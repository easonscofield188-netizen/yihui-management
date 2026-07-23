/**
 * 腾讯云函数: projectService
 * 功能：项目管理（创建、查询等）
 */
'use strict';

const cloud = require("wx-server-sdk");
const nodemailer = require("nodemailer");
const crypto = require('crypto');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const ADMIN_SUPER_ROLE = 'ADMIN_SUPER';
const ADMIN_COM_ROLE = 'ADMIN_COM';
const SESSION_COLLECTION = 'auth_sessions';
const READ_ROLES = new Set(['ADMIN_SUPER', 'ADMIN_COM', 'ADMIN', 'PROJECT_MANAGER', 'FINANCE_MANAGER', 'VISITOR', 'user']);
const WRITE_ROLES = new Set(['ADMIN_SUPER', 'ADMIN_COM', 'ADMIN', 'PROJECT_MANAGER', 'FINANCE_MANAGER']);
const ADMIN_ROLES = new Set(['ADMIN_SUPER', 'ADMIN_COM', 'ADMIN']);

function getServerDateOnly() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
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
    if (!READ_ROLES.has(auth.user.role || 'user')) {
      return { code: 403, message: '当前账号无项目访问权限' };
    }
    switch (action) {
      case 'getServerDate':
        return { code: 0, message: '查询成功', data: { date: getServerDateOnly() } };
      case 'create':
      case 'createProject':
        if (!ADMIN_ROLES.has(auth.user.role)) return forbidden();
        return await createProject({ ...data, currentUser: auth.user });
      case 'list':
        return await listProjects(data);
      case 'overview':
      case 'getOverview':
        return await getOverview(data);
      case 'get':
        return await getProject(data);
      case 'update':
        if (!WRITE_ROLES.has(auth.user.role)) return forbidden();
        return await updateProject(data);
      case 'quickRecord':
        if (!WRITE_ROLES.has(auth.user.role)) return forbidden();
        return await quickRecord(data, auth.user);
      case 'delete':
        if (!ADMIN_ROLES.has(auth.user.role)) return forbidden();
        return await deleteProject(data);
      case 'syncFinancials':
        if (!WRITE_ROLES.has(auth.user.role)) return forbidden();
        return await syncFinancials(data);
      case 'syncHistoryFinancials':
        if (!ADMIN_ROLES.has(auth.user.role)) return forbidden();
        return await syncHistoryFinancials(data);
      default:
        return { code: 400, message: '未知操作' };
    }
  } catch (error) {
    console.error('项目管理操作失败', error);
    return { code: 500, message: '操作失败', error: error.message };
  }
};

function forbidden() {
  return { code: 403, message: '当前账号无此操作权限' };
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
  const userResult = await db.collection('users').doc(session.userId).get();
  if (!userResult.data) return { error: { code: 401, message: '用户不存在或已停用' } };
  if (userResult.data.status && userResult.data.status !== 'active') {
    return { error: { code: 403, message: '账号已停用' } };
  }
  return { user: { ...userResult.data, id: session.userId } };
}

// 金额转分（整数），避免 JS 浮点误差
function moneyToCents(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return 0;
  return Math.round(numberValue * 100);
}

function centsToMoney(cents) {
  return Math.round(Number(cents) || 0) / 100;
}

// 计算资金相关字段（统一在后端用分位整数计算）
function calculateFinancials(amount, receivedAmount, costs, subProjects) {
  const totalCents = moneyToCents(amount);
  const receivedCents = moneyToCents(receivedAmount);
  const unreceivedCents = Math.max(0, totalCents - receivedCents);

  let payableCents = 0;
  let paidCents = 0;

  // 主项目成本
  if (costs && Array.isArray(costs)) {
    costs.forEach((cost) => {
      const costCents = moneyToCents(cost.amount);
      payableCents += costCents;
      if (cost.isSettled === true || cost.isSettled === '是') {
        paidCents += costCents;
      }
    });
  }

  // 子项目成本
  if (subProjects && Array.isArray(subProjects)) {
    subProjects.forEach((sp) => {
      if (sp.costs && Array.isArray(sp.costs)) {
        sp.costs.forEach((cost) => {
          const costCents = moneyToCents(cost.amount);
          payableCents += costCents;
          if (cost.isSettled === true || cost.isSettled === '是') {
            paidCents += costCents;
          }
        });
      }
    });
  }

  const profitCents = totalCents - payableCents;

  return {
    unreceivedAmount: centsToMoney(unreceivedCents),
    payableAmount: centsToMoney(payableCents),
    paidAmount: centsToMoney(paidCents),
    profitAmount: centsToMoney(profitCents),
  };
}

function enrichProjectFinancials(project) {
  if (!project) return project;
  const financials = calculateFinancials(
    project.amount,
    project.receivedAmount,
    project.costs,
    project.subProjects
  );
  return {
    ...project,
    ...financials,
  };
}

function isFutureDateValue(dateValue) {
  if (!dateValue) return false;
  const date = new Date(dateValue);
  if (isNaN(date.getTime())) return true;
  return date.getTime() > Date.now();
}

function getAllowedStatusesByType(type, isHistorical) {
  if (type === 'long_term') {
    return ['in_cooperation', 'terminated'];
  }
  if (type === 'historical' || isHistorical) {
    return ['closed'];
  }
  return ['negotiating', 'constructing', 'completed', 'settling', 'closed'];
}

// 资金计算同步接口
async function syncFinancials(params) {
  const { projectId } = params;
  if (!projectId) return { code: 400, message: '缺少项目 ID' };

  try {
    const projectDoc = await db.collection('projects').doc(projectId).get();
    if (!projectDoc.data) return { code: 404, message: '项目不存在' };
    
    const project = projectDoc.data;
    const financials = calculateFinancials(project.amount, project.receivedAmount, project.costs, project.subProjects);
    
    await db.collection('projects').doc(projectId).update({
      data: {
        ...financials,
        updateTime: db.serverDate()
      }
    });
    
    return { code: 0, message: '同步成功', data: financials };
  } catch (err) {
    console.error('同步资金失败:', err);
    return { code: 500, message: '同步失败', error: err.message };
  }
}

// 历史数据同步接口
async function syncHistoryFinancials(params) {
  const { projectId } = params;
  try {
    let query = db.collection('projects');
    if (projectId) {
      query = query.doc(projectId);
    }
    
    const res = await query.get();
    const projects = Array.isArray(res.data) ? res.data : [res.data];
    
    let successCount = 0;
    let failCount = 0;
    const failures = [];

    for (const project of projects) {
      try {
        const amount = project.amount || 0;
        const receivedAmount = project.receivedAmount !== undefined ? project.receivedAmount : 0;
        
        // 历史成本项默认设为已结清
        const updatedCosts = (project.costs || []).map(cost => ({
          ...cost,
          isSettled: cost.isSettled !== undefined ? cost.isSettled : true
        }));
        const subProjects = project.subProjects || [];

        const financials = calculateFinancials(amount, receivedAmount, updatedCosts, subProjects);
        
        await db.collection('projects').doc(project._id).update({
          data: {
            receivedAmount,
            costs: updatedCosts,
            ...financials,
            updateTime: db.serverDate()
          }
        });
        successCount++;
      } catch (err) {
        failCount++;
        failures.push({ id: project._id, reason: err.message });
      }
    }
    
    return { 
      code: 0, 
      message: '同步完成', 
      data: { successCount, failCount, failures } 
    };
  } catch (err) {
    console.error('历史数据同步失败:', err);
    return { code: 500, message: '同步失败', error: err.message };
  }
}

// 安全校验：拦截特殊字符
const isSafeInput = (str) => {
  if (!str) return true;
  const unsafePattern = /[<>{}[\]\\^%`|]/;
  return !unsafePattern.test(str);
};

function normalizeSupplier(value) {
  const supplier = String(value ?? '').trim();
  const emptyValues = new Set(['', 'none', 'null', 'undefined', 'n/a', '无']);
  return emptyValues.has(supplier.toLowerCase()) ? '无' : supplier;
}

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
  const { id, name, type, period, client, clientId, role, scene, staffCount, amount, receivedAmount, desc, costs, status, isHistorical, constructionPeriod, collectionPeriod, completionTime, negotiatingTime, constructingTime, completedTime, settlingTime, settledTime, isHasContract, isHasPreview, isHasVoucher, clientSource, subProjects } = params;

  if (!id) {
    return { code: 400, message: '缺少项目 ID' };
  }

  // 安全校验
  if (!isSafeInput(name) || !isSafeInput(client) || !isSafeInput(desc) || !isSafeInput(clientSource)) {
    return { code: 400, message: '输入包含非法字符' };
  }

  try {
    const projectDoc = await db.collection('projects').doc(id).get();
    if (!projectDoc.data) {
      return { code: 404, message: '项目不存在' };
    }
    const oldProject = projectDoc.data;

    // 补录单特殊逻辑：项目类型和项目状态不可修改
    if (oldProject.type === 'historical') {
      if (type && type !== oldProject.type) return { code: 403, message: '补录单项目类型不可修改' };
      if (status && status !== oldProject.status) return { code: 403, message: '补录单项目状态不可修改' };
    } else if (oldProject.type === 'long_term') {
      // 长期项目逻辑：项目类型禁止修改，但允许修改 period (因为结束日期会随系统时间自动更新)
      if (type && type !== oldProject.type) return { code: 403, message: '长期项目类型不可修改' };
      if (period && JSON.stringify(period) !== JSON.stringify(oldProject.period)) {
        return { code: 403, message: '长期项目项目周期不可手动修改' };
      }
    } else {
      // 常规项目逻辑：创建成功后，项目类型和三大周期禁止编辑
      const lockedFields = ['type', 'period', 'constructionPeriod', 'collectionPeriod'];
      const incomingFields = Object.keys(params).filter(key => params[key] !== undefined && !['id', 'authToken'].includes(key));
      const illegalChanges = incomingFields.filter(field => {
        if (!lockedFields.includes(field)) return false;
        const newValue = params[field];
        const oldValue = oldProject[field];
        if (Array.isArray(newValue) || (newValue && typeof newValue === 'object')) {
          return JSON.stringify(newValue) !== JSON.stringify(oldValue);
        }
        return newValue != oldValue;
      });

      if (illegalChanges.length > 0) {
        return { 
          code: 403, 
          message: '常规项目创建成功后，项目类型及三大周期禁止编辑',
          details: `非法修改了字段: ${illegalChanges.join(', ')}`
        };
      }
    }

    // 已结清状态权限控制
    const nextType = type || oldProject.type;
    const nextIsHistorical = isHistorical !== undefined ? !!isHistorical : !!oldProject.isHistorical;
    if (status) {
      const allowedStatuses = getAllowedStatusesByType(nextType, nextIsHistorical);
      if (!allowedStatuses.includes(status)) {
        return { code: 400, message: '当前项目类型不支持该项目状态' };
      }
    }

    if (nextType === 'long_term') {
      const nextSubProjects = Array.isArray(subProjects) ? subProjects : (oldProject.subProjects || []);
      const hasFutureSubProjectDate = nextSubProjects.some(item => isFutureDateValue(item.startDate));
      if (hasFutureSubProjectDate) {
        return { code: 400, message: '长期项目子项目开始日期不能晚于当前日期' };
      }
    }

    if (oldProject.status === 'closed' && oldProject.type !== 'historical') {
      const allowedFields = [
        'name',
        'desc',
        'costs',
        'vouchers',
        'isHasVoucher',
        'receivedAmount',
        'status',
        'negotiatingTime',
        'constructingTime',
        'completedTime',
        'settlingTime',
        'settledTime'
      ];
      const incomingFields = Object.keys(params).filter(key => params[key] !== undefined && !['id', 'authToken'].includes(key));
      
      // 只有当字段在不允许编辑的列表中，且其值与原值不同时，才视为非法操作
      const illegalChanges = incomingFields.filter(field => {
        if (allowedFields.includes(field)) return false;
        
        // 检查值是否真的发生了变化
        const newValue = params[field];
        const oldValue = oldProject[field];
        
        // 处理数组/对象比较
        if (Array.isArray(newValue) || (newValue && typeof newValue === 'object')) {
          return JSON.stringify(newValue) !== JSON.stringify(oldValue);
        }
        
        return newValue != oldValue;
      });

      if (illegalChanges.length > 0) {
        return { 
          code: 403, 
          message: '已结清项目仅可编辑：项目状态、项目名称、项目描述、成本支出、凭证上传及已收账款',
          details: `非法修改了字段: ${illegalChanges.join(', ')}`
        };
      }
    }

    const updateData = {};
    // 订单金额修改限制逻辑
    if (amount !== undefined && parseFloat(amount) !== parseFloat(oldProject.amount || 0)) {
      const editCount = oldProject.amountEditCount || 0;
      if (editCount >= 1) {
        return { code: 403, message: '订单金额在创建后仅允许修改一次，当前已达到修改上限' };
      }
      updateData.amountEditCount = editCount + 1;
    }

    const updateDataFinal = {
      ...updateData,
      updateTime: db.serverDate()
    };

    if (name) updateDataFinal.name = name;
    if (type) updateDataFinal.type = type;
    if (period) updateDataFinal.period = period;
    if (client) updateDataFinal.client = client;
    if (clientId !== undefined) updateDataFinal.clientId = clientId;
    if (role) updateDataFinal.role = role;
    if (scene !== undefined) updateDataFinal.scene = scene;
    if (staffCount !== undefined) updateDataFinal.staffCount = staffCount;
    if (amount !== undefined) updateDataFinal.amount = amount;
    if (receivedAmount !== undefined) {
      if (receivedAmount > (amount || oldProject.amount)) {
        return { code: 400, message: '已收账款不可超过订单金额' };
      }
      updateDataFinal.receivedAmount = receivedAmount;
    }
    if (desc !== undefined) updateDataFinal.desc = desc;
    if (clientSource !== undefined) updateDataFinal.clientSource = clientSource;
    
    if (costs && Array.isArray(costs)) {
      // 清洗成本数据，确保没有 NaN 或 undefined
      updateDataFinal.costs = costs.map(item => ({
        category: item.category || '',
        supplier: normalizeSupplier(item.supplier),
        amount: isNaN(parseFloat(item.amount)) ? 0 : parseFloat(item.amount),
        isSettled: item.isSettled || '否'
      }));
    }
    
    if (status) updateDataFinal.status = status;
    
    if (subProjects && Array.isArray(subProjects)) {
      updateDataFinal.subProjects = subProjects.map(sp => ({
        id: sp.id || Date.now() + Math.random(),
        content: sp.content || '',
        startDate: sp.startDate || '',
        amount: isNaN(parseFloat(sp.amount)) ? 0 : parseFloat(sp.amount),
        isHasVoucher: sp.isHasVoucher || '否',
        vouchers: sp.vouchers || [],
        costs: (sp.costs || []).map(c => ({
          id: c.id || Date.now() + Math.random(),
          category: c.category || '',
          supplier: normalizeSupplier(c.supplier),
          amount: isNaN(parseFloat(c.amount)) ? 0 : parseFloat(c.amount),
          isSettled: c.isSettled || false
        }))
      }));
    }
    
    // 历史数据相关字段
    if (isHistorical !== undefined) updateDataFinal.isHistorical = isHistorical;
    if (type) updateDataFinal.type = type;
    if (constructionPeriod !== undefined) updateDataFinal.constructionPeriod = constructionPeriod;
    if (collectionPeriod !== undefined) updateDataFinal.collectionPeriod = collectionPeriod;
    if (completionTime !== undefined) updateDataFinal.completionTime = completionTime;
    
    if (isHasContract !== undefined) updateDataFinal.isHasContract = isHasContract;
    if (isHasPreview !== undefined) updateDataFinal.isHasPreview = isHasPreview;
    if (isHasVoucher !== undefined) updateDataFinal.isHasVoucher = isHasVoucher;

    // 时间节点显式更新
    if (negotiatingTime) updateDataFinal.negotiatingTime = negotiatingTime;
    if (constructingTime) updateDataFinal.constructingTime = constructingTime;
    if (completedTime) updateDataFinal.completedTime = completedTime;
    if (settlingTime) updateDataFinal.settlingTime = settlingTime;
    if (settledTime) updateDataFinal.settledTime = settledTime;

    // 长期项目状态切换时，项目周期结束日期立即联动到当天
    if (status && status !== oldProject.status && oldProject.type === 'long_term') {
      const today = new Date().toISOString().split('T')[0];
      const periodStart = (oldProject.period && oldProject.period[0]) || today;
      updateDataFinal.period = [periodStart, today];
    }

    // 状态变更自动记录时间节点及周期联动 (仅针对常规项目)
    if (status && status !== oldProject.status && oldProject.type !== 'historical' && oldProject.type !== 'long_term') {
      const now = new Date().toISOString();
      const today = now.split('T')[0];
      
      if (status === 'negotiating' && !oldProject.negotiatingTime) {
        updateDataFinal.negotiatingTime = now;
      }
      if (status === 'constructing') {
        if (!oldProject.constructingTime) {
          updateDataFinal.constructingTime = now;
          updateDataFinal.constructionPeriod = [today, today];
        }
      }
      if (status === 'completed') {
        if (!oldProject.completedTime) {
          updateDataFinal.completedTime = now;
          // 锁定施工周期结束日期
          const conStart = (oldProject.constructionPeriod && oldProject.constructionPeriod[0]) ? oldProject.constructionPeriod[0] : today;
          updateDataFinal.constructionPeriod = [conStart, today];
        }
      }
      if (status === 'settling') {
        if (!oldProject.settlingTime) {
          updateDataFinal.settlingTime = now;
          updateDataFinal.collectionPeriod = [today, today];
        }
      }
      if (status === 'closed') {
        if (!oldProject.settledTime) {
          updateDataFinal.settledTime = now;
          // 锁定项目周期和回款周期结束日期
          const pStart = (oldProject.period && oldProject.period[0]) ? oldProject.period[0] : today;
          updateDataFinal.period = [pStart, today];
          
          const colStart = (oldProject.collectionPeriod && oldProject.collectionPeriod[0]) ? oldProject.collectionPeriod[0] : today;
          updateDataFinal.collectionPeriod = [colStart, today];
        }
      }
    }

    // 重新计算资金
    const finalAmount = (amount !== undefined && !isNaN(parseFloat(amount))) ? parseFloat(amount) : oldProject.amount;
    const finalReceived = (receivedAmount !== undefined && !isNaN(parseFloat(receivedAmount))) ? parseFloat(receivedAmount) : (oldProject.receivedAmount || 0);
    const finalCosts = updateDataFinal.costs || oldProject.costs || [];
    const finalSubProjects = updateDataFinal.subProjects || oldProject.subProjects || [];
    const financials = calculateFinancials(finalAmount, finalReceived, finalCosts, finalSubProjects);
    Object.assign(updateDataFinal, financials);

    // 联动删除逻辑：如果从“是”改为“否”，清理云端文件
    if (oldProject.isHasContract === '是' && isHasContract === '否') {
      console.log(`项目 ${id} 合同状态由 是 改为 否，触发清理逻辑...`);
      try {
        await cloud.callFunction({
          name: 'contractPreviewService',
          data: { action: 'deleteAllByProject', data: { projectId: id, type: 'contract' } }
        });
      } catch (err) {
        console.error('清理合同文件失败:', err);
      }
    }
    if (oldProject.isHasPreview === '是' && isHasPreview === '否') {
      console.log(`项目 ${id} 预览图状态由 是 改为 否，触发清理逻辑...`);
      try {
        await cloud.callFunction({
          name: 'contractPreviewService',
          data: { action: 'deleteAllByProject', data: { projectId: id, type: 'preview' } }
        });
      } catch (err) {
        console.error('清理预览图失败:', err);
      }
    }

    // 移除所有 undefined 的字段，防止数据库更新失败
    Object.keys(updateDataFinal).forEach(key => {
      if (updateDataFinal[key] === undefined) {
        delete updateDataFinal[key];
      }
    });

    await db.collection('projects').doc(id).update({
      data: updateDataFinal
    });

    return { code: 0, message: '更新成功' };
  } catch (err) {
    console.error('更新项目失败:', err);
    return { code: 500, message: `更新失败: ${err.message || '未知错误'}`, error: err.message };
  }
}

async function createProject(params) {
  const { name, type, startDate, period, client, role, staffCount, amount, receivedAmount, desc, costs, status, isHistorical, constructionPeriod, collectionPeriod, completionTime, isHasContract, isHasPreview, contractFileIds, previewFileIds, subProjects, currentUser } = params;

  // 1. 基础完整性校验
  if (!name || !client || !role || staffCount === undefined || !amount || !desc || !costs) {
    return { code: 400, message: '缺少必需的项目信息，请确保所有字段均已填写' };
  }

  if (type !== 'normal') {
    return { code: 400, message: '新建项目仅支持常规类型' };
  }

  // 合同/预览图校验
  if (isHasContract === '是') {
    if (!contractFileIds || !Array.isArray(contractFileIds) || contractFileIds.length === 0) {
      return { code: 400, message: '请上传合同文件后再创建项目' };
    }
  }
  if (isHasPreview === '是') {
    if (!previewFileIds || !Array.isArray(previewFileIds) || previewFileIds.length === 0) {
      return { code: 400, message: '请上传预览图后再创建项目' };
    }
  }

  // 2. 安全校验
  const allowedStatuses = getAllowedStatusesByType(type, !!isHistorical);
  if (status && !allowedStatuses.includes(status)) {
    return { code: 400, message: '当前项目类型不支持该项目状态' };
  }

  if (type === 'long_term') {
    const hasFutureSubProjectDate = Array.isArray(subProjects) && subProjects.some(item => isFutureDateValue(item.startDate));
    if (hasFutureSubProjectDate) {
      return { code: 400, message: '长期项目子项目开始日期不能晚于当前日期' };
    }
  }

  if (type === 'normal') {
    if (!startDate) {
      return { code: 400, message: '请选择交付日期' };
    }
    if (isFutureDateValue(startDate)) {
      return { code: 400, message: '交付日期不能晚于当前日期' };
    }
  }

  if (Array.isArray(period) && period[0] && isFutureDateValue(period[0])) {
    return { code: 400, message: '项目开始日期不能晚于当前日期' };
  }

  if (!isSafeInput(name) || !isSafeInput(client) || !isSafeInput(desc)) {
    return { code: 400, message: '输入包含非法字符，请检查后重试' };
  }

  // 3. 数据类型校验
  if (isNaN(parseFloat(amount))) {
    return { code: 400, message: '订单金额格式不正确' };
  }

  const received = receivedAmount !== undefined ? parseFloat(receivedAmount) : 0;
  if (received > parseFloat(amount)) {
    return { code: 400, message: '已收账款不可超过订单金额' };
  }

  try {
    const now = new Date().toISOString();
    const costsData = Array.isArray(costs)
      ? costs.map(cost => ({
        ...cost,
        supplier: normalizeSupplier(cost.supplier)
      }))
      : [];
    
    const subProjectsData = (subProjects && Array.isArray(subProjects)) ? subProjects.map(sp => ({
      id: sp.id || Date.now() + Math.random(),
      content: sp.content || '',
      startDate: sp.startDate || '',
      amount: isNaN(parseFloat(sp.amount)) ? 0 : parseFloat(sp.amount),
      isHasVoucher: sp.isHasVoucher || '否',
      vouchers: sp.vouchers || [],
      costs: (sp.costs || []).map(c => ({
        id: c.id || Date.now() + Math.random(),
        category: c.category || '',
        supplier: normalizeSupplier(c.supplier),
        amount: isNaN(parseFloat(c.amount)) ? 0 : parseFloat(c.amount),
        isSettled: c.isSettled || false
      }))
    })) : [];

    // 计算资金
    const financials = calculateFinancials(amount, received, costsData, subProjectsData);
    
    const data = {
      ...params,
      receivedAmount: received,
      costs: costsData,
      subProjects: subProjectsData,
      amountEditCount: 0, // 初始化修改次数为0
      ...financials,
      createdAt: now,
      createTime: db.serverDate(),
      updateTime: db.serverDate()
    };
    delete data.currentUser;
    delete data.authToken;

    // 初始化时间节点 (仅针对常规项目)
    if (type !== 'historical') {
      const initialStatus = status || 'negotiating';
      if (initialStatus === 'negotiating' && !data.negotiatingTime) data.negotiatingTime = now;
      if (initialStatus === 'constructing' && !data.constructingTime) data.constructingTime = now;
      if (initialStatus === 'completed' && !data.completedTime) data.completedTime = now;
      if (initialStatus === 'closed' && !data.settledTime) data.settledTime = now;
    } else {
      // 补录单仅记录完结时间
      if (!data.settledTime) data.settledTime = now;
    }

    const res = await db.collection('projects').add({
      data
    });

    // 发送邮件通知超级管理员（仅当创建者是普通管理员时）
    if (currentUser && currentUser.role === ADMIN_COM_ROLE) {
      try {
        const adminEmails = await getSuperAdminEmails();
        if (adminEmails.length > 0) {
          await sendProjectCreatedEmail(adminEmails, data, currentUser);
        }
      } catch (emailError) {
        console.error('发送邮件通知失败:', emailError);
        // 邮件发送失败不影响主流程
      }
    }

    return { code: 0, message: '创建成功', data: { id: res._id } };
  } catch (err) {
    console.error('创建项目失败:', err);
    return { code: 500, message: '创建失败', error: err.message };
  }
}

async function getProject(params) {
  const { id } = params || {};
  if (!id) return { code: 400, message: '缺少项目 ID' };
  try {
    const result = await db.collection('projects').doc(id).get();
    if (!result.data) return { code: 404, message: '项目不存在' };
    return { code: 0, message: '查询成功', data: enrichProjectFinancials(result.data) };
  } catch (err) {
    console.error('查询项目详情失败:', err);
    return { code: 500, message: '查询失败', error: err.message };
  }
}

function toCents(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return null;
  if (Math.abs(numberValue * 100 - Math.round(numberValue * 100)) > 0.000001) return null;
  return Math.round(numberValue * 100);
}

async function quickRecord(params, currentUser) {
  const { projectId, recordType, amount, category, supplier, isSettled, requestId } = params || {};
  if (!projectId || !requestId || !['receipt', 'cost'].includes(recordType)) {
    return { code: 400, message: '记账参数不完整' };
  }
  const amountCents = toCents(amount);
  if (!amountCents || amountCents <= 0) {
    return { code: 400, message: '金额必须大于 0，且最多保留两位小数' };
  }
  if (recordType === 'cost' && (!category || !isSafeInput(category) || !isSafeInput(supplier))) {
    return { code: 400, message: '请填写有效的成本类别和供应商' };
  }

  try {
    const transactionResult = await db.runTransaction(async transaction => {
      const projectRef = transaction.collection('projects').doc(projectId);
      const projectResult = await projectRef.get();
      const project = projectResult.data;
      if (!project) throw new Error('PROJECT_NOT_FOUND');

      const requestIds = Array.isArray(project.mobileRequestIds) ? project.mobileRequestIds : [];
      if (requestIds.includes(requestId)) {
        return { duplicated: true, project };
      }

      const updateData = {
        mobileRequestIds: [...requestIds.slice(-99), requestId],
        updateTime: db.serverDate(),
        lastMobileRecord: {
          requestId,
          recordType,
          amount: amountCents / 100,
          operatorId: currentUser.id,
          operatorName: currentUser.nickname || currentUser.username || '',
          createdAt: new Date().toISOString()
        }
      };

      if (recordType === 'receipt') {
        const totalCents = toCents(project.amount || 0) || 0;
        const receivedCents = toCents(project.receivedAmount || 0) || 0;
        const nextReceivedCents = receivedCents + amountCents;
        if (nextReceivedCents > totalCents) throw new Error('RECEIPT_EXCEEDS_AMOUNT');
        updateData.receivedAmount = nextReceivedCents / 100;
        Object.assign(updateData, calculateFinancials(
          project.amount,
          updateData.receivedAmount,
          project.costs,
          project.subProjects
        ));
      } else {
        const costs = Array.isArray(project.costs) ? project.costs : [];
        updateData.costs = [...costs, {
          id: `mobile-${requestId}`,
          category: String(category).trim(),
          supplier: normalizeSupplier(supplier),
          amount: amountCents / 100,
          isSettled: isSettled === true || isSettled === '是'
        }];
        Object.assign(updateData, calculateFinancials(
          project.amount,
          project.receivedAmount,
          updateData.costs,
          project.subProjects
        ));
      }

      await projectRef.update({ data: updateData });
      return { duplicated: false, financials: updateData };
    });

    return {
      code: 0,
      message: transactionResult.duplicated ? '该笔记录已提交' : '记账成功',
      data: { duplicated: transactionResult.duplicated }
    };
  } catch (err) {
    if (err.message === 'PROJECT_NOT_FOUND') return { code: 404, message: '项目不存在' };
    if (err.message === 'RECEIPT_EXCEEDS_AMOUNT') return { code: 400, message: '本次收款会使累计收款超过订单金额' };
    console.error('移动端快速记账失败:', err);
    return { code: 500, message: '记账失败，请稍后重试', error: err.message };
  }
}

async function listProjects(params) {
  const {
    page,
    pageSize,
    keyword = '',
    status = ''
  } = params || {};
  const allowedStatuses = new Set([
    'negotiating',
    'constructing',
    'completed',
    'settling',
    'closed',
    'in_cooperation',
    'terminated'
  ]);
  const normalizedStatus = String(status || '').trim();
  const normalizedKeyword = String(keyword || '').trim().slice(0, 50);
  if (normalizedStatus && !allowedStatuses.has(normalizedStatus)) {
    return { code: 400, message: '项目状态筛选值无效' };
  }

  const usePagination = page !== undefined || pageSize !== undefined || normalizedKeyword || normalizedStatus;
  const currentPage = Math.max(1, Number(page) || 1);
  const currentPageSize = Math.min(50, Math.max(1, Number(pageSize) || 20));
  try {
    let query = db.collection('projects');
    const _ = db.command;
    const conditions = [];

    if (normalizedStatus) {
      conditions.push({ status: normalizedStatus });
    }
    if (normalizedKeyword) {
      const regexp = db.RegExp({
        regexp: normalizedKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        options: 'i'
      });
      conditions.push(_.or([
        { name: regexp },
        { client: regexp },
        { projectCode: regexp },
        { code: regexp },
        { projectNo: regexp }
      ]));
    }

    if (conditions.length === 1) {
      query = query.where(conditions[0]);
    } else if (conditions.length > 1) {
      query = query.where(_.and(conditions));
    }

    const countResult = usePagination ? await query.count() : null;
    let orderedQuery = query.orderBy('createTime', 'desc');
    if (usePagination) {
      orderedQuery = orderedQuery.skip((currentPage - 1) * currentPageSize).limit(currentPageSize);
    }
    const res = await orderedQuery.get();
    const list = (res.data || []).map(enrichProjectFinancials);
    if (!usePagination) return { code: 0, message: '查询成功', data: list };
    const total = countResult.total || 0;
    return {
      code: 0,
      message: '查询成功',
      data: {
        list,
        total,
        page: currentPage,
        pageSize: currentPageSize,
        hasMore: currentPage * currentPageSize < total
      }
    };
  } catch (err) {
    console.error('查询项目列表失败:', err);
    return { code: 500, message: '查询失败', error: err.message };
  }
}

function toOverviewDate(value) {
  if (!value) return null;
  const raw = value.$date || value;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isHistoricalOverviewProject(project) {
  return project && (project.type === 'historical' || !!project.isHistorical);
}

function getOverviewProjectDate(project) {
  if (isHistoricalOverviewProject(project)) {
    return toOverviewDate(project.completionTime);
  }
  return toOverviewDate(project.period && project.period[0])
    || toOverviewDate(project.startDate)
    || toOverviewDate(project.negotiatingTime)
    || toOverviewDate(project.createTime);
}

function isOverviewCostSettled(value) {
  if (value === undefined || value === null || value === '') return true;
  return value === true || value === 1 || ['是', 'true', '已支付', '已结清'].includes(String(value).toLowerCase());
}

function getOverviewProjectAmount(project) {
  return Number(project.amount) || Number(project.totalAmount) || 0;
}

function getOverviewProjectCost(project) {
  if (Number(project.payableAmount)) return Number(project.payableAmount);
  const projectCost = Array.isArray(project.costs)
    ? project.costs.reduce((sum, cost) => sum + (Number(cost.amount) || 0), 0)
    : 0;
  const subProjectCost = Array.isArray(project.subProjects)
    ? project.subProjects.reduce((sum, subProject) => {
      const costs = Array.isArray(subProject.costs) ? subProject.costs : [];
      return sum + costs.reduce((costSum, cost) => costSum + (Number(cost.amount) || 0), 0);
    }, 0)
    : 0;
  return projectCost + subProjectCost;
}

function getOverviewProjectPaidCost(project) {
  if (project.paidAmount !== undefined && project.paidAmount !== null && project.paidAmount !== '') {
    return Number(project.paidAmount) || 0;
  }
  const projectPaid = Array.isArray(project.costs)
    ? project.costs.reduce((sum, cost) => {
      if (!isOverviewCostSettled(cost.isSettled)) return sum;
      return sum + (Number(cost.amount) || 0);
    }, 0)
    : 0;
  const subProjectPaid = Array.isArray(project.subProjects)
    ? project.subProjects.reduce((sum, subProject) => {
      const costs = Array.isArray(subProject.costs) ? subProject.costs : [];
      return sum + costs.reduce((costSum, cost) => {
        if (!isOverviewCostSettled(cost.isSettled)) return costSum;
        return costSum + (Number(cost.amount) || 0);
      }, 0);
    }, 0)
    : 0;
  return projectPaid + subProjectPaid;
}

function getOverviewRangeBounds(rangeType, startDate, endDate) {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  if (rangeType === 'custom' && startDate && endDate) {
    const start = toOverviewDate(startDate);
    const end = toOverviewDate(endDate);
    if (!start || !end) return null;
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  if (rangeType === 'year') {
    return {
      start: new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0),
      end: new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999)
    };
  }

  const months = rangeType === 'quarter' ? 3 : 1;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setMonth(start.getMonth() - months);
  return { start, end };
}

function getPreviousOverviewBounds(bounds) {
  const duration = bounds.end.getTime() - bounds.start.getTime();
  const end = new Date(bounds.start.getTime() - 1);
  const start = new Date(end.getTime() - duration);
  return { start, end };
}

function getRecentOneMonthBounds() {
  // 最近一个月：与顶部筛选无关，固定为「今天往前推 1 个自然月」到今天
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setMonth(start.getMonth() - 1);
  return { start, end };
}

function filterOverviewProjects(projects, bounds) {
  const start = bounds.start.getTime();
  const end = bounds.end.getTime();
  return projects.filter((project) => {
    const projectDate = getOverviewProjectDate(project);
    if (!projectDate) return false;
    const time = projectDate.getTime();
    return time >= start && time <= end;
  });
}

function buildOverviewMetrics(projects) {
  const totalAmount = projects.reduce((sum, item) => sum + getOverviewProjectAmount(item), 0);
  const receivedAmount = projects.reduce((sum, item) => sum + (Number(item.receivedAmount) || 0), 0);
  const unpaidAmount = Math.max(0, totalAmount - receivedAmount);
  const totalCost = projects.reduce((sum, item) => sum + getOverviewProjectCost(item), 0);
  const paidCost = projects.reduce((sum, item) => sum + getOverviewProjectPaidCost(item), 0);
  const unpaidCost = Math.max(0, totalCost - paidCost);
  const profit = totalAmount - totalCost;
  const profitRate = totalAmount ? (profit / totalAmount) * 100 : 0;
  const costRate = totalAmount ? (totalCost / totalAmount) * 100 : 0;
  return {
    orderCount: projects.length,
    totalAmount: Number(totalAmount.toFixed(2)),
    receivedAmount: Number(receivedAmount.toFixed(2)),
    unpaidAmount: Number(unpaidAmount.toFixed(2)),
    totalCost: Number(totalCost.toFixed(2)),
    paidCost: Number(paidCost.toFixed(2)),
    unpaidCost: Number(unpaidCost.toFixed(2)),
    profit: Number(profit.toFixed(2)),
    profitRate: Number(profitRate.toFixed(2)),
    costRate: Number(costRate.toFixed(2))
  };
}

function getOverviewPeriodLabel(rangeType, startDate, endDate, bounds) {
  if (rangeType === 'custom' && startDate && endDate) {
    return `${String(startDate).slice(0, 10)} ~ ${String(endDate).slice(0, 10)}`;
  }
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  if (rangeType === 'year') return String(now.getFullYear());
  if (rangeType === 'quarter') {
    return `Q${Math.floor(now.getMonth() / 3) + 1} ${now.getFullYear()}`;
  }
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getOverviewStatusMeta(status) {
  const labels = {
    negotiating: '洽谈中',
    constructing: '施工中',
    completed: '已交付',
    settling: '结账中',
    closed: '已结清',
    in_cooperation: '合作中',
    terminated: '已终止'
  };
  if (status === 'completed' || status === 'closed') {
    return { label: labels[status] || '已完成', tone: 'done' };
  }
  if (status === 'terminated') {
    return { label: labels[status] || '已终止', tone: 'ended' };
  }
  return { label: labels[status] || '进行中', tone: 'doing' };
}

async function fetchAllProjectsForOverview() {
  const MAX_LIMIT = 100;
  const collection = db.collection('projects');
  const countResult = await collection.count();
  const total = countResult.total || 0;
  if (!total) return [];

  const batchCount = Math.ceil(total / MAX_LIMIT);
  const tasks = [];
  for (let i = 0; i < batchCount; i += 1) {
    tasks.push(
      collection.orderBy('createTime', 'desc').skip(i * MAX_LIMIT).limit(MAX_LIMIT).get()
    );
  }
  const results = await Promise.all(tasks);
  return results.reduce((list, result) => list.concat(result.data || []), []);
}

async function getOverview(params = {}) {
  const rangeType = String(params.rangeType || 'all').trim();
  const startDate = params.startDate ? String(params.startDate).slice(0, 10) : '';
  const endDate = params.endDate ? String(params.endDate).slice(0, 10) : '';
  const allowedRanges = new Set(['all', 'month', 'quarter', 'year', 'custom']);
  if (!allowedRanges.has(rangeType)) {
    return { code: 400, message: '时间范围类型无效' };
  }
  if (rangeType === 'custom' && (!startDate || !endDate)) {
    return { code: 400, message: '自定义范围请选择开始和结束日期' };
  }
  if (rangeType === 'custom' && startDate > endDate) {
    return { code: 400, message: '开始日期不能晚于结束日期' };
  }

  try {
    const bounds = rangeType === 'all'
      ? null
      : getOverviewRangeBounds(rangeType, startDate, endDate);
    if (rangeType !== 'all' && !bounds) return { code: 400, message: '时间范围无效' };

    const allProjects = await fetchAllProjectsForOverview();
    const currentProjects = rangeType === 'all'
      ? allProjects.slice()
      : filterOverviewProjects(allProjects, bounds);
    const previousProjects = rangeType === 'all'
      ? []
      : filterOverviewProjects(allProjects, getPreviousOverviewBounds(bounds));
    // 最近订单状态：始终按最近一个月返回，不受 rangeType / 自定义筛选影响
    const recentProjects = filterOverviewProjects(allProjects, getRecentOneMonthBounds())
      .sort((a, b) => {
        const timeA = (getOverviewProjectDate(a) || new Date(0)).getTime();
        const timeB = (getOverviewProjectDate(b) || new Date(0)).getTime();
        return timeB - timeA;
      })
      .slice(0, 20)
      .map((item) => {
        const statusMeta = getOverviewStatusMeta(item.status);
        return {
          id: item._id,
          name: item.name || '',
          amount: getOverviewProjectAmount(item),
          status: item.status || '',
          statusLabel: statusMeta.label,
          statusTone: statusMeta.tone,
          time: item.updateTime || item.createTime || getOverviewProjectDate(item),
          createTime: item.createTime || null
        };
      });

    const currentMetrics = buildOverviewMetrics(currentProjects);
    const previousMetrics = buildOverviewMetrics(previousProjects);
    let trendPercent = 0;
    if (rangeType !== 'all') {
      if (previousMetrics.profit !== 0) {
        trendPercent = ((currentMetrics.profit - previousMetrics.profit) / Math.abs(previousMetrics.profit)) * 100;
      } else if (currentMetrics.profit !== 0) {
        trendPercent = 100;
      }
    }

    return {
      code: 0,
      message: '查询成功',
      data: {
        rangeType,
        startDate: rangeType === 'all' ? '' : (startDate || bounds.start.toISOString().slice(0, 10)),
        endDate: rangeType === 'all' ? '' : (endDate || bounds.end.toISOString().slice(0, 10)),
        periodLabel: rangeType === 'all'
          ? '全部'
          : getOverviewPeriodLabel(rangeType, startDate, endDate, bounds),
        metrics: {
          ...currentMetrics,
          trendPercent: Number(trendPercent.toFixed(2))
        },
        recentProjects
      }
    };
  } catch (err) {
    console.error('查询项目总览失败:', err);
    return { code: 500, message: '总览查询失败', error: err.message };
  }
}

// 格式化日期时间
function formatDateTime(dateValue) {
  if (!dateValue) return '-';
  if (dateValue.$date) {
    dateValue = dateValue.$date;
  }
  const date = new Date(dateValue);
  if (isNaN(date.getTime())) return '-';
  return date.toLocaleString('zh-CN', { 
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function getSmtpConfig() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 465);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user;

  if (!host || !port || !user || !pass) {
    throw new Error('SMTP 配置缺失');
  }

  return {
    host,
    port,
    user,
    pass,
    from,
    secure: port === 465
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function maskEmail(email) {
  const value = String(email || '');
  const [name, domain] = value.split('@');
  if (!name || !domain) return value ? '***' : '';
  return `${name.slice(0, 2)}***@${domain}`;
}

function getProjectAmount(projectData) {
  return projectData.totalAmount ?? projectData.amount ?? 0;
}

function formatMoney(value) {
  const numberValue = Number(value || 0);
  if (!Number.isFinite(numberValue)) return '0.00';
  return numberValue.toFixed(2);
}

function getProjectCost(projectData) {
  const mainCost = Array.isArray(projectData.costs)
    ? projectData.costs.reduce((sum, item) => sum + (Number(item.amount) || 0), 0)
    : 0;
  const subProjectCost = Array.isArray(projectData.subProjects)
    ? projectData.subProjects.reduce((sum, item) => {
      const costs = Array.isArray(item.costs) ? item.costs : [];
      return sum + costs.reduce((costSum, cost) => costSum + (Number(cost.amount) || 0), 0);
    }, 0)
    : 0;
  return mainCost + subProjectCost;
}

function getProjectTypeText(projectData) {
  const type = projectData.type || (projectData.isHistorical ? 'historical' : 'normal');
  const typeMap = {
    normal: '常规项目',
    historical: '补录项目',
    long_term: '长期项目'
  };
  return projectData.typeLabel || typeMap[type] || type || '-';
}

const CLIENT_ROLE_MAP = {
  pm: '项目经理',
  boss: '老板本身',
  agent: '中间人',
  other: '其他'
};

function getClientRoleText(projectData) {
  const role = projectData.role || projectData.clientRole || '';
  return projectData.roleLabel || CLIENT_ROLE_MAP[role] || role || '-';
}

function getClientSourceText(projectData) {
  return projectData.clientSourceLabel || projectData.sourceLabel || projectData.clientSource || projectData.source || '-';
}

function getProjectDescription(projectData) {
  return projectData.description ?? projectData.desc ?? '';
}

function buildProjectCreatedEmailHtml(projectData, creator) {
  const creatorName = `${creator.username || '-'} (${creator.nickname || creator.username || '-'})`;
  const description = getProjectDescription(projectData);

  return `
    <div style="margin:0;padding:24px;background:#f6f8fb;font-family:Arial,'Microsoft YaHei',sans-serif;color:#1f2937;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:8px;padding:28px;border:1px solid #e5e7eb;">
        <h2 style="margin:0 0 16px;font-size:22px;color:#111827;">新增项目提醒</h2>
        <p style="margin:0 0 20px;font-size:14px;line-height:1.7;color:#4b5563;">系统管理员新增了项目，请及时查看后台管理系统。</p>
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <tr><td style="padding:10px 12px;width:132px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:700;">新增人</td><td style="padding:10px 12px;border:1px solid #e5e7eb;">${escapeHtml(creatorName)}</td></tr>
          <tr><td style="padding:10px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:700;">项目名称</td><td style="padding:10px 12px;border:1px solid #e5e7eb;">${escapeHtml(projectData.name)}</td></tr>
          <tr><td style="padding:10px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:700;">客户单位</td><td style="padding:10px 12px;border:1px solid #e5e7eb;">${escapeHtml(projectData.client)}</td></tr>
          <tr><td style="padding:10px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:700;">项目类型</td><td style="padding:10px 12px;border:1px solid #e5e7eb;">${escapeHtml(getProjectTypeText(projectData))}</td></tr>
          <tr><td style="padding:10px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:700;">客户来源</td><td style="padding:10px 12px;border:1px solid #e5e7eb;">${escapeHtml(getClientSourceText(projectData))}</td></tr>
          <tr><td style="padding:10px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:700;">客户角色</td><td style="padding:10px 12px;border:1px solid #e5e7eb;">${escapeHtml(getClientRoleText(projectData))}</td></tr>
          <tr><td style="padding:10px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:700;">项目金额</td><td style="padding:10px 12px;border:1px solid #e5e7eb;">¥${escapeHtml(formatMoney(getProjectAmount(projectData)))}</td></tr>
          <tr><td style="padding:10px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:700;">项目成本</td><td style="padding:10px 12px;border:1px solid #e5e7eb;">¥${escapeHtml(formatMoney(getProjectCost(projectData)))}</td></tr>
          <tr><td style="padding:10px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:700;">新增时间</td><td style="padding:10px 12px;border:1px solid #e5e7eb;">${escapeHtml(formatDateTime(projectData.createdAt || Date.now()))}</td></tr>
          ${description ? `<tr><td style="padding:10px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:700;">项目描述</td><td style="padding:10px 12px;border:1px solid #e5e7eb;">${escapeHtml(description)}</td></tr>` : ''}
        </table>
        <p style="margin:18px 0 0;font-size:13px;color:#6b7280;">此邮件由系统自动发送，请勿直接回复。</p>
      </div>
    </div>
  `;
}

// 获取所有超级管理员的邮箱
async function getSuperAdminEmails() {
  try {
    const res = await db.collection('users')
      .where({
        role: ADMIN_SUPER_ROLE
      })
      .field({
        email: true
      })
      .get();
    
    return Array.from(new Set((res.data || [])
      .map(user => String(user.email || '').trim())
      .filter(isValidEmail)));
  } catch (err) {
    console.error('获取超级管理员邮箱失败:', err);
    return [];
  }
}

// 发送项目创建邮件
async function sendProjectCreatedEmail(emails, projectData, creator) {
  if (!emails || emails.length === 0) return;
  
  try {
    const smtpConfig = getSmtpConfig();
    const transporter = nodemailer.createTransport({
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: smtpConfig.secure,
      auth: {
        user: smtpConfig.user,
        pass: smtpConfig.pass
      }
    });
    const mailOptions = {
      from: smtpConfig.from,
      to: emails,
      subject: '【系统通知】新增项目提醒',
      html: buildProjectCreatedEmailHtml(projectData, creator)
    };
    
    const result = await transporter.sendMail(mailOptions);
    console.log('新增项目提醒邮件发送成功:', emails.map(maskEmail).join(','), result.response || '');
  } catch (err) {
    console.error('邮件发送失败:', err);
    // 邮件发送失败不影响主流程
  }
}
