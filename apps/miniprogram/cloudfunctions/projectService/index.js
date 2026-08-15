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
const PROJECT_CHANGE_EVENT_COLLECTION = 'project_change_events';
const NOTIFICATION_COLLECTION = 'notifications';
const MINI_PROGRAM_STATES = new Set(['developer', 'trial', 'formal']);
async function getWechatSubscribeTemplateId() {
  try {
    const res = await db.collection('system_configs').where({ key: 'wechat_subscribe_template_id', isActive: true }).limit(1).get();
    if (res.data && res.data[0] && res.data[0].value) {
      return String(res.data[0].value).trim();
    }
  } catch (err) {
    console.error('获取订阅模板配置失败:', err);
  }
  return process.env.WECHAT_SUBSCRIBE_TEMPLATE_ID || 'AzJTLvxbpAoCM3IoQYfp5DsSKM4IjqCAwmsD1F_oXqA';
}
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const READ_ROLES = new Set(['ADMIN_SUPER', 'ADMIN_COM', 'ADMIN', 'PROJECT_MANAGER', 'FINANCE_MANAGER', 'VISITOR', 'user']);
const WRITE_ROLES = new Set(['ADMIN_SUPER', 'ADMIN_COM', 'ADMIN', 'PROJECT_MANAGER', 'FINANCE_MANAGER']);
const ADMIN_ROLES = new Set(['ADMIN_SUPER', 'ADMIN_COM', 'ADMIN']);
const PROJECT_STATUS = Object.freeze({
  COMPLETED: 'completed',
  CLOSED: 'closed',
  ARCHIVED: 'archived'
});
const PROJECT_STATUS_LABELS = Object.freeze({
  [PROJECT_STATUS.COMPLETED]: '已交付',
  [PROJECT_STATUS.CLOSED]: '已结清',
  [PROJECT_STATUS.ARCHIVED]: '已归档'
});
const YES_NO = Object.freeze({ YES: 'yes', NO: 'no' });
const YES_NO_DICTIONARY = Object.freeze({
  [YES_NO.YES]: { value: YES_NO.YES, label: '是' },
  [YES_NO.NO]: { value: YES_NO.NO, label: '否' }
});
const CREATION_CHANNEL = Object.freeze({
  MINIPROGRAM: 'mini_program',
  ADMIN_WEB: 'admin_web'
});
const CREATION_CHANNEL_DICTIONARY = Object.freeze({
  [CREATION_CHANNEL.MINIPROGRAM]: { value: CREATION_CHANNEL.MINIPROGRAM, label: '微信小程序' },
  [CREATION_CHANNEL.ADMIN_WEB]: { value: CREATION_CHANNEL.ADMIN_WEB, label: '后台管理系统' }
});
const COST_SETTLEMENT_DICTIONARY = Object.freeze({
  true: { value: true, label: '已支付' },
  false: { value: false, label: '待支付' }
});
const COST_CATEGORY_DICTIONARY = Object.freeze({
  real_plant: { value: 'real_plant', label: '真植物' },
  fake_plant: { value: 'fake_plant', label: '仿真植物' },
  labor: { value: 'labor', label: '人工费' },
  food: { value: 'food', label: '伙食费' },
  meal: { value: 'meal', label: '餐食' },
  logistics: { value: 'logistics', label: '物流运输' },
  material: { value: 'material', label: '材料费' },
  stone: { value: 'stone', label: '石材' },
  paving: { value: 'paving', label: '铺装' },
  other: { value: 'other', label: '其他' }
});
const COST_CATEGORY_VALUE_ALIASES = Object.freeze({
  '真植物': 'real_plant',
  '仿真植物': 'fake_plant',
  '人工': 'labor',
  '人工费': 'labor',
  '伙食': 'food',
  '伙食费': 'food',
  '餐食': 'meal',
  '物流': 'logistics',
  '物流运输': 'logistics',
  '材料': 'material',
  '材料费': 'material',
  '石材': 'stone',
  '铺装': 'paving',
  '其他': 'other',
  '其他成本': 'other'
});
const PROJECT_EVENT_TYPE = Object.freeze({
  CREATED: 'project_created',
  UPDATED: 'project_updated'
});
const PROJECT_EVENT_TYPE_DICTIONARY = Object.freeze({
  [PROJECT_EVENT_TYPE.CREATED]: { value: PROJECT_EVENT_TYPE.CREATED, label: '新建项目' },
  [PROJECT_EVENT_TYPE.UPDATED]: { value: PROJECT_EVENT_TYPE.UPDATED, label: '项目重要信息变更' }
});
const NOTIFICATION_READ_STATUS = Object.freeze({
  UNREAD: 'unread',
  READ: 'read'
});
const NOTIFICATION_DELIVERY_STATUS = Object.freeze({
  PENDING: 'pending',
  SENT: 'sent',
  FAILED: 'failed',
  SKIPPED: 'skipped'
});
const NOTIFICATION_DELIVERY_STATUS_DICTIONARY = Object.freeze({
  [NOTIFICATION_DELIVERY_STATUS.PENDING]: { value: NOTIFICATION_DELIVERY_STATUS.PENDING, label: '待发送' },
  [NOTIFICATION_DELIVERY_STATUS.SENT]: { value: NOTIFICATION_DELIVERY_STATUS.SENT, label: '发送成功' },
  [NOTIFICATION_DELIVERY_STATUS.FAILED]: { value: NOTIFICATION_DELIVERY_STATUS.FAILED, label: '发送失败' },
  [NOTIFICATION_DELIVERY_STATUS.SKIPPED]: { value: NOTIFICATION_DELIVERY_STATUS.SKIPPED, label: '未发送' }
});
const PROJECT_CHANGE_FIELD_DICTIONARY = Object.freeze({
  name: { label: '项目名称', valueType: 'text' },
  client: { label: '客户名称', valueType: 'text' },
  amount: { label: '订单金额', valueType: 'money' },
  receivedAmount: { label: '已收金额', valueType: 'money' },
  startDate: { label: '交付日期', valueType: 'date' },
  staffCount: { label: '人员数量', valueType: 'number' },
  status: { label: '项目状态', valueType: 'project_status' },
  desc: { label: '项目描述', valueType: 'text' }
});

function getProjectEventTypeLabel(value) {
  return PROJECT_EVENT_TYPE_DICTIONARY[value]?.label || value;
}

function auditValuesEqual(left, right, valueType) {
  if (valueType === 'money' || valueType === 'number') {
    return Number(left || 0) === Number(right || 0);
  }
  return String(left ?? '') === String(right ?? '');
}

function normalizeAuditValue(value, valueType) {
  if (valueType === 'money' || valueType === 'number') return Number(value || 0);
  return value == null ? '' : String(value);
}

function getProjectStatusAuditLabel(value) {
  const labels = {
    negotiating: '洽谈中',
    constructing: '施工中',
    completed: '已交付',
    settling: '结算中',
    closed: '已结清',
    archived: '已归档',
    in_cooperation: '合作中',
    terminated: '已终止'
  };
  return labels[value] || value || '未设置';
}

function buildSimpleProjectChanges(beforeProject, afterProject, isCreated = false) {
  return Object.entries(PROJECT_CHANGE_FIELD_DICTIONARY).reduce((changes, [field, meta]) => {
    const oldValue = isCreated ? null : beforeProject?.[field];
    const newValue = afterProject?.[field];
    if (!isCreated && auditValuesEqual(oldValue, newValue, meta.valueType)) return changes;
    if (isCreated && (newValue === undefined || newValue === null || newValue === '')) return changes;
    const normalizedOldValue = normalizeAuditValue(oldValue, meta.valueType);
    const normalizedNewValue = normalizeAuditValue(newValue, meta.valueType);
    changes.push({
      field,
      fieldLabel: meta.label,
      valueType: meta.valueType,
      changeType: isCreated ? 'created' : 'updated',
      oldValue: isCreated ? null : normalizedOldValue,
      newValue: normalizedNewValue,
      oldDisplayValue: meta.valueType === 'project_status'
        ? getProjectStatusAuditLabel(oldValue)
        : normalizedOldValue,
      newDisplayValue: meta.valueType === 'project_status'
        ? getProjectStatusAuditLabel(newValue)
        : normalizedNewValue
    });
    return changes;
  }, []);
}

function flattenProjectCosts(project) {
  const result = [];
  const appendCosts = (costs, scope, scopeLabel) => {
    (Array.isArray(costs) ? costs : []).forEach((cost, index) => {
      const key = String(cost.id || `${scope}-${index}`);
      const category = normalizeCostCategoryCode(cost);
      const supplier = normalizeSupplier(cost.supplier);
      result.push({
        key,
        scope,
        scopeLabel,
        category,
        categoryLabel: getCostCategoryLabel(cost, category),
        supplier,
        amount: Number(cost.amount || 0),
        isSettled: normalizeCostSettled(cost.isSettled)
      });
    });
  };
  appendCosts(project?.costs, 'project', '主项目');
  (Array.isArray(project?.subProjects) ? project.subProjects : []).forEach((subProject, index) => {
    const subProjectId = String(subProject.id || `sub-${index}`);
    appendCosts(subProject.costs, `sub_project:${subProjectId}`, subProject.content || `子项目${index + 1}`);
  });
  return result;
}

function normalizeCostCategoryCode(cost = {}) {
  const rawValue = String(cost.categoryCode || cost.category || 'other').trim();
  return COST_CATEGORY_VALUE_ALIASES[rawValue] || rawValue || 'other';
}

function getCostCategoryLabel(cost = {}, categoryCode = normalizeCostCategoryCode(cost)) {
  const explicitLabel = String(cost.categoryLabel || '').trim();
  if (explicitLabel) {
    const explicitCode = COST_CATEGORY_VALUE_ALIASES[explicitLabel] || explicitLabel;
    return COST_CATEGORY_DICTIONARY[explicitCode]?.label || explicitLabel;
  }
  const dictionaryItem = COST_CATEGORY_DICTIONARY[categoryCode];
  if (dictionaryItem) return dictionaryItem.label;
  const rawCategory = String(cost.category || '').trim();
  return COST_CATEGORY_VALUE_ALIASES[rawCategory] ? rawCategory : (rawCategory || categoryCode);
}

function normalizeCostCategory(cost = {}) {
  const categoryCode = normalizeCostCategoryCode(cost);
  const categoryLabel = getCostCategoryLabel(cost, categoryCode);
  return { categoryCode, categoryLabel };
}

function getCostAuditName(cost) {
  return `${cost.scopeLabel}-${cost.categoryLabel}-${cost.supplier}`;
}

function buildCostProjectChanges(beforeProject, afterProject, isCreated = false) {
  const beforeMap = new Map(flattenProjectCosts(beforeProject).map(item => [item.key, item]));
  const afterMap = new Map(flattenProjectCosts(afterProject).map(item => [item.key, item]));
  const keys = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  const changes = [];

  keys.forEach((key) => {
    const before = beforeMap.get(key);
    const after = afterMap.get(key);
    if (!before && after) {
      changes.push({
        field: `costs.${key}`,
        fieldLabel: `新增成本：${getCostAuditName(after)}`,
        valueType: 'cost_item',
        changeType: 'added',
        oldValue: null,
        newValue: after,
        oldDisplayValue: '无',
        newDisplayValue: `¥${after.amount.toFixed(2)} / ${after.isSettled ? '已支付' : '待支付'}`
      });
      return;
    }
    if (before && !after) {
      changes.push({
        field: `costs.${key}`,
        fieldLabel: `删除成本：${getCostAuditName(before)}`,
        valueType: 'cost_item',
        changeType: 'removed',
        oldValue: before,
        newValue: null,
        oldDisplayValue: `¥${before.amount.toFixed(2)} / ${before.isSettled ? '已支付' : '待支付'}`,
        newDisplayValue: '无'
      });
      return;
    }
    if (!before || !after) return;
    if (before.amount !== after.amount) {
      changes.push({
        field: `costs.${key}.amount`,
        fieldLabel: `${getCostAuditName(after)}金额`,
        valueType: 'money',
        changeType: 'updated',
        oldValue: before.amount,
        newValue: after.amount,
        oldDisplayValue: before.amount,
        newDisplayValue: after.amount
      });
    }
    if (before.isSettled !== after.isSettled) {
      changes.push({
        field: `costs.${key}.isSettled`,
        fieldLabel: `${getCostAuditName(after)}支付状态`,
        valueType: 'cost_settlement',
        changeType: 'updated',
        oldValue: before.isSettled,
        newValue: after.isSettled,
        oldDisplayValue: before.isSettled ? '已支付' : '待支付',
        newDisplayValue: after.isSettled ? '已支付' : '待支付'
      });
    }
    if (before.category !== after.category || before.supplier !== after.supplier) {
      changes.push({
        field: `costs.${key}.identity`,
        fieldLabel: '成本信息',
        valueType: 'text',
        changeType: 'updated',
        oldValue: getCostAuditName(before),
        newValue: getCostAuditName(after),
        oldDisplayValue: getCostAuditName(before),
        newDisplayValue: getCostAuditName(after)
      });
    }
  });

  if (isCreated && !changes.length && afterMap.size) {
    return buildCostProjectChanges({}, afterProject, false);
  }
  return changes;
}

function buildProjectChanges(beforeProject, afterProject, isCreated = false) {
  return [
    ...buildSimpleProjectChanges(beforeProject, afterProject, isCreated),
    ...buildCostProjectChanges(beforeProject, afterProject, isCreated)
  ];
}

function buildProjectEventSummary(eventType, projectName, changes) {
  if (eventType === PROJECT_EVENT_TYPE.CREATED) return `新建项目“${projectName || '未命名项目'}”`;
  const labels = Array.from(new Set(changes.map(item => item.fieldLabel))).slice(0, 3);
  const suffix = changes.length > labels.length ? `等${changes.length}项` : labels.join('、');
  return `修改项目“${projectName || '未命名项目'}”：${suffix || '项目信息'}`;
}

async function getActiveSuperAdmins() {
  const result = await db.collection('users').where({ role: ADMIN_SUPER_ROLE }).get();
  return (result.data || []).filter(user => !user.status || user.status === 'active');
}

function truncateSubscribeValue(value, maxLength = 20) {
  return Array.from(String(value || '').trim()).slice(0, maxLength).join('') || '未填写';
}

function formatSubscribeTime(timestamp) {
  const chinaTime = new Date(Number(timestamp || Date.now()) + 8 * 60 * 60 * 1000);
  return chinaTime.toISOString().slice(0, 16).replace('T', ' ');
}

function buildSubscribeChangeStatus(eventType, changes) {
  if (eventType === PROJECT_EVENT_TYPE.CREATED) return '项目已新建';
  const labels = Array.from(new Set((changes || []).map(item => item.fieldLabel).filter(Boolean)));
  if (!labels.length) return '项目信息已变更';
  const suffix = labels.length > 2 ? `等${labels.length}项` : labels.slice(0, 2).join('、');
  return truncateSubscribeValue(`${suffix}变更`);
}

async function updateNotificationDelivery(notificationId, status, extraData = {}) {
  await db.collection(NOTIFICATION_COLLECTION).doc(notificationId).update({
    data: {
      deliveryStatus: status,
      deliveryStatusLabel: NOTIFICATION_DELIVERY_STATUS_DICTIONARY[status].label,
      deliveryUpdatedTimestamp: Date.now(),
      deliveryUpdatedAt: db.serverDate(),
      ...extraData
    }
  });
}

function normalizeMiniProgramState(value) {
  const state = String(value || '').trim().toLowerCase();
  return MINI_PROGRAM_STATES.has(state) ? state : 'formal';
}

async function deliverWechatSubscription({ recipient, notificationId, eventData, changes, now, miniProgramState }) {
  const availableCount = Math.max(0, Number(recipient.wechatSubscriptionAvailableCount) || 0);
  if (!recipient.wechatOpenId || availableCount < 1) {
    await updateNotificationDelivery(notificationId, NOTIFICATION_DELIVERY_STATUS.SKIPPED, {
      deliveryReason: recipient.wechatOpenId ? 'no_available_subscription' : 'wechat_not_bound',
      deliveryReasonLabel: recipient.wechatOpenId ? '没有可用订阅次数' : '未绑定微信账号'
    });
    return;
  }

  const wechatTemplateId = await getWechatSubscribeTemplateId();
  try {
    const sendResult = await cloud.openapi.subscribeMessage.send({
      touser: recipient.wechatOpenId,
      templateId: wechatTemplateId,
      page: `pages/notification-detail/index?id=${notificationId}&source=wechat_subscribe`,
      miniprogramState: normalizeMiniProgramState(miniProgramState),
      lang: 'zh_CN',
      data: {
        thing1: { value: truncateSubscribeValue(eventData.projectName) },
        thing2: { value: buildSubscribeChangeStatus(eventData.eventType, changes) },
        time3: { value: formatSubscribeTime(now) },
        thing4: { value: truncateSubscribeValue(`${eventData.actorName}操作，请查看详情`) }
      }
    });
    await Promise.all([
      updateNotificationDelivery(notificationId, NOTIFICATION_DELIVERY_STATUS.SENT, {
        deliveryReason: '',
        deliveryReasonLabel: '',
        wechatTemplateId,
        wechatMessageResult: sendResult || {},
        deliveredTimestamp: Date.now(),
        deliveredAt: db.serverDate()
      }),
      db.collection('users').doc(recipient._id).update({
        data: {
          wechatSubscriptionAvailableCount: db.command.inc(-1),
          wechatSubscriptionLastSentTimestamp: Date.now(),
          wechatSubscriptionLastSentAt: db.serverDate(),
          updateTime: db.serverDate()
        }
      })
    ]);
  } catch (error) {
    const errorCode = Number(error.errCode || error.errcode || 0);
    const errorMessage = String(error.errMsg || error.message || 'unknown').slice(0, 240);
    const subscriptionExpired = errorCode === 43101 || /43101|user\s+refuse|未订阅|拒绝接收/i.test(errorMessage);
    await Promise.all([
      updateNotificationDelivery(notificationId, NOTIFICATION_DELIVERY_STATUS.FAILED, {
        deliveryReason: subscriptionExpired ? 'subscription_expired' : 'wechat_send_failed',
        deliveryReasonLabel: subscriptionExpired ? '微信订阅次数已失效，系统已自动清零' : '微信订阅消息发送失败',
        wechatTemplateId,
        deliveryErrorCode: errorCode,
        deliveryErrorMessage: errorMessage
      }),
      subscriptionExpired
        ? db.collection('users').doc(recipient._id).update({
          data: {
            wechatSubscriptionAvailableCount: 0,
            wechatSubscriptionInvalidTimestamp: Date.now(),
            updateTime: db.serverDate()
          }
        })
        : Promise.resolve()
    ]);
    console.error('微信订阅消息发送失败:', { notificationId, errorCode, message: error.message || error.errMsg });
  }
}

async function recordProjectChangeEvent({ eventType, projectId, beforeProject, afterProject, actor, source, miniProgramState }) {
  try {
    const isCreated = eventType === PROJECT_EVENT_TYPE.CREATED;
    const changes = buildProjectChanges(beforeProject, afterProject, isCreated);
    if (!isCreated && !changes.length) return null;
    const now = Date.now();
    const projectName = afterProject?.name || beforeProject?.name || '';
    const eventTypeLabel = getProjectEventTypeLabel(eventType);
    const summary = buildProjectEventSummary(eventType, projectName, changes);
    const eventData = {
      eventType,
      eventTypeLabel,
      projectId,
      projectName,
      actorUserId: actor?.id || actor?._id || '',
      actorName: actor?.nickname || actor?.username || '未知用户',
      actorUsername: actor?.username || '',
      actorRole: actor?.role || 'user',
      actorRoleLabel: actor?.roleName || actor?.role || '普通用户',
      source,
      sourceLabel: getCreationChannelLabel(source),
      summary,
      changes,
      changeCount: changes.length,
      createdTimestamp: now,
      createdAt: db.serverDate()
    };
    const eventResult = await db.collection(PROJECT_CHANGE_EVENT_COLLECTION).add({ data: eventData });

    if (actor?.role !== ADMIN_SUPER_ROLE) {
      const recipients = await getActiveSuperAdmins();
      const targetMiniProgramState = normalizeMiniProgramState(miniProgramState);
      await Promise.all(recipients.map(async (recipient) => {
        const notificationResult = await db.collection(NOTIFICATION_COLLECTION).add({
          data: {
          recipientUserId: recipient._id,
          eventId: eventResult._id,
          category: 'project_change',
          categoryLabel: '项目变更',
          eventType,
          eventTypeLabel,
          projectId,
          projectName,
          actorUserId: eventData.actorUserId,
          actorName: eventData.actorName,
          actorRole: eventData.actorRole,
          actorRoleLabel: eventData.actorRoleLabel,
          summary,
          readStatus: NOTIFICATION_READ_STATUS.UNREAD,
          readStatusLabel: '未读',
          deliveryStatus: NOTIFICATION_DELIVERY_STATUS.PENDING,
          deliveryStatusLabel: NOTIFICATION_DELIVERY_STATUS_DICTIONARY[NOTIFICATION_DELIVERY_STATUS.PENDING].label,
          targetMiniProgramState,
          createdTimestamp: now,
          createdAt: db.serverDate()
          }
        });
        await deliverWechatSubscription({
          recipient,
          notificationId: notificationResult._id,
          eventData,
          changes,
          now,
          miniProgramState: targetMiniProgramState
        });
      }));
    }
    return eventResult._id;
  } catch (error) {
    // 审计记录异常暂不阻断项目主流程；错误会保留在云函数日志中供排查。
    console.error('记录项目变更事件失败:', error);
    return null;
  }
}

function getDictionaryValue(value, dictionary, defaultValue) {
  if (Object.prototype.hasOwnProperty.call(dictionary, value)) return value;
  return defaultValue;
}

function normalizeYesNo(value, defaultValue = YES_NO.NO) {
  return getDictionaryValue(value, YES_NO_DICTIONARY, defaultValue);
}

function getYesNoLabel(value) {
  return YES_NO_DICTIONARY[normalizeYesNo(value)].label;
}

function normalizeCreationChannel(value) {
  return getDictionaryValue(value, CREATION_CHANNEL_DICTIONARY, CREATION_CHANNEL.ADMIN_WEB);
}

function getCreationChannelLabel(value) {
  return CREATION_CHANNEL_DICTIONARY[normalizeCreationChannel(value)].label;
}

function normalizeCostSettled(value, defaultValue = true) {
  return typeof value === 'boolean' ? value : defaultValue;
}

function getCostSettledLabel(value, defaultValue = true) {
  return COST_SETTLEMENT_DICTIONARY[String(normalizeCostSettled(value, defaultValue))].label;
}

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
        return await createProject({
          ...data,
          currentUser: auth.user,
          requestSource: event.body ? CREATION_CHANNEL.ADMIN_WEB : CREATION_CHANNEL.MINIPROGRAM
        });
      case 'list':
        return await listProjects(data);
      case 'listIds':
        if (auth.user.role !== ADMIN_SUPER_ROLE) return forbidden();
        return await listProjectIds(data);
      case 'financialList':
        return await listFinancialProjects(data);
      case 'overview':
      case 'getOverview':
        return await getOverview(data);
      case 'get':
        return await getProject(data);
      case 'update':
        if (!WRITE_ROLES.has(auth.user.role)) return forbidden();
        return await updateProject({
          ...data,
          currentUser: auth.user,
          requestSource: event.body ? CREATION_CHANNEL.ADMIN_WEB : CREATION_CHANNEL.MINIPROGRAM
        });
      case 'quickRecord':
        if (!WRITE_ROLES.has(auth.user.role)) return forbidden();
        return await quickRecord(data, auth.user);
      case 'delete':
      case 'deleteBatch':
        if (auth.user.role !== ADMIN_SUPER_ROLE) return forbidden();
        return await deleteProjects(data, auth.user);
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
    if (session && session._id) {
      db.collection(SESSION_COLLECTION).doc(session._id).remove().catch(() => {});
    }
    return { error: { code: 401, message: '登录状态已失效，请重新登录' } };
  }
  const now = Date.now();
  const lastActiveAt = Number(session.lastActiveAt || 0);
  if (!lastActiveAt || now - lastActiveAt >= SESSION_TOUCH_INTERVAL_MS) {
    db.collection(SESSION_COLLECTION).doc(session._id).update({
      data: {
        lastActiveAt: now,
        expiresAt: now + SESSION_TTL_MS,
        updateTime: db.serverDate()
      }
    }).catch(() => {});
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
      if (normalizeCostSettled(cost.isSettled)) {
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
          if (normalizeCostSettled(cost.isSettled)) {
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
  const raw = String(dateValue.$date || dateValue).trim();
  const matched = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!matched) return true;
  const normalized = `${matched[1]}-${matched[2]}-${matched[3]}`;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return true;
  return normalized > getServerDateOnly();
}

function getAllowedStatusesByType(type, isHistorical) {
  if (type === 'long_term') {
    return ['in_cooperation', 'terminated'];
  }
  if (type === 'historical' || isHistorical) {
    return ['closed'];
  }
  return ['negotiating', 'constructing', 'completed', 'settling', 'closed', 'archived'];
}

function areAllCostsSettled(costs, subProjects) {
  const projectCosts = Array.isArray(costs) ? costs : [];
  const childCosts = (Array.isArray(subProjects) ? subProjects : [])
    .flatMap(item => Array.isArray(item.costs) ? item.costs : []);
  return [...projectCosts, ...childCosts].every(cost => normalizeCostSettled(cost.isSettled));
}

function deriveNormalProjectStatus(amount, receivedAmount, costs, subProjects) {
  const amountCents = moneyToCents(amount);
  const receivedCents = moneyToCents(receivedAmount);
  if (amountCents <= 0 || receivedCents < amountCents) return PROJECT_STATUS.COMPLETED;
  return areAllCostsSettled(costs, subProjects) ? PROJECT_STATUS.ARCHIVED : PROJECT_STATUS.CLOSED;
}

function buildNormalProjectLifecycle(project, now = new Date().toISOString()) {
  const status = deriveNormalProjectStatus(
    project.amount,
    project.receivedAmount,
    project.costs,
    project.subProjects
  );
  const isFullyReceived = status !== PROJECT_STATUS.COMPLETED;
  const isArchived = status === PROJECT_STATUS.ARCHIVED;
  return {
    status,
    statusLabel: PROJECT_STATUS_LABELS[status],
    settledTime: isFullyReceived ? (project.settledTime || now) : null,
    archivedTime: isArchived ? (project.archivedTime || now) : null
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
    const lifecycle = project.type === 'normal' && !project.isHistorical
      ? buildNormalProjectLifecycle(project)
      : {};
    
    await db.collection('projects').doc(projectId).update({
      data: {
        ...financials,
        ...lifecycle,
        updateTime: db.serverDate()
      }
    });
    
    return { code: 0, message: '同步成功', data: { ...financials, ...lifecycle } };
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

function normalizeProjectDeleteIds(params = {}) {
  const values = Array.isArray(params.ids) ? params.ids : [params.id];
  return Array.from(new Set(values
    .map(value => String(value || '').trim().slice(0, 80))
    .filter(Boolean)));
}

function collectCloudFileIds(value, target = new Set(), visited = new Set()) {
  if (typeof value === 'string') {
    if (value.startsWith('cloud://')) target.add(value);
    return target;
  }
  if (!value || typeof value !== 'object' || visited.has(value)) return target;
  visited.add(value);
  if (Array.isArray(value)) {
    value.forEach(item => collectCloudFileIds(item, target, visited));
    return target;
  }
  Object.keys(value).forEach(key => collectCloudFileIds(value[key], target, visited));
  return target;
}

function isMissingProjectFileError(item) {
  const message = String(item && (item.errMsg || item.message) || '');
  return /not\s*(exist|found)|不存在/i.test(message);
}

async function deleteProjectCloudFiles(fileIds) {
  const uniqueIds = Array.from(new Set(fileIds || []));
  const batchSize = 50;
  for (let index = 0; index < uniqueIds.length; index += batchSize) {
    const batch = uniqueIds.slice(index, index + batchSize);
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const result = await cloud.deleteFile({ fileList: batch });
        const failed = (result.fileList || [])
          .filter(item => Number(item.status) !== 0 && !isMissingProjectFileError(item));
        if (failed.length) throw new Error(`有 ${failed.length} 个项目文件清理失败`);
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

async function getRecordsByValues(collectionName, field, values) {
  const records = [];
  const batchSize = 20;
  const pageSize = 1000;
  const _ = db.command;
  for (let index = 0; index < values.length; index += batchSize) {
    const batch = values.slice(index, index + batchSize);
    let offset = 0;
    while (true) {
      const result = await db.collection(collectionName)
        .where({ [field]: _.in(batch) })
        .skip(offset)
        .limit(pageSize)
        .get();
      const page = result.data || [];
      records.push(...page);
      if (page.length < pageSize) break;
      offset += pageSize;
    }
  }
  return records;
}

async function removeRecords(collectionName, records) {
  const ids = Array.from(new Set((records || []).map(item => item && item._id).filter(Boolean)));
  const batchSize = 20;
  for (let index = 0; index < ids.length; index += batchSize) {
    const batch = ids.slice(index, index + batchSize);
    await Promise.all(batch.map(id => db.collection(collectionName).doc(id).remove()));
  }
  return ids.length;
}

async function deleteProjects(params, currentUser) {
  const ids = normalizeProjectDeleteIds(params);
  if (!ids.length) return { code: 400, message: '请选择要删除的项目' };
  if (ids.length > 1000) return { code: 400, message: '单次最多删除 1000 个项目' };

  try {
    const projects = await getRecordsByValues('projects', '_id', ids);
    if (!projects.length) return { code: 404, message: '所选项目不存在或已删除' };
    const projectIds = projects.map(item => item._id);
    const relatedCollectionNames = [
      'project_vouchers',
      'project_contracts',
      'project_previews',
      'project_cases',
      'project_quotations',
      PROJECT_CHANGE_EVENT_COLLECTION,
      NOTIFICATION_COLLECTION
    ];
    const relatedEntries = await Promise.all(relatedCollectionNames.map(async collectionName => ({
      collectionName,
      records: await getRecordsByValues(collectionName, 'projectId', projectIds)
    })));

    const fileIds = new Set();
    projects.forEach(project => collectCloudFileIds(project, fileIds));
    relatedEntries.forEach(entry => entry.records.forEach(record => collectCloudFileIds(record, fileIds)));

    // 云文件先清理；如失败则保留数据库记录，管理员可直接重试删除。
    const deletedFiles = await deleteProjectCloudFiles(Array.from(fileIds));
    const deletedRelated = {};
    for (const entry of relatedEntries) {
      deletedRelated[entry.collectionName] = await removeRecords(entry.collectionName, entry.records);
    }
    const deletedProjects = await removeRecords('projects', projects);

    console.log('超级管理员批量删除项目完成', {
      operatorId: currentUser.id,
      projectIds,
      deletedProjects,
      deletedFiles,
      deletedRelated
    });
    return {
      code: 0,
      message: '项目删除成功',
      data: { deletedProjects, deletedFiles, deletedRelated }
    };
  } catch (err) {
    console.error('批量删除项目失败:', err);
    return { code: 500, message: `删除失败：${err.message || '未知错误'}`, error: err.message };
  }
}

async function applyCanonicalClientSnapshot(params = {}) {
  const clientId = String(params.clientId || '').trim().slice(0, 80);
  if (!clientId) return { params };
  try {
    const client = (await db.collection('clients').doc(clientId).get()).data;
    if (!client || client.status === 'deleted' || client.status === 'deleting') {
      return { error: { code: 409, message: '所选客户不存在或已删除，请重新选择客户' } };
    }
    const roleCode = String(client.roleCode || client.role || '').trim();
    const source = String(client.source || '').trim();
    if (!client.name || !roleCode || !source) {
      return { error: { code: 409, message: '所选客户信息不完整，请先在客户管理中完善' } };
    }
    return {
      params: {
        ...params,
        clientId,
        client: String(client.name).trim(),
        role: roleCode,
        clientRole: roleCode,
        clientSource: source,
        source,
        clientSnapshotVersion: Math.max(1, Number(client.version) || 1)
      },
      client
    };
  } catch (error) {
    return { error: { code: 409, message: '所选客户不存在或无法读取，请重新选择客户' } };
  }
}

async function updateProject(params) {
  const canonical = await applyCanonicalClientSnapshot(params);
  if (canonical.error) return canonical.error;
  params = canonical.params;
  const { id, name, type, period, client, clientId, role, scene, staffCount, amount, receivedAmount, desc, costs, status, isHistorical, constructionPeriod, collectionPeriod, completionTime, startDate, negotiatingTime, constructingTime, completedTime, settlingTime, settledTime, isHasContract, isHasPreview, isHasVoucher, clientSource, subProjects } = params;

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
      const incomingFields = Object.keys(params).filter(key => (
        params[key] !== undefined
        && !['id', 'authToken', 'currentUser', 'requestSource', '_miniProgramState'].includes(key)
      ));
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
    const shouldAutoStatus = nextType === 'normal' && !nextIsHistorical;
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

    if ([PROJECT_STATUS.CLOSED, PROJECT_STATUS.ARCHIVED].includes(oldProject.status) && oldProject.type !== 'historical') {
      const allowedFields = [
        'name',
        'desc',
        'costs',
        'vouchers',
        'isHasVoucher',
        'receivedAmount',
        'status',
        'startDate',
        'completionTime',
        'negotiatingTime',
        'constructingTime',
        'completedTime',
        'settlingTime',
        'settledTime',
        'archivedTime'
      ];
      const incomingFields = Object.keys(params).filter(key => (
        params[key] !== undefined
        && !['id', 'authToken', 'currentUser', 'requestSource', '_miniProgramState'].includes(key)
      ));
      
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
          message: '已结清或已归档项目仅可编辑：项目名称、项目描述、成本支出、凭证上传及已收账款',
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
    if (params.clientSnapshotVersion !== undefined) updateDataFinal.clientSnapshotVersion = params.clientSnapshotVersion;
    if (role) updateDataFinal.role = role;
    if (params.clientRole !== undefined) updateDataFinal.clientRole = params.clientRole;
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
    if (clientSource !== undefined) {
      updateDataFinal.clientSource = clientSource;
      updateDataFinal.source = clientSource;
    }
    
    if (costs && Array.isArray(costs)) {
      // 清洗成本数据，确保没有 NaN 或 undefined
      updateDataFinal.costs = costs.map((item, index) => {
        const category = normalizeCostCategory(item);
        const oldCost = oldProject.costs?.[index];
        return {
          id: item.id || oldCost?.id || (oldCost ? '' : `cost-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`),
          category: category.categoryLabel,
          categoryCode: category.categoryCode,
          categoryLabel: category.categoryLabel,
          supplier: normalizeSupplier(item.supplier),
          amount: isNaN(parseFloat(item.amount)) ? 0 : parseFloat(item.amount),
          isSettled: normalizeCostSettled(item.isSettled),
          isSettledLabel: getCostSettledLabel(item.isSettled)
        };
      });
    }
    
    if (status && !shouldAutoStatus) updateDataFinal.status = status;
    
    if (subProjects && Array.isArray(subProjects)) {
      updateDataFinal.subProjects = subProjects.map(sp => ({
        id: sp.id || Date.now() + Math.random(),
        content: sp.content || '',
        startDate: sp.startDate || '',
        amount: isNaN(parseFloat(sp.amount)) ? 0 : parseFloat(sp.amount),
        isHasVoucher: normalizeYesNo(sp.isHasVoucher),
        isHasVoucherLabel: getYesNoLabel(sp.isHasVoucher),
        vouchers: sp.vouchers || [],
        costs: (sp.costs || []).map(c => {
          const category = normalizeCostCategory(c);
          return {
            id: c.id || Date.now() + Math.random(),
            category: category.categoryLabel,
            categoryCode: category.categoryCode,
            categoryLabel: category.categoryLabel,
            supplier: normalizeSupplier(c.supplier),
            amount: isNaN(parseFloat(c.amount)) ? 0 : parseFloat(c.amount),
            isSettled: normalizeCostSettled(c.isSettled, false),
            isSettledLabel: getCostSettledLabel(c.isSettled, false)
          };
        })
      }));
    }
    
    // 历史数据相关字段
    if (isHistorical !== undefined) updateDataFinal.isHistorical = isHistorical;
    if (type) updateDataFinal.type = type;
    if (constructionPeriod !== undefined) updateDataFinal.constructionPeriod = constructionPeriod;
    if (collectionPeriod !== undefined) updateDataFinal.collectionPeriod = collectionPeriod;
    if (completionTime !== undefined) updateDataFinal.completionTime = completionTime;

    // 允许编辑交付日期：同步 startDate / completionTime，常规项目同步 period 便于列表年份筛选
    if (startDate !== undefined && startDate !== null && startDate !== '') {
      const normalizedStartDate = String(startDate).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedStartDate)) {
        return { code: 400, message: '交付日期格式不正确' };
      }
      if (isFutureDateValue(normalizedStartDate)) {
        return { code: 400, message: '交付日期不能晚于当前日期' };
      }
      updateDataFinal.startDate = normalizedStartDate;
      updateDataFinal.completionTime = normalizedStartDate;
      if (oldProject.type !== 'long_term') {
        updateDataFinal.period = [normalizedStartDate, normalizedStartDate];
      }
    }

    if (isHasContract !== undefined) {
      updateDataFinal.isHasContract = normalizeYesNo(isHasContract);
      updateDataFinal.isHasContractLabel = getYesNoLabel(isHasContract);
    }
    if (isHasPreview !== undefined) {
      updateDataFinal.isHasPreview = normalizeYesNo(isHasPreview);
      updateDataFinal.isHasPreviewLabel = getYesNoLabel(isHasPreview);
    }
    if (isHasVoucher !== undefined) {
      updateDataFinal.isHasVoucher = normalizeYesNo(isHasVoucher);
      updateDataFinal.isHasVoucherLabel = getYesNoLabel(isHasVoucher);
    }

    // 时间节点显式更新
    if (negotiatingTime) updateDataFinal.negotiatingTime = negotiatingTime;
    if (constructingTime) updateDataFinal.constructingTime = constructingTime;
    if (completedTime) updateDataFinal.completedTime = completedTime;
    if (settlingTime && !shouldAutoStatus) updateDataFinal.settlingTime = settlingTime;
    if (settledTime && !shouldAutoStatus) updateDataFinal.settledTime = settledTime;

    // 长期项目状态切换时，项目周期结束日期立即联动到当天
    if (status && status !== oldProject.status && oldProject.type === 'long_term') {
      const today = new Date().toISOString().split('T')[0];
      const periodStart = (oldProject.period && oldProject.period[0]) || today;
      updateDataFinal.period = [periodStart, today];
    }

    // 状态变更自动记录时间节点及周期联动 (仅针对常规项目)
    if (status && !shouldAutoStatus && status !== oldProject.status && oldProject.type !== 'historical' && oldProject.type !== 'long_term') {
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
    if (shouldAutoStatus) {
      Object.assign(updateDataFinal, buildNormalProjectLifecycle({
        ...oldProject,
        ...updateDataFinal,
        amount: finalAmount,
        receivedAmount: finalReceived,
        costs: finalCosts,
        subProjects: finalSubProjects
      }));
    }

    // 联动删除逻辑：如果从“是”改为“否”，清理云端文件
    if (normalizeYesNo(oldProject.isHasContract) === YES_NO.YES && normalizeYesNo(isHasContract) === YES_NO.NO) {
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
    if (normalizeYesNo(oldProject.isHasPreview) === YES_NO.YES && normalizeYesNo(isHasPreview) === YES_NO.NO) {
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

    await recordProjectChangeEvent({
      eventType: PROJECT_EVENT_TYPE.UPDATED,
      projectId: id,
      beforeProject: oldProject,
      afterProject: { ...oldProject, ...updateDataFinal },
      actor: params.currentUser,
      source: normalizeCreationChannel(params.requestSource),
      miniProgramState: params._miniProgramState
    });

    return { code: 0, message: '更新成功' };
  } catch (err) {
    console.error('更新项目失败:', err);
    return { code: 500, message: `更新失败: ${err.message || '未知错误'}`, error: err.message };
  }
}

async function createProject(params) {
  if (!String(params.clientId || '').trim()) {
    return { code: 400, message: '请选择已有客户，或先新增客户后再创建项目' };
  }
  const canonical = await applyCanonicalClientSnapshot(params);
  if (canonical.error) return canonical.error;
  params = canonical.params;
  const { name, type, startDate, period, client, role, staffCount, amount, receivedAmount, desc, costs, isHistorical, constructionPeriod, collectionPeriod, completionTime, isHasContract, isHasPreview, contractFileIds, previewFileIds, subProjects, currentUser } = params;
  // 创建渠道只在首次创建时写入，避免后续编辑篡改项目来源。
  // 未传该字段的旧管理端调用按“后台管理系统”处理，兼容既有入口。
  const creationChannel = normalizeCreationChannel(params.creationChannel);

  // 1. 基础完整性校验
  if (!name || !client || !role || staffCount === undefined || !amount || !desc || !costs) {
    return { code: 400, message: '缺少必需的项目信息，请确保所有字段均已填写' };
  }

  if (type !== 'normal') {
    return { code: 400, message: '新建项目仅支持常规类型' };
  }

  // 合同/预览图校验
  if (normalizeYesNo(isHasContract) === YES_NO.YES) {
    if (!contractFileIds || !Array.isArray(contractFileIds) || contractFileIds.length === 0) {
      return { code: 400, message: '请上传合同文件后再创建项目' };
    }
  }
  if (normalizeYesNo(isHasPreview) === YES_NO.YES) {
    if (!previewFileIds || !Array.isArray(previewFileIds) || previewFileIds.length === 0) {
      return { code: 400, message: '请上传预览图后再创建项目' };
    }
  }

  // 2. 安全校验
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
      ? costs.map((cost, index) => {
        const category = normalizeCostCategory(cost);
        return {
          ...cost,
          id: cost.id || `cost-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
          category: category.categoryLabel,
          categoryCode: category.categoryCode,
          categoryLabel: category.categoryLabel,
          supplier: normalizeSupplier(cost.supplier),
          isSettled: normalizeCostSettled(cost.isSettled),
          isSettledLabel: getCostSettledLabel(cost.isSettled)
        };
      })
      : [];
    
    const subProjectsData = (subProjects && Array.isArray(subProjects)) ? subProjects.map(sp => ({
      id: sp.id || Date.now() + Math.random(),
      content: sp.content || '',
      startDate: sp.startDate || '',
      amount: isNaN(parseFloat(sp.amount)) ? 0 : parseFloat(sp.amount),
      isHasVoucher: normalizeYesNo(sp.isHasVoucher),
      isHasVoucherLabel: getYesNoLabel(sp.isHasVoucher),
      vouchers: sp.vouchers || [],
      costs: (sp.costs || []).map(c => {
        const category = normalizeCostCategory(c);
        return {
          id: c.id || Date.now() + Math.random(),
          category: category.categoryLabel,
          categoryCode: category.categoryCode,
          categoryLabel: category.categoryLabel,
          supplier: normalizeSupplier(c.supplier),
          amount: isNaN(parseFloat(c.amount)) ? 0 : parseFloat(c.amount),
          isSettled: normalizeCostSettled(c.isSettled, false),
          isSettledLabel: getCostSettledLabel(c.isSettled, false)
        };
      })
    })) : [];

    // 计算资金
    const financials = calculateFinancials(amount, received, costsData, subProjectsData);
    
    const data = {
      ...params,
      creationChannel,
      creationChannelLabel: getCreationChannelLabel(creationChannel),
      isHasContract: normalizeYesNo(isHasContract),
      isHasContractLabel: getYesNoLabel(isHasContract),
      isHasPreview: normalizeYesNo(isHasPreview),
      isHasPreviewLabel: getYesNoLabel(isHasPreview),
      isHasVoucher: normalizeYesNo(params.isHasVoucher),
      isHasVoucherLabel: getYesNoLabel(params.isHasVoucher),
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
    delete data.requestSource;
    delete data._miniProgramState;
    // 常规项目状态完全由收款和成本结算情况决定；交付时间使用用户填写的交付日期。
    data.completedTime = String(startDate).slice(0, 10);
    Object.assign(data, buildNormalProjectLifecycle({
      ...data,
      settledTime: null,
      archivedTime: null
    }, now));

    const res = await db.collection('projects').add({
      data
    });

    if (params.clientId) {
      const latestClient = (await db.collection('clients').doc(params.clientId).get()).data;
      if (!latestClient || latestClient.status === 'deleted' || latestClient.status === 'deleting') {
        await db.collection('projects').doc(res._id).remove();
        return { code: 409, message: '所选客户已被删除，请重新选择客户后再创建项目' };
      }
      const latestRole = String(latestClient.roleCode || latestClient.role || '').trim();
      const latestSource = String(latestClient.source || '').trim();
      const latestVersion = Math.max(1, Number(latestClient.version) || 1);
      if (
        data.client !== latestClient.name
        || data.role !== latestRole
        || data.clientSource !== latestSource
        || Number(data.clientSnapshotVersion || 1) !== latestVersion
      ) {
        Object.assign(data, {
          client: latestClient.name,
          role: latestRole,
          clientRole: latestRole,
          clientSource: latestSource,
          source: latestSource,
          clientSnapshotVersion: latestVersion
        });
        await db.collection('projects').doc(res._id).update({
          data: {
            client: data.client,
            role: data.role,
            clientRole: data.clientRole,
            clientSource: data.clientSource,
            source: data.source,
            clientSnapshotVersion: latestVersion,
            updateTime: db.serverDate()
          }
        });
      }
    }

    await recordProjectChangeEvent({
      eventType: PROJECT_EVENT_TYPE.CREATED,
      projectId: res._id,
      beforeProject: null,
      afterProject: data,
      actor: currentUser,
      source: normalizeCreationChannel(params.requestSource || creationChannel),
      miniProgramState: params._miniProgramState
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
          isSettled: normalizeCostSettled(isSettled),
          isSettledLabel: getCostSettledLabel(isSettled)
        }];
        Object.assign(updateData, calculateFinancials(
          project.amount,
          project.receivedAmount,
          updateData.costs,
          project.subProjects
        ));
      }

      if (project.type === 'normal' && !project.isHistorical) {
        Object.assign(updateData, buildNormalProjectLifecycle({
          ...project,
          ...updateData,
          costs: updateData.costs || project.costs || [],
          subProjects: project.subProjects || []
        }));
      }

      await projectRef.update({ data: updateData });
      return {
        duplicated: false,
        beforeProject: project,
        afterProject: { ...project, ...updateData }
      };
    });

    if (!transactionResult.duplicated) {
      await recordProjectChangeEvent({
        eventType: PROJECT_EVENT_TYPE.UPDATED,
        projectId,
        beforeProject: transactionResult.beforeProject,
        afterProject: transactionResult.afterProject,
        actor: currentUser,
        source: CREATION_CHANNEL.MINIPROGRAM,
        miniProgramState: params._miniProgramState
      });
    }

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
    status = '',
    year
  } = params || {};
  const allowedStatuses = new Set([
    'negotiating',
    'constructing',
    'completed',
    'settling',
    'closed',
    'archived',
    'in_cooperation',
    'terminated'
  ]);
  const normalizedStatus = String(status || '').trim();
  const normalizedKeyword = String(keyword || '').trim().slice(0, 50);
  const normalizedYear = Number(year);
  const hasYear = Number.isInteger(normalizedYear) && normalizedYear >= 2000 && normalizedYear <= 2100;
  if (normalizedStatus && !allowedStatuses.has(normalizedStatus)) {
    return { code: 400, message: '项目状态筛选值无效' };
  }

  const usePagination = page !== undefined || pageSize !== undefined || normalizedKeyword || normalizedStatus || hasYear;
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
    // 按「交付日期」年份筛选（与列表展示字段一致：startDate / completionTime / period[1]）
    if (hasYear) {
      const yearPrefix = db.RegExp({
        regexp: `^${normalizedYear}-`,
        options: 'i'
      });
      const dateStart = new Date(`${normalizedYear}-01-01T00:00:00.000+08:00`);
      const dateEnd = new Date(`${normalizedYear}-12-31T23:59:59.999+08:00`);
      conditions.push(_.or([
        { startDate: yearPrefix },
        {
          startDate: _.and(
            _.gte(`${normalizedYear}-01-01`),
            _.lte(`${normalizedYear}-12-31`)
          )
        },
        {
          completionTime: _.and(_.gte(dateStart), _.lte(dateEnd))
        },
        { 'period.1': yearPrefix },
        { 'period.0': yearPrefix }
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

async function listProjectIds(params = {}) {
  try {
    const ids = [];
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      const result = await listProjects({ ...params, page, pageSize: 50 });
      if (!result || result.code !== 0) return result;
      const data = result.data || {};
      ids.push(...(data.list || []).map(item => item._id).filter(Boolean));
      hasMore = Boolean(data.hasMore);
      page += 1;
    }
    return {
      code: 0,
      message: '查询成功',
      data: { ids, total: ids.length }
    };
  } catch (err) {
    console.error('查询项目 ID 列表失败:', err);
    return { code: 500, message: '查询失败', error: err.message };
  }
}

async function listFinancialProjects(params = {}) {
  const {
    type = '',
    rangeType = 'all',
    startDate = '',
    endDate = '',
    page = 1,
    pageSize = 20
  } = params;
  const allowedTypes = new Set(['unreceived', 'unpaid_cost']);
  const allowedRanges = new Set(['all', 'month', 'quarter', 'year', 'custom']);
  const normalizedType = String(type || '').trim();
  const normalizedRange = String(rangeType || 'all').trim();
  const normalizedStart = String(startDate || '').slice(0, 10);
  const normalizedEnd = String(endDate || '').slice(0, 10);

  if (!allowedTypes.has(normalizedType)) {
    return { code: 400, message: '资金项目筛选类型无效' };
  }
  if (!allowedRanges.has(normalizedRange)) {
    return { code: 400, message: '时间范围类型无效' };
  }
  if (normalizedRange === 'custom' && (!normalizedStart || !normalizedEnd)) {
    return { code: 400, message: '自定义范围请选择开始和结束日期' };
  }
  if (normalizedRange === 'custom' && normalizedStart > normalizedEnd) {
    return { code: 400, message: '开始日期不能晚于结束日期' };
  }

  const currentPage = Math.max(1, Number(page) || 1);
  const currentPageSize = Math.min(50, Math.max(1, Number(pageSize) || 20));

  try {
    const bounds = normalizedRange === 'all'
      ? null
      : getOverviewRangeBounds(normalizedRange, normalizedStart, normalizedEnd);
    if (normalizedRange !== 'all' && !bounds) {
      return { code: 400, message: '时间范围无效' };
    }

    const allProjects = await fetchAllProjectsForOverview();
    const rangeProjects = bounds
      ? filterOverviewProjects(allProjects, bounds)
      : allProjects;
    const matchedProjects = rangeProjects
      .map((project) => {
        const amount = getOverviewProjectAmount(project);
        const receivedAmount = Number(project.receivedAmount) || 0;
        const payableAmount = getOverviewProjectCost(project);
        const paidAmount = getOverviewProjectPaidCost(project);
        const unreceivedCents = Math.max(
          0,
          moneyToCents(amount) - moneyToCents(receivedAmount)
        );
        const enriched = enrichProjectFinancials(project);
        const unpaidCostCents = Math.max(
          0,
          moneyToCents(payableAmount) - moneyToCents(paidAmount)
        );
        return {
          ...enriched,
          amount,
          receivedAmount,
          unreceivedAmount: centsToMoney(unreceivedCents),
          payableAmount,
          paidAmount,
          profitAmount: centsToMoney(moneyToCents(amount) - moneyToCents(payableAmount)),
          unpaidCostAmount: centsToMoney(unpaidCostCents)
        };
      })
      .filter((project) => (
        normalizedType === 'unreceived'
          ? moneyToCents(project.unreceivedAmount) > 0
          : moneyToCents(project.unpaidCostAmount) > 0
      ))
      .sort((a, b) => {
        const timeA = toOverviewDate(a.createTime);
        const timeB = toOverviewDate(b.createTime);
        return (timeB ? timeB.getTime() : 0) - (timeA ? timeA.getTime() : 0);
      });

    const total = matchedProjects.length;
    const startIndex = (currentPage - 1) * currentPageSize;
    const list = matchedProjects.slice(startIndex, startIndex + currentPageSize);
    const summaryAmountCents = matchedProjects.reduce((sum, project) => (
      sum + moneyToCents(
        normalizedType === 'unreceived'
          ? project.unreceivedAmount
          : project.unpaidCostAmount
      )
    ), 0);

    return {
      code: 0,
      message: '查询成功',
      data: {
        list,
        total,
        page: currentPage,
        pageSize: currentPageSize,
        hasMore: currentPage * currentPageSize < total,
        summaryAmount: centsToMoney(summaryAmountCents),
        periodLabel: normalizedRange === 'all'
          ? '全部项目'
          : getOverviewPeriodLabel(normalizedRange, normalizedStart, normalizedEnd, bounds)
      }
    };
  } catch (error) {
    console.error('查询资金项目列表失败:', error);
    return { code: 500, message: '查询失败', error: error.message };
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
  return normalizeCostSettled(value);
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
    archived: '已归档',
    in_cooperation: '合作中',
    terminated: '已终止'
  };
  if (status === 'completed' || status === 'closed' || status === 'archived') {
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
