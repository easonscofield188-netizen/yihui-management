/**
 * 腾讯云函数: configService
 * 功能：配置管理（全局配置聚合、配置查询等）
 * 运行环境: Node.js 16+
 */
'use strict';

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

/**
 * 查询配置列表
 */
async function queryConfig(params) {
  const { group, isActive } = params || {};

  try {
    // 构建查询条件
    let query = db.collection('system_configs');
    
    // 按分组筛选
    if (group) {
      query = query.where({
        group: group
      });
    }

    // 状态筛选：默认只查询已启用的配置 (isActive == true)
    if (isActive !== undefined) {
      query = query.where({
        isActive: isActive === 'true' || isActive === true
      });
    } else {
      query = query.where({
        isActive: true
      });
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
