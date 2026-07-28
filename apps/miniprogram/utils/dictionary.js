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
  [CREATION_CHANNEL.MINIPROGRAM]: { value: CREATION_CHANNEL.MINIPROGRAM, label: '小程序' },
  [CREATION_CHANNEL.ADMIN_WEB]: { value: CREATION_CHANNEL.ADMIN_WEB, label: '后台管理系统' }
});

const COST_SETTLEMENT_DICTIONARY = Object.freeze({
  true: { value: true, label: '已支付' },
  false: { value: false, label: '待支付' }
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

module.exports = {
  YES_NO,
  YES_NO_DICTIONARY,
  CREATION_CHANNEL,
  CREATION_CHANNEL_DICTIONARY,
  normalizeYesNo,
  isSettled
};
