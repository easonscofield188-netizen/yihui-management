const {
  FLOATING_NOTIFICATION_MODE,
  getFloatingNotificationMode,
  setFloatingNotificationMode,
} = require("../../utils/notification-preferences");

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
  },

  onShow() {
    this.setData({ displayMode: getFloatingNotificationMode() });
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
});
