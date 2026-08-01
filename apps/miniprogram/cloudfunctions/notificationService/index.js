'use strict';

const cloud = require('wx-server-sdk');
const crypto = require('crypto');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const SESSION_COLLECTION = 'auth_sessions';
const NOTIFICATION_COLLECTION = 'notifications';
const PROJECT_CHANGE_EVENT_COLLECTION = 'project_change_events';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const READ_STATUS = Object.freeze({ UNREAD: 'unread', READ: 'read' });
const READ_STATUS_DICTIONARY = Object.freeze({
  [READ_STATUS.UNREAD]: { value: READ_STATUS.UNREAD, label: '未读' },
  [READ_STATUS.READ]: { value: READ_STATUS.READ, label: '已读' }
});

function parseBody(event) {
  if (event.body) return typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  return event || {};
}

function getAuthToken(event, data) {
  const headers = event.headers || {};
  const authorization = headers.authorization || headers.Authorization || '';
  return String(
    data.authToken
    || event.authToken
    || authorization.replace(/^Bearer\s+/i, '')
    || ''
  ).trim();
}

async function authenticate(event, data) {
  const token = getAuthToken(event, data);
  if (!token) return { error: { code: 401, message: '请先登录' } };
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const sessionResult = await db.collection(SESSION_COLLECTION).where({ tokenHash }).limit(1).get();
  const session = (sessionResult.data || [])[0];
  if (!session || Number(session.expiresAt || 0) <= Date.now()) {
    return { error: { code: 401, message: '登录状态已失效，请重新登录' } };
  }
  const now = Date.now();
  if (!session.lastActiveAt || now - Number(session.lastActiveAt) >= SESSION_TOUCH_INTERVAL_MS) {
    db.collection(SESSION_COLLECTION).doc(session._id).update({
      data: {
        lastActiveAt: now,
        expiresAt: now + SESSION_TTL_MS,
        updateTime: db.serverDate()
      }
    }).catch(() => {});
  }
  const userResult = await db.collection('users').doc(session.userId).get();
  if (!userResult.data) return { error: { code: 404, message: '用户不存在' } };
  if (userResult.data.status && userResult.data.status !== 'active') {
    return { error: { code: 403, message: '账号已停用' } };
  }
  return { userId: session.userId, user: userResult.data };
}

function normalizeReadStatus(value) {
  return Object.prototype.hasOwnProperty.call(READ_STATUS_DICTIONARY, value)
    ? value
    : '';
}

function getNotificationTimestamp(item) {
  if (Number(item.createdTimestamp)) return Number(item.createdTimestamp);
  const raw = item.createdAt?.$date || item.createdAt;
  const date = new Date(raw || 0);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

async function getUserNotifications(userId) {
  const result = await db.collection(NOTIFICATION_COLLECTION)
    .where({ recipientUserId: userId })
    .limit(1000)
    .get();
  return (result.data || []).sort((a, b) => getNotificationTimestamp(b) - getNotificationTimestamp(a));
}

async function listNotifications(data, current) {
  const page = Math.max(1, Number(data.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(data.pageSize) || 20));
  const readStatus = normalizeReadStatus(data.readStatus);
  const allNotifications = await getUserNotifications(current.userId);
  const filtered = readStatus
    ? allNotifications.filter(item => item.readStatus === readStatus)
    : allNotifications;
  const unreadCount = allNotifications.filter(item => item.readStatus === READ_STATUS.UNREAD).length;
  const start = (page - 1) * pageSize;
  return {
    code: 0,
    message: '查询成功',
    data: {
      list: filtered.slice(start, start + pageSize),
      total: filtered.length,
      unreadCount,
      page,
      pageSize,
      hasMore: page * pageSize < filtered.length
    }
  };
}

async function getUnreadCount(current) {
  const list = await getUserNotifications(current.userId);
  return {
    code: 0,
    message: '查询成功',
    data: { count: list.filter(item => item.readStatus === READ_STATUS.UNREAD).length }
  };
}

async function getNotificationDetail(data, current) {
  const id = String(data.id || '').trim();
  if (!id) return { code: 400, message: '缺少通知 ID' };
  const notificationResult = await db.collection(NOTIFICATION_COLLECTION).doc(id).get();
  const notification = notificationResult.data;
  if (!notification || notification.recipientUserId !== current.userId) {
    return { code: 404, message: '通知不存在' };
  }
  const eventResult = notification.eventId
    ? await db.collection(PROJECT_CHANGE_EVENT_COLLECTION).doc(notification.eventId).get()
    : { data: null };
  if (notification.readStatus !== READ_STATUS.READ) {
    await db.collection(NOTIFICATION_COLLECTION).doc(id).update({
      data: {
        readStatus: READ_STATUS.READ,
        readStatusLabel: READ_STATUS_DICTIONARY[READ_STATUS.READ].label,
        readTimestamp: Date.now(),
        readAt: db.serverDate()
      }
    });
    notification.readStatus = READ_STATUS.READ;
    notification.readStatusLabel = READ_STATUS_DICTIONARY[READ_STATUS.READ].label;
  }
  return {
    code: 0,
    message: '查询成功',
    data: { notification, event: eventResult.data || null }
  };
}

async function markAllRead(current) {
  const list = await getUserNotifications(current.userId);
  const unread = list.filter(item => item.readStatus === READ_STATUS.UNREAD);
  const now = Date.now();
  await Promise.all(unread.map(item => db.collection(NOTIFICATION_COLLECTION).doc(item._id).update({
    data: {
      readStatus: READ_STATUS.READ,
      readStatusLabel: READ_STATUS_DICTIONARY[READ_STATUS.READ].label,
      readTimestamp: now,
      readAt: db.serverDate()
    }
  })));
  return { code: 0, message: '已全部标记为已读', data: { updated: unread.length } };
}

exports.main = async (event) => {
  let body;
  try {
    body = parseBody(event);
  } catch (error) {
    return { code: 400, message: '请求格式错误' };
  }
  const action = body.action;
  const data = body.data || {};
  try {
    const current = await authenticate(event, data);
    if (current.error) return current.error;
    switch (action) {
      case 'list':
        return await listNotifications(data, current);
      case 'unreadCount':
        return await getUnreadCount(current);
      case 'detail':
        return await getNotificationDetail(data, current);
      case 'markAllRead':
        return await markAllRead(current);
      default:
        return { code: 400, message: '未知操作' };
    }
  } catch (error) {
    console.error('通知服务操作失败:', error);
    return { code: 500, message: '通知服务暂时不可用', error: error.message };
  }
};
