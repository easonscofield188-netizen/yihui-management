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
  const isCategoryReview = item.notificationType === "cost_category_review";
  const projectName = String(item.projectName || "未命名项目");
  const isCreated = item.eventType === "project_created";
  const listTitle = isCategoryReview
    ? `新类目“${item.proposedLabel || '待审核'}”待审核`
    : isCreated
    ? `新建《${projectName}》`
    : `《${projectName}》信息变更`;
  return {
    ...item,
    listTitle,
    isUnread: item.readStatus === "unread",
    timeText: formatDateTime(item.createdAt, item.createdTimestamp),
    iconName: isCategoryReview ? "task" : isCreated ? "folder-add-filled" : "edit-1-filled",
    iconColor: isCategoryReview ? "#9a5b13" : isCreated ? "#0f7a45" : "#2457a7",
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
    deleting: false,
    selectionMode: false,
    selectedIds: [],
    allSelected: false,
  },

  onShow() {
    if (!api.getToken()) {
      wx.reLaunch({ url: "/pages/login/index" });
      return;
    }
    this.loadNotifications(true);
  },

  onPullDownRefresh() {
    if (this.data.selectionMode) {
      wx.stopPullDownRefresh();
      return;
    }
    this.loadNotifications(true).finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (!this.data.selectionMode && !this.data.loading && this.data.hasMore) {
      this.loadNotifications(false);
    }
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack();
    else wx.switchTab({ url: "/pages/profile/index" });
  },

  onStatusTap(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (index === this.data.readStatusIndex || !this.data.readStatusOptions[index]) return;
    this.setData({
      readStatusIndex: index,
      selectionMode: false,
      selectedIds: [],
      allSelected: false,
    }, () => this.loadNotifications(true));
  },

  onUnload() {
    if (this.longPressTimer) clearTimeout(this.longPressTimer);
  },

  onNotificationTap(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    if (this.longPressedId === id) {
      this.longPressedId = "";
      return;
    }
    if (this.data.selectionMode) {
      this.toggleSelectionById(id);
      return;
    }
    const notification = this.data.notifications.find(item => item._id === id);
    if (notification && notification.notificationType === "cost_category_review" && notification.reviewRequestId) {
      wx.navigateTo({ url: `/pages/category-review-detail/index?id=${notification.reviewRequestId}&notificationId=${id}` });
      return;
    }
    wx.navigateTo({ url: `/pages/notification-detail/index?id=${id}` });
  },

  enterSelectionMode(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    this.longPressedId = id;
    if (this.longPressTimer) clearTimeout(this.longPressTimer);
    this.longPressTimer = setTimeout(() => {
      this.longPressedId = "";
    }, 700);
    if (wx.vibrateShort) wx.vibrateShort({ type: "light" });
    if (this.data.selectionMode) {
      this.toggleSelectionById(id);
      return;
    }
    this.applySelection([id], true);
  },

  toggleSelectionById(id) {
    const selectedIds = this.data.selectedIds.includes(id)
      ? this.data.selectedIds.filter(item => item !== id)
      : this.data.selectedIds.concat(id);
    this.applySelection(selectedIds, true);
  },

  applySelection(selectedIds, selectionMode = this.data.selectionMode) {
    const selectedSet = new Set(selectedIds);
    const total = Number(this.data.total) || this.data.notifications.length;
    this.setData({
      selectionMode,
      selectedIds,
      allSelected: total > 0 && selectedIds.length === total,
      notifications: this.data.notifications.map(item => ({
        ...item,
        selected: selectedSet.has(item._id),
      })),
    });
  },

  cancelSelection() {
    this.applySelection([], false);
  },

  async toggleSelectAll() {
    if (this.data.deleting || !this.data.total) return;
    if (this.data.allSelected) {
      this.applySelection([], true);
      return;
    }
    try {
      this.setData({ loading: true });
      const readStatus = this.data.readStatusOptions[this.data.readStatusIndex].value;
      const result = await api.listNotificationIds(readStatus);
      this.applySelection(Array.isArray(result.ids) ? result.ids : [], true);
    } catch (error) {
      wx.showToast({ title: error.message || "全选失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  deleteSelected() {
    if (!this.data.selectedIds.length || this.data.deleting) return;
    this.confirmDelete(this.data.selectedIds);
  },

  confirmDelete(ids) {
    const count = ids.length;
    wx.showModal({
      title: count > 1 ? "批量删除消息" : "删除消息",
      content: count > 1 ? `确定删除选中的 ${count} 条消息吗？` : "确定删除这条消息吗？",
      confirmText: "删除",
      confirmColor: "#c62828",
      success: result => {
        if (result.confirm) this.performDelete(ids);
      },
    });
  },

  async performDelete(ids) {
    if (this.data.deleting) return;
    this.setData({ deleting: true });
    try {
      if (ids.length === 1) await api.deleteNotification(ids[0]);
      else await api.deleteNotifications(ids);
      wx.removeStorageSync("notificationUnreadCountCachedAt");
      wx.showToast({ title: "删除成功", icon: "success" });
      this.setData({ selectionMode: false, selectedIds: [], allSelected: false });
      await this.loadNotifications(true);
    } catch (error) {
      wx.showToast({ title: error.message || "删除失败", icon: "none" });
    } finally {
      this.setData({ deleting: false });
    }
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
      const selectedSet = new Set(this.data.selectedIds);
      const incoming = (result.list || []).map(item => ({
        ...decorateNotification(item),
        selected: selectedSet.has(item._id),
      }));
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
