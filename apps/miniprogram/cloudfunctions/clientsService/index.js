'use strict';

const cloud = require('wx-server-sdk');
const crypto = require('crypto');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const CLIENT_COLLECTION = 'clients';
const PROJECT_COLLECTION = 'projects';
const CLIENT_EVENT_COLLECTION = 'operation_logs';
const SESSION_COLLECTION = 'auth_sessions';
const ADMIN_SUPER_ROLE = 'ADMIN_SUPER';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const READ_ROLES = new Set(['ADMIN_SUPER', 'ADMIN_COM', 'ADMIN', 'PROJECT_MANAGER', 'FINANCE_MANAGER', 'VISITOR', 'user']);
const CREATE_ROLES = new Set(['ADMIN_SUPER', 'ADMIN_COM', 'ADMIN']);
const PAGE_FETCH_LIMIT = 1000;

function forbidden() {
  return { code: 403, message: '当前账号无此操作权限' };
}

function safeText(value, maxLength = 120) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function normalizeClientName(value) {
  return safeText(value, 120).replace(/\s+/g, ' ').toLowerCase();
}

function isSafeInput(value) {
  return !/[<>{}[\]\\^%`|]/.test(String(value || ''));
}

function isActiveClient(client) {
  return client && client.status !== 'deleted' && client.status !== 'deleting';
}

function getAuthToken(event, data) {
  const headers = event.headers || {};
  const authorization = headers.authorization || headers.Authorization || '';
  return String(data.authToken || event.authToken || authorization.replace(/^Bearer\s+/i, '') || '').trim();
}

async function authenticate(event, data) {
  const token = getAuthToken(event, data || {});
  if (!token) return { error: { code: 401, message: '请先登录' } };
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const sessionResult = await db.collection(SESSION_COLLECTION).where({ tokenHash }).limit(1).get();
  const session = (sessionResult.data || [])[0];
  if (!session || Number(session.expiresAt || 0) <= Date.now()) {
    if (session && session._id) db.collection(SESSION_COLLECTION).doc(session._id).remove().catch(() => {});
    return { error: { code: 401, message: '登录状态已失效，请重新登录' } };
  }
  const now = Date.now();
  if (!session.lastActiveAt || now - Number(session.lastActiveAt) >= SESSION_TOUCH_INTERVAL_MS) {
    db.collection(SESSION_COLLECTION).doc(session._id).update({
      data: { lastActiveAt: now, expiresAt: now + SESSION_TTL_MS, updateTime: db.serverDate() }
    }).catch(() => {});
  }
  const userResult = await db.collection('users').doc(session.userId).get();
  if (!userResult.data) return { error: { code: 401, message: '用户不存在或已停用' } };
  if (userResult.data.status && userResult.data.status !== 'active') {
    return { error: { code: 403, message: '账号已停用' } };
  }
  return { user: { ...userResult.data, id: session.userId } };
}

function parseRequest(event = {}) {
  let body = event;
  if (event.body) body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  if (body.action) return { action: body.action, data: body.data || {} };
  return { action: 'listForSelection', data: body || {} };
}

async function fetchAll(query) {
  const records = [];
  let offset = 0;
  while (true) {
    const result = await query.skip(offset).limit(PAGE_FETCH_LIMIT).get();
    const page = result.data || [];
    records.push(...page);
    if (page.length < PAGE_FETCH_LIMIT) break;
    offset += PAGE_FETCH_LIMIT;
  }
  return records;
}

async function getClient(id) {
  if (!id) return null;
  try {
    return (await db.collection(CLIENT_COLLECTION).doc(id).get()).data || null;
  } catch (error) {
    return null;
  }
}

async function getProjectReferences(clientId) {
  if (!clientId) return [];
  return fetchAll(db.collection(PROJECT_COLLECTION).where({ clientId }));
}

function projectReferenceView(project) {
  return {
    id: project._id,
    name: safeText(project.name, 120) || '未命名项目',
    status: safeText(project.status, 40),
    projectCode: safeText(project.projectCode || project.code || project.projectNo, 80),
    updateTime: project.updateTime || project.createTime || null
  };
}

function clientView(client) {
  return {
    id: client._id,
    name: safeText(client.name, 120),
    role: safeText(client.roleCode || client.role, 80),
    roleCode: safeText(client.roleCode || client.role, 80),
    source: safeText(client.source, 80),
    paymentCycle: safeText(client.paymentCycle, 80),
    description: safeText(client.description, 500),
    version: Math.max(1, Number(client.version) || 1),
    updateTime: client.updateTime || client.createdAt || null
  };
}

function impactToken(client, projects) {
  const payload = {
    clientId: client._id,
    version: Math.max(1, Number(client.version) || 1),
    projects: (projects || [])
      .map(item => [item._id, JSON.stringify(item.updateTime || item.createTime || '')])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0])))
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

async function findActiveDuplicate(normalizedName, excludedId = '') {
  const allClients = await fetchAll(db.collection(CLIENT_COLLECTION));
  return allClients.find(client => (
    client._id !== excludedId
    && isActiveClient(client)
    && normalizeClientName(client.normalizedName || client.name) === normalizedName
  )) || null;
}

function validateClientInput(data = {}) {
  const name = safeText(data.name, 120);
  const roleCode = safeText(data.roleCode || data.role, 80);
  const source = safeText(data.source, 80);
  const paymentCycle = safeText(data.paymentCycle, 80);
  const description = safeText(data.description, 500);
  if (!name) return { error: { code: 400, message: '请输入客户名称' } };
  if (!roleCode) return { error: { code: 400, message: '请选择客户角色' } };
  if (!source) return { error: { code: 400, message: '请选择来源渠道' } };
  if (![name, roleCode, source, paymentCycle, description].every(isSafeInput)) {
    return { error: { code: 400, message: '输入包含非法字符，请检查后重试' } };
  }
  return { name, normalizedName: normalizeClientName(name), roleCode, source, paymentCycle, description };
}

async function createClient(data, currentUser) {
  const validated = validateClientInput(data);
  if (validated.error) return validated.error;
  const duplicated = await findActiveDuplicate(validated.normalizedName);
  if (duplicated) {
    return { code: 0, message: '客户已存在', data: { ...clientView(duplicated), existed: true } };
  }
  const result = await db.collection(CLIENT_COLLECTION).add({
    data: {
      name: validated.name,
      normalizedName: validated.normalizedName,
      role: validated.roleCode,
      roleCode: validated.roleCode,
      source: validated.source,
      paymentCycle: validated.paymentCycle,
      description: validated.description,
      status: 'active',
      version: 1,
      createdBy: currentUser.id,
      createdByName: currentUser.nickname || currentUser.username || '',
      updatedBy: currentUser.id,
      updatedByName: currentUser.nickname || currentUser.username || '',
      createdAt: db.serverDate(),
      updateTime: db.serverDate()
    }
  });
  return { code: 0, message: '创建成功', data: { id: result._id, ...validated, existed: false, version: 1 } };
}

async function listForSelection(data = {}) {
  const keyword = safeText(data.keyword, 50).toLowerCase();
  const clients = await fetchAll(db.collection(CLIENT_COLLECTION));
  const list = clients
    .filter(isActiveClient)
    .filter(client => !keyword || safeText(client.name, 120).toLowerCase().includes(keyword))
    .sort((left, right) => {
      const timeLeft = new Date(left.updateTime?.$date || left.updateTime || left.createdAt?.$date || left.createdAt || 0).getTime() || 0;
      const timeRight = new Date(right.updateTime?.$date || right.updateTime || right.createdAt?.$date || right.createdAt || 0).getTime() || 0;
      return timeRight - timeLeft;
    })
    .slice(0, 50)
    .map(client => ({ ...client, _id: client._id, roleCode: client.roleCode || client.role }));
  return { code: 0, message: '查询成功', data: list };
}

async function manageList(data = {}) {
  const page = Math.max(1, Number(data.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(data.pageSize) || 20));
  const keyword = safeText(data.keyword, 50).toLowerCase();
  const roleCode = safeText(data.roleCode, 80);
  const source = safeText(data.source, 80);
  const allClients = await fetchAll(db.collection(CLIENT_COLLECTION));
  const filtered = allClients
    .filter(isActiveClient)
    .filter(client => !keyword || safeText(client.name, 120).toLowerCase().includes(keyword))
    .filter(client => !roleCode || safeText(client.roleCode || client.role, 80) === roleCode)
    .filter(client => !source || safeText(client.source, 80) === source)
    .sort((left, right) => {
      const timeLeft = new Date(left.updateTime?.$date || left.updateTime || left.createdAt?.$date || left.createdAt || 0).getTime() || 0;
      const timeRight = new Date(right.updateTime?.$date || right.updateTime || right.createdAt?.$date || right.createdAt || 0).getTime() || 0;
      return timeRight - timeLeft;
    });
  const pageClients = filtered.slice((page - 1) * pageSize, page * pageSize);
  const withReferences = await Promise.all(pageClients.map(async client => {
    const projects = await getProjectReferences(client._id);
    return {
      ...clientView(client),
      referenceCount: projects.length,
      referencePreview: projects.slice(0, 3).map(projectReferenceView)
    };
  }));
  return {
    code: 0,
    message: '查询成功',
    data: { list: withReferences, total: filtered.length, page, pageSize, hasMore: page * pageSize < filtered.length }
  };
}

async function prepareUpdate(data = {}) {
  const id = safeText(data.id, 80);
  const client = await getClient(id);
  if (!isActiveClient(client)) return { code: 404, message: '客户不存在或已删除' };
  const projects = await getProjectReferences(id);
  return {
    code: 0,
    message: '查询成功',
    data: {
      client: clientView(client),
      projects: projects.map(projectReferenceView),
      referenceCount: projects.length,
      impactToken: impactToken(client, projects)
    }
  };
}

async function writeClientEvent(action, clientId, beforeData, afterData, projects, currentUser) {
  try {
    await db.collection(CLIENT_EVENT_COLLECTION).add({
      data: {
        uid: currentUser.id,
        un: safeText(currentUser.nickname || currentUser.username, 20),
        username: currentUser.username || '',
        m: '客户管理',
        a: action,
        c: action === 'delete'
          ? `删除客户 ${beforeData?.name || clientId}`
          : `修改客户 ${beforeData?.name || clientId}，同步 ${projects.length} 个项目`,
        s: '成功',
        action,
        clientId,
        clientName: afterData?.name || beforeData?.name || '',
        beforeData: beforeData || null,
        afterData: afterData || null,
        affectedProjects: (projects || []).map(projectReferenceView),
        affectedProjectCount: (projects || []).length,
        operatorId: currentUser.id,
        operatorName: currentUser.nickname || currentUser.username || '',
        createdTimestamp: Date.now(),
        createdAt: db.serverDate()
      }
    });
  } catch (error) {
    console.error('记录客户操作日志失败:', error);
  }
}

async function updateClient(data = {}, currentUser) {
  const id = safeText(data.id, 80);
  const validated = validateClientInput(data);
  if (!id) return { code: 400, message: '缺少客户 ID' };
  if (validated.error) return validated.error;
  const client = await getClient(id);
  if (!isActiveClient(client)) return { code: 404, message: '客户不存在或已删除' };
  const projects = await getProjectReferences(id);
  const currentImpactToken = impactToken(client, projects);
  if (!data.confirmed || safeText(data.impactToken, 100) !== currentImpactToken) {
    return {
      code: 409,
      message: data.confirmed ? '客户引用情况已变化，请重新确认' : '请先确认受影响的项目',
      data: {
        client: clientView(client),
        projects: projects.map(projectReferenceView),
        referenceCount: projects.length,
        impactToken: currentImpactToken
      }
    };
  }
  const duplicated = await findActiveDuplicate(validated.normalizedName, id);
  if (duplicated) return { code: 409, message: `客户“${duplicated.name}”已存在` };

  const beforeData = clientView(client);
  const nextVersion = beforeData.version + 1;
  const clientUpdate = {
    name: validated.name,
    normalizedName: validated.normalizedName,
    role: validated.roleCode,
    roleCode: validated.roleCode,
    source: validated.source,
    paymentCycle: validated.paymentCycle,
    description: validated.description,
    version: nextVersion,
    updatedBy: currentUser.id,
    updatedByName: currentUser.nickname || currentUser.username || '',
    updateTime: db.serverDate()
  };

  try {
    await db.runTransaction(async transaction => {
      const clientRef = transaction.collection(CLIENT_COLLECTION).doc(id);
      const liveClient = (await clientRef.get()).data;
      if (!isActiveClient(liveClient)) throw new Error('CLIENT_NOT_FOUND');
      if (Math.max(1, Number(liveClient.version) || 1) !== beforeData.version) throw new Error('CLIENT_CHANGED');
      const liveProjects = [];
      for (const project of projects) {
        const projectRef = transaction.collection(PROJECT_COLLECTION).doc(project._id);
        const liveProject = (await projectRef.get()).data;
        if (!liveProject || liveProject.clientId !== id) throw new Error('REFERENCES_CHANGED');
        liveProjects.push({ projectRef, liveProject });
      }
      for (const { projectRef } of liveProjects) {
        await projectRef.update({
          data: {
            client: validated.name,
            role: validated.roleCode,
            clientRole: validated.roleCode,
            clientSource: validated.source,
            source: validated.source,
            clientSnapshotVersion: nextVersion,
            updateTime: db.serverDate()
          }
        });
      }
      await clientRef.update({ data: clientUpdate });
    });
  } catch (error) {
    if (['CLIENT_CHANGED', 'REFERENCES_CHANGED'].includes(error.message)) {
      return { code: 409, message: '客户或项目引用情况已变化，请重新确认' };
    }
    if (error.message === 'CLIENT_NOT_FOUND') return { code: 404, message: '客户不存在或已删除' };
    throw error;
  }

  const afterData = { ...beforeData, ...validated, role: validated.roleCode, version: nextVersion };
  await writeClientEvent('update', id, beforeData, afterData, projects, currentUser);
  return { code: 0, message: '客户信息及引用项目已同步更新', data: { client: afterData, updatedProjects: projects.length } };
}

async function deleteClient(data = {}, currentUser) {
  const id = safeText(data.id, 80);
  if (!id) return { code: 400, message: '缺少客户 ID' };
  const client = await getClient(id);
  if (!isActiveClient(client)) return { code: 404, message: '客户不存在或已删除' };

  await db.collection(CLIENT_COLLECTION).doc(id).update({ data: { status: 'deleting', updateTime: db.serverDate() } });
  try {
    const projects = await getProjectReferences(id);
    if (projects.length) {
      await db.collection(CLIENT_COLLECTION).doc(id).update({ data: { status: 'active', updateTime: db.serverDate() } });
      return {
        code: 409,
        message: `该客户已被 ${projects.length} 个项目引用，无法删除`,
        data: { projects: projects.map(projectReferenceView), referenceCount: projects.length }
      };
    }
    await db.collection(CLIENT_COLLECTION).doc(id).update({
      data: {
        status: 'deleted',
        deletedBy: currentUser.id,
        deletedByName: currentUser.nickname || currentUser.username || '',
        deletedTimestamp: Date.now(),
        deletedAt: db.serverDate(),
        updateTime: db.serverDate()
      }
    });
    await writeClientEvent('delete', id, clientView(client), null, [], currentUser);
    return { code: 0, message: '客户已删除', data: { id } };
  } catch (error) {
    await db.collection(CLIENT_COLLECTION).doc(id).update({ data: { status: 'active', updateTime: db.serverDate() } }).catch(() => {});
    throw error;
  }
}

exports.main = async (event) => {
  let request;
  try {
    request = parseRequest(event || {});
  } catch (error) {
    return { code: 400, message: '请求格式错误' };
  }
  const { action, data } = request;
  try {
    const auth = await authenticate(event || {}, data || {});
    if (auth.error) return auth.error;
    if (!READ_ROLES.has(auth.user.role || 'user')) return forbidden();
    switch (action) {
      case 'listForSelection':
      case 'query':
        return await listForSelection(data);
      case 'createClient':
        if (!CREATE_ROLES.has(auth.user.role)) return forbidden();
        return await createClient(data, auth.user);
      case 'manageList':
        if (auth.user.role !== ADMIN_SUPER_ROLE) return forbidden();
        return await manageList(data);
      case 'prepareUpdate':
        if (auth.user.role !== ADMIN_SUPER_ROLE) return forbidden();
        return await prepareUpdate(data);
      case 'updateClient':
        if (auth.user.role !== ADMIN_SUPER_ROLE) return forbidden();
        return await updateClient(data, auth.user);
      case 'deleteClient':
        if (auth.user.role !== ADMIN_SUPER_ROLE) return forbidden();
        return await deleteClient(data, auth.user);
      default:
        return { code: 400, message: '未知操作' };
    }
  } catch (error) {
    console.error('客户管理操作失败:', action, error);
    return { code: 500, message: error.message || '客户管理操作失败', error: error.message };
  }
};
