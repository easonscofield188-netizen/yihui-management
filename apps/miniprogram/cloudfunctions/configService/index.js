/**
 * 腾讯云函数: configService
 * 功能：配置管理（全局配置聚合、配置查询等）
 * 运行环境: Node.js 16+
 */
'use strict';

const crypto = require('crypto');
const https = require('https');
const cloud = require("wx-server-sdk");

// 初始化云开发环境
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const SESSION_COLLECTION = 'auth_sessions';
const QUOTATION_COLLECTION = 'project_quotations';
const ADMIN_SUPER_ROLE = 'ADMIN_SUPER';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const READ_ROLES = new Set(['ADMIN_SUPER', 'ADMIN_COM', 'ADMIN', 'PROJECT_MANAGER', 'FINANCE_MANAGER', 'VISITOR', 'user']);
const ALLOWED_GROUPS = new Set(['CLIENT_ROLE', 'COST_CATEGORY', 'CLIENT_SOURCE', 'PROJECT_SCENE']);

// --- 服务器内存缓存变量 ---
// 注意：云函数实例在“温热”状态下会保留全局变量
let configCache = null;      // 缓存数据对象
let lastUpdateTime = 0;      // 上次更新时间戳
const CACHE_TTL = 12 * 60 * 60 * 1000; // 缓存时长：12小时（毫秒）

/**
 * 云函数入口
 */
exports.main = async (event, context) => {
  // 尝试多种参数获取方式
  let action, data;
  
  // 方式1: 直接从event获取（云函数直接调用）
  if (event.action) {
    action = event.action;
    data = event.data;
    console.log('方式1获取到action:', action);
  }
  // 方式2: 从event.body获取（HTTP访问服务）
  else if (event.body) {
    try {
      const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
      action = body.action;
      data = body.data;
      console.log('方式2获取到action:', action);
    } catch (e) {
      console.error('解析body失败:', e);
    }
  }
  
  try {
    const auth = await authenticate(event, data || {});
    if (auth.error) return auth.error;
    if (!READ_ROLES.has(auth.user.role || 'user')) return forbidden();
    // 根据操作类型执行相应的函数
    switch (action) {
      case 'getGlobalConfig':
        return await getGlobalConfig(data);
      case 'queryConfig':
        if (auth.user.role !== ADMIN_SUPER_ROLE) return forbidden();
        return await queryConfig(data);
      case 'createConfig':
        if (auth.user.role !== ADMIN_SUPER_ROLE) return forbidden();
        return await createConfig(data);
      case 'updateConfigStatus':
        if (auth.user.role !== ADMIN_SUPER_ROLE) return forbidden();
        return await updateConfigStatus(data);
      case 'getConfigUsage':
        if (auth.user.role !== ADMIN_SUPER_ROLE) return forbidden();
        return await getConfigUsage(data);
      case 'updateConfig':
        if (auth.user.role !== ADMIN_SUPER_ROLE) return forbidden();
        return await updateConfig(data, auth.user);
      case 'reorderConfig':
        if (auth.user.role !== ADMIN_SUPER_ROLE) return forbidden();
        return await reorderConfig(data);
      case 'deleteConfig':
        if (auth.user.role !== ADMIN_SUPER_ROLE) return forbidden();
        return await deleteConfig(data, auth.user);
      default:
        // 处理未知操作
        return {
          code: 400,
          message: '未知操作',
          receivedAction: action
        };
    }
  } catch (error) {
    // 捕获并处理错误
    console.error('配置管理操作失败', error);
    return {
      code: 500,
      message: '操作失败',
      error: error.message
    };
  }
};

function forbidden() {
  return { code: 403, message: '当前账号无此操作权限' };
}

function getAuthToken(event, data) {
  const headers = event.headers || {};
  const authorization = headers.authorization || headers.Authorization || '';
  return String(data.authToken || event.authToken || authorization.replace(/^Bearer\s+/i, '') || '').trim();
}

async function authenticate(event, data) {
  const token = getAuthToken(event, data || {});
  if (!token) return { error: { code: 401, message: '请先登录' } };
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const sessionResult = await db.collection(SESSION_COLLECTION).where({ tokenHash }).limit(1).get();
  const session = (sessionResult.data || [])[0];
  if (!session || Number(session.expiresAt || 0) <= Date.now()) {
    if (session && session._id) db.collection(SESSION_COLLECTION).doc(session._id).remove().catch(() => {});
    return { error: { code: 401, message: '登录状态已失效，请重新登录' } };
  }
  const now = Date.now();
  if (!session.lastActiveAt || now - Number(session.lastActiveAt) >= SESSION_TOUCH_INTERVAL_MS) {
    db.collection(SESSION_COLLECTION).doc(session._id).update({
      data: { lastActiveAt: now, expiresAt: now + SESSION_TTL_MS, updateTime: db.serverDate() }
    }).catch(() => {});
  }
  const userResult = await db.collection('users').doc(session.userId).get();
  if (!userResult.data) return { error: { code: 401, message: '用户不存在或已停用' } };
  if (userResult.data.status && userResult.data.status !== 'active') return { error: forbidden() };
  return { user: { ...userResult.data, id: session.userId } };
}

/**
 * 获取全局聚合配置（带服务器内存缓存）
 */
async function getGlobalConfig(params) {
  const now = Date.now();
  const { forceRefresh = false } = params || {}; // 支持强制刷新参数

  // 1. 判断内存缓存是否有效 (如果不强制刷新且缓存未过期)
  if (!forceRefresh && configCache && (now - lastUpdateTime < CACHE_TTL)) {
    console.log('🚀 [Cache Hit] 从服务器内存返回聚合配置数据');
    return {
      code: 0,
      message: 'success (from server cache)',
      data: configCache
    };
  }

  try {
    console.log(forceRefresh ? '🔄 [Force Refresh] 正在强制从数据库同步...' : '📡 [Cache Miss] 缓存失效，正在查询数据库...');
    
    // 2. 查询所有启用的配置项 (isActive == true)
    // 注意：移除 .orderBy()，防止缺少该字段的数据被过滤
    // 显式设置 .limit(1000)，防止默认只返回 20 条
    const res = await db.collection('system_configs')
      .where({
        isActive: true
      })
      .limit(1000) 
      .get();

    // 3. 将扁平化的数据库记录按 group 字段进行分组处理
    const groupedConfig = {};
    res.data.forEach(item => {
      const groupName = item.group || 'DEFAULT';
      if (!groupedConfig[groupName]) {
        groupedConfig[groupName] = [];
      }
      
      // 容错处理：如果缺少 value，使用 label 或 _id
      const val = item.value !== undefined ? item.value : (item.label || item._id);
      
      groupedConfig[groupName].push({
        id: item._id || item.id,
        label: item.label || '未命名',
        value: val,
        commonUnit: String(item.commonUnit || '').trim(),
        sortOrder: item.sortOrder !== undefined ? item.sortOrder : 999 // 默认排在最后
      });
    });

    // 4. 在内存中进行排序，确保即使字段缺失也能正常显示
    Object.keys(groupedConfig).forEach(key => {
      groupedConfig[key].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
    });

    // 5. 更新内存缓存及时间戳
    configCache = groupedConfig;
    lastUpdateTime = now;

    return {
      code: 0,
      message: 'success (refreshed from db)',
      data: configCache
    };
  } catch (err) {
    console.error('❌ 获取全局配置失败:', err);
    return {
      code: 500,
      message: '服务器内部错误',
      error: err.message
    };
  }
}

function isSafeInput(str) {
  if (!str) return true;
  const unsafePattern = /[<>{}[\]\\^%`|]/;
  return !unsafePattern.test(str);
}

/**
 * 生成 MD5 签名
 * @param {string} text - 待签名文本
 * @returns {string} MD5 签名
 * @throws {Error} 无
 */
function md5(text) {
  return crypto.createHash('md5').update(text, 'utf8').digest('hex');
}

/**
 * 规范化翻译结果为数据库 value
 * @param {string} text - 英文翻译文本
 * @returns {string} 英文唯一标识基础值
 * @throws {Error} 无
 */
function normalizeTranslatedValue(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_')
    .slice(0, 40);
}

/**
 * 调用百度翻译将中文配置名翻译为英文
 * @param {string} label - 中文配置名
 * @returns {Promise<string>} 英文翻译文本
 * @throws {Error} 百度翻译接口异常
 */
function translateByBaidu(label) {
  return new Promise((resolve, reject) => {
    const appId = process.env.BAIDU_TRANSLATE_APP_ID;
    const appKey = process.env.BAIDU_TRANSLATE_APP_KEY;
    const q = String(label || '').trim();

    if (!q) {
      resolve('');
      return;
    }
    if (!appId || !appKey) {
      reject(new Error('百度翻译环境变量未配置'));
      return;
    }

    const salt = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
    const sign = md5(`${appId}${q}${salt}${appKey}`);
    const params = new URLSearchParams({
      q,
      from: 'zh',
      to: 'en',
      appid: appId,
      salt,
      sign
    });
    const body = params.toString();

    const req = https.request({
      hostname: 'fanyi-api.baidu.com',
      path: '/api/trans/vip/translate',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 5000
    }, (res) => {
      let responseBody = '';

      res.on('data', chunk => {
        responseBody += chunk;
      });

      res.on('end', () => {
        try {
          const result = JSON.parse(responseBody);
          if (result.error_code) {
            reject(new Error(result.error_msg || `百度翻译失败：${result.error_code}`));
            return;
          }

          resolve(result.trans_result?.[0]?.dst || '');
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('百度翻译请求超时'));
    });
    req.write(body);
    req.end();
  });
}

function normalizeEnglishValue(label) {
  const raw = String(label || '').trim().toLowerCase();
  const asciiValue = raw
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');

  if (asciiValue) return asciiValue;

  const wordMap = {
    '老': 'old',
    '客户': 'client',
    '推荐': 'referral',
    '官网': 'official_site',
    '咨询': 'inquiry',
    '行业': 'industry',
    '展会': 'exhibition',
    '线上': 'online',
    '搜索': 'search',
    '主动': 'active',
    '开发': 'outreach',
    '其他': 'other',
    '真': 'real',
    '植物': 'plant',
    '仿真': 'artificial',
    '人工': 'labor',
    '餐食': 'meal',
    '石材': 'stone',
    '铺装': 'paving',
    '项目': 'project',
    '经理': 'manager',
    '老板': 'boss',
    '本人': 'owner',
    '中间人': 'agent',
    '负责人': 'principal',
    '采购': 'purchase',
    '代理': 'agent',
    '设计': 'design',
    '代表': 'representative',
    '甲方': 'client'
  };

  let converted = raw;
  Object.keys(wordMap)
    .sort((a, b) => b.length - a.length)
    .forEach(key => {
      converted = converted.replace(new RegExp(key, 'g'), `_${wordMap[key]}_`);
    });

  const mappedValue = converted
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');

  if (mappedValue) return mappedValue;

  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) - hash) + raw.charCodeAt(i);
    hash |= 0;
  }
  return `config_${Math.abs(hash)}`;
}

async function ensureUniqueValue(group, baseValue) {
  let value = baseValue || 'config';
  let index = 1;

  while (true) {
    const res = await db.collection('system_configs')
      .where({ group, value })
      .limit(1)
      .get();

    if (!res.data || res.data.length === 0) return value;
    index += 1;
    value = `${baseValue || 'config'}_${index}`;
  }
}

/**
 * 查询配置列表
 */
async function queryConfig(params) {
  const { group, isActive } = params || {};

  try {
    let query = db.collection('system_configs');
    const whereCondition = {};
    
    // 按分组筛选
    if (group) {
      whereCondition.group = group;
    }

    // 状态筛选：默认只查询已启用的配置 (isActive == true)
    if (isActive !== undefined && isActive !== 'all') {
      whereCondition.isActive = isActive === 'true' || isActive === true;
    } else if (isActive === undefined) {
      whereCondition.isActive = true;
    }

    if (Object.keys(whereCondition).length > 0) {
      query = query.where(whereCondition);
    }

    // 排序逻辑：按 sortOrder 字段升序排列，确保前端展示顺序可控
    const res = await query.orderBy('sortOrder', 'asc').limit(1000).get();

    const sortedData = (res.data || []).slice().sort((left, right) => {
      const statusDifference = Number(left.isActive === false) - Number(right.isActive === false);
      return statusDifference || (Number(left.sortOrder) || 0) - (Number(right.sortOrder) || 0);
    });

    return {
      code: 0,
      message: '查询成功',
      data: sortedData
    };
  } catch (err) {
    console.error('查询配置数据库错误:', err);
    return {
      code: 500,
      message: '服务器内部错误',
      error: err.message
    };
  }
}

/**
 * 创建配置项
 */
async function createConfig(params) {
  const { group, label, description = '' } = params || {};
  const commonUnit = group === 'COST_CATEGORY' ? String(params.commonUnit || '').trim().slice(0, 30) : '';

  if (!group || !ALLOWED_GROUPS.has(group)) {
    return { code: 400, message: '配置分组不支持新增' };
  }
  if (!label || !String(label).trim()) {
    return { code: 400, message: '请填写配置中文名' };
  }
  if (group === 'COST_CATEGORY' && !commonUnit) {
    return { code: 400, message: '请填写常用单位' };
  }
  if (!isSafeInput(label) || !isSafeInput(description) || !isSafeInput(commonUnit)) {
    return { code: 400, message: '输入包含非法字符' };
  }

  try {
    const normalizedLabel = String(label).trim();
    const duplicatedLabel = await db.collection('system_configs')
      .where({
        group,
        label: normalizedLabel
      })
      .limit(1)
      .get();

    if (duplicatedLabel.data && duplicatedLabel.data.length > 0) {
      return { code: 409, message: '该配置中文名已存在' };
    }

    const lastRes = await db.collection('system_configs')
      .where({ group })
      .orderBy('sortOrder', 'desc')
      .limit(1)
      .get();

    const nextSortOrder = lastRes.data && lastRes.data.length > 0
      ? (Number(lastRes.data[0].sortOrder) || 0) + 1
      : 1;

    let baseValue = '';
    try {
      const translatedText = await translateByBaidu(normalizedLabel);
      baseValue = normalizeTranslatedValue(translatedText);
    } catch (error) {
      console.error('百度翻译生成配置标识失败，使用本地规则兜底:', error);
    }

    if (!baseValue) {
      baseValue = normalizeEnglishValue(normalizedLabel);
    }

    const value = await ensureUniqueValue(group, baseValue);
    const now = db.serverDate();
    const configData = {
      group,
      label: normalizedLabel,
      value,
      sortOrder: nextSortOrder,
      isActive: true,
      description: String(description || '').trim().slice(0, 240),
      commonUnit,
      createdAt: now,
      updateTime: now
    };

    const res = await db.collection('system_configs').add({
      data: configData
    });

    configCache = null;
    lastUpdateTime = 0;

    return {
      code: 0,
      message: '创建成功',
      data: {
        id: res._id,
        ...configData,
        createdAt: undefined,
        updateTime: undefined
      }
    };
  } catch (err) {
    console.error('创建配置项失败:', err);
    return { code: 500, message: '创建失败', error: err.message };
  }
}

/**
 * 更新配置项启用状态
 */
async function updateConfigStatus(params) {
  const { id, group, isActive } = params || {};

  if (!id || !String(id).trim()) {
    return { code: 400, message: '缺少配置 ID' };
  }
  if (typeof isActive !== 'boolean') {
    return { code: 400, message: '缺少启用状态' };
  }
  if (!group || !ALLOWED_GROUPS.has(group)) {
    return { code: 400, message: '配置分组不支持修改状态' };
  }

  try {
    const configRes = await db.collection('system_configs')
      .doc(id)
      .get();
    const config = configRes.data;

    if (!config) {
      return { code: 404, message: '配置不存在' };
    }
    if (config.group !== group) {
      return { code: 400, message: '配置分组不匹配' };
    }
    if (config.isActive === isActive) {
      return {
        code: 0,
        message: isActive ? '配置已启用' : '配置已停用',
        data: { id, isActive }
      };
    }

    if (!isActive && config.isActive) {
      const activeResult = await db.collection('system_configs').where({ group, isActive: true }).count();
      if (Number(activeResult.total) <= 1) {
        return { code: 409, message: '每个配置分组至少保留一个启用项' };
      }
    }

    const groupResult = await db.collection('system_configs').where({ group }).orderBy('sortOrder', 'asc').limit(1000).get();
    const targetStatusItems = (groupResult.data || []).filter(item => item._id !== id && (item.isActive !== false) === isActive);
    const nextSortOrder = targetStatusItems.reduce((maximum, item) => Math.max(maximum, Number(item.sortOrder) || 0), 0) + 1;

    await db.collection('system_configs')
      .doc(id)
      .update({
        data: {
          isActive,
          sortOrder: nextSortOrder,
          updateTime: db.serverDate()
        }
      });

    configCache = null;
    lastUpdateTime = 0;

    return {
      code: 0,
      message: isActive ? '启用成功' : '停用成功',
      data: { id, isActive }
    };
  } catch (err) {
    console.error('更新配置状态失败:', err);
    return { code: 500, message: '状态更新失败', error: err.message };
  }
}

async function fetchAllConfigDocuments(query) {
  const records = [];
  const pageSize = 1000;
  let offset = 0;
  while (true) {
    const result = await query.skip(offset).limit(pageSize).get();
    const page = result.data || [];
    records.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return records;
}

async function fetchOptionalCollection(collectionName) {
  try {
    return await fetchAllConfigDocuments(db.collection(collectionName));
  } catch (error) {
    const message = String(error?.message || error?.errMsg || '');
    const code = String(error?.errCode || error?.code || '');
    if (code === '-502005' || /collection.*(not exist|不存在)/i.test(message)) return [];
    throw error;
  }
}

function configMatchesCost(cost, config) {
  return String(cost?.categoryCode || '').trim() === config.value
    || (!cost?.categoryCode && String(cost?.category || '').trim() === config.label);
}

async function collectConfigUsage(config) {
  const clients = await fetchAllConfigDocuments(db.collection('clients'));
  const projects = await fetchAllConfigDocuments(db.collection('projects'));
  const clientReferences = [];
  const projectReferences = [];
  const quotationReferences = [];

  if (config.group === 'CLIENT_ROLE') {
    clients.forEach(client => {
      if (String(client.roleCode || client.role || '') === config.value) clientReferences.push(client);
    });
    projects.forEach(project => {
      if (String(project.role || project.clientRole || '') === config.value) projectReferences.push(project);
    });
  } else if (config.group === 'CLIENT_SOURCE') {
    clients.forEach(client => {
      if (String(client.source || '') === config.value) clientReferences.push(client);
    });
    projects.forEach(project => {
      if (String(project.clientSource || project.source || '') === config.value) projectReferences.push(project);
    });
  } else if (config.group === 'PROJECT_SCENE') {
    projects.forEach(project => {
      if (String(project.scene || '') === config.value) projectReferences.push(project);
    });
  } else if (config.group === 'COST_CATEGORY') {
    projects.forEach(project => {
      const directCosts = Array.isArray(project.costs) ? project.costs : [];
      const subCosts = (Array.isArray(project.subProjects) ? project.subProjects : [])
        .flatMap(item => Array.isArray(item.costs) ? item.costs : []);
      if ([...directCosts, ...subCosts].some(cost => configMatchesCost(cost, config))) projectReferences.push(project);
    });
    const quotations = await fetchOptionalCollection(QUOTATION_COLLECTION);
    quotations.forEach(quotation => {
      if (quotation.status === 'deleted') return;
      const used = (Array.isArray(quotation.items) ? quotation.items : []).some(item => (
        String(item.categoryConfigValue || '').trim() === config.value
        || (!item.categoryConfigValue && String(item.name || '').trim() === config.label)
      ));
      if (used) quotationReferences.push(quotation);
    });
  }

  const previews = [
    ...clientReferences.map(client => ({ type: 'client', id: client._id, name: client.name || '未命名客户' })),
    ...projectReferences.map(project => ({ type: 'project', id: project._id, name: project.name || '未命名项目' })),
    ...quotationReferences.map(quotation => ({
      type: 'quotation',
      id: quotation._id,
      name: `报价单：${quotation.projectName || quotation.title || '未命名报价'}${quotation.versionLabel ? `（${quotation.versionLabel}）` : ''}`
    }))
  ];
  return {
    clientReferences,
    projectReferences,
    quotationReferences,
    referenceCount: previews.length,
    previews
  };
}

async function getConfigRecord(id, group) {
  if (!id || !ALLOWED_GROUPS.has(group)) return null;
  try {
    const config = (await db.collection('system_configs').doc(id).get()).data;
    return config && config.group === group ? config : null;
  } catch (error) {
    return null;
  }
}

async function getConfigUsage(params = {}) {
  const id = String(params.id || '').trim().slice(0, 80);
  const group = String(params.group || '').trim();
  const config = await getConfigRecord(id, group);
  if (!config) return { code: 404, message: '配置项不存在' };
  const usage = await collectConfigUsage(config);
  return {
    code: 0,
    message: '查询成功',
    data: {
      config,
      referenceCount: usage.referenceCount,
      clientReferenceCount: usage.clientReferences.length,
      projectReferenceCount: usage.projectReferences.length,
      quotationReferenceCount: usage.quotationReferences.length,
      references: usage.previews
    }
  };
}

async function batchUpdateDocuments(collectionName, updates) {
  const batchSize = 20;
  for (let index = 0; index < updates.length; index += batchSize) {
    const batch = updates.slice(index, index + batchSize);
    await Promise.all(batch.map(item => db.collection(collectionName).doc(item.id).update({ data: item.data })));
  }
  return updates.length;
}

async function syncConfigLabel(config, nextLabel) {
  const usage = await collectConfigUsage(config);
  const clientUpdates = [];
  const projectUpdates = [];

  usage.clientReferences.forEach(client => {
    const data = { updateTime: db.serverDate() };
    if (config.group === 'CLIENT_ROLE') data.roleLabel = nextLabel;
    if (config.group === 'CLIENT_SOURCE') data.sourceLabel = nextLabel;
    clientUpdates.push({ id: client._id, data });
  });

  usage.projectReferences.forEach(project => {
    const data = { updateTime: db.serverDate() };
    if (config.group === 'CLIENT_ROLE') data.clientRoleLabel = nextLabel;
    if (config.group === 'CLIENT_SOURCE') data.clientSourceLabel = nextLabel;
    if (config.group === 'PROJECT_SCENE') data.sceneLabel = nextLabel;
    if (config.group === 'COST_CATEGORY') {
      data.costs = (Array.isArray(project.costs) ? project.costs : []).map(cost => (
        configMatchesCost(cost, config)
          ? { ...cost, categoryCode: config.value, category: nextLabel, categoryLabel: nextLabel }
          : cost
      ));
      data.subProjects = (Array.isArray(project.subProjects) ? project.subProjects : []).map(subProject => ({
        ...subProject,
        costs: (Array.isArray(subProject.costs) ? subProject.costs : []).map(cost => (
          configMatchesCost(cost, config)
            ? { ...cost, categoryCode: config.value, category: nextLabel, categoryLabel: nextLabel }
            : cost
        ))
      }));
    }
    projectUpdates.push({ id: project._id, data });
  });

  await batchUpdateDocuments('clients', clientUpdates);
  await batchUpdateDocuments('projects', projectUpdates);
  return usage.clientReferences.length + usage.projectReferences.length;
}

async function updateConfig(params = {}, currentUser) {
  const id = String(params.id || '').trim().slice(0, 80);
  const group = String(params.group || '').trim();
  const label = String(params.label || '').trim().slice(0, 80);
  const description = String(params.description || '').trim().slice(0, 240);
  const commonUnit = group === 'COST_CATEGORY' ? String(params.commonUnit || '').trim().slice(0, 30) : '';
  if (!id || !ALLOWED_GROUPS.has(group)) return { code: 400, message: '配置参数不完整' };
  if (!label) return { code: 400, message: '请输入配置名称' };
  if (group === 'COST_CATEGORY' && !commonUnit) return { code: 400, message: '请输入常用单位' };
  if (!isSafeInput(label) || !isSafeInput(description) || !isSafeInput(commonUnit)) return { code: 400, message: '输入包含非法字符' };
  const config = await getConfigRecord(id, group);
  if (!config) return { code: 404, message: '配置项不存在' };
  const duplicates = await db.collection('system_configs').where({ group, label }).limit(10).get();
  if ((duplicates.data || []).some(item => item._id !== id)) return { code: 409, message: '同名配置项已存在' };

  const affectedReferences = config.label === label ? 0 : await syncConfigLabel(config, label);
  await db.collection('system_configs').doc(id).update({
    data: {
      label,
      description,
      commonUnit,
      updatedBy: currentUser.id,
      updatedByName: currentUser.nickname || currentUser.username || '',
      updateTime: db.serverDate()
    }
  });
  configCache = null;
  lastUpdateTime = 0;
  return { code: 0, message: '配置项已更新', data: { id, affectedReferences } };
}

async function reorderConfig(params = {}) {
  const id = String(params.id || '').trim().slice(0, 80);
  const group = String(params.group || '').trim();
  const direction = params.direction === 'up' ? 'up' : params.direction === 'down' ? 'down' : '';
  if (!id || !ALLOWED_GROUPS.has(group) || !direction) return { code: 400, message: '排序参数无效' };
  const result = await db.collection('system_configs').where({ group }).orderBy('sortOrder', 'asc').limit(1000).get();
  const list = result.data || [];
  const current = list.find(item => item._id === id);
  if (!current) return { code: 404, message: '配置项不存在' };
  const peers = list.filter(item => (item.isActive !== false) === (current.isActive !== false));
  const currentIndex = peers.findIndex(item => item._id === id);
  const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
  if (targetIndex < 0 || targetIndex >= peers.length) return { code: 0, message: '当前已经在边界位置', data: { unchanged: true } };
  const target = peers[targetIndex];
  await Promise.all([
    db.collection('system_configs').doc(current._id).update({ data: { sortOrder: Number(target.sortOrder) || targetIndex + 1, updateTime: db.serverDate() } }),
    db.collection('system_configs').doc(target._id).update({ data: { sortOrder: Number(current.sortOrder) || currentIndex + 1, updateTime: db.serverDate() } })
  ]);
  configCache = null;
  lastUpdateTime = 0;
  return { code: 0, message: '排序已更新', data: { id } };
}

async function deleteConfig(params = {}, currentUser) {
  const id = String(params.id || '').trim().slice(0, 80);
  const group = String(params.group || '').trim();
  const config = await getConfigRecord(id, group);
  if (!config) return { code: 404, message: '配置项不存在' };
  const usage = await collectConfigUsage(config);
  if (usage.referenceCount) {
    return {
      code: 409,
      message: `该配置仍被 ${usage.referenceCount} 条数据引用，无法删除`,
      data: { referenceCount: usage.referenceCount, references: usage.previews }
    };
  }
  const activeResult = await db.collection('system_configs').where({ group, isActive: true }).count();
  if (config.isActive && Number(activeResult.total) <= 1) return { code: 409, message: '每个配置分组至少保留一个启用项' };
  await db.collection('system_configs').doc(id).remove();
  configCache = null;
  lastUpdateTime = 0;
  try {
    await db.collection('operation_logs').add({
      data: {
        uid: currentUser.id,
        un: String(currentUser.nickname || currentUser.username || '').slice(0, 20),
        username: currentUser.username || '',
        m: '数据配置',
        a: 'delete',
        c: `删除配置 ${config.label}（${group}）`,
        s: '成功',
        createdTimestamp: Date.now(),
        createdAt: db.serverDate()
      }
    });
  } catch (error) {
    console.error('记录配置删除日志失败:', error);
  }
  return { code: 0, message: '配置项已删除', data: { id } };
}
