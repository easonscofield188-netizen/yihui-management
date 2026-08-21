/**
 * 腾讯云函数: cronService
 * 功能：每日定时更新项目周期
 */
'use strict';

const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const _ = db.command;
const EXPENSE_COLLECTION = 'company_expenses';
const RECURRING_RULE_COLLECTION = 'company_expense_rules';

function addMonths(month, offset) {
  const [year, value] = String(month).split('-').map(Number);
  const date = new Date(Date.UTC(year, value - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function parseMonthList(startMonth, endMonth) {
  const result = [];
  let cursor = startMonth;
  while (cursor <= endMonth) {
    result.push(cursor);
    cursor = addMonths(cursor, 1);
  }
  return result;
}

async function extendLongTermExpenseRules(currentMonth, today) {
  let rules = [];
  try {
    const result = await db.collection(RECURRING_RULE_COLLECTION)
      .where({ status: 'active' })
      .limit(1000)
      .get();
    rules = result.data || [];
  } catch (error) {
    // 支出集合尚未创建时不影响原有项目定时任务。
    return 0;
  }

  let created = 0;
  await db.collection(EXPENSE_COLLECTION).where({
    recordStatus: 'planned',
    expenseMonth: _.lte(currentMonth)
  }).update({
    data: { recordStatus: 'posted', updatedAt: db.serverDate() }
  }).catch(() => {});
  for (const rule of rules) {
    const isLongTerm = Boolean(rule.isLongTerm || !rule.endMonth);
    if (!isLongTerm) continue;
    const materializeEndMonth = addMonths(currentMonth, 12);
    const existingResult = await db.collection(EXPENSE_COLLECTION)
      .where({ recurringRuleId: rule._id })
      .limit(1000)
      .get();
    const existingMonths = new Set((existingResult.data || []).map(item => item.expenseMonth));

    for (const month of parseMonthList(rule.startMonth, materializeEndMonth)) {
      if (existingMonths.has(month)) continue;
      await db.collection(EXPENSE_COLLECTION).add({
        data: {
          category: rule.category,
          categoryLabel: rule.categoryLabel || rule.category,
          amount: Number(rule.amountPerMonth || 0),
          expenseType: 'recurring',
          expenseDate: `${month}-01`,
          expenseMonth: month,
          recurringRuleId: rule._id,
          recordStatus: month > currentMonth ? 'planned' : 'posted',
          remark: rule.remark ? `[固定分摊] ${rule.remark}` : '[固定分摊]',
          createdBy: rule.createdBy || '',
          createdByName: rule.createdByName || '系统自动分摊',
          createdAt: db.serverDate(),
          updatedAt: db.serverDate()
        }
      });
      created += 1;
    }
  }
  return created;
}

exports.main = async (event, context) => {
  const now = new Date();
  // 考虑到时区问题，使用北京时间 (UTC+8)
  const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const today = beijingTime.toISOString().split('T')[0];
  
  console.log(`开始执行每日更新任务，日期: ${today}`);

  try {
    // 1. 获取所有未结清/未终止的活跃项目（处理分页，TCB 默认限制 20 条，最大 100 条）
    const MAX_LIMIT = 100;
    const countResult = await db.collection('projects').where({
      type: _.neq('historical'),
      status: _.nin(['closed', 'terminated'])
    }).count();
    
    const total = countResult.total;
    console.log(`总共有 ${total} 个活跃项目待检查`);
    
    let updateCount = 0;
    const batchCount = Math.ceil(total / MAX_LIMIT);
    
    for (let i = 0; i < batchCount; i++) {
      const res = await db.collection('projects').where({
        type: _.neq('historical'),
        status: _.nin(['closed', 'terminated'])
      })
      .skip(i * MAX_LIMIT)
      .limit(MAX_LIMIT)
      .get();

      const projects = res.data;
      console.log(`正在处理第 ${i + 1} 批次，共 ${projects.length} 个项目`);

      for (const project of projects) {
        const updateData = {
          updateTime: db.serverDate()
        };

        // 长期项目逻辑
        if (project.type === 'long_term') {
          if (project.status === 'in_cooperation' && project.period && project.period[0]) {
            updateData.period = [project.period[0], today];
          } else {
            continue;
          }
        } else {
          // 常规项目逻辑
          // 更新项目周期结束日期
          if (project.period && project.period[0]) {
            updateData.period = [project.period[0], today];
          }

          // 如果在交付中，更新施工周期结束日期
          if (project.status === 'constructing' && project.constructionPeriod && project.constructionPeriod[0]) {
            updateData.constructionPeriod = [project.constructionPeriod[0], today];
          }

          // 如果在结账中，更新回款周期结束日期
          if (project.status === 'settling' && project.collectionPeriod && project.collectionPeriod[0]) {
            updateData.collectionPeriod = [project.collectionPeriod[0], today];
          }
        }

        await db.collection('projects').doc(project._id).update({
          data: updateData
        });
        updateCount++;
      }
    }

    const currentMonth = today.slice(0, 7);
    const recurringExpenseCount = await extendLongTermExpenseRules(currentMonth, today);
    return {
      code: 0,
      message: `成功更新 ${updateCount} 个项目，并补齐 ${recurringExpenseCount} 条固定支出预算`,
      date: today
    };
  } catch (err) {
    console.error('每日更新任务失败:', err);
    return { code: 500, message: '任务失败', error: err.message };
  }
};
