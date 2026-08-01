'use strict';

const cloud = require('wx-server-sdk');
const crypto = require('crypto');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const SESSION_COLLECTION = 'auth_sessions';
const NOTIFICATION_COLLECTION = 'notifications';
const PROJECT_CHANGE_EVENT_COLLECTION = 'project_change_events';
const ADMIN_SUPER_ROLE = 'ADMIN_SUPER';
const WECHAT_SUBSCRIBE_TEMPLATE_ID = 'YQoHfMgZd9EnpJGKxzGO2yGcB0ZyK4V8_eLMpQXbrJY';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const READ_STATUS = Object.freeze({ UNREAD: 'unread', READ: 'read' });
const READ_STATUS_DICTIONARY = Object.freeze({
  [READ_STATUS.UNREAD]: { value: READ_STATUS.UNREAD, label: '未读' },
  [READ_STATUS.READ]: { value: READ_STATUS.READ, label: '已读' }
});
const WECHAT_SUBSCRIPTION_STATUS = Object.freeze({
  NOT_BOUND: 'not_bound',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  BANNED: 'banned'
});
const WECHAT_SUBSCRIPTION_STATUS_DICTIONARY = Object.freeze({
  [WECHAT_SUBSCRIPTION_STATUS.NOT_BOUND]: { value: WECHAT_SUBSCRIPTION_STATUS.NOT_BOUND, label: '未开启' },
  [WECHAT_SUBSCRIPTION_STATUS.ACCEPTED]: { value: WECHAT_SUBSCRIPTION_STATUS.ACCEPTED, label: '已授权' },
  [WECHAT_SUBSCRIPTION_STATUS.REJECTED]: { value: WECHAT_SUBSCRIPTION_STATUS.REJECTED, label: '已拒绝' },
  [WECHAT_SUBSCRIPTION_STATUS.BANNED]: { value: WECHAT_SUBSCRIPTION_STATUS.BANNED, label: '已在微信设置中关闭' }
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

async function listNotificationIds(data, current) {
  const readStatus = normalizeReadStatus(data.readStatus);
  const list = await getUserNotifications(current.userId);
  const filtered = readStatus
    ? list.filter(item => item.readStatus === readStatus)
    : list;
  return {
    code: 0,
    message: '查询成功',
    data: { ids: filtered.map(item => item._id) }
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

function normalizeNotificationIds(data) {
  const values = Array.isArray(data.ids) ? data.ids : [data.id];
  return Array.from(new Set(values.map(value => String(value || '').trim()).filter(Boolean))).slice(0, 1000);
}

async function deleteNotifications(data, current) {
  const ids = normalizeNotificationIds(data);
  if (!ids.length) return { code: 400, message: '请选择要删除的消息' };

  const userNotifications = await getUserNotifications(current.userId);
  const allowedIds = userNotifications
    .filter(item => ids.includes(item._id))
    .map(item => item._id);
  if (!allowedIds.length) return { code: 404, message: '消息不存在或已删除' };

  const batchSize = 20;
  for (let index = 0; index < allowedIds.length; index += batchSize) {
    const batch = allowedIds.slice(index, index + batchSize);
    await Promise.all(batch.map(id => db.collection(NOTIFICATION_COLLECTION).doc(id).remove()));
  }
  return {
    code: 0,
    message: '删除成功',
    data: { deleted: allowedIds.length }
  };
}

function forbiddenSubscription() {
  return { code: 403, message: '仅超级系统管理员可以设置微信消息提醒' };
}

function normalizeWechatSubscriptionStatus(value) {
  return Object.prototype.hasOwnProperty.call(WECHAT_SUBSCRIPTION_STATUS_DICTIONARY, value)
    ? value
    : WECHAT_SUBSCRIPTION_STATUS.REJECTED;
}

function formatWechatSubscription(user) {
  const status = normalizeWechatSubscriptionStatus(
    user.wechatSubscriptionStatus || WECHAT_SUBSCRIPTION_STATUS.NOT_BOUND
  );
  const availableCount = Math.max(0, Number(user.wechatSubscriptionAvailableCount) || 0);
  const statusLabel = availableCount > 0
    ? '已开启'
    : (status === WECHAT_SUBSCRIPTION_STATUS.ACCEPTED
      ? '提醒次数已用完'
      : WECHAT_SUBSCRIPTION_STATUS_DICTIONARY[status].label);
  return {
    templateId: WECHAT_SUBSCRIBE_TEMPLATE_ID,
    status,
    statusLabel,
    isBound: Boolean(user.wechatOpenId),
    availableCount,
    canReceive: Boolean(user.wechatOpenId && availableCount > 0)
  };
}

async function getWechatSubscriptionStatus(current) {
  if (current.user.role !== ADMIN_SUPER_ROLE) return forbiddenSubscription();
  return {
    code: 0,
    message: '查询成功',
    data: formatWechatSubscription(current.user)
  };
}

async function saveWechatSubscription(data, current) {
  if (current.user.role !== ADMIN_SUPER_ROLE) return forbiddenSubscription();
  if (data.templateId !== WECHAT_SUBSCRIBE_TEMPLATE_ID) {
    return { code: 400, message: '订阅消息模板不匹配' };
  }
  const status = normalizeWechatSubscriptionStatus(data.status);
  const wxContext = cloud.getWXContext();
  const openId = String(wxContext.OPENID || '').trim();
  if (!openId) {
    return { code: 400, message: '请在微信小程序真机环境中开启消息提醒' };
  }

  const sameWechatResult = await db.collection('users').where({ wechatOpenId: openId }).get();
  const duplicatedUsers = (sameWechatResult.data || []).filter(user => user._id !== current.userId);
  await Promise.all(duplicatedUsers.map(user => db.collection('users').doc(user._id).update({
    data: {
      wechatOpenId: db.command.remove(),
      wechatSubscriptionStatus: WECHAT_SUBSCRIPTION_STATUS.NOT_BOUND,
      wechatSubscriptionStatusLabel: WECHAT_SUBSCRIPTION_STATUS_DICTIONARY[WECHAT_SUBSCRIPTION_STATUS.NOT_BOUND].label,
      wechatSubscriptionAvailableCount: 0,
      updateTime: db.serverDate()
    }
  })));

  const updateData = {
    wechatOpenId: openId,
    wechatSubscriptionTemplateId: WECHAT_SUBSCRIBE_TEMPLATE_ID,
    wechatSubscriptionStatus: status,
    wechatSubscriptionStatusLabel: WECHAT_SUBSCRIPTION_STATUS_DICTIONARY[status].label,
    wechatSubscriptionUpdatedTimestamp: Date.now(),
    wechatSubscriptionUpdatedAt: db.serverDate(),
    updateTime: db.serverDate()
  };
  if (status === WECHAT_SUBSCRIPTION_STATUS.ACCEPTED) {
    updateData.wechatSubscriptionAvailableCount = db.command.inc(1);
  }
  await db.collection('users').doc(current.userId).update({ data: updateData });
  const latest = await db.collection('users').doc(current.userId).get();
  return {
    code: 0,
    message: status === WECHAT_SUBSCRIPTION_STATUS.ACCEPTED ? '微信提醒已开启一次' : '订阅状态已更新',
    data: formatWechatSubscription(latest.data || {})
  };
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
      case 'listIds':
        return await listNotificationIds(data, current);
      case 'detail':
        return await getNotificationDetail(data, current);
      case 'markAllRead':
        return await markAllRead(current);
      case 'delete':
      case 'deleteBatch':
        return await deleteNotifications(data, current);
      case 'getWechatSubscriptionStatus':
        return await getWechatSubscriptionStatus(current);
      case 'saveWechatSubscription':
        return await saveWechatSubscription(data, current);
      default:
        return { code: 400, message: '未知操作' };
    }
  } catch (error) {
    console.error('通知服务操作失败:', error);
    return { code: 500, message: '通知服务暂时不可用', error: error.message };
  }
};
