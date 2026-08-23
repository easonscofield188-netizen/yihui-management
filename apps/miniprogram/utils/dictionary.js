/**
 * 业务字典：业务逻辑只使用 value，中文 label 仅用于展示或兼容历史数据。
 */
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

const EXPENSE_TYPE = Object.freeze({
  ONE_TIME: 'one_time',
  RECURRING: 'recurring'
});

const EXPENSE_TYPE_DICTIONARY = Object.freeze({
  [EXPENSE_TYPE.ONE_TIME]: { value: EXPENSE_TYPE.ONE_TIME, label: '一次性支出' },
  [EXPENSE_TYPE.RECURRING]: { value: EXPENSE_TYPE.RECURRING, label: '固定分摊支出' }
});

const RECURRING_STATUS = Object.freeze({
  ACTIVE: 'active',
  STOPPED: 'stopped',
  COMPLETED: 'completed'
});

const RECURRING_STATUS_DICTIONARY = Object.freeze({
  [RECURRING_STATUS.ACTIVE]: { value: RECURRING_STATUS.ACTIVE, label: '进行中' },
  [RECURRING_STATUS.STOPPED]: { value: RECURRING_STATUS.STOPPED, label: '已停用' },
  [RECURRING_STATUS.COMPLETED]: { value: RECURRING_STATUS.COMPLETED, label: '已结束' }
});

function getDictionaryValue(value, dictionary, defaultValue) {
  if (Object.prototype.hasOwnProperty.call(dictionary, value)) return value;
  return defaultValue;
}

function normalizeYesNo(value, defaultValue = YES_NO.NO) {
  return getDictionaryValue(value, YES_NO_DICTIONARY, defaultValue);
}

function isSettled(value, defaultValue = true) {
  return typeof value === 'boolean' ? value : defaultValue;
}

const PROJECT_TYPE = Object.freeze({
  NORMAL: 'normal',
  LONG_TERM: 'long_term',
  FLOWER_PLANT: 'flower_plant',
  HISTORICAL: 'historical'
});

const PROJECT_TYPE_DICTIONARY = Object.freeze({
  [PROJECT_TYPE.NORMAL]: { value: PROJECT_TYPE.NORMAL, label: '常规项目' },
  [PROJECT_TYPE.LONG_TERM]: { value: PROJECT_TYPE.LONG_TERM, label: '长期项目' },
  [PROJECT_TYPE.FLOWER_PLANT]: { value: PROJECT_TYPE.FLOWER_PLANT, label: '鲜花绿植供应' },
  [PROJECT_TYPE.HISTORICAL]: { value: PROJECT_TYPE.HISTORICAL, label: '历史归档项目' }
});

module.exports = {
  YES_NO,
  YES_NO_DICTIONARY,
  CREATION_CHANNEL,
  CREATION_CHANNEL_DICTIONARY,
  COST_SETTLEMENT_DICTIONARY,
  EXPENSE_TYPE,
  EXPENSE_TYPE_DICTIONARY,
  RECURRING_STATUS,
  RECURRING_STATUS_DICTIONARY,
  PROJECT_TYPE,
  PROJECT_TYPE_DICTIONARY,
  normalizeYesNo,
  isSettled
};

