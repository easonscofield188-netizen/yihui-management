/**
 * 给历史业务数据补充 dataScope=REAL。
 *
 * 在部署带数据隔离的云函数前执行一次：
 *   node scripts/migrate-data-scope.js
 *
 * 运行环境需要已配置 wx-server-sdk 的 CloudBase 凭据；脚本只更新缺少
 * dataScope 的记录，不会覆盖已经标记为 DEMO 的演示数据。
 */
'use strict';

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
const COMMAND = db.command;
const PAGE_SIZE = 100;

const COLLECTIONS = [
  'projects',
  'clients',
  'project_cases',
  'project_quotations',
  'project_service_records',
  'project_vouchers',
  'project_contracts',
  'project_previews',
  'company_expenses',
  'company_expense_rules',
  'notifications',
  'project_change_events',
  'operation_logs'
];

async function migrateCollection(name) {
  let updated = 0;
  while (true) {
    const result = await db.collection(name)
      .where({ dataScope: COMMAND.exists(false) })
      .limit(PAGE_SIZE)
      .get();
    const records = result.data || [];
    if (!records.length) break;
    await Promise.all(records.map(record => db.collection(name).doc(record._id).update({
      data: { dataScope: 'REAL', dataScopeMigratedAt: db.serverDate() }
    })));
    updated += records.length;
  }
  console.log(`${name}: migrated ${updated}`);
}

async function main() {
  for (const name of COLLECTIONS) {
    try {
      await migrateCollection(name);
    } catch (error) {
      // 可选集合尚未创建时继续迁移其他集合。
      console.warn(`${name}: skipped (${error.message})`);
    }
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
