const {
  FLOATING_NOTIFICATION_MODE,
  getFloatingNotificationMode,
  setFloatingNotificationMode,
} = require("../../utils/notification-preferences");
const api = require("../../utils/api");
const {
  PROJECT_CHANGE_TEMPLATE_ID,
  WECHAT_SUBSCRIPTION_STATUS,
  mapWechatAuthResult,
} = require("../../utils/wechat-subscription");

const DISPLAY_MODE_OPTIONS = [
  {
    value: FLOATING_NOTIFICATION_MODE.UNREAD_ONLY,
    label: "仅有新消息时显示",
    description: "没有未读消息时自动隐藏，页面更简洁",
    icon: "notification-add-filled",
  },
  {
    value: FLOATING_NOTIFICATION_MODE.ALWAYS,
    label: "始终显示",
    description: "即使没有未读消息，也保留消息入口",
    icon: "notification-filled",
  },
];

function getNavMetrics() {
  const systemInfo = wx.getSystemInfoSync();
  const statusBarHeight = systemInfo.statusBarHeight || 0;
  const menuButton = wx.getMenuButtonBoundingClientRect();
  const contentHeight = menuButton && menuButton.height
    ? menuButton.height + Math.max(0, menuButton.top - statusBarHeight) * 2
    : 44;
  return { statusBarHeight, navHeight: statusBarHeight + contentHeight };
}

Page({
  data: {
    ...getNavMetrics(),
    displayMode: FLOATING_NOTIFICATION_MODE.UNREAD_ONLY,
    displayModeOptions: DISPLAY_MODE_OPTIONS,
    wechatSubscription: {
      status: "not_bound",
      statusLabel: "未开启",
      availableCount: 0,
      canReceive: false,
    },
    wechatSubscriptionLoading: false,
  },

  onShow() {
    this.setData({ displayMode: getFloatingNotificationMode() });
    this.loadWechatSubscriptionStatus();
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack();
    else wx.switchTab({ url: "/pages/profile/index" });
  },

  selectDisplayMode(event) {
    const mode = setFloatingNotificationMode(event.currentTarget.dataset.value);
    this.setData({ displayMode: mode });
    wx.showToast({ title: "设置已保存", icon: "success" });
  },

  async loadWechatSubscriptionStatus() {
    try {
      const result = await api.getWechatSubscriptionStatus();
      this.setData({ wechatSubscription: result });
    } catch (error) {
      // 微信订阅状态加载失败不影响本地悬浮按钮设置。
    }
  },

  async enableWechatSubscription() {
    if (this.data.wechatSubscriptionLoading) return;
    if (typeof wx.requestSubscribeMessage !== "function") {
      wx.showToast({ title: "当前微信版本不支持订阅消息", icon: "none" });
      return;
    }
    this.setData({ wechatSubscriptionLoading: true });
    try {
      const authResult = await new Promise((resolve, reject) => {
        wx.requestSubscribeMessage({
          tmplIds: [PROJECT_CHANGE_TEMPLATE_ID],
          success: resolve,
          fail: reject,
        });
      });
      const status = mapWechatAuthResult(authResult[PROJECT_CHANGE_TEMPLATE_ID]);
      const result = await api.saveWechatSubscription({
        templateId: PROJECT_CHANGE_TEMPLATE_ID,
        status,
      });
      this.setData({ wechatSubscription: result });
      if (status === WECHAT_SUBSCRIPTION_STATUS.ACCEPTED) {
        wx.showToast({ title: "已增加一次微信提醒", icon: "success" });
      } else if (status === WECHAT_SUBSCRIPTION_STATUS.BANNED) {
        wx.showModal({
          title: "微信通知已关闭",
          content: "请在小程序右上角菜单的设置中，允许接收订阅消息后重试。",
          showCancel: false,
          confirmText: "知道了",
        });
      } else {
        wx.showToast({ title: "你暂未同意微信提醒", icon: "none" });
      }
    } catch (error) {
      wx.showToast({ title: error.message || "微信提醒开启失败", icon: "none" });
    } finally {
      this.setData({ wechatSubscriptionLoading: false });
    }
  },
});
