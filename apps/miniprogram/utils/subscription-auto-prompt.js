const { WECHAT_SUBSCRIPTION_STATUS, mapWechatAuthResult } = require("./wechat-subscription");

const REJECT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function rejectionKey(templateId) {
  return `subscriptionRejectedAt:${templateId}`;
}

function requestLowCountSubscriptions(items, complete) {
  const candidates = (items || []).filter(item => {
    if (!item || !item.templateId || Number(item.status?.availableCount) > 1) return false;
    const rejectedAt = Number(wx.getStorageSync(rejectionKey(item.templateId))) || 0;
    return !rejectedAt || Date.now() - rejectedAt >= REJECT_COOLDOWN_MS;
  });
  if (!candidates.length || typeof wx.requestSubscribeMessage !== "function") {
    complete && complete();
    return false;
  }
  wx.requestSubscribeMessage({
    tmplIds: candidates.map(item => item.templateId),
    success: result => {
      const saves = candidates.map(item => {
        const status = mapWechatAuthResult(result[item.templateId]);
        if (status === WECHAT_SUBSCRIPTION_STATUS.ACCEPTED) wx.removeStorageSync(rejectionKey(item.templateId));
        else wx.setStorageSync(rejectionKey(item.templateId), Date.now());
        return Promise.resolve(item.save(status)).catch(() => null);
      });
      Promise.all(saves).finally(() => complete && complete());
    },
    fail: () => {
      candidates.forEach(item => wx.setStorageSync(rejectionKey(item.templateId), Date.now()));
      complete && complete();
    },
  });
  return true;
}

module.exports = { requestLowCountSubscriptions };
