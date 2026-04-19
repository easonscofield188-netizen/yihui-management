/**
 * 腾讯云函数: projectService
 * 功能：项目管理（创建、查询等）
 */
'use strict';

const cloud = require("wx-server-sdk");
const nodemailer = require("nodemailer");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const ADMIN_SUPER_ROLE = 'ADMIN_SUPER';
const ADMIN_COM_ROLE = 'ADMIN_COM';

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
      case 'createProject':
        return await createProject(data);
      case 'list':
        return await listProjects(data);
      case 'update':
        return await updateProject(data);
      case 'delete':
        return await deleteProject(data);
      case 'syncFinancials':
        return await syncFinancials(data);
      case 'syncHistoryFinancials':
        return await syncHistoryFinancials(data);
      default:
        return { code: 400, message: '未知操作' };
    }
  } catch (error) {
    console.error('项目管理操作失败', error);
    return { code: 500, message: '操作失败', error: error.message };
  }
};

// 计算资金相关字段
function calculateFinancials(amount, receivedAmount, costs, subProjects) {
  const totalAmount = parseFloat(amount) || 0;
  const received = parseFloat(receivedAmount) || 0;
  const unreceived = Math.max(0, totalAmount - received);
  
  let payable = 0;
  let paid = 0;
  
  // 主项目成本
  if (costs && Array.isArray(costs)) {
    costs.forEach(cost => {
      const costAmount = parseFloat(cost.amount) || 0;
      payable += costAmount;
      if (cost.isSettled === true || cost.isSettled === '是') {
        paid += costAmount;
      }
    });
  }

  // 子项目成本
  if (subProjects && Array.isArray(subProjects)) {
    subProjects.forEach(sp => {
      if (sp.costs && Array.isArray(sp.costs)) {
        sp.costs.forEach(cost => {
          const costAmount = parseFloat(cost.amount) || 0;
          payable += costAmount;
          if (cost.isSettled === true || cost.isSettled === '是') {
            paid += costAmount;
          }
        });
      }
    });
  }
  
  return {
    unreceivedAmount: parseFloat(unreceived.toFixed(2)),
    payableAmount: parseFloat(payable.toFixed(2)),
    paidAmount: parseFloat(paid.toFixed(2))
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
  const { id, name, type, period, client, role, staffCount, amount, receivedAmount, desc, costs, status, isHistorical, constructionPeriod, collectionPeriod, completionTime, negotiatingTime, constructingTime, completedTime, settlingTime, settledTime, isHasContract, isHasPreview, clientSource, subProjects } = params;

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
      const incomingFields = Object.keys(params).filter(key => params[key] !== undefined && key !== 'id');
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
      const allowedFields = ['name', 'desc', 'costs', 'vouchers', 'receivedAmount'];
      const incomingFields = Object.keys(params).filter(key => params[key] !== undefined && key !== 'id');
      
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
          message: '已结清项目仅可编辑：项目名称、项目描述、成本支出、凭证上传及已收账款',
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
    if (role) updateDataFinal.role = role;
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
        supplier: item.supplier || '',
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
          supplier: c.supplier || '',
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
  const { name, type, period, client, role, staffCount, amount, receivedAmount, desc, costs, status, isHistorical, constructionPeriod, collectionPeriod, completionTime, isHasContract, isHasPreview, contractFileIds, previewFileIds, subProjects, currentUser } = params;

  // 1. 基础完整性校验
  if (!name || !client || !role || staffCount === undefined || !amount || !desc || !costs) {
    return { code: 400, message: '缺少必需的项目信息，请确保所有字段均已填写' };
  }

  // 补录单特殊逻辑
  if (type === 'historical') {
    params.status = 'closed';
    params.isHistorical = true;
    if (!completionTime) return { code: 400, message: '补录单必须填写完结时间' };
  } else {
    // 常规项目新建时，禁止选择「已结清」状态
    if (status === 'closed') {
      return { code: 400, message: '常规项目新建时，禁止选择「已结清」状态' };
    }
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
        supplier: c.supplier || '',
        amount: isNaN(parseFloat(c.amount)) ? 0 : parseFloat(c.amount),
        isSettled: c.isSettled || false
      }))
    })) : [];

    // 计算资金
    const financials = calculateFinancials(amount, received, costs, subProjectsData);
    
    const data = {
      ...params,
      receivedAmount: received,
      subProjects: subProjectsData,
      amountEditCount: 0, // 初始化修改次数为0
      ...financials,
      createdAt: now,
      createTime: db.serverDate(),
      updateTime: db.serverDate()
    };
    delete data.currentUser;

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
