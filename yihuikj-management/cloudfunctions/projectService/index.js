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
    }

    // 常规项目逻辑：创建成功后，项目类型和三大周期禁止编辑
    if (oldProject.type !== 'historical') {
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
        content: sp.content || '',
        startDate: sp.startDate || '',
        amount: isNaN(parseFloat(sp.amount)) ? 0 : parseFloat(sp.amount),
        costs: (sp.costs || []).map(c => ({
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

    // 状态变更自动记录时间节点及周期联动 (仅针对常规项目)
    if (status && status !== oldProject.status && oldProject.type !== 'historical') {
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
  const { name, type, period, client, role, staffCount, amount, receivedAmount, desc, costs, status, isHistorical, constructionPeriod, collectionPeriod, completionTime, isHasContract, isHasPreview, contractFileIds, previewFileIds, subProjects } = params;

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
      content: sp.content || '',
      startDate: sp.startDate || '',
      amount: isNaN(parseFloat(sp.amount)) ? 0 : parseFloat(sp.amount),
      costs: (sp.costs || []).map(c => ({
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
      createTime: db.serverDate(),
      updateTime: db.serverDate()
    };

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
