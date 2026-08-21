'use strict';

/**
 * 腾讯云函数: expenseService
 * 功能：公司日常运营支出管理（一次性支出、固定分摊支出、统计分析等）
 */

const cloud = require('wx-server-sdk');
const crypto = require('crypto');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const $ = db.command.aggregate;

const EXPENSE_COLLECTION = 'company_expenses';
const RECURRING_RULE_COLLECTION = 'company_expense_rules';
const SESSION_COLLECTION = 'auth_sessions';
const USER_COLLECTION = 'users';
const CONFIG_COLLECTION = 'system_configs';

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

const READ_ROLES = new Set([
  'ADMIN_SUPER',
  'ADMIN_COM',
  'ADMIN',
  'PROJECT_MANAGER',
  'FINANCE_MANAGER',
  'VISITOR',
  'user'
]);
const MANAGE_ROLES = new Set(['ADMIN_SUPER', 'ADMIN_COM', 'ADMIN']);

const EXPENSE_TYPE = Object.freeze({
  ONE_TIME: 'one_time',
  RECURRING: 'recurring'
});

const RECURRING_STATUS = Object.freeze({
  ACTIVE: 'active',
  STOPPED: 'stopped',
  COMPLETED: 'completed'
});

let collectionsReady = false;

async function ensureCollections() {
  if (collectionsReady) return;
  try {
    await db.createCollection(EXPENSE_COLLECTION);
  } catch (e) {}
  try {
    await db.createCollection(RECURRING_RULE_COLLECTION);
  } catch (e) {}
  collectionsReady = true;
}

async function getActiveExpenseCategory(category, expenseScope) {
  const result = await db.collection(CONFIG_COLLECTION).where({
    group: 'EXPENSE_CATEGORY',
    value: category,
    isActive: true
  }).limit(1).get();
  const config = (result.data || [])[0];
  if (!config) return null;
  const configuredScope = config.expenseScope === EXPENSE_TYPE.RECURRING
    ? EXPENSE_TYPE.RECURRING
    : EXPENSE_TYPE.ONE_TIME;
  return configuredScope === expenseScope ? config : null;
}

async function increaseExpenseCategoryUsage(category) {
  try {
    await db.collection(CONFIG_COLLECTION).where({
      group: 'EXPENSE_CATEGORY',
      value: category
    }).update({ data: { usageCount: _.inc(1), updateTime: db.serverDate() } });
  } catch (error) {
    // 类目使用统计失败不应阻断已经成功的记账。
  }
}

function getAuthToken(event, data) {
  const headers = event.headers || {};
  const authorization = headers.authorization || headers.Authorization || '';
  return String(
    data.authToken
    || event.authToken
    || authorization.replace(/^Bearer\s+/i, '')
    || ''
  ).trim();
}

async function authenticate(event, data) {
  const token = getAuthToken(event, data);
  if (!token) return { error: { code: 401, message: '请先登录' } };
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const sessionResult = await db.collection(SESSION_COLLECTION).where({ tokenHash }).limit(1).get();
  const session = (sessionResult.data || [])[0];
  if (!session || Number(session.expiresAt || 0) <= Date.now()) {
    return { error: { code: 401, message: '登录状态已失效，请重新登录' } };
  }

  const now = Date.now();
  if (!session.lastActiveAt || now - Number(session.lastActiveAt) >= SESSION_TOUCH_INTERVAL_MS) {
    db.collection(SESSION_COLLECTION).doc(session._id).update({
      data: {
        lastActiveAt: now,
        expiresAt: now + SESSION_TTL_MS,
        updateTime: db.serverDate()
      }
    }).catch(() => {});
  }

  const userResult = await db.collection(USER_COLLECTION).doc(session.userId).get();
  const user = userResult.data;
  if (!user || (user.status && user.status !== 'active')) {
    return { error: { code: 403, message: '账号不存在或已停用' } };
  }
  if (!READ_ROLES.has(user.role || 'user')) {
    return { error: { code: 403, message: '当前账号无支出数据访问权限' } };
  }
  // 访客不得访问公司支出；该接口尚未提供独立的 DEMO 财务数据集。
  if (user.role === 'VISITOR') {
    return { error: { code: 403, message: '访客账号无公司支出数据访问权限' } };
  }
  return { userId: session.userId, user };
}

function parseMonthList(startMonth, endMonth) {
  const months = [];
  const [startYear, startM] = startMonth.split('-').map(Number);
  const [endYear, endM] = endMonth.split('-').map(Number);

  let currentYear = startYear;
  let currentMonth = startM;

  while (
    currentYear < endYear ||
    (currentYear === endYear && currentMonth <= endM)
  ) {
    const formattedMonth = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
    months.push(formattedMonth);

    currentMonth += 1;
    if (currentMonth > 12) {
      currentMonth = 1;
      currentYear += 1;
    }
  }
  return months;
}

function getCurrentMonthString() {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function getCurrentDateString() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function addMonths(month, offset) {
  const [year, value] = String(month || '').split('-').map(Number);
  const date = new Date(Date.UTC(year, value - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function getRecurringRecordStatus(month) {
  return month > getCurrentMonthString() ? 'planned' : 'posted';
}

async function createExpense(data, user) {
  const category = String(data.category || '').trim();
  const amount = Number(data.amount);
  const expenseDate = String(data.expenseDate || '').slice(0, 10);
  const remark = String(data.remark || '').trim();

  if (!category) return { code: 400, message: '请选择支出类目' };
  if (!Number.isFinite(amount) || amount <= 0) return { code: 400, message: '请输入有效的支出金额' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)) return { code: 400, message: '请选择有效的支出日期' };

  const categoryConfig = await getActiveExpenseCategory(category, EXPENSE_TYPE.ONE_TIME);
  if (!categoryConfig) return { code: 400, message: '支出类目不存在、已停用或不适用于一次性支出' };
  const categoryLabel = String(categoryConfig.label || category).trim();

  const expenseMonth = expenseDate.slice(0, 7);

  await ensureCollections();

  const record = {
    category,
    categoryLabel,
    amount: Number(amount.toFixed(2)),
    expenseType: EXPENSE_TYPE.ONE_TIME,
    expenseDate,
    expenseMonth,
    recurringRuleId: '',
    recordStatus: expenseDate > getCurrentDateString() ? 'planned' : 'posted',
    remark,
    createdBy: user._id || '',
    createdByName: user.nickname || user.username || '用户',
    createdAt: db.serverDate(),
    updatedAt: db.serverDate()
  };

  const res = await db.collection(EXPENSE_COLLECTION).add({ data: record });
  await increaseExpenseCategoryUsage(category);

  return {
    code: 0,
    message: '支出记录成功',
    data: { _id: res._id, ...record }
  };
}

async function checkDuplicateExpense(data) {
  const category = String(data.category || '').trim();
  const expenseDate = String(data.expenseDate || '').slice(0, 10);
  if (!category || !/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)) {
    return { code: 400, message: '支出类目或日期无效' };
  }
  await ensureCollections();
  const result = await db.collection(EXPENSE_COLLECTION).where({
    category,
    expenseDate,
    expenseType: EXPENSE_TYPE.ONE_TIME
  }).limit(100).get();
  const list = result.data || [];
  const first = list[0];
  const totalAmount = list.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  return {
    code: 0,
    message: '查询成功',
    data: {
      exists: Boolean(first),
      expenseId: first ? first._id : '',
      categoryLabel: first ? (first.categoryLabel || category) : '',
      amount: Number(totalAmount.toFixed(2)),
      count: list.length
    }
  };
}

async function mergeExpense(data, user) {
  const id = String(data.id || '').trim();
  const amount = Number(data.amount);
  const category = String(data.category || '').trim();
  const expenseDate = String(data.expenseDate || '').slice(0, 10);
  if (!id || !category || !/^\d{4}-\d{2}-\d{2}$/.test(expenseDate) || !Number.isFinite(amount) || amount <= 0) {
    return { code: 400, message: '合并支出参数无效' };
  }
  const categoryConfig = await getActiveExpenseCategory(category, EXPENSE_TYPE.ONE_TIME);
  if (!categoryConfig) return { code: 400, message: '支出类目不存在、已停用或不适用于一次性支出' };
  await ensureCollections();
  const target = await db.collection(EXPENSE_COLLECTION).doc(id).get();
  const record = target.data;
  if (!record || record.expenseType !== EXPENSE_TYPE.ONE_TIME || record.category !== category || record.expenseDate !== expenseDate) {
    return { code: 409, message: '原支出记录已变化，请重新检查重复项' };
  }
  const nextAmount = Number(((Number(record.amount) || 0) + amount).toFixed(2));
  await db.collection(EXPENSE_COLLECTION).doc(id).update({
    data: {
      amount: nextAmount,
      updatedAt: db.serverDate(),
      mergedBy: user._id || '',
      mergedByName: user.nickname || user.username || '用户'
    }
  });
  await increaseExpenseCategoryUsage(category);
  return { code: 0, message: '支出已合并', data: { id, amount: nextAmount } };
}

async function createRecurringRule(data, user) {
  if (!MANAGE_ROLES.has(user.role)) return { code: 403, message: '仅管理员可创建固定支出规则' };
  const category = String(data.category || '').trim();
  const amountPerMonth = Number(data.amountPerMonth);
  const startMonth = String(data.startMonth || '').slice(0, 7);
  const endMonth = String(data.endMonth || '').slice(0, 7);
  const remark = String(data.remark || '').trim();

  if (!category) return { code: 400, message: '请选择支出类目' };
  const categoryConfig = await getActiveExpenseCategory(category, EXPENSE_TYPE.RECURRING);
  if (!categoryConfig) return { code: 400, message: '支出类目不存在、已停用或不适用于固定/分摊支出' };
  const categoryLabel = String(categoryConfig.label || category).trim();
  if (!Number.isFinite(amountPerMonth) || amountPerMonth <= 0) {
    return { code: 400, message: '请输入有效的每月分摊金额' };
  }
  const isLongTerm = !endMonth;
  if (!/^\d{4}-\d{2}$/.test(startMonth) || (!isLongTerm && !/^\d{4}-\d{2}$/.test(endMonth))) {
    return { code: 400, message: '请选择有效的开始月份和结束月份' };
  }
  if (!isLongTerm && startMonth > endMonth) {
    return { code: 400, message: '开始月份不能晚于结束月份' };
  }

  const currentMonth = getCurrentMonthString();
  // 长期规则先预生成未来 12 个月；每日任务会持续向后补齐，直到管理员停用。
  const materializeEndMonth = isLongTerm ? addMonths(currentMonth, 12) : endMonth;
  const months = parseMonthList(startMonth, materializeEndMonth);
  if (!months.length) return { code: 400, message: '分摊周期无效' };

  const totalMonths = isLongTerm ? null : months.length;
  const totalAmount = isLongTerm ? null : Number((amountPerMonth * totalMonths).toFixed(2));

  await ensureCollections();

  let status = RECURRING_STATUS.ACTIVE;
  if (!isLongTerm && endMonth < currentMonth) {
    status = RECURRING_STATUS.COMPLETED;
  }

  const ruleData = {
    category,
    categoryLabel,
    amountPerMonth: Number(amountPerMonth.toFixed(2)),
    startMonth,
    endMonth,
    isLongTerm,
    totalMonths,
    totalAmount,
    status,
    remark,
    createdBy: user._id || '',
    createdByName: user.nickname || user.username || '用户',
    createdAt: db.serverDate(),
    updatedAt: db.serverDate()
  };

  const ruleRes = await db.collection(RECURRING_RULE_COLLECTION).add({ data: ruleData });
  await increaseExpenseCategoryUsage(category);
  const ruleId = ruleRes._id;

  // 批量生成各月份的分摊记录
  for (const month of months) {
    await db.collection(EXPENSE_COLLECTION).add({
      data: {
        category,
        categoryLabel,
        amount: Number(amountPerMonth.toFixed(2)),
        expenseType: EXPENSE_TYPE.RECURRING,
        expenseDate: `${month}-01`,
        expenseMonth: month,
        recurringRuleId: ruleId,
        recordStatus: getRecurringRecordStatus(month),
        remark: remark ? `[固定分摊] ${remark}` : '[固定分摊]',
        createdBy: user._id || '',
        createdByName: user.nickname || user.username || '用户',
        createdAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    });
  }

  return {
    code: 0,
    message: '固定支出规则创建成功并已自动分摊',
    data: { _id: ruleId, totalMonths, totalAmount, isLongTerm }
  };
}

async function listExpenses(params = {}) {
  await ensureCollections();

  const month = params.month ? String(params.month).slice(0, 7) : '';
  const category = params.category ? String(params.category).trim() : '';
  const expenseType = params.expenseType ? String(params.expenseType).trim() : '';
  const startDate = params.startDate ? String(params.startDate).slice(0, 10) : '';
  const endDate = params.endDate ? String(params.endDate).slice(0, 10) : '';
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(params.pageSize) || 20));

  let query = {};
  if (month) {
    query.expenseMonth = month;
  } else if (startDate && endDate) {
    query.expenseDate = _.gte(startDate).and(_.lte(endDate));
  } else if (startDate) {
    query.expenseDate = _.gte(startDate);
  } else if (endDate) {
    query.expenseDate = _.lte(endDate);
  }

  if (category) query.category = category;
  if (expenseType) query.expenseType = expenseType;

  const countRes = await db.collection(EXPENSE_COLLECTION).where(query).count();
  const total = countRes.total || 0;

  const listRes = await db.collection(EXPENSE_COLLECTION)
    .where(query)
    .orderBy('expenseDate', 'desc')
    .orderBy('createdAt', 'desc')
    .skip((page - 1) * pageSize)
    .limit(pageSize)
    .get();

  // 计算当前条件下的总支出、固定支出、一次性支出
  let totalAmount = 0;
  let recurringAmount = 0;
  let oneTimeAmount = 0;

  // 使用聚合统计当前筛选范围下的全量总额
  try {
    const aggMatch = {};
    if (month) {
      aggMatch.expenseMonth = month;
    } else if (startDate && endDate) {
      aggMatch.expenseDate = _.gte(startDate).and(_.lte(endDate));
    } else if (startDate) {
      aggMatch.expenseDate = _.gte(startDate);
    } else if (endDate) {
      aggMatch.expenseDate = _.lte(endDate);
    }
    if (category) aggMatch.category = category;
    if (expenseType) aggMatch.expenseType = expenseType;

    const summaryResult = await db.collection(EXPENSE_COLLECTION)
      .aggregate()
      .match(aggMatch)
      .group({
        _id: '$expenseType',
        total: $.sum('$amount')
      })
      .end();

    (summaryResult.list || []).forEach(item => {
      if (item._id === EXPENSE_TYPE.RECURRING) {
        recurringAmount = Number(item.total.toFixed(2));
      } else {
        oneTimeAmount = Number(item.total.toFixed(2));
      }
    });
    totalAmount = Number((recurringAmount + oneTimeAmount).toFixed(2));
  } catch (e) {
    // 降级使用当前页计算
    (listRes.data || []).forEach(item => {
      const amt = Number(item.amount) || 0;
      totalAmount += amt;
      if (item.expenseType === EXPENSE_TYPE.RECURRING) recurringAmount += amt;
      else oneTimeAmount += amt;
    });
  }

  return {
    code: 0,
    message: '查询成功',
    data: {
      list: listRes.data || [],
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
      summary: {
        totalAmount: Number(totalAmount.toFixed(2)),
        recurringAmount: Number(recurringAmount.toFixed(2)),
        oneTimeAmount: Number(oneTimeAmount.toFixed(2))
      }
    }
  };
}

async function getExpenseAnalysis(params = {}) {
  await ensureCollections();

  const rangeType = String(params.rangeType || 'month').trim();
  const targetMonth = params.targetMonth ? String(params.targetMonth).slice(0, 7) : getCurrentMonthString();
  const startDateParam = params.startDate ? String(params.startDate).slice(0, 10) : '';
  const endDateParam = params.endDate ? String(params.endDate).slice(0, 10) : '';

  let startDate = '';
  let endDate = '';
  let periodLabel = '';

  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const currentYear = now.getFullYear();

  if (rangeType === 'month') {
    const [year, m] = targetMonth.split('-').map(Number);
    const lastDay = new Date(year, m, 0).getDate();
    startDate = `${targetMonth}-01`;
    endDate = `${targetMonth}-${String(lastDay).padStart(2, '0')}`;
    periodLabel = `${year}年${m}月`;
  } else if (rangeType === 'quarter') {
    const quarterIndex = Math.floor(now.getMonth() / 3);
    const startM = quarterIndex * 3 + 1;
    const endM = startM + 2;
    const lastDay = new Date(currentYear, endM, 0).getDate();
    startDate = `${currentYear}-${String(startM).padStart(2, '0')}-01`;
    endDate = `${currentYear}-${String(endM).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    periodLabel = `${currentYear}年第${quarterIndex + 1}季度`;
  } else if (rangeType === 'half_year') {
    const isFirstHalf = now.getMonth() < 6;
    if (isFirstHalf) {
      startDate = `${currentYear}-01-01`;
      endDate = `${currentYear}-06-30`;
      periodLabel = `${currentYear}年上半年`;
    } else {
      startDate = `${currentYear}-07-01`;
      endDate = `${currentYear}-12-31`;
      periodLabel = `${currentYear}年下半年`;
    }
  } else if (rangeType === 'year') {
    const targetYear = params.targetYear ? Number(params.targetYear) : currentYear;
    startDate = `${targetYear}-01-01`;
    endDate = `${targetYear}-12-31`;
    periodLabel = `${targetYear}年度`;
  } else if (rangeType === 'custom') {
    startDate = startDateParam;
    endDate = endDateParam;
    periodLabel = `${startDate} ~ ${endDate}`;
  }

  // 1. 查询当前范围内的所有支出记录
  const records = await fetchAllExpensesInRange(startDate, endDate, true);

  let totalAmount = 0;
  let recurringAmount = 0;
  let oneTimeAmount = 0;
  const categoryMap = {};

  records.forEach(item => {
    const amt = Number(item.amount) || 0;
    totalAmount += amt;
    if (item.expenseType === EXPENSE_TYPE.RECURRING) {
      recurringAmount += amt;
    } else {
      oneTimeAmount += amt;
    }

    const catKey = item.category || 'other';
    if (!categoryMap[catKey]) {
      categoryMap[catKey] = {
        category: catKey,
        categoryLabel: item.categoryLabel || catKey,
        amount: 0
      };
    }
    categoryMap[catKey].amount += amt;
  });

  const categoryList = Object.values(categoryMap)
    .map(item => ({
      ...item,
      amount: Number(item.amount.toFixed(2)),
      percent: totalAmount ? Number(((item.amount / totalAmount) * 100).toFixed(1)) : 0
    }))
    .sort((a, b) => b.amount - a.amount);

  const recurringPercent = totalAmount ? Number(((recurringAmount / totalAmount) * 100).toFixed(1)) : 0;
  const oneTimePercent = totalAmount ? Number(((oneTimeAmount / totalAmount) * 100).toFixed(1)) : 0;

  // 2. 近 12 个月的月度支出走势
  const monthlyTrend = await buildMonthlyTrend();
  const trendAnalysis = buildTrendAnalysis(monthlyTrend);

  return {
    code: 0,
    message: '查询成功',
    data: {
      rangeType,
      periodLabel,
      startDate,
      endDate,
      totalAmount: Number(totalAmount.toFixed(2)),
      recurringAmount: Number(recurringAmount.toFixed(2)),
      recurringPercent,
      oneTimeAmount: Number(oneTimeAmount.toFixed(2)),
      oneTimePercent,
      categoryList,
      maxCategory: categoryList[0] || null,
      monthlyTrend: trendAnalysis.monthlyTrend,
      trendSummary: trendAnalysis.summary,
      trendPeak: trendAnalysis.peak,
      trendAxis: trendAnalysis.axis
    }
  };
}

async function fetchAllExpensesInRange(startDate, endDate, actualOnly = false) {
  const today = getCurrentDateString();
  const actualEndDate = actualOnly && endDate > today ? today : endDate;
  if (actualOnly && startDate > actualEndDate) return [];
  const MAX_LIMIT = 100;
  let all = [];
  let skip = 0;
  while (true) {
    const res = await db.collection(EXPENSE_COLLECTION)
      .where({
        expenseDate: _.gte(startDate).and(_.lte(actualEndDate))
      })
      .skip(skip)
      .limit(MAX_LIMIT)
      .get();
    const list = res.data || [];
    all = all.concat(list);
    if (list.length < MAX_LIMIT) break;
    skip += MAX_LIMIT;
  }
  return all;
}

async function buildMonthlyTrend() {
  const months = [];
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  let year = now.getFullYear();
  let month = now.getMonth() + 1;

  for (let i = 0; i < 12; i++) {
    months.unshift(`${year}-${String(month).padStart(2, '0')}`);
    month -= 1;
    if (month < 1) {
      month = 12;
      year -= 1;
    }
  }

  const startMonth = months[0];
  const endMonth = months[months.length - 1];

  const res = await db.collection(EXPENSE_COLLECTION)
    .where({
      expenseMonth: _.gte(startMonth).and(_.lte(endMonth))
    })
    .limit(1000)
    .get();

  const monthMap = {};
  months.forEach(m => {
    monthMap[m] = { month: m, total: 0, recurring: 0, oneTime: 0 };
  });

  (res.data || []).forEach(item => {
    const m = item.expenseMonth;
    if (monthMap[m]) {
      const amt = Number(item.amount) || 0;
      monthMap[m].total += amt;
      if (item.expenseType === EXPENSE_TYPE.RECURRING) {
        monthMap[m].recurring += amt;
      } else {
        monthMap[m].oneTime += amt;
      }
    }
  });

  return months.map(m => ({
    month: m,
    total: Number(monthMap[m].total.toFixed(2)),
    recurring: Number(monthMap[m].recurring.toFixed(2)),
    oneTime: Number(monthMap[m].oneTime.toFixed(2))
  }));
}

// 所有金额汇总、极值和图表比例均由服务端计算，前端只负责展示和绘制。
function buildTrendAnalysis(monthlyTrend) {
  const list = Array.isArray(monthlyTrend) ? monthlyTrend : [];
  if (!list.length) {
    return {
      monthlyTrend: [],
      summary: null,
      peak: null,
      axis: {
        topAmount: 0,
        middleAmount: 0,
        bottomAmount: 0,
        topLabel: '¥0',
        middleLabel: '¥0',
        bottomLabel: '¥0'
      }
    };
  }

  let sum = 0;
  let peak = list[0];
  let minimum = list[0];

  list.forEach(item => {
    const amount = Number(item.total) || 0;
    sum += amount;
    if (amount > Number(peak.total || 0)) peak = item;
    if (amount < Number(minimum.total || 0)) minimum = item;
  });

  const peakAmount = Number(peak.total || 0);
  const annotatedTrend = list.map(item => {
    const amount = Number(item.total) || 0;
    return {
      ...item,
      chartPercent: peakAmount > 0
        ? Number(((amount / peakAmount) * 100).toFixed(4))
        : 0
    };
  });

  return {
    monthlyTrend: annotatedTrend,
    summary: {
      averageAmount: Number((sum / list.length).toFixed(2)),
      peakMonth: peak.month,
      peakAmount: Number(peakAmount.toFixed(2)),
      minimumMonth: minimum.month,
      minimumAmount: Number((Number(minimum.total) || 0).toFixed(2))
    },
    peak: peakAmount > 0
      ? { month: peak.month, amount: Number(peakAmount.toFixed(2)) }
      : null,
    axis: buildTrendAxis(peakAmount)
  };
}

function buildTrendAxis(peakAmount) {
  const topAmount = Number((Number(peakAmount) || 0).toFixed(2));
  const middleAmount = Number((topAmount / 2).toFixed(2));
  return {
    topAmount,
    middleAmount,
    bottomAmount: 0,
    topLabel: formatChartAmount(topAmount),
    middleLabel: formatChartAmount(middleAmount),
    bottomLabel: '¥0'
  };
}

function formatChartAmount(amount) {
  const value = Number(amount) || 0;
  if (value >= 10000) {
    return `¥${(value / 10000).toFixed(value >= 100000 ? 0 : 1)}万`;
  }
  return `¥${Math.round(value)}`;
}

async function listRecurringRules(params = {}) {
  await ensureCollections();

  const status = params.status ? String(params.status).trim() : '';
  const query = status ? { status } : {};

  const res = await db.collection(RECURRING_RULE_COLLECTION)
    .where(query)
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get();

  const currentMonth = getCurrentMonthString();

  const list = (res.data || []).map(rule => {
    const isLongTerm = Boolean(rule.isLongTerm || !rule.endMonth);
    const displayEndMonth = isLongTerm ? addMonths(currentMonth, 12) : rule.endMonth;
    const allMonths = parseMonthList(rule.startMonth, displayEndMonth);
    const passedMonths = allMonths.filter(m => m <= currentMonth).length;
    return {
      ...rule,
      isLongTerm,
      displayEndMonth,
      passedMonths,
      remainingMonths: isLongTerm ? null : Math.max(0, rule.totalMonths - passedMonths)
    };
  });

  return {
    code: 0,
    message: '查询成功',
    data: { list }
  };
}

async function updateRecurringRule(data, user) {
  if (!MANAGE_ROLES.has(user.role)) return { code: 403, message: '仅管理员可修改固定支出规则' };

  const id = String(data.id || '').trim();
  if (!id) return { code: 400, message: '参数缺失' };

  await ensureCollections();

  const ruleDoc = await db.collection(RECURRING_RULE_COLLECTION).doc(id).get();
  if (!ruleDoc.data) return { code: 404, message: '规则不存在' };

  const oldRule = ruleDoc.data;
  const newAmountPerMonth = Number(data.amountPerMonth);
  const remark = data.remark !== undefined ? String(data.remark).trim() : oldRule.remark;
  const category = data.category ? String(data.category).trim() : oldRule.category;
  const categoryLabel = data.categoryLabel ? String(data.categoryLabel).trim() : oldRule.categoryLabel;

  const currentMonth = getCurrentMonthString();
  const updateData = {
    remark,
    category,
    categoryLabel,
    updatedAt: db.serverDate()
  };

  const hasNewAmount = Number.isFinite(newAmountPerMonth) && newAmountPerMonth > 0 && newAmountPerMonth !== oldRule.amountPerMonth;
  if (hasNewAmount) {
    updateData.amountPerMonth = Number(newAmountPerMonth.toFixed(2));

    // 同步更新未来/当前未过月份的分摊记录
    const ruleEndMonth = oldRule.endMonth || addMonths(currentMonth, 12);
    const allMonths = parseMonthList(oldRule.startMonth, ruleEndMonth);
    const futureMonths = allMonths.filter(m => m >= currentMonth);
    const pastMonthsCount = allMonths.length - futureMonths.length;

    updateData.totalAmount = oldRule.isLongTerm || !oldRule.endMonth
      ? null
      : Number((pastMonthsCount * oldRule.amountPerMonth + futureMonths.length * newAmountPerMonth).toFixed(2));

  }

  // 规则信息只同步本月及未来预算，已结算月份保留历史口径。
  const expenseUpdate = { category, categoryLabel, remark: remark ? `[固定分摊] ${remark}` : '[固定分摊]', updatedAt: db.serverDate() };
  if (hasNewAmount) expenseUpdate.amount = Number(newAmountPerMonth.toFixed(2));
  await db.collection(EXPENSE_COLLECTION).where({
    recurringRuleId: id,
    expenseMonth: _.gte(currentMonth)
  }).update({ data: expenseUpdate });

  await db.collection(RECURRING_RULE_COLLECTION).doc(id).update({ data: updateData });

  return { code: 0, message: '规则已更新' };
}

async function stopRecurringRule(data, user) {
  if (!MANAGE_ROLES.has(user.role)) return { code: 403, message: '仅管理员可停用固定支出规则' };

  const id = String(data.id || '').trim();
  if (!id) return { code: 400, message: '参数缺失' };

  await ensureCollections();

  const ruleDoc = await db.collection(RECURRING_RULE_COLLECTION).doc(id).get();
  if (!ruleDoc.data) return { code: 404, message: '规则不存在' };

  const currentMonth = getCurrentMonthString();

  // 1. 删除所有未来月份（> currentMonth）的分摊记录
  await db.collection(EXPENSE_COLLECTION).where({
    recurringRuleId: id,
    expenseMonth: _.gt(currentMonth)
  }).remove();

  // 2. 更新规则状态为 stopped
  await db.collection(RECURRING_RULE_COLLECTION).doc(id).update({
    data: {
      status: RECURRING_STATUS.STOPPED,
      updatedAt: db.serverDate()
    }
  });

  return { code: 0, message: '固定支出规则已停用，未来月份记录已移除' };
}

async function deleteRecurringRule(data, user) {
  if (!MANAGE_ROLES.has(user.role)) return { code: 403, message: '仅管理员可删除固定支出规则' };

  const id = String(data.id || '').trim();
  if (!id) return { code: 400, message: '参数缺失' };

  await ensureCollections();

  // 删除关联的所有支出记录
  await db.collection(EXPENSE_COLLECTION).where({
    recurringRuleId: id
  }).remove();

  // 删除规则本身
  await db.collection(RECURRING_RULE_COLLECTION).doc(id).remove();

  return { code: 0, message: '固定支出规则及关联分摊记录已全部删除' };
}

async function updateExpense(data, user) {
  if (!MANAGE_ROLES.has(user.role)) return { code: 403, message: '仅管理员可编辑支出记录' };

  const id = String(data.id || '').trim();
  if (!id) return { code: 400, message: '参数缺失' };

  await ensureCollections();

  const expenseDoc = await db.collection(EXPENSE_COLLECTION).doc(id).get();
  if (!expenseDoc.data) return { code: 404, message: '记录不存在' };

  const updateData = { updatedAt: db.serverDate() };
  if (data.category) updateData.category = String(data.category).trim();
  if (data.categoryLabel) updateData.categoryLabel = String(data.categoryLabel).trim();
  if (Number.isFinite(Number(data.amount)) && Number(data.amount) > 0) {
    updateData.amount = Number(Number(data.amount).toFixed(2));
  }
  if (data.expenseDate && /^\d{4}-\d{2}-\d{2}$/.test(data.expenseDate)) {
    updateData.expenseDate = String(data.expenseDate).slice(0, 10);
    updateData.expenseMonth = updateData.expenseDate.slice(0, 7);
  }
  if (data.remark !== undefined) updateData.remark = String(data.remark).trim();

  await db.collection(EXPENSE_COLLECTION).doc(id).update({ data: updateData });

  return { code: 0, message: '记录已更新' };
}

async function deleteExpense(data, user) {
  if (!MANAGE_ROLES.has(user.role)) return { code: 403, message: '仅管理员可删除支出记录' };

  const id = String(data.id || '').trim();
  if (!id) return { code: 400, message: '参数缺失' };

  await ensureCollections();

  const expenseDoc = await db.collection(EXPENSE_COLLECTION).doc(id).get();
  if (!expenseDoc.data) return { code: 404, message: '记录不存在' };
  if (expenseDoc.data.expenseType === EXPENSE_TYPE.RECURRING) {
    return { code: 409, message: '固定分摊记录请在“固定支出管理”中调整或停用规则，不能单独删除' };
  }

  await db.collection(EXPENSE_COLLECTION).doc(id).remove();

  return { code: 0, message: '支出记录已删除' };
}

exports.main = async (event, context) => {
  let action, data;

  if (event.action) {
    action = event.action;
    data = event.data || {};
  } else if (event.body) {
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    action = body.action;
    data = body.data || {};
  }

  try {
    const auth = await authenticate(event, data || {});
    if (auth.error) return auth.error;

    switch (action) {
      case 'createExpense':
        return await createExpense(data, auth.user);
      case 'checkDuplicateExpense':
        return await checkDuplicateExpense(data);
      case 'mergeExpense':
        return await mergeExpense(data, auth.user);
      case 'createRecurringRule':
        return await createRecurringRule(data, auth.user);
      case 'listExpenses':
        return await listExpenses(data);
      case 'getExpenseAnalysis':
        return await getExpenseAnalysis(data);
      case 'listRecurringRules':
        return await listRecurringRules(data);
      case 'updateRecurringRule':
        return await updateRecurringRule(data, auth.user);
      case 'stopRecurringRule':
        return await stopRecurringRule(data, auth.user);
      case 'deleteRecurringRule':
        return await deleteRecurringRule(data, auth.user);
      case 'updateExpense':
        return await updateExpense(data, auth.user);
      case 'deleteExpense':
        return await deleteExpense(data, auth.user);
      default:
        return { code: 400, message: '未知操作' };
    }
  } catch (error) {
    console.error('支出管理操作异常:', error);
    return { code: 500, message: '操作失败', error: error.message };
  }
};
