const api = require("../../utils/api");

const READ_STATUS_OPTIONS = [
  { label: "全部", value: "" },
  { label: "未读", value: "unread" },
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

function formatDateTime(value, timestamp) {
  const raw = value?.$date || value || timestamp;
  const date = new Date(raw || 0);
  if (Number.isNaN(date.getTime())) return "时间未知";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function decorateNotification(item) {
  const projectName = String(item.projectName || "未命名项目");
  const isCreated = item.eventType === "project_created";
  const listTitle = isCreated
    ? `新建${projectName}`
    : `${projectName}信息变更`;
  return {
    ...item,
    listTitle,
    isUnread: item.readStatus === "unread",
    timeText: formatDateTime(item.createdAt, item.createdTimestamp),
    iconName: isCreated ? "folder-add-filled" : "edit-1-filled",
    iconColor: isCreated ? "#0f7a45" : "#2457a7",
  };
}

Page({
  data: {
    ...getNavMetrics(),
    readStatusOptions: READ_STATUS_OPTIONS,
    readStatusIndex: 0,
    notifications: [],
    unreadCount: 0,
    total: 0,
    page: 1,
    hasMore: true,
    loading: false,
  },

  onShow() {
    if (!api.getToken()) {
      wx.reLaunch({ url: "/pages/login/index" });
      return;
    }
    this.loadNotifications(true);
  },

  onPullDownRefresh() {
    this.loadNotifications(true).finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (!this.data.loading && this.data.hasMore) this.loadNotifications(false);
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack();
    else wx.switchTab({ url: "/pages/profile/index" });
  },

  onStatusTap(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (index === this.data.readStatusIndex || !this.data.readStatusOptions[index]) return;
    this.setData({ readStatusIndex: index }, () => this.loadNotifications(true));
  },

  openNotification(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/notification-detail/index?id=${id}` });
  },

  async markAllRead() {
    if (!this.data.unreadCount) return;
    try {
      await api.markAllNotificationsRead();
      wx.removeStorageSync("notificationUnreadCountCachedAt");
      wx.showToast({ title: "已全部标记为已读", icon: "success" });
      this.loadNotifications(true);
    } catch (error) {
      wx.showToast({ title: error.message || "操作失败", icon: "none" });
    }
  },

  async loadNotifications(reset) {
    if (!reset && (this.data.loading || !this.data.hasMore)) return;
    const requestId = (this.requestId || 0) + 1;
    this.requestId = requestId;
    const page = reset ? 1 : this.data.page;
    this.setData({ loading: true });
    try {
      const readStatus = this.data.readStatusOptions[this.data.readStatusIndex].value;
      const result = await api.listNotifications({ page, pageSize: 20, readStatus });
      if (requestId !== this.requestId) return;
      const incoming = (result.list || []).map(decorateNotification);
      const unreadCount = Number(result.unreadCount) || 0;
      wx.setStorageSync("notificationUnreadCount", unreadCount);
      wx.setStorageSync("notificationUnreadCountCachedAt", Date.now());
      this.setData({
        notifications: reset ? incoming : this.data.notifications.concat(incoming),
        unreadCount,
        total: Number(result.total) || 0,
        page: page + 1,
        hasMore: Boolean(result.hasMore),
      });
    } catch (error) {
      if (requestId !== this.requestId) return;
      wx.showToast({ title: error.message || "消息加载失败", icon: "none" });
    } finally {
      if (requestId === this.requestId) this.setData({ loading: false });
    }
  },
});
