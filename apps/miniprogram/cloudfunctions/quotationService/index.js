'use strict';

const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const XLSX = require('xlsx');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const QUOTATION_COLLECTION = 'project_quotations';
const CONFIG_COLLECTION = 'system_configs';
const REVIEW_COLLECTION = 'config_review_requests';
const NOTIFICATION_COLLECTION = 'notifications';
const CATEGORY_REVIEW_TEMPLATE_ID = 'osXcvIp2RwA4HpYNqVienL9R3gq-PNw5iDe0LQprkok';
const ADMIN_SUPER_ROLE = 'ADMIN_SUPER';
const SESSION_COLLECTION = 'auth_sessions';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const MINI_PROGRAM_STATES = new Set(['developer', 'trial', 'formal']);
const QUOTATION_STATUS = Object.freeze({ DELETED: 'deleted' });
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
const VERSION_DIGITS = Object.freeze(['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']);

let collectionReady = false;
let reviewCollectionReady = false;

function parseBody(event) {
  if (event.body) return typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  return event || {};
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

  const userResult = await db.collection('users').doc(session.userId).get();
  const user = userResult.data;
  if (!user || (user.status && user.status !== 'active')) {
    return { error: { code: 403, message: '账号不存在或已停用' } };
  }
  if (!READ_ROLES.has(user.role || 'user')) {
    return { error: { code: 403, message: '当前账号无项目报价访问权限' } };
  }
  return { userId: session.userId, user };
}

async function ensureQuotationCollection() {
  if (collectionReady) return;
  try {
    await db.createCollection(QUOTATION_COLLECTION);
  } catch (error) {
    // 集合已存在时继续查询。
  }
  collectionReady = true;
}

function safeText(value, maxLength = 200) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function drawingFileId(drawing) {
  return safeText(drawing && (drawing.fileId || drawing.fileID), 500);
}

function collectQuotationFileIds(items) {
  const fileIds = [];
  (items || []).forEach(item => {
    const files = ['drawings', 'images', 'attachments', 'files']
      .reduce((list, field) => list.concat(Array.isArray(item[field]) ? item[field] : []), []);
    files.forEach(drawing => {
      fileIds.push(drawingFileId(drawing));
    });
  });
  return new Set(fileIds.filter(Boolean));
}

function isMissingCloudFileError(item) {
  const message = safeText(item && (item.errMsg || item.message), 500);
  return /not\s*(exist|found)|不存在/i.test(message);
}

async function deleteCloudFiles(fileIds) {
  const uniqueIds = Array.from(new Set((fileIds || []).filter(Boolean)));
  const batchSize = 50;
  for (let index = 0; index < uniqueIds.length; index += batchSize) {
    const batch = uniqueIds.slice(index, index + batchSize);
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const result = await cloud.deleteFile({ fileList: batch });
        const failed = (result.fileList || []).filter(item => Number(item.status) !== 0 && !isMissingCloudFileError(item));
        if (failed.length) throw new Error(`有 ${failed.length} 个报价单文件清理失败`);
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) throw lastError;
  }
  return uniqueIds.length;
}

function rawDate(value) {
  if (value && value.$date) return value.$date;
  return value;
}

function timestamp(value) {
  const raw = rawDate(value);
  const direct = Number(raw || 0);
  if (direct > 100000000000) return direct;
  const parsed = new Date(raw || 0);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function formatDate(value) {
  const time = timestamp(value);
  if (!time) return '';
  const date = new Date(time);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}.${month}.${day}`;
}

function formatDateTime(value) {
  const time = timestamp(value);
  if (!time) return '';
  const date = new Date(time);
  const dateText = formatDate(time);
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${dateText} ${hour}:${minute}`;
}

function quotationDate(item) {
  return item.createdDate
    || item.quotationDate
    || item.createdTimestamp
    || item.createdAt
    || item.createTime
    || item.createdDate
    || item.date
    || 0;
}

function toCents(value) {
  const num = Number(value);
  return Math.round((!Number.isNaN(num) ? num : 0) * 100);
}

function normalizeMoney(value) {
  return toCents(value) / 100;
}

function calculateTotalAmount(items) {
  const centsSum = (items || []).reduce((sum, item) => sum + toCents(item.totalAmount), 0);
  return centsSum / 100;
}

function numberToChinese(value) {
  const number = Math.max(1, Math.floor(Number(value) || 1));
  if (number < 10) return VERSION_DIGITS[number];
  if (number === 10) return '十';
  if (number < 20) return `十${VERSION_DIGITS[number % 10]}`;
  if (number < 100) {
    const ones = number % 10;
    return `${VERSION_DIGITS[Math.floor(number / 10)]}十${ones ? VERSION_DIGITS[ones] : ''}`;
  }
  return String(number);
}

function versionSequence(value, fallback = 1) {
  const direct = Number(value && value.versionSequence);
  if (Number.isInteger(direct) && direct > 0) return direct;
  const raw = typeof value === 'object'
    ? value.version || value.versionNo || value.quotationVersion
    : value;
  const matched = safeText(raw, 30).match(/^V(\d+)(?:\.\d+)?$/i);
  return matched ? Math.max(1, Number(matched[1]) || 1) : fallback;
}

function versionInfo(sequence) {
  const normalizedSequence = Math.max(1, Math.floor(Number(sequence) || 1));
  return {
    sequence: normalizedSequence,
    value: `V${normalizedSequence}.0`,
    label: `版本${numberToChinese(normalizedSequence)}`
  };
}

async function nextVersionInfo(projectName) {
  const normalizedName = safeText(projectName, 120).toLowerCase();
  if (!normalizedName) return versionInfo(1);
  const result = await db.collection(QUOTATION_COLLECTION).limit(1000).get();
  const maxSequence = (result.data || [])
    .filter(item => item.status !== QUOTATION_STATUS.DELETED)
    .filter(item => safeText(item.projectName || item.title || item.name, 120).toLowerCase() === normalizedName)
    .reduce((maximum, item) => Math.max(maximum, versionSequence(item)), 0);
  return versionInfo(maxSequence + 1);
}

function normalizeItem(item, index) {
  const quantity = normalizeMoney(item.quantity);
  const unitPrice = normalizeMoney(item.unitPrice);
  const qtyCents = toCents(quantity);
  const priceCents = toCents(unitPrice);
  const totalCents = Math.round((qtyCents * priceCents) / 100);
  return {
    itemCode: safeText(item.itemCode, 40) || `ITEM_${index + 1}`,
    name: safeText(item.name, 120),
    categoryConfigValue: safeText(item.categoryConfigValue, 80),
    quantity,
    unit: safeText(item.unit, 30),
    unitPrice,
    totalAmount: totalCents / 100,
    remark: safeText(item.remark, 300),
    sortOrder: index + 1
  };
}

function normalizeDrawing(file) {
  return {
    fileId: safeText(file.fileId || file.fileID, 500),
    url: safeText(file.url, 1000),
    name: safeText(file.name, 160),
    fileType: safeText(file.fileType, 20),
    mimeType: safeText(file.mimeType, 80),
    size: Math.max(0, Number(file.size) || 0),
    sourceCode: safeText(file.sourceCode, 40) || 'quotation_drawing'
  };
}

function dateOnly(value) {
  const matched = safeText(value, 40).match(/^\d{4}-\d{2}-\d{2}/);
  return matched ? matched[0] : '';
}

function buildProjectCode(createdDate) {
  const year = (createdDate || new Date().toISOString()).slice(0, 4);
  return `YH-${year}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

function normalizeCategoryName(value) {
  return safeText(value, 120).normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

function normalizeMergeName(value) {
  return safeText(value, 120).normalize('NFKC').toLowerCase().replace(/[\s\-_/\\·,，.。()（）【】\[\]{}]/g, '');
}

function canonicalMergeUnit(value) {
  const unit = normalizeMergeName(value).replace(/²/g, '2').replace(/³/g, '3');
  const aliases = { 米: 'm', 公尺: 'm', 平方米: 'm2', '㎡': 'm2', 'm²': 'm2', 立方米: 'm3', 'm³': 'm3', 公斤: 'kg', 千克: 'kg', 克: 'g', 吨: 't', 升: 'l', 毫升: 'ml' };
  return aliases[unit] || unit;
}

function categoryNamesAreRelated(left, right) {
  const firstName = normalizeMergeName(left);
  const secondName = normalizeMergeName(right);
  if (!firstName || !secondName) return false;
  if (firstName === secondName) return true;
  const shorter = firstName.length <= secondName.length ? firstName : secondName;
  const longer = firstName.length > secondName.length ? firstName : secondName;
  if (shorter.length >= 2 && longer.includes(shorter)) return true;
  let longest = 0;
  for (let i = 0; i < firstName.length; i += 1) {
    for (let j = 0; j < secondName.length; j += 1) {
      let size = 0;
      while (firstName[i + size] && firstName[i + size] === secondName[j + size]) size += 1;
      if (size > longest) longest = size;
    }
  }
  if (longest >= 2 && longest / shorter.length >= 0.6) return true;
  const bigrams = value => Array.from({ length: Math.max(0, value.length - 1) }, (_, index) => value.slice(index, index + 2));
  const firstBigrams = bigrams(firstName);
  const remaining = bigrams(secondName);
  let matches = 0;
  firstBigrams.forEach(item => {
    const index = remaining.indexOf(item);
    if (index >= 0) {
      matches += 1;
      remaining.splice(index, 1);
    }
  });
  const denominator = firstBigrams.length + bigrams(secondName).length;
  return denominator > 0 && (2 * matches) / denominator >= 0.4;
}

function validateCategoryMerge(review, config) {
  const reasons = [];
  if (!categoryNamesAreRelated(review.proposedLabel, config.label)) {
    reasons.push(`名称差异过大：“${review.proposedLabel}”与“${config.label}”不属于明显近似类目`);
  }
  const targetUnit = canonicalMergeUnit(config.commonUnit);
  const sourceUnits = Array.from(new Set([
    review.proposedUnit,
    ...(review.unitCandidates || []),
    ...(review.sources || []).map(item => item.originalUnit)
  ].map(canonicalMergeUnit).filter(Boolean)));
  if (!targetUnit || !sourceUnits.length) reasons.push('申请或已有配置缺少单位');
  else if (sourceUnits.some(unit => unit !== targetUnit)) {
    reasons.push(`单位不一致：申请为“${sourceUnits.join('、')}”，配置为“${config.commonUnit}”`);
  }
  return { allowed: reasons.length === 0, reason: reasons.join('；') };
}

function normalizeMiniProgramState(value) {
  const state = safeText(value, 20).toLowerCase();
  return MINI_PROGRAM_STATES.has(state) ? state : 'formal';
}

function formatReviewTime(timestamp) {
  const date = new Date(timestamp || Date.now());
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function ensureReviewCollection() {
  if (reviewCollectionReady) return;
  try {
    await db.createCollection(REVIEW_COLLECTION);
  } catch (error) {
    if (!/exist|存在/i.test(String(error.message || error.errMsg || ''))) throw error;
  }
  reviewCollectionReady = true;
}

async function sendCategoryReviewWechat(admin, notificationId, review, miniProgramState) {
  const availableCount = Math.max(0, Number(admin.costCategoryReviewSubscriptionAvailableCount) || 0);
  if (!admin.wechatOpenId || availableCount < 1) return { status: 'skipped', reason: '未开启类目审核微信提醒' };
  try {
    await cloud.openapi.subscribeMessage.send({
      touser: admin.wechatOpenId,
      templateId: CATEGORY_REVIEW_TEMPLATE_ID,
      page: `pages/notification-detail/index?id=${notificationId}&source=wechat_subscribe`,
      miniprogramState: normalizeMiniProgramState(miniProgramState),
      lang: 'zh_CN',
      data: {
        thing1: { value: safeText(`新增类目：${review.proposedLabel}`, 20) },
        thing2: { value: safeText(review.projectName || '报价项目', 20) },
        name3: { value: safeText(review.submittedByName || '系统用户', 10) },
        thing4: { value: safeText(`建议单位：${review.proposedUnit || '未填写'}`, 20) },
        date6: { value: formatReviewTime(review.createdTimestamp) }
      }
    });
    await db.collection('users').doc(admin._id).update({
      data: { costCategoryReviewSubscriptionAvailableCount: db.command.inc(-1), updateTime: db.serverDate() }
    });
    return { status: 'sent', reason: '' };
  } catch (error) {
    console.error('类目审核微信通知发送失败:', error);
    return { status: 'failed', reason: safeText(error.message || error.errMsg, 120) };
  }
}

async function notifyCategoryReview(review, current, miniProgramState) {
  const adminResult = await db.collection('users').where({ role: ADMIN_SUPER_ROLE }).limit(100).get();
  const admins = (adminResult.data || []).filter(user => !user.status || user.status === 'active');
  const targetMiniProgramState = normalizeMiniProgramState(miniProgramState);
  await Promise.all(admins.map(async admin => {
    const createdTimestamp = Date.now();
    const notificationResult = await db.collection(NOTIFICATION_COLLECTION).add({
      data: {
        notificationType: 'cost_category_review',
        eventType: 'cost_category_review',
        reviewRequestId: review._id,
        projectName: review.projectName,
        proposedLabel: review.proposedLabel,
        proposedUnit: review.proposedUnit,
        summary: `发现新报价类目“${review.proposedLabel}”，等待审核`,
        actorUserId: current.userId,
        actorName: review.submittedByName,
        recipientUserId: admin._id,
        readStatus: 'unread',
        readStatusLabel: '未读',
        deliveryStatus: 'pending',
        deliveryStatusLabel: '待发送',
        targetMiniProgramState,
        createdTimestamp,
        createdAt: db.serverDate()
      }
    });
    const delivery = await sendCategoryReviewWechat(admin, notificationResult._id, review, targetMiniProgramState);
    await db.collection(NOTIFICATION_COLLECTION).doc(notificationResult._id).update({
      data: {
        deliveryStatus: delivery.status,
        deliveryStatusLabel: delivery.status === 'sent' ? '发送成功' : delivery.status === 'failed' ? '发送失败' : '未发送',
        deliveryReasonLabel: delivery.reason,
        updateTime: db.serverDate()
      }
    });
  }));
}

async function captureCategoryReviewSuggestions(quotation, current, miniProgramState) {
  if (current.user.role === ADMIN_SUPER_ROLE) return;
  await ensureReviewCollection();
  const configResult = await db.collection(CONFIG_COLLECTION).where({ group: 'COST_CATEGORY' }).limit(1000).get();
  const existingNames = new Set((configResult.data || []).map(item => normalizeCategoryName(item.label)).filter(Boolean));
  const candidates = new Map();
  (quotation.items || []).forEach((item, itemIndex) => {
    const normalizedName = normalizeCategoryName(item.name);
    if (!normalizedName || item.categoryConfigValue || existingNames.has(normalizedName)) return;
    if (!candidates.has(normalizedName)) candidates.set(normalizedName, { item, itemIndex });
  });
  for (const [normalizedName, candidate] of candidates) {
    const source = {
      quotationId: quotation._id,
      quotationVersion: quotation.versionLabel || quotation.version || '',
      itemIndex: candidate.itemIndex,
      originalName: candidate.item.name,
      originalUnit: candidate.item.unit,
      submittedBy: current.userId,
      submittedByName: safeText(current.user.nickname || current.user.username, 80),
      submittedTimestamp: Date.now()
    };
    const historyResult = await db.collection(REVIEW_COLLECTION).where({ normalizedName }).limit(100).get();
    const history = (historyResult.data || []).filter(item => item.group === 'COST_CATEGORY');
    const pending = history.find(item => item.status === 'PENDING');
    if (pending) {
      const units = Array.from(new Set([...(pending.unitCandidates || []), candidate.item.unit].filter(Boolean))).slice(0, 20);
      await db.collection(REVIEW_COLLECTION).doc(pending._id).update({
        data: {
          occurrenceCount: Number(pending.occurrenceCount || 1) + 1,
          unitCandidates: units,
          sources: [...(pending.sources || []), source].slice(-50),
          latestTimestamp: Date.now(),
          updateTime: db.serverDate()
        }
      });
      continue;
    }
    const rejectedInCooldown = history.find(item => item.status === 'REJECTED' && Date.now() - Number(item.latestTimestamp || item.reviewedTimestamp || 0) < 30 * 24 * 60 * 60 * 1000);
    if (rejectedInCooldown) {
      await db.collection(REVIEW_COLLECTION).doc(rejectedInCooldown._id).update({ data: {
        occurrenceCount: Number(rejectedInCooldown.occurrenceCount || 1) + 1,
        unitCandidates: Array.from(new Set([...(rejectedInCooldown.unitCandidates || []), candidate.item.unit].filter(Boolean))).slice(0, 20),
        sources: [...(rejectedInCooldown.sources || []), source].slice(-50),
        latestTimestamp: Date.now(),
        updateTime: db.serverDate()
      }});
      continue;
    }
    const createdTimestamp = Date.now();
    const reviewData = {
      group: 'COST_CATEGORY',
      normalizedName,
      proposedLabel: safeText(candidate.item.name, 80),
      proposedUnit: safeText(candidate.item.unit, 30),
      unitCandidates: [safeText(candidate.item.unit, 30)].filter(Boolean),
      projectName: quotation.projectName,
      occurrenceCount: 1,
      sources: [source],
      submittedBy: current.userId,
      submittedByName: source.submittedByName,
      status: 'PENDING',
      statusLabel: '待审核',
      createdTimestamp,
      latestTimestamp: createdTimestamp,
      createdAt: db.serverDate(),
      updateTime: db.serverDate()
    };
    const result = await db.collection(REVIEW_COLLECTION).add({ data: reviewData });
    await notifyCategoryReview({ ...reviewData, _id: result._id }, current, miniProgramState);
  }
}

async function createQuotation(data, current) {
  if (!MANAGE_ROLES.has(current.user.role)) {
    return { code: 403, message: '当前账号无新增项目报价权限' };
  }
  await ensureQuotationCollection();
  const projectName = safeText(data.projectName, 120);
  const createdDate = dateOnly(data.createdDate);
  const clientRequestId = safeText(data.clientRequestId, 100);
  const sourceItems = (Array.isArray(data.items) ? data.items : []).slice(0, 100);
  const invalidItem = sourceItems.some(item => (
    !safeText(item.name, 120)
    || !safeText(item.unit, 30)
    || !String(item.quantity == null ? '' : item.quantity).trim()
    || !Number.isFinite(Number(item.quantity))
    || Number(item.quantity) <= 0
    || !String(item.unitPrice == null ? '' : item.unitPrice).trim()
    || !Number.isFinite(Number(item.unitPrice))
    || Number(item.unitPrice) < 0
  ));
  const items = sourceItems.map(normalizeItem);
  const drawings = (Array.isArray(data.drawings) ? data.drawings : [])
    .slice(0, 9)
    .map(normalizeDrawing)
    .filter(file => file.fileId || file.url);

  if (!projectName) return { code: 400, message: '请输入项目名称' };
  if (!createdDate) return { code: 400, message: '请选择创建日期' };
  if (!items.length) return { code: 400, message: '请至少填写一个有效报价类目' };
  if (invalidItem) {
    return { code: 400, message: '请完善报价清单' };
  }

  if (clientRequestId) {
    const duplicated = await db.collection(QUOTATION_COLLECTION)
      .where({ clientRequestId })
      .limit(1)
      .get();
    if (duplicated.data && duplicated.data.length) {
      const existed = duplicated.data[0];
      return {
        code: 0,
        message: '报价单已创建',
        data: { id: existed._id, projectCode: existed.projectCode, duplicated: true }
      };
    }
  }

  const totalAmount = calculateTotalAmount(items);
  const nextVersion = await nextVersionInfo(projectName);
  const projectCode = buildProjectCode(createdDate);
  const createdTimestamp = Date.now();
  const record = {
    projectName,
    projectCode,
    quotationNo: projectCode,
    projectNameKey: projectName.toLowerCase(),
    version: nextVersion.value,
    versionLabel: nextVersion.label,
    versionSequence: nextVersion.sequence,
    rootQuotationId: '',
    quotationGroupId: '',
    createdDate,
    totalAmount,
    items,
    drawings,
    status: 'active',
    statusLabel: '生效中',
    createChannel: 'miniprogram',
    createChannelLabel: '微信小程序端',
    createdBy: current.userId,
    createdByName: safeText(current.user.nickname || current.user.username, 80),
    createdTimestamp,
    clientRequestId,
    createdAt: db.serverDate(),
    updateTime: db.serverDate()
  };
  const result = await db.collection(QUOTATION_COLLECTION).add({ data: record });
  await db.collection(QUOTATION_COLLECTION).doc(result._id).update({
    data: {
      rootQuotationId: result._id,
      quotationGroupId: result._id,
      updateTime: db.serverDate()
    }
  });
  await captureCategoryReviewSuggestions({ ...record, _id: result._id }, current, data._miniProgramState).catch(error => {
    console.error('生成成本类目审核申请失败:', error);
  });
  return {
    code: 0,
    message: '报价单创建成功',
    data: { id: result._id, projectCode, totalAmount }
  };
}

async function createQuotationVersion(data, current) {
  if (!MANAGE_ROLES.has(current.user.role)) {
    return { code: 403, message: '当前账号无编辑项目报价权限' };
  }
  await ensureQuotationCollection();
  const sourceId = safeText(data.sourceId, 80);
  if (!sourceId) return { code: 400, message: '缺少原报价单 ID' };

  let source;
  try {
    source = (await db.collection(QUOTATION_COLLECTION).doc(sourceId).get()).data;
  } catch (error) {
    return { code: 404, message: '原报价单不存在或已删除' };
  }
  if (!source || source.status === QUOTATION_STATUS.DELETED) {
    return { code: 404, message: '原报价单不存在或已删除' };
  }

  const clientRequestId = safeText(data.clientRequestId, 100);
  if (clientRequestId) {
    const duplicated = await db.collection(QUOTATION_COLLECTION).where({ clientRequestId }).limit(1).get();
    if (duplicated.data && duplicated.data.length) {
      const existed = duplicated.data[0];
      return { code: 0, message: '新版本已创建', data: { id: existed._id, duplicated: true } };
    }
  }

  const sourceItems = (Array.isArray(data.items) ? data.items : []).slice(0, 100);
  const invalidItem = sourceItems.some(item => (
    !safeText(item.name, 120)
    || !safeText(item.unit, 30)
    || !String(item.quantity == null ? '' : item.quantity).trim()
    || !Number.isFinite(Number(item.quantity))
    || Number(item.quantity) <= 0
    || !String(item.unitPrice == null ? '' : item.unitPrice).trim()
    || !Number.isFinite(Number(item.unitPrice))
    || Number(item.unitPrice) < 0
  ));
  const items = sourceItems.map(normalizeItem);
  if (!items.length || invalidItem) return { code: 400, message: '请完善报价清单' };
  const drawings = (Array.isArray(data.drawings) ? data.drawings : [])
    .slice(0, 9)
    .map(normalizeDrawing)
    .filter(file => file.fileId || file.url);
  const nextVersion = await nextVersionInfo(source.projectName);
  const rootQuotationId = safeText(source.rootQuotationId || source.quotationGroupId || source._id, 80);
  const now = Date.now();
  const record = {
    projectId: safeText(source.projectId, 80),
    projectName: safeText(source.projectName, 120),
    projectCode: safeText(source.projectCode || source.quotationNo, 80),
    quotationNo: safeText(source.quotationNo || source.projectCode, 80),
    projectNameKey: safeText(source.projectNameKey || source.projectName, 120).toLowerCase(),
    version: nextVersion.value,
    versionLabel: nextVersion.label,
    versionSequence: nextVersion.sequence,
    rootQuotationId,
    quotationGroupId: rootQuotationId,
    previousVersionId: source._id,
    createdDate: dateOnly(source.createdDate) || dateOnly(data.createdDate),
    totalAmount: calculateTotalAmount(items),
    items,
    drawings,
    status: 'active',
    statusLabel: '生效中',
    createChannel: 'miniprogram',
    createChannelLabel: '微信小程序端',
    createdBy: current.userId,
    createdByName: safeText(current.user.nickname || current.user.username, 80),
    createdTimestamp: now,
    updatedTimestamp: now,
    clientRequestId,
    createdAt: db.serverDate(),
    updateTime: db.serverDate()
  };
  const result = await db.collection(QUOTATION_COLLECTION).add({ data: record });
  await captureCategoryReviewSuggestions({ ...record, _id: result._id }, current, data._miniProgramState).catch(error => {
    console.error('生成成本类目审核申请失败:', error);
  });
  return {
    code: 0,
    message: '报价新版本创建成功',
    data: { id: result._id, version: nextVersion.value, versionLabel: nextVersion.label }
  };
}

function ensureSuperAdmin(current) {
  return current.user.role === ADMIN_SUPER_ROLE;
}

async function recoverStaleCategoryReviews() {
  const result = await db.collection(REVIEW_COLLECTION).where({ status: 'PROCESSING' }).limit(100).get();
  const stale = (result.data || []).filter(item => Date.now() - Number(item.processingTimestamp || 0) > 5 * 60 * 1000);
  await Promise.all(stale.map(item => db.collection(REVIEW_COLLECTION).doc(item._id).update({ data: {
    status: 'PENDING',
    processingBy: db.command.remove(),
    processingTimestamp: db.command.remove(),
    updateTime: db.serverDate()
  }})));
}

async function getReviewRecord(id) {
  try {
    return (await db.collection(REVIEW_COLLECTION).doc(id).get()).data || null;
  } catch (error) {
    return null;
  }
}

async function listCategoryReviews(data, current) {
  if (!ensureSuperAdmin(current)) return { code: 403, message: '仅超级系统管理员可审核类目' };
  await ensureReviewCollection();
  await recoverStaleCategoryReviews();
  const status = safeText(data.status, 20) || 'PENDING';
  const page = Math.max(1, Number(data.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(data.pageSize) || 20));
  const result = await db.collection(REVIEW_COLLECTION).limit(1000).get();
  const filtered = (result.data || [])
    .filter(item => status === 'ALL' || item.status === status)
    .sort((a, b) => Number(b.latestTimestamp || b.createdTimestamp) - Number(a.latestTimestamp || a.createdTimestamp));
  const start = (page - 1) * pageSize;
  return { code: 0, message: '查询成功', data: { list: filtered.slice(start, start + pageSize), total: filtered.length, page, pageSize, hasMore: page * pageSize < filtered.length } };
}

async function getCategoryReviewDetail(data, current) {
  if (!ensureSuperAdmin(current)) return { code: 403, message: '仅超级系统管理员可审核类目' };
  const review = await getReviewRecord(safeText(data.id, 80));
  if (!review) return { code: 404, message: '审核申请不存在' };
  return { code: 0, message: '查询成功', data: review };
}

async function getCategoryReviewPendingCount(current) {
  if (!ensureSuperAdmin(current)) return { code: 403, message: '仅超级系统管理员可查看审核数量' };
  await ensureReviewCollection();
  await recoverStaleCategoryReviews();
  const result = await db.collection(REVIEW_COLLECTION).where({ status: 'PENDING' }).count();
  return { code: 0, message: '查询成功', data: { count: Number(result.total) || 0 } };
}

async function claimCategoryReview(id, current) {
  const result = await db.collection(REVIEW_COLLECTION).where({ _id: id, status: 'PENDING' }).update({
    data: { status: 'PROCESSING', processingBy: current.userId, processingTimestamp: Date.now(), updateTime: db.serverDate() }
  });
  return Number(result.stats?.updated) > 0;
}

async function finishCategoryReview(id, data, current) {
  await db.collection(REVIEW_COLLECTION).doc(id).update({
    data: {
      ...data,
      reviewedBy: current.userId,
      reviewedByName: safeText(current.user.nickname || current.user.username, 80),
      reviewedTimestamp: Date.now(),
      reviewedAt: db.serverDate(),
      updateTime: db.serverDate()
    }
  });
  const notifications = await db.collection(NOTIFICATION_COLLECTION).where({ reviewRequestId: id }).limit(100).get();
  await Promise.all((notifications.data || []).map(item => db.collection(NOTIFICATION_COLLECTION).doc(item._id).update({
    data: { reviewStatus: data.status, reviewStatusLabel: data.statusLabel, updateTime: db.serverDate() }
  })));
  await db.collection('operation_logs').add({ data: {
    uid: current.userId,
    un: safeText(current.user.nickname || current.user.username, 20),
    username: safeText(current.user.username, 80),
    m: '成本类目审核',
    a: safeText(data.status, 30).toLowerCase(),
    c: `审核申请 ${id}：${data.statusLabel}`,
    s: '成功',
    createdTimestamp: Date.now(),
    createdAt: db.serverDate()
  }}).catch(error => console.error('记录类目审核日志失败:', error));
}

async function reviewCategoryRequest(data, current) {
  if (!ensureSuperAdmin(current)) return { code: 403, message: '仅超级系统管理员可审核类目' };
  const id = safeText(data.id, 80);
  const action = safeText(data.reviewAction, 20).toUpperCase();
  if (!id || !['APPROVE', 'MERGE', 'REJECT'].includes(action)) return { code: 400, message: '审核参数无效' };
  const review = await getReviewRecord(id);
  if (!review) return { code: 404, message: '审核申请不存在' };
  if (review.status !== 'PENDING') return { code: 409, message: '该申请已被其他管理员处理' };
  if (!(await claimCategoryReview(id, current))) return { code: 409, message: '该申请已被其他管理员处理' };
  try {
    if (action === 'REJECT') {
      const reason = safeText(data.reason, 200);
      await finishCategoryReview(id, { status: 'REJECTED', statusLabel: '已驳回', reviewRemark: reason }, current);
      return { code: 0, message: '已驳回', data: { id, status: 'REJECTED' } };
    }
    if (action === 'MERGE') {
      const configId = safeText(data.configId, 80);
      const config = configId ? (await db.collection(CONFIG_COLLECTION).doc(configId).get()).data : null;
      if (!config || config.group !== 'COST_CATEGORY') throw Object.assign(new Error('请选择有效的成本配置'), { businessCode: 400 });
      const mergeValidation = validateCategoryMerge(review, config);
      if (!mergeValidation.allowed) {
        throw Object.assign(new Error(`不能合并：${mergeValidation.reason}。请改选更接近的已有类目，或使用“通过新增”`), { businessCode: 422 });
      }
      if (data.reactivate && config.isActive === false) {
        const active = await db.collection(CONFIG_COLLECTION).where({ group: 'COST_CATEGORY', isActive: true }).orderBy('sortOrder', 'desc').limit(1).get();
        const sortOrder = (Number(active.data?.[0]?.sortOrder) || 0) + 1;
        await db.collection(CONFIG_COLLECTION).doc(configId).update({ data: { isActive: true, sortOrder, updateTime: db.serverDate() } });
      }
      await finishCategoryReview(id, { status: 'MERGED', statusLabel: '已合并', approvedConfigId: configId, approvedLabel: config.label, reviewRemark: safeText(data.reason, 200) }, current);
      return { code: 0, message: '已合并到现有配置', data: { id, status: 'MERGED', configId } };
    }
    const label = safeText(data.label, 80);
    const commonUnit = safeText(data.commonUnit, 30);
    const description = safeText(data.description, 240);
    if (!label || !commonUnit) throw Object.assign(new Error('请填写配置名称和常用单位'), { businessCode: 400 });
    const allConfigs = await db.collection(CONFIG_COLLECTION).where({ group: 'COST_CATEGORY' }).limit(1000).get();
    const duplicated = (allConfigs.data || []).find(item => normalizeCategoryName(item.label) === normalizeCategoryName(label));
    if (duplicated) throw Object.assign(new Error('同名或近似配置已存在，请选择合并'), { businessCode: 409, data: { configId: duplicated._id } });
    let value = `review_${crypto.createHash('sha1').update(`${review.normalizedName}_${Date.now()}`).digest('hex').slice(0, 12)}`;
    const last = await db.collection(CONFIG_COLLECTION).where({ group: 'COST_CATEGORY' }).orderBy('sortOrder', 'desc').limit(1).get();
    const sortOrder = (Number(last.data?.[0]?.sortOrder) || 0) + 1;
    const configResult = await db.collection(CONFIG_COLLECTION).add({ data: { group: 'COST_CATEGORY', label, value, commonUnit, description, sortOrder, isActive: true, source: 'REVIEW_APPROVED', reviewRequestId: id, createdAt: db.serverDate(), updateTime: db.serverDate() } });
    await finishCategoryReview(id, { status: 'APPROVED', statusLabel: '已通过', approvedConfigId: configResult._id, approvedLabel: label, approvedUnit: commonUnit, reviewRemark: safeText(data.reason, 200) }, current);
    return { code: 0, message: '审核通过，配置已新增', data: { id, status: 'APPROVED', configId: configResult._id } };
  } catch (error) {
    await db.collection(REVIEW_COLLECTION).doc(id).update({ data: { status: 'PENDING', processingBy: db.command.remove(), processingTimestamp: db.command.remove(), updateTime: db.serverDate() } }).catch(() => {});
    return { code: error.businessCode || 500, message: error.message || '审核处理失败', data: error.data };
  }
}

async function getNextVersion(data) {
  await ensureQuotationCollection();
  const nextVersion = await nextVersionInfo(data.projectName);
  return { code: 0, message: '查询成功', data: nextVersion };
}

async function parseExcelImport(data, current) {
  if (!MANAGE_ROLES.has(current.user.role)) {
    return { code: 403, message: '当前账号无导入报价清单权限' };
  }
  const fileId = safeText(data.fileId, 500);
  const fileName = safeText(data.fileName, 160);
  const extension = fileName.split('.').pop().toLowerCase();
  if (!fileId || !['xlsx', 'xls'].includes(extension)) {
    return { code: 400, message: '请选择有效的 Excel 文件' };
  }
  try {
    const download = await cloud.downloadFile({ fileID: fileId });
    const fileContent = download.fileContent;
    if (!fileContent || fileContent.length > 10 * 1024 * 1024) {
      return { code: 400, message: 'Excel 文件不能超过 10MB' };
    }
    const workbook = XLSX.read(fileContent, { type: 'buffer', cellDates: false });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) return { code: 400, message: 'Excel 中没有可用工作表' };
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], {
      header: 1,
      raw: true,
      defval: ''
    });
    const header = Array.isArray(rows[0]) ? rows[0] : [];
    if (header.length < 4) {
      return { code: 400, message: 'Excel 表头与报价清单格式不一致' };
    }
    const sourceRows = rows.slice(1, 101)
      .filter(row => Array.isArray(row) && row.some(cell => safeText(cell, 200)));
    const invalidRowIndex = sourceRows.findIndex(row => (
      !safeText(row[0], 120)
      || !String(row[1] == null ? '' : row[1]).trim()
      || !Number.isFinite(Number(row[1]))
      || Number(row[1]) <= 0
      || !safeText(row[2], 30)
      || !String(row[3] == null ? '' : row[3]).trim()
      || !Number.isFinite(Number(row[3]))
      || Number(row[3]) < 0
    ));
    if (invalidRowIndex >= 0) {
      return { code: 400, message: `Excel 第 ${invalidRowIndex + 2} 行数据不完整` };
    }
    const items = sourceRows
      .map((row, index) => normalizeItem({
        itemCode: `ITEM_${index + 1}`,
        name: row[0],
        quantity: row[1],
        unit: row[2],
        unitPrice: row[3],
        remark: row[4]
      }, index))
      .filter(item => item.name);
    if (!items.length) return { code: 400, message: 'Excel 中没有有效报价数据' };
    return { code: 0, message: '导入成功', data: { items, count: items.length } };
  } catch (error) {
    console.error('Excel 报价清单解析失败:', error);
    return { code: 400, message: 'Excel 文件解析失败，请检查文件格式' };
  } finally {
    cloud.deleteFile({ fileList: [fileId] }).catch(() => {});
  }
}

function normalizeVersion(value) {
  const text = safeText(value, 30);
  if (!text) return 'V1.0';
  return /^v/i.test(text) ? `V${text.slice(1)}` : `V${text}`;
}

function formatQuotation(item) {
  const createdValue = quotationDate(item);
  const createdTimestamp = timestamp(createdValue);
  const project = item.project || {};
  return {
    _id: item._id,
    projectId: safeText(item.projectId || project._id, 80),
    projectName: safeText(item.projectName || item.title || item.name || project.name, 120) || '未命名项目',
    projectNameKey: safeText(item.projectNameKey || item.projectName || item.title || item.name || project.name, 120).toLowerCase(),
    projectCode: safeText(item.projectCode || item.code || item.quotationNo || project.code, 80) || '-',
    version: normalizeVersion(item.version || item.versionNo || item.quotationVersion),
    versionLabel: safeText(item.versionLabel, 40) || versionInfo(versionSequence(item)).label,
    versionSequence: versionSequence(item),
    totalAmount: Number(item.totalAmount ?? item.quotationAmount ?? item.quoteAmount ?? item.amount ?? item.total) || 0,
    createdDate: formatDate(createdValue) || '日期未设置',
    createdYear: createdTimestamp ? String(new Date(createdTimestamp).getFullYear()) : '',
    createdTimestamp,
    status: safeText(item.status, 40),
    rootQuotationId: safeText(item.rootQuotationId || item.quotationGroupId || item._id, 80)
  };
}

function formatQuotationDetail(item, versions, canManage) {
  const updatedValue = item.updatedTimestamp || item.updateTime || item.createdTimestamp || item.createdAt;
  return {
    ...formatQuotation(item),
    createdDateRaw: dateOnly(item.createdDate),
    totalAmount: normalizeMoney(item.totalAmount),
    items: (Array.isArray(item.items) ? item.items : []).map(normalizeItem),
    drawings: (Array.isArray(item.drawings) ? item.drawings : []).map(normalizeDrawing),
    updatedDate: formatDate(updatedValue) || formatDate(quotationDate(item)),
    updatedDateTime: formatDateTime(updatedValue) || formatDateTime(quotationDate(item)),
    updatedByName: safeText(item.createdByName || item.updatedByName, 80) || '系统用户',
    canManage,
    versions
  };
}

async function getQuotationDetail(data, current) {
  await ensureQuotationCollection();
  const id = safeText(data.id, 80);
  if (!id) return { code: 400, message: '缺少报价单 ID' };
  let item;
  try {
    item = (await db.collection(QUOTATION_COLLECTION).doc(id).get()).data;
  } catch (error) {
    return { code: 404, message: '报价单不存在或已删除' };
  }
  if (!item || item.status === QUOTATION_STATUS.DELETED) {
    return { code: 404, message: '报价单不存在或已删除' };
  }
  const rootQuotationId = safeText(item.rootQuotationId || item.quotationGroupId || item._id, 80);
  const projectName = safeText(item.projectName || item.title || item.name, 120);
  const projectNameKey = safeText(item.projectNameKey || projectName, 120).toLowerCase();
  const [rootResult, groupResult, nameKeyResult, nameResult] = await Promise.all([
    db.collection(QUOTATION_COLLECTION).where({ rootQuotationId }).limit(100).get(),
    db.collection(QUOTATION_COLLECTION).where({ quotationGroupId: rootQuotationId }).limit(100).get(),
    projectNameKey
      ? db.collection(QUOTATION_COLLECTION).where({ projectNameKey }).limit(100).get()
      : Promise.resolve({ data: [] }),
    projectName
      ? db.collection(QUOTATION_COLLECTION).where({ projectName }).limit(100).get()
      : Promise.resolve({ data: [] })
  ]);
  const versionMap = new Map();
  [item].concat(rootResult.data || [], groupResult.data || [], nameKeyResult.data || [], nameResult.data || []).forEach(record => {
    if (record && record._id && record.status !== QUOTATION_STATUS.DELETED) versionMap.set(record._id, record);
  });
  const versionRecords = Array.from(versionMap.values());
  const versions = versionRecords
    .map(record => ({
      id: record._id,
      version: normalizeVersion(record.version || record.versionNo || record.quotationVersion),
      versionLabel: versionInfo(versionSequence(record)).label,
      versionSequence: versionSequence(record),
      updatedDateTime: formatDateTime(record.updatedTimestamp || record.updateTime || record.createdTimestamp || record.createdAt),
      updatedByName: safeText(record.createdByName || record.updatedByName, 80) || '系统用户'
    }))
    .sort((left, right) => right.versionSequence - left.versionSequence);
  const currentSequence = versions.length ? versions[0].versionSequence : versionSequence(item);
  const detail = formatQuotationDetail(item, versions, MANAGE_ROLES.has(current.user.role));
  detail.isCurrentVersion = detail.versionSequence === currentSequence;
  return { code: 0, message: '查询成功', data: detail };
}

async function ensureQuotationShare(data, current) {
  await ensureQuotationCollection();
  const id = safeText(data.id, 80);
  if (!id) return { code: 400, message: '缺少报价单 ID' };
  let item;
  try {
    item = (await db.collection(QUOTATION_COLLECTION).doc(id).get()).data;
  } catch (error) {
    return { code: 404, message: '报价单不存在或已删除' };
  }
  if (!item || item.status === QUOTATION_STATUS.DELETED) {
    return { code: 404, message: '报价单不存在或已删除' };
  }
  const rootQuotationId = safeText(item.rootQuotationId || item.quotationGroupId || item._id, 80);
  const shareToken = safeText(item.clientShareToken, 100) || crypto.randomBytes(24).toString('hex');
  const [rootResult, groupResult] = await Promise.all([
    db.collection(QUOTATION_COLLECTION).where({ rootQuotationId }).limit(100).get(),
    db.collection(QUOTATION_COLLECTION).where({ quotationGroupId: rootQuotationId }).limit(100).get()
  ]);
  const versionMap = new Map();
  [item].concat(rootResult.data || [], groupResult.data || []).forEach(record => {
    if (record && record._id && record.status !== QUOTATION_STATUS.DELETED) {
      versionMap.set(record._id, record);
    }
  });

  const updates = Array.from(versionMap.values()).map(record =>
    db.collection(QUOTATION_COLLECTION).doc(record._id).update({
      data: {
        clientShareToken: shareToken,
        clientShareEnabled: true,
        clientShareUpdatedBy: current.userId,
        clientShareUpdatedAt: db.serverDate(),
        updateTime: record.updateTime || db.serverDate()
      }
    }).catch(() => {})
  );
  await Promise.all(updates);

  return { code: 0, message: '客户分享链接已准备', data: { id, shareToken } };
}

function shareTokenMatches(expected, received) {
  const left = Buffer.from(safeText(expected, 100));
  const right = Buffer.from(safeText(received, 100));
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function getPublicQuotationDetail(data) {
  await ensureQuotationCollection();
  const id = safeText(data.id, 80);
  const shareToken = safeText(data.shareToken, 100);
  if (!id || !shareToken) return { code: 403, message: '客户报价链接无效' };
  let sharedItem;
  try {
    sharedItem = (await db.collection(QUOTATION_COLLECTION).doc(id).get()).data;
  } catch (error) {
    return { code: 404, message: '该报价单已失效，请联系重新发送' };
  }
  if (
    !sharedItem
    || sharedItem.status === QUOTATION_STATUS.DELETED
    || sharedItem.clientShareEnabled === false
    || !shareTokenMatches(sharedItem.clientShareToken, shareToken)
  ) {
    return { code: 404, message: '该报价单已失效，请联系重新发送' };
  }

  const rootQuotationId = safeText(
    sharedItem.rootQuotationId || sharedItem.quotationGroupId || sharedItem._id,
    80
  );
  const [rootResult, groupResult] = await Promise.all([
    db.collection(QUOTATION_COLLECTION).where({ rootQuotationId }).limit(100).get(),
    db.collection(QUOTATION_COLLECTION).where({ quotationGroupId: rootQuotationId }).limit(100).get()
  ]);
  const versionMap = new Map();
  [sharedItem].concat(rootResult.data || [], groupResult.data || [])
    .forEach(record => {
      if (record && record._id && record.status !== QUOTATION_STATUS.DELETED) {
        versionMap.set(record._id, record);
      }
    });

  const requestedVersionId = safeText(data.versionId, 80) || id;
  const item = versionMap.get(requestedVersionId);
  if (!item) return { code: 404, message: '该报价版本不存在或已失效，请联系重新发送' };

  const versions = Array.from(versionMap.values())
    .map(record => ({
      id: record._id,
      version: normalizeVersion(record.version || record.versionNo || record.quotationVersion),
      versionLabel: versionInfo(versionSequence(record)).label,
      versionSequence: versionSequence(record)
    }))
    .sort((left, right) => right.versionSequence - left.versionSequence);
  const currentSequence = versions.length ? versions[0].versionSequence : versionSequence(item);
  const updatedValue = item.updatedTimestamp || item.updateTime || item.createdTimestamp || item.createdAt;
  const updatedTimestamp = timestamp(updatedValue) || Date.now();
  return {
    code: 0,
    message: '查询成功',
    data: {
      id: item._id,
      projectName: safeText(item.projectName || item.title || item.name, 120) || '未命名项目',
      projectCode: safeText(item.projectCode || item.quotationNo, 80) || '-',
      version: normalizeVersion(item.version || item.versionNo || item.quotationVersion),
      versionLabel: versionInfo(versionSequence(item)).label,
      versionSequence: versionSequence(item),
      versions: versions.map(version => ({
        ...version,
        current: version.versionSequence === currentSequence
      })),
      totalAmount: normalizeMoney(item.totalAmount),
      updatedDate: formatDate(updatedValue) || formatDate(quotationDate(item)),
      validUntil: formatDate(updatedTimestamp + 30 * 24 * 60 * 60 * 1000),
      items: (Array.isArray(item.items) ? item.items : []).map(normalizeItem),
      drawings: (Array.isArray(item.drawings) ? item.drawings : []).map(normalizeDrawing),
      contactName: safeText(item.createdByName || item.updatedByName, 80) || '项目商务负责人'
    }
  };
}

async function listQuotations(data, current) {
  await ensureQuotationCollection();
  const page = Math.max(1, Number(data.page) || 1);
  const pageSize = Math.min(30, Math.max(1, Number(data.pageSize) || 10));
  const { filtered, years } = await getFilteredQuotationList(data);
  const start = (page - 1) * pageSize;
  return {
    code: 0,
    message: '查询成功',
    data: {
      list: filtered.slice(start, start + pageSize),
      total: filtered.length,
      page,
      pageSize,
      hasMore: page * pageSize < filtered.length,
      years,
      canManage: MANAGE_ROLES.has(current.user.role)
    }
  };
}

async function getFilteredQuotationList(data = {}) {
  const keyword = safeText(data.keyword, 120).toLowerCase();
  const year = safeText(data.year, 4);
  const result = await db.collection(QUOTATION_COLLECTION).limit(1000).get();
  const formattedItems = (result.data || [])
    .filter(item => item.status !== QUOTATION_STATUS.DELETED)
    .map(formatQuotation)
    .sort((left, right) => right.createdTimestamp - left.createdTimestamp);
  const latestByGroup = new Map();
  formattedItems.forEach(item => {
    const groupId = item.projectNameKey || item.rootQuotationId || item._id;
    const existed = latestByGroup.get(groupId);
    if (!existed || item.versionSequence > existed.versionSequence) latestByGroup.set(groupId, item);
  });
  const allItems = Array.from(latestByGroup.values())
    .sort((left, right) => right.createdTimestamp - left.createdTimestamp);
  const years = Array.from(new Set(allItems.map(item => item.createdYear).filter(Boolean)))
    .sort((left, right) => Number(right) - Number(left));
  const filtered = allItems.filter(item => {
    if (year && item.createdYear !== year) return false;
    if (!keyword) return true;
    return [item.projectName, item.projectCode].some(value => value.toLowerCase().includes(keyword));
  });
  return { filtered, years };
}

async function listQuotationIds(data, current) {
  if (!MANAGE_ROLES.has(current.user.role)) {
    return { code: 403, message: '当前账号无管理项目报价权限' };
  }
  await ensureQuotationCollection();
  const { filtered } = await getFilteredQuotationList(data);
  return {
    code: 0,
    message: '查询成功',
    data: {
      ids: filtered.map(item => item._id),
      total: filtered.length,
    }
  };
}

async function deleteQuotations(data, current) {
  if (!MANAGE_ROLES.has(current.user.role)) {
    return { code: 403, message: '当前账号无删除项目报价权限' };
  }
  await ensureQuotationCollection();
  const ids = Array.from(new Set((Array.isArray(data.ids) ? data.ids : [])
    .map(id => safeText(id, 80))
    .filter(Boolean)))
    .slice(0, 1000);
  if (!ids.length) return { code: 400, message: '请选择要删除的报价单' };

  const selectedIdValues = new Set(ids);
  const allResult = await db.collection(QUOTATION_COLLECTION).limit(1000).get();
  const allRecords = allResult.data || [];
  const selectedRecords = allRecords.filter(item => item && selectedIdValues.has(item._id));
  if (!selectedRecords.length) return { code: 404, message: '所选报价单不存在' };

  const selectedIds = new Set(selectedRecords.map(item => item._id));
  const projectNameKeys = new Set(selectedRecords
    .map(item => safeText(item.projectNameKey || item.projectName || item.title || item.name, 120).toLowerCase())
    .filter(Boolean));
  const rootIds = new Set(selectedRecords
    .map(item => safeText(item.rootQuotationId || item.quotationGroupId || item._id, 80))
    .filter(Boolean));
  const recordsInGroups = allRecords.filter(item => {
    if (!item) return false;
    if (selectedIds.has(item._id)) return true;
    const projectNameKey = safeText(item.projectNameKey || item.projectName || item.title || item.name, 120).toLowerCase();
    const rootId = safeText(item.rootQuotationId || item.quotationGroupId || item._id, 80);
    return (projectNameKey && projectNameKeys.has(projectNameKey)) || (rootId && rootIds.has(rootId));
  });
  const groupRecordIds = new Set(recordsInGroups.map(item => item._id));
  const referencedByOtherQuotations = collectQuotationFileIds(allRecords
    .filter(item => !groupRecordIds.has(item._id) && item.status !== QUOTATION_STATUS.DELETED));
  const fileIds = Array.from(collectQuotationFileIds(recordsInGroups))
    .filter(fileId => !referencedByOtherQuotations.has(fileId));
  const recordsToDelete = recordsInGroups.filter(item => item.status !== QUOTATION_STATUS.DELETED);
  const deletedTimestamp = Date.now();
  const batchSize = 20;
  for (let index = 0; index < recordsToDelete.length; index += batchSize) {
    const batch = recordsToDelete.slice(index, index + batchSize);
    await Promise.all(batch.map(item =>
      db.collection(QUOTATION_COLLECTION).doc(item._id).update({
        data: {
          status: QUOTATION_STATUS.DELETED,
          statusLabel: '已删除',
          clientShareEnabled: false,
          deletedBy: current.userId,
          deletedTimestamp,
          deletedAt: db.serverDate(),
          storageCleanupStatus: fileIds.length ? 'pending' : 'not_needed',
          updateTime: db.serverDate()
        }
      })
    ));
  }

  try {
    const deletedFiles = await deleteCloudFiles(fileIds);
    for (let index = 0; index < recordsInGroups.length; index += batchSize) {
      const batch = recordsInGroups.slice(index, index + batchSize);
      await Promise.all(batch.map(item =>
        db.collection(QUOTATION_COLLECTION).doc(item._id).update({
          data: {
            storageCleanupStatus: fileIds.length ? 'completed' : 'not_needed',
            storageCleanupFileCount: deletedFiles,
            storageCleanupTimestamp: Date.now(),
            storageCleanupAt: db.serverDate(),
            updateTime: db.serverDate()
          }
        })
      ));
    }
    return {
      code: 0,
      message: '删除成功',
      data: { deleted: selectedRecords.length, deletedVersions: recordsToDelete.length, deletedFiles }
    };
  } catch (error) {
    await Promise.all(recordsInGroups.map(item =>
      db.collection(QUOTATION_COLLECTION).doc(item._id).update({
        data: {
          storageCleanupStatus: 'failed',
          storageCleanupError: safeText(error.message, 300),
          storageCleanupTimestamp: Date.now(),
          updateTime: db.serverDate()
        }
      }).catch(() => {})
    ));
    throw error;
  }
}

exports.main = async event => {
  let body;
  try {
    body = parseBody(event);
  } catch (error) {
    return { code: 400, message: '请求格式错误' };
  }
  const action = body.action;
  const data = body.data || {};
  try {
    if (action === 'publicDetail') return await getPublicQuotationDetail(data);
    const current = await authenticate(event, data);
    if (current.error) return current.error;
    if (action === 'list') return await listQuotations(data, current);
    if (action === 'listIds') return await listQuotationIds(data, current);
    if (action === 'deleteBatch') return await deleteQuotations(data, current);
    if (action === 'detail') return await getQuotationDetail(data, current);
    if (action === 'prepareShare') return await ensureQuotationShare(data, current);
    if (action === 'create') return await createQuotation(data, current);
    if (action === 'createVersion') return await createQuotationVersion(data, current);
    if (action === 'reviewList') return await listCategoryReviews(data, current);
    if (action === 'reviewDetail') return await getCategoryReviewDetail(data, current);
    if (action === 'reviewPendingCount') return await getCategoryReviewPendingCount(current);
    if (action === 'reviewSubmit') return await reviewCategoryRequest(data, current);
    if (action === 'nextVersion') return await getNextVersion(data);
    if (action === 'parseExcel') return await parseExcelImport(data, current);
    return { code: 400, message: '未知操作' };
  } catch (error) {
    console.error('项目报价服务操作失败:', error);
    return { code: 500, message: '项目报价服务暂时不可用', error: error.message };
  }
};
