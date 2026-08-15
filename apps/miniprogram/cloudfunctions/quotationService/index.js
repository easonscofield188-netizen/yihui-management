'use strict';

const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const XLSX = require('xlsx');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const QUOTATION_COLLECTION = 'project_quotations';
const SESSION_COLLECTION = 'auth_sessions';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
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
  return {
    code: 0,
    message: '报价新版本创建成功',
    data: { id: result._id, version: nextVersion.value, versionLabel: nextVersion.label }
  };
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
    if (action === 'nextVersion') return await getNextVersion(data);
    if (action === 'parseExcel') return await parseExcelImport(data, current);
    return { code: 400, message: '未知操作' };
  } catch (error) {
    console.error('项目报价服务操作失败:', error);
    return { code: 500, message: '项目报价服务暂时不可用', error: error.message };
  }
};
