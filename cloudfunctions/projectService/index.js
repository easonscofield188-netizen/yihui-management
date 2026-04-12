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
function calculateFinancials(amount, receivedAmount, costs) {
  const totalAmount = parseFloat(amount) || 0;
  const received = parseFloat(receivedAmount) || 0;
  const unreceived = Math.max(0, totalAmount - received);
  
  let payable = 0;
  let paid = 0;
  
  if (costs && Array.isArray(costs)) {
    costs.forEach(cost => {
      const costAmount = parseFloat(cost.amount) || 0;
      payable += costAmount;
      if (cost.isSettled === true || cost.isSettled === '是') {
        paid += costAmount;
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
    const financials = calculateFinancials(project.amount, project.receivedAmount, project.costs);
    
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

        const financials = calculateFinancials(amount, receivedAmount, updatedCosts);
        
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
  const { id, name, type, period, client, role, staffCount, amount, receivedAmount, desc, costs, status, isHistorical, constructionPeriod, collectionPeriod, completionTime, negotiatingTime, constructingTime, completedTime, settlingTime, settledTime, isHasContract, isHasPreview } = params;

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

    const updateData = {
      updateTime: db.serverDate()
    };

    if (name) updateData.name = name;
    if (period) updateData.period = period;
    if (client) updateData.client = client;
    if (role) updateData.role = role;
    if (staffCount !== undefined) updateData.staffCount = staffCount;
    if (amount !== undefined) updateData.amount = amount;
    if (receivedAmount !== undefined) {
      if (receivedAmount > (amount || oldProject.amount)) {
        return { code: 400, message: '已收账款不可超过订单金额' };
      }
      updateData.receivedAmount = receivedAmount;
    }
    if (desc !== undefined) updateData.desc = desc;
    if (costs) updateData.costs = costs;
    if (status) updateData.status = status;
    
    // 历史数据相关字段
    if (isHistorical !== undefined) updateData.isHistorical = isHistorical;
    if (type) updateData.type = type;
    if (constructionPeriod !== undefined) updateData.constructionPeriod = constructionPeriod;
    if (collectionPeriod !== undefined) updateData.collectionPeriod = collectionPeriod;
    if (completionTime !== undefined) updateData.completionTime = completionTime;
    
    if (isHasContract !== undefined) updateData.isHasContract = isHasContract;
    if (isHasPreview !== undefined) updateData.isHasPreview = isHasPreview;

    // 时间节点显式更新
    if (negotiatingTime) updateData.negotiatingTime = negotiatingTime;
    if (constructingTime) updateData.constructingTime = constructingTime;
    if (completedTime) updateData.completedTime = completedTime;
    if (settlingTime) updateData.settlingTime = settlingTime;
    if (settledTime) updateData.settledTime = settledTime;

    // 状态变更自动记录时间节点及周期联动 (仅针对常规项目)
    if (status && status !== oldProject.status && oldProject.type !== 'historical') {
      const now = new Date().toISOString();
      const today = now.split('T')[0];
      
      if (status === 'negotiating' && !oldProject.negotiatingTime) {
        updateData.negotiatingTime = now;
      }
      if (status === 'constructing') {
        if (!oldProject.constructingTime) {
          updateData.constructingTime = now;
          updateData.constructionPeriod = [today, today];
        }
      }
      if (status === 'completed') {
        if (!oldProject.completedTime) {
          updateData.completedTime = now;
          // 锁定施工周期结束日期
          const conStart = (oldProject.constructionPeriod && oldProject.constructionPeriod[0]) ? oldProject.constructionPeriod[0] : today;
          updateData.constructionPeriod = [conStart, today];
        }
      }
      if (status === 'settling') {
        if (!oldProject.settlingTime) {
          updateData.settlingTime = now;
          updateData.collectionPeriod = [today, today];
        }
      }
      if (status === 'closed') {
        if (!oldProject.settledTime) {
          updateData.settledTime = now;
          // 锁定项目周期和回款周期结束日期
          const pStart = (oldProject.period && oldProject.period[0]) ? oldProject.period[0] : today;
          updateData.period = [pStart, today];
          
          const colStart = (oldProject.collectionPeriod && oldProject.collectionPeriod[0]) ? oldProject.collectionPeriod[0] : today;
          updateData.collectionPeriod = [colStart, today];
        }
      }
    }

    // 重新计算资金
    const finalAmount = amount !== undefined ? amount : oldProject.amount;
    const finalReceived = receivedAmount !== undefined ? receivedAmount : (oldProject.receivedAmount || 0);
    const finalCosts = costs || oldProject.costs || [];
    const financials = calculateFinancials(finalAmount, finalReceived, finalCosts);
    Object.assign(updateData, financials);

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
  const { name, type, period, client, role, staffCount, amount, receivedAmount, desc, costs, status, isHistorical, constructionPeriod, collectionPeriod, completionTime, isHasContract, isHasPreview, contractFileIds, previewFileIds } = params;

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
    
    // 计算资金
    const financials = calculateFinancials(amount, received, costs);
    
    const data = {
      ...params,
      receivedAmount: received,
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
