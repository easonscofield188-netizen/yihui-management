/**
 * 腾讯云函数: queryClients
 * 运行环境: Node.js 16+
 * 适配: 微信云开发环境 (callFunction) + 外部 HTTPS 请求 (Axios)
 */
'use strict';

const cloud = require("wx-server-sdk");

// 初始化云开发环境
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV, // 自动使用当前云环境
});

const db = cloud.database();
const _ = db.command;

/**
 * 云函数入口
 * @param {Object} event - 包含请求参数。如果是 HTTP 触发，参数在 event.body 中。
 * @param {Object} context - 云函数上下文。
 */
exports.main = async (event, context) => {
  // --- 兼容性处理：解析请求体 ---
  // 如果是外部 HTTP 触发器调用，数据通常在 event.body 中
  // 如果是小程序内部调用，数据直接在 event 中
  let body = {};
  try {
    if (event.body) {
      body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    } else {
      body = event;
    }
  } catch (e) {
    return { code: 400, message: '请求格式错误' };
  }
  
  const { keyword } = body;

  try {
    // 构建查询条件
    let query = db.collection('clients');
    
    // 如果提供了关键词，按名称进行模糊匹配（小程序数据库支持正则查询）
    if (keyword) {
      query = query.where({
        name: db.RegExp({
          regexp: keyword,
          options: 'i', // 不区分大小写
        })
      });
    }

    // 执行查询，按创建时间倒序排列，限制返回 50 条
    const res = await query.orderBy('createdAt', 'desc').limit(50).get();

    return {
      code: 0,
      message: '查询成功',
      data: res.data
    };
  } catch (err) {
    console.error('查询客户数据库错误:', err);
    return {
      code: 500,
      message: '服务器内部错误',
      error: err.message
    };
  }
};
