'use strict';

const cloud = require('wx-server-sdk');
const crypto = require('crypto');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const CASE_COLLECTION = 'project_cases';
const DATA_SCOPE = Object.freeze({ REAL: 'REAL', DEMO: 'DEMO' });
const REVIEW_ROLE = 'ADMIN_REVIEW';
const VISITOR_ROLE = 'VISITOR';
const SESSION_COLLECTION = 'auth_sessions';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const CASE_STATUS = Object.freeze({ PUBLISHED: 'published', DRAFT: 'draft', DELETED: 'deleted' });
const FALLBACK_PROJECT_SCENES = Object.freeze([
  { value: 'internal_operation', label: '内部运营' }
]);
const READ_ROLES = new Set([
  'ADMIN_SUPER',
  'ADMIN_COM',
  'ADMIN',
  'PROJECT_MANAGER',
  'FINANCE_MANAGER',
  'VISITOR',
  'ADMIN_REVIEW',
  'user'
]);
const MANAGE_ROLES = new Set(['ADMIN_SUPER', 'ADMIN_COM', 'ADMIN']);

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
    return { error: { code: 403, message: '当前账号无项目案例访问权限' } };
  }
  if (user.role === REVIEW_ROLE && user.reviewEnabled === false) {
    return { error: { code: 403, message: '当前账号无权访问该内容' } };
  }
  const isDemoUser = [REVIEW_ROLE, VISITOR_ROLE].includes(user.role);
  return { userId: session.userId, user, isDemoUser, dataScope: isDemoUser ? DATA_SCOPE.DEMO : DATA_SCOPE.REAL };
}

async function ensureCaseCollection() {
  if (collectionReady) return;
  try {
    await db.createCollection(CASE_COLLECTION);
  } catch (error) {
    // 集合已经存在时会进入这里；后续查询会验证集合是否可用。
  }
  collectionReady = true;
}

function normalizeCategory(value) {
  return safeText(value, 80);
}

async function getCategoryOptions() {
  try {
    const result = await db.collection('system_configs').where({
      group: 'PROJECT_SCENE',
      isActive: true
    }).limit(100).get();
    const configured = (result.data || [])
      .map(item => ({
        value: normalizeCategory(item.value),
        label: safeText(item.label, 80),
        sortOrder: Number(item.sortOrder) || 0
      }))
      .filter(item => item.value && item.label)
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map(({ value, label }) => ({ value, label }));
    if (configured.length) return configured;
  } catch (error) {
    // 配置尚未建立时使用内置字典，保证功能可用。
  }
  return FALLBACK_PROJECT_SCENES;
}

function caseTimestamp(item) {
  const direct = Number(item.publishTimestamp || item.createdTimestamp || 0);
  if (direct) return direct;
  const raw = item.caseDate || item.publishDate || item.createdAt?.$date || item.createdAt;
  const date = new Date(raw || 0);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function formatCase(item) {
  const categoryCode = normalizeCategory(item.categoryCode || item.sceneCode);
  return {
    ...item,
    title: item.title || item.projectName || item.name || '未命名案例',
    summary: item.summary || item.description || item.desc || '',
    content: item.content || item.detail || item.summary || item.description || item.desc || '',
    categoryCode,
    categoryLabel: item.categoryLabel || item.sceneLabel || categoryCode || '其他',
    coverFileId: item.coverFileId || item.imageFileId || '',
    coverUrl: item.coverUrl || item.imageUrl || '',
    caseDate: item.caseDate || item.publishDate || item.deliveryDate || item.startDate || '',
    images: (Array.isArray(item.images) ? item.images : []).slice(0, 9).map(image => ({
      fileId: image.fileId || image.fileID || '',
      url: image.url || image.fileUrl || '',
      name: image.name || '',
      sourceCode: image.sourceCode || 'case_upload'
    }))
  };
}

function applySceneTranslation(item, projectScenes) {
  const matched = projectScenes.find(scene => scene.value === item.categoryCode);
  if (!matched) return item;
  return {
    ...item,
    categoryLabel: matched.label,
    sceneCode: matched.value,
    sceneLabel: matched.label
  };
}

function safeText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function imageFileId(image) {
  return safeText(image && (image.fileId || image.fileID), 500);
}

function collectCaseOwnedFileIds(item) {
  const images = Array.isArray(item && item.images) ? item.images : [];
  const fileIds = images.filter(image => {
    const fileId = imageFileId(image);
    if (!fileId || image.sourceCode === 'linked_project') return false;
    return image.sourceCode === 'case_upload' || fileId.includes('/project-cases/');
  }).map(imageFileId);
  const coverFileId = safeText(item && (item.coverFileId || item.imageFileId), 500);
  if (coverFileId.includes('/project-cases/')) fileIds.push(coverFileId);
  return Array.from(new Set(fileIds));
}

function collectReferencedCaseFileIds(items) {
  const fileIds = [];
  (items || []).forEach(item => {
    (Array.isArray(item.images) ? item.images : []).forEach(image => fileIds.push(imageFileId(image)));
    fileIds.push(safeText(item.coverFileId || item.imageFileId, 500));
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
        if (failed.length) throw new Error(`有 ${failed.length} 个案例文件清理失败`);
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

function dateOnly(value) {
  const matched = safeText(value, 40).match(/^\d{4}-\d{2}-\d{2}/);
  return matched ? matched[0] : '';
}

function buildCaseCode(caseDate) {
  const datePart = (caseDate || new Date().toISOString().slice(0, 10)).replace(/-/g, '');
  const randomPart = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `YH-${datePart}-${randomPart}`;
}

async function getCaseDetail(data, current) {
  await ensureCaseCollection();
  const id = safeText(data.id, 80);
  if (!id) return { code: 400, message: '缺少案例 ID' };
  let item;
  try {
    const result = await db.collection(CASE_COLLECTION).where({ _id: id, dataScope: current.dataScope }).limit(1).get();
    item = (result.data || [])[0];
  } catch (error) {
    item = null;
  }
  if (!item || item.status !== CASE_STATUS.PUBLISHED) {
    return { code: 404, message: '案例不存在或尚未发布' };
  }
  const projectScenes = await getCategoryOptions();
  return {
    code: 0,
    message: '查询成功',
    data: {
      ...applySceneTranslation(formatCase(item), projectScenes),
      canManage: Boolean(current && MANAGE_ROLES.has(current.user.role))
    }
  };
}

async function getSceneLabel(sceneCode) {
  if (!sceneCode) return '';
  try {
    const result = await db.collection('system_configs').where({
      group: 'PROJECT_SCENE',
      value: sceneCode,
      isActive: true
    }).limit(1).get();
    return result.data?.[0]?.label || sceneCode;
  } catch (error) {
    return sceneCode;
  }
}

async function syncProject(data, current) {
  if (!MANAGE_ROLES.has(current.user.role)) {
    return { code: 403, message: '当前账号无新增案例权限' };
  }
  const projectId = safeText(data.projectId, 80);
  if (!projectId) return { code: 400, message: '缺少项目 ID' };
  let project;
  try {
    project = (await db.collection('projects').doc(projectId).get()).data;
  } catch (error) {
    project = null;
  }
  if (!project) return { code: 404, message: '项目不存在' };
  let previewList = [];
  try {
    const previewResult = await db.collection('project_previews')
      .where({ projectId })
      .orderBy('createdAt', 'desc')
      .limit(9)
      .get();
    previewList = previewResult.data || [];
  } catch (error) {
    // 项目没有预览图时仍允许同步其他基础信息。
  }
  const sceneCode = safeText(project.scene, 80);
  const images = previewList.map(item => ({
    fileId: item.fileId || '',
    url: item.url || '',
    name: item.name || '',
    sourceCode: 'linked_project'
  })).filter(item => item.fileId || item.url);
  return {
    code: 0,
    message: '同步成功',
    data: {
      projectId,
      projectCode: project.projectCode || project.code || project.projectNo || '',
      title: project.name || '',
      caseDate: dateOnly(project.startDate || project.completionTime || project.period?.[1]),
      sceneCode,
      sceneLabel: await getSceneLabel(sceneCode),
      amount: Number(project.amount) || 0,
      summary: project.desc || project.description || '',
      content: project.desc || project.description || '',
      images
    }
  };
}

async function createCase(data, current) {
  if (!MANAGE_ROLES.has(current.user.role)) {
    return { code: 403, message: '当前账号无新增案例权限' };
  }
  await ensureCaseCollection();
  const title = safeText(data.title, 100);
  const caseDate = dateOnly(data.caseDate);
  const categoryCode = normalizeCategory(data.categoryCode);
  const amountEnabled = Boolean(data.amountEnabled);
  const descriptionEnabled = Boolean(data.descriptionEnabled);
  const amount = Number(data.amount) || 0;
  const summary = safeText(data.summary, 300);
  const content = safeText(data.content, 3000);
  const projectId = safeText(data.projectId, 80);
  const clientRequestId = safeText(data.clientRequestId, 100);
  const images = (Array.isArray(data.images) ? data.images : []).slice(0, 9).map(image => ({
    fileId: safeText(image.fileId || image.fileID, 500),
    url: safeText(image.url || image.fileUrl, 1000),
    name: safeText(image.name, 120),
    sourceCode: image.sourceCode === 'linked_project' ? 'linked_project' : 'case_upload'
  })).filter(image => image.fileId || image.url);
  const categoryOptions = await getCategoryOptions();
  const category = categoryOptions.find(item => item.value === categoryCode);

  if (!title) return { code: 400, message: '请输入案例名称' };
  if (!caseDate) return { code: 400, message: '请选择交付日期' };
  if (!category) return { code: 400, message: '请选择有效的项目场景' };
  if (amountEnabled && amount <= 0) return { code: 400, message: '请输入有效的项目报价' };
  if (descriptionEnabled && !content) return { code: 400, message: '请输入案例自述' };
  if (!images.length) return { code: 400, message: '请至少上传一张项目图片' };

  if (clientRequestId) {
    const duplicate = await db.collection(CASE_COLLECTION).where({ clientRequestId }).limit(1).get();
    if ((duplicate.data || []).length) {
      return { code: 0, message: '案例已创建', data: { id: duplicate.data[0]._id, duplicated: true } };
    }
  }

  const now = Date.now();
  const caseCode = buildCaseCode(caseDate);
  const record = {
    dataScope: DATA_SCOPE.REAL,
    caseCode,
    projectId,
    projectCode: safeText(data.projectCode, 80),
    title,
    caseDate,
    categoryCode,
    categoryLabel: category.label,
    sceneCode: categoryCode,
    sceneLabel: category.label,
    amountEnabled,
    amount: amountEnabled ? amount : 0,
    descriptionEnabled,
    summary: summary || content.slice(0, 180),
    content: descriptionEnabled ? content : '',
    images,
    coverFileId: images[0].fileId,
    coverUrl: images[0].url,
    status: CASE_STATUS.PUBLISHED,
    statusLabel: '已发布',
    clientRequestId,
    createdBy: current.userId,
    createdByName: current.user.nickname || current.user.username || '',
    publishTimestamp: now,
    createdTimestamp: now,
    createdAt: db.serverDate(),
    updateTime: db.serverDate()
  };
  const result = await db.collection(CASE_COLLECTION).add({ data: record });
  return { code: 0, message: '案例创建成功', data: { id: result._id, caseCode } };
}

async function deleteCase(data, current) {
  if (!MANAGE_ROLES.has(current.user.role)) {
    return { code: 403, message: '当前账号无删除案例权限' };
  }
  await ensureCaseCollection();
  const id = safeText(data.id, 80);
  if (!id) return { code: 400, message: '缺少案例 ID' };
  let item;
  try {
    item = (await db.collection(CASE_COLLECTION).doc(id).get()).data;
  } catch (error) {
    item = null;
  }
  if (!item) {
    return { code: 404, message: '案例不存在' };
  }
  const allCases = await db.collection(CASE_COLLECTION).limit(1000).get();
  const referencedByOtherCases = collectReferencedCaseFileIds((allCases.data || [])
    .filter(caseItem => caseItem._id !== id && caseItem.status !== CASE_STATUS.DELETED));
  const fileIds = collectCaseOwnedFileIds(item).filter(fileId => !referencedByOtherCases.has(fileId));

  if (item.status !== CASE_STATUS.DELETED) {
    await db.collection(CASE_COLLECTION).doc(id).update({
      data: {
        status: CASE_STATUS.DELETED,
        statusLabel: '已删除',
        deletedBy: current.userId,
        deletedByName: current.user.nickname || current.user.username || '',
        deletedTimestamp: Date.now(),
        deletedAt: db.serverDate(),
        storageCleanupStatus: fileIds.length ? 'pending' : 'not_needed',
        updateTime: db.serverDate()
      }
    });
  }

  try {
    const deletedFiles = await deleteCloudFiles(fileIds);
    await db.collection(CASE_COLLECTION).doc(id).update({
      data: {
        storageCleanupStatus: fileIds.length ? 'completed' : 'not_needed',
        storageCleanupFileCount: deletedFiles,
        storageCleanupTimestamp: Date.now(),
        storageCleanupAt: db.serverDate(),
        updateTime: db.serverDate()
      }
    });
    return { code: 0, message: '案例删除成功', data: { id, deletedFiles } };
  } catch (error) {
    await db.collection(CASE_COLLECTION).doc(id).update({
      data: {
        storageCleanupStatus: 'failed',
        storageCleanupError: safeText(error.message, 300),
        storageCleanupTimestamp: Date.now(),
        updateTime: db.serverDate()
      }
    }).catch(() => {});
    throw error;
  }
}

async function setCaseCover(data, current) {
  if (!MANAGE_ROLES.has(current.user.role)) {
    return { code: 403, message: '当前账号无设置案例封面权限' };
  }
  await ensureCaseCollection();
  const id = safeText(data.id, 80);
  const fileId = safeText(data.fileId, 500);
  const url = safeText(data.url, 1000);
  if (!id) return { code: 400, message: '缺少案例 ID' };
  if (!fileId && !url) return { code: 400, message: '请选择有效的案例图片' };
  let item;
  try {
    item = (await db.collection(CASE_COLLECTION).doc(id).get()).data;
  } catch (error) {
    item = null;
  }
  if (!item || item.status !== CASE_STATUS.PUBLISHED) {
    return { code: 404, message: '案例不存在或尚未发布' };
  }
  const images = Array.isArray(item.images) ? item.images : [];
  const matchedIndex = images.findIndex(image => (
    (fileId && (image.fileId === fileId || image.fileID === fileId))
    || (url && (image.url === url || image.fileUrl === url))
  ));
  if (matchedIndex < 0) return { code: 400, message: '所选图片不属于当前案例' };
  const matched = images[matchedIndex];
  const reorderedImages = [matched].concat(images.filter((image, index) => index !== matchedIndex));
  const coverFileId = safeText(matched.fileId || matched.fileID, 500);
  const coverUrl = safeText(matched.url || matched.fileUrl, 1000);
  await db.collection(CASE_COLLECTION).doc(id).update({
    data: {
      coverFileId,
      coverUrl,
      images: reorderedImages,
      coverUpdatedBy: current.userId,
      coverUpdatedTimestamp: Date.now(),
      updateTime: db.serverDate()
    }
  });
  return { code: 0, message: '案例封面设置成功', data: { id, coverFileId, coverUrl } };
}

async function listCases(data, current) {
  await ensureCaseCollection();
  const categoryCode = normalizeCategory(data.categoryCode);
  const categories = await getCategoryOptions();
  if (data.categoryCode && !categories.some(item => item.value === categoryCode)) {
    return { code: 400, message: '项目场景筛选值无效' };
  }
  const page = Math.max(1, Number(data.page) || 1);
  const pageSize = Math.min(30, Math.max(1, Number(data.pageSize) || 10));
  const result = await db.collection(CASE_COLLECTION)
    .where({ dataScope: current.dataScope, status: CASE_STATUS.PUBLISHED })
    .limit(1000)
    .get();
  const published = (result.data || [])
    .filter(item => item.status === CASE_STATUS.PUBLISHED)
    .map(item => applySceneTranslation(formatCase(item), categories))
    .filter(item => !categoryCode || item.categoryCode === categoryCode)
    .sort((left, right) => caseTimestamp(right) - caseTimestamp(left));
  const start = (page - 1) * pageSize;
  const list = published.slice(start, start + pageSize);
  return {
    code: 0,
    message: '查询成功',
    data: {
      list,
      total: published.length,
      page,
      pageSize,
      hasMore: page * pageSize < published.length,
      canManage: MANAGE_ROLES.has(current.user.role),
      categories
    }
  };
}

exports.main = async (event) => {
  let body;
  try {
    body = parseBody(event);
  } catch (error) {
    return { code: 400, message: '请求格式错误' };
  }
  const action = body.action;
  const data = body.data || {};
  try {
    const current = await authenticate(event, data);
    if (current.error) return current.error;
    switch (action) {
      case 'detail':
        return await getCaseDetail(data, current);
      case 'list':
        return await listCases(data, current);
      case 'syncProject':
        return await syncProject(data, current);
      case 'create':
        return await createCase(data, current);
      case 'delete':
        return await deleteCase(data, current);
      case 'setCover':
        return await setCaseCover(data, current);
      default:
        return { code: 400, message: '未知操作' };
    }
  } catch (error) {
    console.error('项目案例服务操作失败:', error);
    return { code: 500, message: '项目案例服务暂时不可用', error: error.message };
  }
};
