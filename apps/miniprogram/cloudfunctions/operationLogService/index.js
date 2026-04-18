/**
 * 功能：操作日志云函数服务
 * 作者：Codex
 * 时间：2026-04-18
 */
'use strict';

const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;
const OPERATION_LOG_COLLECTION = 'operation_logs';
const VIEW_OPERATION_LOGS = 'VIEW_OPERATION_LOGS';

/**
 * 功能：解析 HTTP 或云调用请求体
 * @param {Object} event 云函数事件
 * @returns {Object} 标准请求体
 * @throws {Error} JSON 解析失败时抛出异常
 */
function parseBody(event) {
  if (event.body) {
    return typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  }
  return event || {};
}

/**
 * 功能：从请求头 token 中提取用户 ID
 * @param {Object} event 云函数事件
 * @returns {string} 用户 ID
 * @throws {Error} 无
 */
function getTokenUserId(event) {
  const headers = event.headers || {};
  const authorization = headers.authorization || headers.Authorization || '';
  const token = authorization.replace(/^Bearer\s+/i, '');
  if (!token || !token.startsWith('auth-token-')) return '';
  const parts = token.split('-');
  return parts.slice(3).join('-');
}

/**
 * 功能：读取当前登录用户
 * @param {Object} event 云函数事件
 * @returns {Promise<Object>} 用户上下文
 * @throws {Error} 数据库异常
 */
async function getCurrentUser(event) {
  const userId = getTokenUserId(event);
  if (!userId) {
    return { error: { code: 401, message: '登录状态已失效，请重新登录' } };
  }

  const res = await db.collection('users').doc(userId).get();
  if (!res.data) {
    return { error: { code: 404, message: '用户不存在' } };
  }

  return { userId, user: res.data };
}

/**
 * 功能：判断用户是否有查看日志权限
 * @param {Object} user 用户数据
 * @returns {boolean} 是否有权限
 * @throws {Error} 无
 */
function canViewOperationLogs(user) {
  if (!user) return false;
  if (user.role === 'ADMIN_SUPER') return true;
  if (Array.isArray(user.permissions)) {
    return user.permissions.includes(VIEW_OPERATION_LOGS);
  }
  return false;
}

/**
 * 功能：校验普通字符串安全性
 * @param {string} value 待校验内容
 * @returns {boolean} 是否安全
 * @throws {Error} 无
 */
function isSafeInput(value) {
  if (!value) return true;
  const unsafePattern = /[<>{}[\]\\^%`|]/;
  return !unsafePattern.test(String(value));
}

/**
 * 功能：读取客户端 IP
 * @param {Object} event 云函数事件
 * @returns {string} IP 地址
 * @throws {Error} 无
 */
function getClientIp(event) {
  const headers = event.headers || {};
  return headers['x-forwarded-for'] || headers['X-Forwarded-For'] || headers['x-real-ip'] || headers['X-Real-IP'] || '';
}

/**
 * 功能：格式化云数据库时间
 * @param {*} value 时间值
 * @returns {string} ISO 时间字符串
 * @throws {Error} 无
 */
function normalizeDate(value) {
  if (!value) return new Date().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (value.$date) return new Date(value.$date).toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

/**
 * 功能：格式化日志列表项
 * @param {Object} item 数据库日志
 * @returns {Object} 前端展示日志
 * @throws {Error} 无
 */
function formatLog(item) {
  const createTime = normalizeDate(item.create_time || item.createTime || item.createdAt);
  const dateObj = new Date(createTime);
  const date = Number.isNaN(dateObj.getTime()) ? '' : dateObj.toISOString().slice(0, 10);
  const time = Number.isNaN(dateObj.getTime()) ? '' : dateObj.toTimeString().slice(0, 8);
  const user = item.nickname || item.username || '未知用户';
  const initials = user.slice(0, 1) || '用';

  return {
    id: item._id || item.id,
    date,
    time,
    user,
    username: item.username || '',
    userId: item.user_id || item.userId || '',
    initials,
    avatarClass: item.avatar_class || 'bg-primary/20 text-primary',
    module: item.module || '系统',
    action: item.action || '',
    content: item.content || '',
    status: item.status || '成功',
    ip: item.ip || '',
    userAgent: item.user_agent || '',
    createTime
  };
}

/**
 * 功能：写入操作日志
 * @param {Object} data 日志数据
 * @param {Object} event 云函数事件
 * @returns {Promise<Object>} 写入结果
 * @throws {Error} 数据库异常
 */
async function createOperationLog(data, event) {
  const current = await getCurrentUser(event);
  if (current.error) return current.error;

  const moduleName = String(data.module || '').trim();
  const content = String(data.content || '').trim();
  const action = String(data.action || '').trim();
  const status = String(data.status || '成功').trim();

  if (!moduleName || !content) {
    return { code: 400, message: '缺少日志模块或操作内容' };
  }
  if (![moduleName, content, action, status].every(isSafeInput)) {
    return { code: 400, message: '日志内容包含非法字符' };
  }

  const createTime = new Date();
  const res = await db.collection(OPERATION_LOG_COLLECTION).add({
    data: {
      user_id: current.userId,
      username: current.user.username || '',
      nickname: current.user.nickname || current.user.username || '',
      user_role: current.user.role || '',
      module: moduleName,
      action,
      content,
      status: ['成功', '失败', '警告'].includes(status) ? status : '成功',
      ip: getClientIp(event),
      user_agent: (event.headers && (event.headers['user-agent'] || event.headers['User-Agent'])) || '',
      create_time: createTime.toISOString(),
      create_timestamp: createTime.getTime(),
      createdAt: db.serverDate()
    }
  });

  return {
    code: 0,
    message: '记录成功',
    data: { id: res._id }
  };
}

/**
 * 功能：查询操作日志列表
 * @param {Object} data 查询条件
 * @param {Object} event 云函数事件
 * @returns {Promise<Object>} 日志数据
 * @throws {Error} 数据库异常
 */
async function listOperationLogs(data, event) {
  const current = await getCurrentUser(event);
  if (current.error) return current.error;
  if (!canViewOperationLogs(current.user)) {
    return { code: 403, message: '暂无查看操作记录日志权限' };
  }

  const {
    user = '',
    module = '',
    status = '',
    startDate = '',
    endDate = '',
    page = 1,
    pageSize = 1000
  } = data || {};
  const where = {};

  if (user) where.nickname = user;
  if (module) where.module = module;
  if (status) where.status = status;

  if (startDate || endDate) {
    const startTime = startDate ? new Date(`${startDate}T00:00:00`).getTime() : 0;
    const endTime = endDate ? new Date(`${endDate}T23:59:59`).getTime() : Date.now();
    where.create_timestamp = _.gte(startTime).and(_.lte(endTime));
  }

  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.min(1000, Math.max(1, Number(pageSize) || 1000));
  const countRes = await db.collection(OPERATION_LOG_COLLECTION).where(where).count();
  const res = await db.collection(OPERATION_LOG_COLLECTION)
    .where(where)
    .orderBy('create_timestamp', 'desc')
    .skip((safePage - 1) * safePageSize)
    .limit(safePageSize)
    .get();

  const allRes = await db.collection(OPERATION_LOG_COLLECTION)
    .orderBy('create_timestamp', 'desc')
    .limit(1000)
    .get();
  const allLogs = allRes.data || [];
  const users = Array.from(new Set(allLogs.map(item => item.nickname || item.username).filter(Boolean)));
  const modules = Array.from(new Set(allLogs.map(item => item.module).filter(Boolean)));
  const today = new Date().toISOString().slice(0, 10);
  const failedCount = allLogs.filter(item => item.status === '失败').length;
  const warningCount = allLogs.filter(item => item.status === '警告').length;
  const moduleMap = allLogs.reduce((map, item) => {
    const moduleName = item.module || '系统';
    map[moduleName] = (map[moduleName] || 0) + 1;
    return map;
  }, {});
  const activeModule = Object.entries(moduleMap).sort((a, b) => b[1] - a[1])[0]?.[0] || '-';

  return {
    code: 0,
    message: '查询成功',
    data: {
      list: (res.data || []).map(formatLog),
      total: countRes.total || 0,
      users,
      modules,
      stats: {
        todayCount: allLogs.filter(item => normalizeDate(item.create_time).slice(0, 10) === today).length,
        abnormalCount: failedCount + warningCount,
        activeModule
      }
    }
  };
}

exports.main = async (event, context) => {
  let body = {};
  try {
    body = parseBody(event);
  } catch (error) {
    return { code: 400, message: '请求格式错误' };
  }

  const action = body.action;
  const data = body.data || {};

  try {
    switch (action) {
      case 'list':
        return await listOperationLogs(data, event);
      case 'create':
        return await createOperationLog(data, event);
      default:
        return { code: 400, message: '未知操作' };
    }
  } catch (error) {
    console.error('操作日志服务异常', error);
    return { code: 500, message: '操作失败', error: error.message };
  }
};
