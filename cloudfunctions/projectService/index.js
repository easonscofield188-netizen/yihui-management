/**
 * 腾讯云函数: projectService
 * 功能：项目管理（创建、查询等）
 */
'use strict';

const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();

exports.main = async (event, context) => {
  let action, data;
  
  if (event.action) {
    action = event.action;
    data = event.data;
  } else if (event.body) {
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    action = body.action;
    data = body.data;
  }

  try {
    switch (action) {
      case 'create':
        return await createProject(data);
      case 'list':
        return await listProjects(data);
      case 'update':
        return await updateProject(data);
      case 'delete':
        return await deleteProject(data);
      default:
        return { code: 400, message: '未知操作' };
    }
  } catch (error) {
    console.error('项目管理操作失败', error);
    return { code: 500, message: '操作失败', error: error.message };
  }
};

// 安全校验：拦截特殊字符
const isSafeInput = (str) => {
  if (!str) return true;
  const unsafePattern = /[<>{}[\]\\^%`|]/;
  return !unsafePattern.test(str);
};

async function deleteProject(params) {
  const { id } = params;
  if (!id) {
    return { code: 400, message: '缺少项目 ID' };
  }

  try {
    await db.collection('projects').doc(id).remove();
    return { code: 0, message: '删除成功' };
  } catch (err) {
    console.error('删除项目失败:', err);
    return { code: 500, message: '删除失败', error: err.message };
  }
}

async function updateProject(params) {
  const { id, name, period, client, role, staffCount, amount, desc, costs, status, isHistorical, constructionPeriod, collectionPeriod } = params;

  if (!id) {
    return { code: 400, message: '缺少项目 ID' };
  }

  // 安全校验
  if (!isSafeInput(name) || !isSafeInput(client) || !isSafeInput(desc)) {
    return { code: 400, message: '输入包含非法字符' };
  }

  try {
    const projectDoc = await db.collection('projects').doc(id).get();
    if (!projectDoc.data) {
      return { code: 404, message: '项目不存在' };
    }
    const oldProject = projectDoc.data;

    const updateData = {
      updateTime: db.serverDate()
    };

    if (name) updateData.name = name;
    if (period) updateData.period = period;
    if (client) updateData.client = client;
    if (role) updateData.role = role;
    if (staffCount !== undefined) updateData.staffCount = staffCount;
    if (amount !== undefined) updateData.amount = amount;
    if (desc !== undefined) updateData.desc = desc;
    if (costs) updateData.costs = costs;
    if (status) updateData.status = status;
    
    // 历史数据相关字段
    if (isHistorical !== undefined) updateData.isHistorical = isHistorical;
    if (constructionPeriod) updateData.constructionPeriod = constructionPeriod;
    if (collectionPeriod) updateData.collectionPeriod = collectionPeriod;

    // 状态变更时间节点记录
    if (status && status !== oldProject.status) {
      const now = new Date().toISOString();
      if (status === 'negotiating') updateData.negotiatingTime = now;
      if (status === 'constructing') updateData.constructingTime = now;
      if (status === 'completed') updateData.completedTime = now;
      if (status === 'closed') updateData.settledTime = now;
    }

    await db.collection('projects').doc(id).update({
      data: updateData
    });

    return { code: 0, message: '更新成功' };
  } catch (err) {
    console.error('更新项目失败:', err);
    return { code: 500, message: '更新失败', error: err.message };
  }
}

async function createProject(params) {
  const { name, period, client, role, staffCount, amount, desc, costs, status, isHistorical, constructionPeriod, collectionPeriod } = params;

  // 1. 基础完整性校验
  if (!name || !client || !role || staffCount === undefined || !amount || !desc || !costs) {
    return { code: 400, message: '缺少必需的项目信息，请确保所有字段均已填写' };
  }

  // 2. 安全校验
  if (!isSafeInput(name) || !isSafeInput(client) || !isSafeInput(desc)) {
    return { code: 400, message: '输入包含非法字符，请检查后重试' };
  }

  // 3. 数据类型校验
  if (isNaN(parseFloat(amount))) {
    return { code: 400, message: '订单金额格式不正确' };
  }

  try {
    const now = new Date().toISOString();
    const data = {
      ...params,
      createTime: db.serverDate(),
      updateTime: db.serverDate()
    };

    // 初始化时间节点
    const initialStatus = status || 'negotiating';
    if (initialStatus === 'negotiating') data.negotiatingTime = now;
    if (initialStatus === 'constructing') data.constructingTime = now;
    if (initialStatus === 'completed') data.completedTime = now;
    if (initialStatus === 'closed') data.settledTime = now;

    const res = await db.collection('projects').add({
      data
    });
    return { code: 0, message: '创建成功', data: { id: res._id } };
  } catch (err) {
    console.error('创建项目失败:', err);
    return { code: 500, message: '创建失败', error: err.message };
  }
}

async function listProjects(params) {
  try {
    const res = await db.collection('projects')
      .orderBy('createTime', 'desc')
      .get();
    return { code: 0, message: '查询成功', data: res.data };
  } catch (err) {
    console.error('查询项目列表失败:', err);
    return { code: 500, message: '查询失败', error: err.message };
  }
}
