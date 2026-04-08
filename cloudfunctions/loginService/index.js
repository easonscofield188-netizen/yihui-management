/**
 * 腾讯云函数: login
 * 运行环境: Node.js 16+
 * 适配: 微信云开发环境 + Web端 Axios 请求
 */
'use strict';

const cloud = require("wx-server-sdk");

// 初始化云开发环境
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV, // 自动使用当前云环境
});

const db = cloud.database();

exports.main = async (event, context) => {
  // --- 兼容性处理：解析请求体 ---
  // 如果是 Axios (HTTP 触发器) 调用，数据在 event.body 中
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
  
  const { username, password } = body;

  if (!username || !password) {
    return { code: 400, message: '账号或密码不能为空' };
  }

  try {
    // 在 users 集合中查询匹配的账号密码
    // 注意：前端已对密码进行 MD5 加密，因此数据库中存储的也应是 MD5 加密后的字符串
    const res = await db.collection('users').where({
      username: username,
      password: password
    }).get();

    if (res.data && res.data.length > 0) {
      const user = res.data[0];
      
      return {
        code: 0,
        message: '登录成功',
        data: {
          token: 'auth-token-' + Date.now() + '-' + user._id,
          userInfo: {
            id: user._id,
            username: user.username,
            role: user.role || 'user'
          }
        }
      };
    } else {
      return {
        code: 401,
        message: '账号或密码错误'
      };
    }
  } catch (err) {
    console.error('数据库查询错误:', err);
    return {
      code: 500,
      message: '服务器内部错误',
      error: err.message
    };
  }
};
