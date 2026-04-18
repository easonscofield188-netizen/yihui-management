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
    // 根据操作类型执行相应的函数
    switch (action) {
      case 'getGlobalConfig':
        return await getGlobalConfig(data);
      case 'queryConfig':
        return await queryConfig(data);
      case 'createConfig':
        return await createConfig(data);
      case 'updateConfigStatus':
        return await updateConfigStatus(data);
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
    const res = await query.orderBy('sortOrder', 'asc').get();

    return {
      code: 0,
      message: '查询成功',
      data: res.data
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
  const allowedGroups = ['CLIENT_ROLE', 'COST_CATEGORY', 'CLIENT_SOURCE', 'PROJECT_SCENE'];

  if (!group || !allowedGroups.includes(group)) {
    return { code: 400, message: '配置分组不支持新增' };
  }
  if (!label || !String(label).trim()) {
    return { code: 400, message: '请填写配置中文名' };
  }
  if (!isSafeInput(label) || !isSafeInput(description)) {
    return { code: 400, message: '输入包含非法字符' };
  }

  try {
    const normalizedLabel = String(label).trim();
    const duplicatedLabel = await db.collection('system_configs')
      .where({
        group,
        label: normalizedLabel,
        isActive: true
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
      description: String(description || '').trim(),
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
  const allowedGroups = ['CLIENT_ROLE', 'COST_CATEGORY', 'CLIENT_SOURCE', 'PROJECT_SCENE'];

  if (!id || !String(id).trim()) {
    return { code: 400, message: '缺少配置 ID' };
  }
  if (typeof isActive !== 'boolean') {
    return { code: 400, message: '缺少启用状态' };
  }
  if (!group || !allowedGroups.includes(group)) {
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

    await db.collection('system_configs')
      .doc(id)
      .update({
        data: {
          isActive,
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
