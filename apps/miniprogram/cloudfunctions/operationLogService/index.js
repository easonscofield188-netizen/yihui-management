/**
 * 功能：操作日志云函数服务，支持异步队列、批量写入、查询过滤和过期清理
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
const WRITE_ACTIONS = new Set(['create', 'add', 'insert', 'update', 'edit', 'modify', 'delete', 'remove']);
const WRITE_STATUS = new Set(['成功', '失败', '警告']);
const ACTION_ALIAS_MAP = {
  add: 'create',
  insert: 'create',
  edit: 'update',
  modify: 'update',
  remove: 'delete'
};
const MAX_CONTENT_LENGTH = 80;
const MAX_BATCH_SIZE = 20;
const FLUSH_DELAY_MS = 120;
const LOG_RETENTION_DAYS = 180;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

let logQueue = [];
let flushTimer = null;
let flushing = false;
let lastCleanupTime = 0;

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
 * 功能：判断是否需要记录该操作
 * @param {string} action 操作类型
 * @returns {boolean} 是否写日志
 * @throws {Error} 无
 */
function shouldRecordAction(action) {
  return WRITE_ACTIONS.has(String(action || '').trim().toLowerCase());
}

/**
 * 功能：标准化日志动作
 * @param {string} action 操作类型
 * @returns {string} 标准动作
 * @throws {Error} 无
 */
function normalizeAction(action) {
  const value = String(action || '').trim().toLowerCase();
  return ACTION_ALIAS_MAP[value] || value;
}

/**
 * 功能：裁剪字符串，减少传输和存储开销
 * @param {*} value 字段值
 * @param {number} maxLength 最大长度
 * @returns {string} 裁剪后的字符串
 * @throws {Error} 无
 */
function slimText(value, maxLength = MAX_CONTENT_LENGTH) {
  const text = String(value || '').trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
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
 * 功能：兼容新旧字段并格式化日志列表项
 * @param {Object} item 数据库日志
 * @returns {Object} 前端展示日志
 * @throws {Error} 无
 */
function formatLog(item) {
  const timestamp = item.ts || item.create_timestamp || Date.now();
  const createTime = item.create_time || normalizeDate(timestamp);
  const dateObj = new Date(createTime);
  const date = Number.isNaN(dateObj.getTime()) ? '' : dateObj.toISOString().slice(0, 10);
  const time = Number.isNaN(dateObj.getTime()) ? '' : dateObj.toTimeString().slice(0, 8);
  const user = item.un || item.nickname || item.username || '未知用户';
  const initials = user.slice(0, 1) || '用';

  return {
    id: item._id || item.id,
    date,
    time,
    user,
    username: item.username || '',
    userId: item.uid || item.user_id || item.userId || '',
    initials,
    avatarClass: 'bg-primary/20 text-primary',
    module: item.m || item.module || '系统',
    action: item.a || item.action || '',
    content: item.c || item.content || '',
    status: item.s || item.status || '成功',
    createTime
  };
}

/**
 * 功能：构造精简日志记录
 * @param {Object} data 原始日志
 * @param {Object} current 当前用户
 * @returns {Object|null} 精简日志
 * @throws {Error} 无
 */
function buildSlimLog(data, current) {
  const action = normalizeAction(data.action);
  if (!shouldRecordAction(action)) return null;

  const moduleName = slimText(data.module, 24);
  const content = slimText(data.content || data.title || data.name);
  if (!moduleName || !content) return null;

  const status = slimText(data.status || '成功', 4);
  const now = Date.now();

  return {
    uid: current.userId,
    un: slimText(current.user.nickname || current.user.username || '', 20),
    m: moduleName,
    a: action,
    c: content,
    s: WRITE_STATUS.has(status) ? status : '成功',
    ts: now
  };
}

/**
 * 功能：使用批量写入方式落库，失败时自动降级为逐条写入
 * @param {Array<Object>} logs 日志列表
 * @returns {Promise<number>} 成功写入数量
 * @throws {Error} 外层捕获，避免影响业务
 */
async function batchAddLogs(logs) {
  if (!logs.length) return 0;

  try {
    await db.collection(OPERATION_LOG_COLLECTION).add({
      data: logs
    });
    return logs.length;
  } catch (batchError) {
    let successCount = 0;
    for (const log of logs) {
      try {
        await db.collection(OPERATION_LOG_COLLECTION).add({
          data: log
        });
        successCount += 1;
      } catch (error) {
        console.warn('单条操作日志写入失败，已降级忽略', error.message || error);
      }
    }
    return successCount;
  }
}

/**
 * 功能：立即刷新队列，按批次写入数据库
 * @returns {Promise<number>} 成功写入数量
 * @throws {Error} 内部降级，不向业务抛出
 */
async function flushLogQueue() {
  if (flushing || !logQueue.length) return 0;
  flushing = true;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  let successCount = 0;
  try {
    while (logQueue.length) {
      const batch = logQueue.splice(0, MAX_BATCH_SIZE);
      successCount += await batchAddLogs(batch);
    }
  } catch (error) {
    console.warn('批量写入操作日志失败，已降级忽略', error.message || error);
  } finally {
    flushing = false;
  }

  return successCount;
}

/**
 * 功能：安排异步刷新，不阻塞当前接口响应
 * @returns {void}
 * @throws {Error} 无
 */
function scheduleFlushLogQueue() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushLogQueue().catch(error => {
      console.warn('异步刷新操作日志失败，已忽略', error.message || error);
    });
  }, FLUSH_DELAY_MS);
}

/**
 * 功能：入队日志，达到批量阈值时触发写入
 * @param {Object|Array<Object>} logs 日志或日志列表
 * @returns {number} 入队数量
 * @throws {Error} 无
 */
function enqueueLogs(logs) {
  const list = Array.isArray(logs) ? logs : [logs];
  const validLogs = list.filter(Boolean);
  if (!validLogs.length) return 0;

  logQueue.push(...validLogs);
  if (logQueue.length >= MAX_BATCH_SIZE) {
    flushLogQueue().catch(error => {
      console.warn('批量写入操作日志失败，已忽略', error.message || error);
    });
  } else {
    scheduleFlushLogQueue();
  }

  return validLogs.length;
}

/**
 * 功能：按保留周期清理过期日志
 * @param {Object} params 清理参数
 * @returns {Promise<Object>} 清理结果
 * @throws {Error} 数据库异常
 */
async function cleanExpiredLogs(params = {}) {
  const retentionDays = Math.max(1, Number(params.retentionDays) || LOG_RETENTION_DAYS);
  const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const res = await db.collection(OPERATION_LOG_COLLECTION)
    .where({
      ts: _.lt(cutoffTime)
    })
    .remove();
  const legacyRes = await db.collection(OPERATION_LOG_COLLECTION)
    .where({
      create_timestamp: _.lt(cutoffTime)
    })
    .remove();

  return {
    code: 0,
    message: '清理完成',
    data: {
      deleted: (res.stats?.removed || res.deleted || 0) + (legacyRes.stats?.removed || legacyRes.deleted || 0),
      cutoffTime
    }
  };
}

/**
 * 功能：定期触发清理，失败不影响日志写入
 * @returns {void}
 * @throws {Error} 无
 */
function scheduleCleanupIfNeeded() {
  const now = Date.now();
  if (now - lastCleanupTime < CLEANUP_INTERVAL_MS) return;
  lastCleanupTime = now;
  cleanExpiredLogs().catch(error => {
    console.warn('定期清理操作日志失败，已忽略', error.message || error);
  });
}

/**
 * 功能：异步创建操作日志
 * @param {Object} data 日志数据
 * @param {Object} event 云函数事件
 * @returns {Promise<Object>} 接收结果
 * @throws {Error} 内部降级，不向业务抛出
 */
async function createOperationLog(data, event) {
  try {
    const current = await getCurrentUser(event);
    if (current.error) return current.error;

    const log = buildSlimLog(data || {}, current);
    if (!log) {
      return { code: 0, message: '已忽略无需记录的操作', data: { ignored: true } };
    }

    const queued = enqueueLogs(log);
    scheduleCleanupIfNeeded();
    return { code: 0, message: '日志已入队', data: { queued } };
  } catch (error) {
    console.warn('操作日志入队失败，已降级忽略', error.message || error);
    return { code: 0, message: '日志降级忽略', data: { degraded: true } };
  }
}

/**
 * 功能：批量创建操作日志
 * @param {Object} data 日志批量数据
 * @param {Object} event 云函数事件
 * @returns {Promise<Object>} 接收结果
 * @throws {Error} 内部降级，不向业务抛出
 */
async function batchCreateOperationLogs(data, event) {
  try {
    const current = await getCurrentUser(event);
    if (current.error) return current.error;

    const rows = Array.isArray(data?.list) ? data.list : (Array.isArray(data) ? data : []);
    const logs = rows
      .map(item => buildSlimLog(item || {}, current))
      .filter(Boolean);

    const queued = enqueueLogs(logs);
    scheduleCleanupIfNeeded();
    return { code: 0, message: '日志已批量入队', data: { queued, ignored: rows.length - queued } };
  } catch (error) {
    console.warn('批量操作日志入队失败，已降级忽略', error.message || error);
    return { code: 0, message: '日志降级忽略', data: { degraded: true } };
  }
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

  if (user) where.un = user;
  if (module) where.m = module;
  if (status) where.s = status;

  if (startDate || endDate) {
    const startTime = startDate ? new Date(`${startDate}T00:00:00`).getTime() : 0;
    const endTime = endDate ? new Date(`${endDate}T23:59:59`).getTime() : Date.now();
    where.ts = _.gte(startTime).and(_.lte(endTime));
  }

  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.min(1000, Math.max(1, Number(pageSize) || 1000));
  const countRes = await db.collection(OPERATION_LOG_COLLECTION).where(where).count();
  const res = await db.collection(OPERATION_LOG_COLLECTION)
    .where(where)
    .orderBy('ts', 'desc')
    .skip((safePage - 1) * safePageSize)
    .limit(safePageSize)
    .get();

  const allRes = await db.collection(OPERATION_LOG_COLLECTION)
    .orderBy('ts', 'desc')
    .limit(1000)
    .get();
  const allLogs = allRes.data || [];
  const users = Array.from(new Set(allLogs.map(item => item.un || item.nickname || item.username).filter(Boolean)));
  const modules = Array.from(new Set(allLogs.map(item => item.m || item.module).filter(Boolean)));
  const today = new Date().toISOString().slice(0, 10);
  const failedCount = allLogs.filter(item => (item.s || item.status) === '失败').length;
  const warningCount = allLogs.filter(item => (item.s || item.status) === '警告').length;
  const moduleMap = allLogs.reduce((map, item) => {
    const moduleName = item.m || item.module || '系统';
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
        todayCount: allLogs.filter(item => normalizeDate(item.ts || item.create_timestamp).slice(0, 10) === today).length,
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
      case 'batchCreate':
        return await batchCreateOperationLogs(data, event);
      case 'flush':
        return { code: 0, message: '刷新完成', data: { saved: await flushLogQueue() } };
      case 'cleanExpired':
        return await cleanExpiredLogs(data);
      default:
        return { code: 400, message: '未知操作' };
    }
  } catch (error) {
    console.warn('操作日志服务异常，已降级忽略', error.message || error);
    return { code: 0, message: '日志服务降级忽略', data: { degraded: true } };
  }
};
