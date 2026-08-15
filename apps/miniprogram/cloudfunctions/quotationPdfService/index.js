'use strict';

const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const { PDF_LAYOUT_VERSION, buildQuotationPdf } = require('./pdf-generator');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const QUOTATION_COLLECTION = 'project_quotations';
const SESSION_COLLECTION = 'auth_sessions';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const READ_ROLES = new Set([
  'ADMIN_SUPER', 'ADMIN_COM', 'ADMIN', 'PROJECT_MANAGER',
  'FINANCE_MANAGER', 'VISITOR', 'user'
]);

function safeText(value, maxLength = 200) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function parseBody(event) {
  if (event.body) return typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  return event || {};
}

function getAuthToken(event, data) {
  const headers = event.headers || {};
  const authorization = headers.authorization || headers.Authorization || '';
  return String(data.authToken || event.authToken || authorization.replace(/^Bearer\s+/i, '') || '').trim();
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
    db.collection(SESSION_COLLECTION).doc(session._id).update({ data: {
      lastActiveAt: now,
      expiresAt: now + SESSION_TTL_MS,
      updateTime: db.serverDate()
    }}).catch(() => {});
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

function normalizeMoney(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

function dateOnly(value) {
  const matched = safeText(value, 40).match(/^\d{4}-\d{2}-\d{2}/);
  return matched ? matched[0] : '';
}

function versionSequence(item) {
  const direct = Number(item.versionSequence);
  if (Number.isFinite(direct) && direct > 0) return Math.floor(direct);
  const matched = safeText(item.version || item.versionNo || item.quotationVersion, 30).match(/\d+/);
  return matched ? Math.max(1, Number(matched[0])) : 1;
}

function versionLabel(sequence) {
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  return `版本${digits[sequence] || sequence}`;
}

function normalizeItem(item, index) {
  const quantity = normalizeMoney(item.quantity);
  const unitPrice = normalizeMoney(item.unitPrice);
  return {
    itemCode: safeText(item.itemCode, 40) || `ITEM_${index + 1}`,
    name: safeText(item.name, 120),
    quantity,
    unit: safeText(item.unit, 30),
    unitPrice,
    totalAmount: normalizeMoney(item.totalAmount != null ? item.totalAmount : quantity * unitPrice),
    remark: safeText(item.remark, 300)
  };
}

function normalizeDrawing(file) {
  return {
    fileId: safeText(file && (file.fileId || file.fileID), 500),
    url: safeText(file && file.url, 1000),
    name: safeText(file && file.name, 160)
  };
}

function quotationPdfSnapshot(item) {
  const sequence = versionSequence(item);
  return {
    layoutVersion: PDF_LAYOUT_VERSION,
    id: safeText(item._id, 80),
    projectName: safeText(item.projectName || item.title || item.name, 120),
    projectCode: safeText(item.projectCode || item.quotationNo, 80),
    version: safeText(item.version || item.versionNo || item.quotationVersion, 30) || `V${sequence}.0`,
    versionLabel: safeText(item.versionLabel, 40) || versionLabel(sequence),
    versionSequence: sequence,
    createdDate: dateOnly(item.createdDate),
    totalAmount: normalizeMoney(item.totalAmount),
    items: (Array.isArray(item.items) ? item.items : []).map(normalizeItem),
    drawings: (Array.isArray(item.drawings) ? item.drawings : []).map(normalizeDrawing)
  };
}

function pdfFileName(snapshot) {
  const projectName = safeText(snapshot.projectName, 60)
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ') || '项目';
  const version = safeText(snapshot.versionLabel || snapshot.version, 30)
    .replace(/[\\/:*?"<>|]/g, '-') || '报价';
  return `${projectName}-${version}-报价单.pdf`;
}

async function cachedCloudFileExists(fileId) {
  if (!fileId) return false;
  try {
    const result = await cloud.getTempFileURL({ fileList: [fileId] });
    const file = (result.fileList || [])[0];
    return Boolean(file && file.tempFileURL && (file.status == null || Number(file.status) === 0));
  } catch (error) {
    return false;
  }
}

async function deleteCloudFile(fileId) {
  if (!fileId) return;
  await cloud.deleteFile({ fileList: [fileId] });
}

async function generatePdf(data, current) {
  const startedAt = Date.now();
  const id = safeText(data.id, 80);
  if (!id) return { code: 400, message: '缺少报价单 ID' };
  let item;
  try {
    item = (await db.collection(QUOTATION_COLLECTION).doc(id).get()).data;
  } catch (error) {
    return { code: 404, message: '报价单不存在或已删除' };
  }
  if (!item || item.status === 'deleted') return { code: 404, message: '报价单不存在或已删除' };

  const snapshot = quotationPdfSnapshot(item);
  const contentHash = crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  const fileName = pdfFileName(snapshot);
  const existedFileId = safeText(item.pdfFileId, 500);
  if (existedFileId && safeText(item.pdfContentHash, 80) === contentHash && await cachedCloudFileExists(existedFileId)) {
    console.info('[quotation-pdf] reuse cached file', { id, elapsedMs: Date.now() - startedAt });
    return { code: 0, message: 'PDF 已生成', data: {
      fileId: existedFileId,
      fileName: safeText(item.pdfFileName, 160) || fileName,
      fileSize: Number(item.pdfFileSize) || 0,
      generatedTimestamp: Number(item.pdfGeneratedTimestamp) || 0,
      reused: true
    }};
  }

  const renderingStartedAt = Date.now();
  const pdfBuffer = await buildQuotationPdf(snapshot);
  console.info('[quotation-pdf] rendered', {
    id,
    itemCount: snapshot.items.length,
    bytes: pdfBuffer && pdfBuffer.length,
    renderMs: Date.now() - renderingStartedAt
  });
  if (!pdfBuffer || !pdfBuffer.length) throw new Error('报价单 PDF 生成失败');
  const cloudPath = `project-quotation-pdfs/${id}/${contentHash.slice(0, 24)}.pdf`;
  const uploadResult = await cloud.uploadFile({ cloudPath, fileContent: pdfBuffer });
  console.info('[quotation-pdf] uploaded', { id, elapsedMs: Date.now() - startedAt });
  const fileId = safeText(uploadResult.fileID, 500);
  if (!fileId) throw new Error('报价单 PDF 上传失败');

  const generatedTimestamp = Date.now();
  try {
    await db.collection(QUOTATION_COLLECTION).doc(id).update({ data: {
      pdfFileId: fileId,
      pdfFileName: fileName,
      pdfFileSize: pdfBuffer.length,
      pdfContentHash: contentHash,
      pdfLayoutVersion: PDF_LAYOUT_VERSION,
      pdfGeneratedBy: current.userId,
      pdfGeneratedByName: safeText(current.user.nickname || current.user.username, 80),
      pdfGeneratedTimestamp: generatedTimestamp,
      pdfGeneratedAt: db.serverDate()
    }});
  } catch (error) {
    await deleteCloudFile(fileId).catch(() => {});
    throw error;
  }
  if (existedFileId && existedFileId !== fileId) {
    await deleteCloudFile(existedFileId).catch(error => console.warn('旧报价单 PDF 清理失败:', error));
  }
  return { code: 0, message: 'PDF 生成成功', data: {
    fileId, fileName, fileSize: pdfBuffer.length, generatedTimestamp, reused: false
  }};
}

exports.main = async event => {
  let body;
  try {
    body = parseBody(event);
  } catch (error) {
    return { code: 400, message: '请求格式错误' };
  }
  const data = body.data || {};
  try {
    const current = await authenticate(event, data);
    if (current.error) return current.error;
    if (body.action === 'generate') return await generatePdf(data, current);
    return { code: 400, message: '未知操作' };
  } catch (error) {
    console.error('报价单 PDF 服务操作失败:', error);
    return { code: 500, message: error.message || '报价单 PDF 服务暂时不可用' };
  }
};
