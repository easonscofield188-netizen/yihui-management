const api = require("../../utils/api");

const CHANGE_TYPE_LABELS = {
  created: "初始值",
  updated: "已修改",
  added: "已新增",
  removed: "已删除",
};

const WECHAT_SERVICE_NOTIFICATION_SCENES = new Set([1014]);

function isWechatServiceNotificationEntry(options = {}) {
  if (options.source === "wechat_subscribe") return true;
  if (getCurrentPages().length !== 1) return false;

  try {
    const enterOptions = typeof wx.getEnterOptionsSync === "function"
      ? wx.getEnterOptionsSync()
      : wx.getLaunchOptionsSync();
    return WECHAT_SERVICE_NOTIFICATION_SCENES.has(Number(enterOptions?.scene));
  } catch (error) {
    console.warn("读取小程序进入场景失败", error);
    return false;
  }
}

function getNavMetrics() {
  const systemInfo = wx.getSystemInfoSync();
  const statusBarHeight = systemInfo.statusBarHeight || 0;
  const menuButton = wx.getMenuButtonBoundingClientRect();
  const contentHeight = menuButton && menuButton.height
    ? menuButton.height + Math.max(0, menuButton.top - statusBarHeight) * 2
    : 44;
  return { statusBarHeight, navHeight: statusBarHeight + contentHeight };
}

function formatDateTime(value, timestamp) {
  const raw = value?.$date || value || timestamp;
  const date = new Date(raw || 0);
  if (Number.isNaN(date.getTime())) return "时间未知";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function formatChangeValue(value, displayValue, valueType, emptyText = "—") {
  if (value === null || value === undefined || value === "") return emptyText;
  if (valueType === "money") {
    const amount = Number(value);
    return Number.isFinite(amount)
      ? `¥${amount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : String(displayValue ?? value);
  }
  if (typeof displayValue === "string" || typeof displayValue === "number") {
    return String(displayValue);
  }
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function decorateChange(change, index) {
  return {
    ...change,
    id: `${change.field || "change"}-${index}`,
    changeTypeLabel: CHANGE_TYPE_LABELS[change.changeType] || "已变更",
    oldText: formatChangeValue(change.oldValue, change.oldDisplayValue, change.valueType),
    newText: formatChangeValue(change.newValue, change.newDisplayValue, change.valueType),
  };
}

Page({
  data: {
    ...getNavMetrics(),
    notificationId: "",
    notification: null,
    event: null,
    changes: [],
    timeText: "",
    loading: true,
    isServiceNotificationEntry: false,
  },

  onLoad(options = {}) {
    const notificationId = String(options.id || "").trim();
    const isServiceNotificationEntry = isWechatServiceNotificationEntry(options);
    this.setData({ notificationId, isServiceNotificationEntry });
    if (!notificationId) {
      wx.showToast({ title: "消息参数错误", icon: "none" });
      return;
    }
    this.loadDetail();
  },

  goBack() {
    if (this.data.isServiceNotificationEntry) {
      wx.exitMiniProgram({
        fail: () => wx.switchTab({ url: "/pages/profile/index" }),
      });
      return;
    }

    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack();
    else wx.redirectTo({ url: "/pages/notification-list/index" });
  },

  openProject() {
    const projectId = this.data.event?.projectId || this.data.notification?.projectId;
    if (!projectId) return;
    wx.navigateTo({ url: `/pages/project-detail/index?id=${projectId}` });
  },

  async loadDetail() {
    this.setData({ loading: true });
    try {
      const result = await api.getNotificationDetail(this.data.notificationId);
      const notification = result.notification || null;
      if (notification?.notificationType === "cost_category_review" && notification.reviewRequestId) {
        wx.redirectTo({
          url: `/pages/category-review-detail/index?id=${notification.reviewRequestId}&notificationId=${this.data.notificationId}${this.data.isServiceNotificationEntry ? "&source=wechat_subscribe" : ""}`,
        });
        return;
      }
      const event = result.event || null;
      const changes = (event?.changes || []).map(decorateChange);
      wx.removeStorageSync("notificationUnreadCountCachedAt");
      this.setData({
        notification,
        event,
        changes,
        timeText: formatDateTime(event?.createdAt, event?.createdTimestamp),
      });
    } catch (error) {
      wx.showToast({ title: error.message || "消息详情加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },
});
