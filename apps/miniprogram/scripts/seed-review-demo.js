/**
 * 初始化审核账号与演示环境开关。
 *
 * 用法：REVIEW_PASSWORD='设置一个强密码' node scripts/seed-review-demo.js
 * 不传 REVIEW_PASSWORD 时不会创建账号，避免把默认密码带入任何环境。
 */
'use strict';

const crypto = require('crypto');
// 小程序根目录通常不会安装云函数依赖，优先复用本地已部署云函数的依赖。
let cloud;
try {
  cloud = require('wx-server-sdk');
} catch (error) {
  try {
    cloud = require('../cloudfunctions/quotationService/node_modules/wx-server-sdk');
  } catch (fallbackError) {
    throw new Error('未找到 wx-server-sdk。请先在 cloudfunctions/quotationService 执行 npm install，或在小程序根目录执行 npm install wx-server-sdk。');
  }
}
const initOptions = { env: process.env.TCB_ENV || cloud.DYNAMIC_CURRENT_ENV };
if (process.env.TENCENTCLOUD_SECRETID && process.env.TENCENTCLOUD_SECRETKEY) {
  initOptions.secretId = process.env.TENCENTCLOUD_SECRETID;
  initOptions.secretKey = process.env.TENCENTCLOUD_SECRETKEY;
}
cloud.init(initOptions);
const db = cloud.database();

const username = 'wechat_review';
const password = String(process.env.REVIEW_PASSWORD || '');

async function main() {
  const config = await db.collection('system_configs').where({ key: 'reviewEnabled' }).limit(1).get();
  if (config.data && config.data.length) {
    await db.collection('system_configs').doc(config.data[0]._id).update({
      data: { value: true, isActive: true, updateTime: db.serverDate() }
    });
  } else {
    await db.collection('system_configs').add({
      data: { key: 'reviewEnabled', value: true, isActive: true, createdAt: db.serverDate(), updateTime: db.serverDate() }
    });
  }
  const existing = await db.collection('users').where({ username }).limit(1).get();
  if (existing.data && existing.data.length) {
    await db.collection('users').doc(existing.data[0]._id).update({
      data: { role: 'ADMIN_REVIEW', dataScope: 'DEMO', reviewEnabled: true, updateTime: db.serverDate() }
    });
    console.log('review account updated');
    return;
  }
  if (!password) throw new Error('REVIEW_PASSWORD is required when creating wechat_review');
  await db.collection('users').add({
    data: {
      username,
      nickname: '微信审核账号',
      role: 'ADMIN_REVIEW',
      roleName: '审核账号',
      employeeNo: 'YH-REVIEW-001',
      passwordHash: crypto.createHash('sha256').update(password).digest('hex'),
      status: 'active',
      reviewEnabled: true,
      dataScope: 'DEMO',
      createdAt: new Date().toISOString(),
      updateTime: db.serverDate()
    }
  });
  console.log('review account created');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
