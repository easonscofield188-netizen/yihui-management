const PROJECT_CHANGE_TEMPLATE_ID = "AzJTLvxbpAoCM3IoQYfp5DsSKM4IjqCAwmsD1F_oXqA";
const CATEGORY_REVIEW_TEMPLATE_ID = "osXcvIp2RwA4HpYNqVienL9R3gq-PNw5iDe0LQprkok";

const WECHAT_SUBSCRIPTION_STATUS = Object.freeze({
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  BANNED: "banned",
});

const WECHAT_AUTH_RESULT = Object.freeze({
  ACCEPT: "accept",
  REJECT: "reject",
  BAN: "ban",
});

function mapWechatAuthResult(value) {
  if (value === WECHAT_AUTH_RESULT.ACCEPT) return WECHAT_SUBSCRIPTION_STATUS.ACCEPTED;
  if (value === WECHAT_AUTH_RESULT.BAN) return WECHAT_SUBSCRIPTION_STATUS.BANNED;
  return WECHAT_SUBSCRIPTION_STATUS.REJECTED;
}

module.exports = {
  CATEGORY_REVIEW_TEMPLATE_ID,
  PROJECT_CHANGE_TEMPLATE_ID,
  WECHAT_SUBSCRIPTION_STATUS,
  mapWechatAuthResult,
};
