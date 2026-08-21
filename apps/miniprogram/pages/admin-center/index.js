const api = require("../../utils/api");

const NOTIFICATION_COUNT_KEY = "notificationUnreadCount";

function buildMenuSections(userInfo) {
  const isRootAdmin = userInfo && userInfo.role === "ADMIN_SUPER" && userInfo.employeeNo === "YH-ADMIN_SUPER-000";
  const commonItems = [
    { key: "clients", name: "客户管理", description: "客户资料与项目引用", icon: "usergroup", tone: "blue", route: "/pages/client-management/index" },
  ];

  if (isRootAdmin) {
    commonItems.push({
      key: "accountManage",
      name: "账号管理",
      description: "重置密码与账号停用",
      icon: "user-avatar",
      tone: "violet",
      route: "/pages/account-manage/index",
    });
  }

  commonItems.push(
    { key: "notifications", name: "消息通知", description: "查看项目变更消息", icon: "notification", tone: "orange", route: "/pages/notification-list/index", badgeKey: "unread" },
    { key: "categoryReviews", name: "类目审核", description: "审核报价中发现的新类目", icon: "task", tone: "green", route: "/pages/category-review-list/index", badgeKey: "reviews" }
  );

  return [
    {
      key: "common",
      title: "常用管理",
      description: "客户、账号与消息处理",
      items: commonItems,
    },
    {
      key: "system",
      title: "数据与系统",
      description: "主数据配置与通知设置",
      items: [
        { key: "data", name: "数据配置", description: "角色、渠道、成本与场景", icon: "data-base", tone: "green", route: "/pages/data-config/index" },
        { key: "settings", name: "通知设置", description: "微信提醒与悬浮入口", icon: "setting", tone: "cyan", route: "/pages/system-settings/index" },
      ],
    },
  ];
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

Page({
  data: {
    ...getNavMetrics(),
    keyword: "",
    sections: [],
    unreadCount: 0,
    pendingReviewCount: 0,
    loading: false,
    isRootAdmin: false,
  },

  onLoad() {
    this.authorizeAndLoad();
  },

  onShow() {
    if (this.data.sections.length) {
      this.loadUnreadCount();
      this.loadPendingReviewCount();
    }
  },

  onPullDownRefresh() {
    Promise.all([this.loadUnreadCount({ force: true }), this.loadPendingReviewCount()]).finally(() => wx.stopPullDownRefresh());
  },

  async authorizeAndLoad() {
    if (!api.getToken()) {
      wx.reLaunch({ url: "/pages/login/index" });
      return;
    }
    let userInfo = api.getCachedUserInfo() || {};
    if (!userInfo.role || !api.isUserInfoCacheFresh()) {
      try {
        userInfo = await api.getUserInfo();
        api.cacheUserInfo(userInfo);
      } catch (error) {
        this.denyAccess(error.message);
        return;
      }
    }
    if (userInfo.role !== "ADMIN_SUPER") {
      this.denyAccess("仅超级系统管理员可进入管理中心");
      return;
    }
    this.rawSections = buildMenuSections(userInfo);
    const isRootAdmin = userInfo.role === "ADMIN_SUPER" && userInfo.employeeNo === "YH-ADMIN_SUPER-000";
    this.setData({
      isRootAdmin,
      sections: this.rawSections,
    });
    this.loadUnreadCount();
    this.loadPendingReviewCount();
  },

  denyAccess(message) {
    wx.showToast({ title: message || "无管理中心访问权限", icon: "none" });
    setTimeout(() => this.goBack(), 300);
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack();
    else wx.switchTab({ url: "/pages/profile/index" });
  },

  onSearchInput(event) {
    const keyword = String(event.detail.value || "");
    this.setData({ keyword }, () => this.applySearch());
  },

  clearSearch() {
    this.setData({ keyword: "", sections: this.rawSections || [] });
  },

  applySearch() {
    const raw = this.rawSections || [];
    const keyword = this.data.keyword.trim().toLowerCase();
    if (!keyword) {
      this.setData({ sections: raw });
      return;
    }
    const sections = raw
      .map(section => ({
        ...section,
        items: section.items.filter(item => `${item.name}${item.description}`.toLowerCase().includes(keyword)),
      }))
      .filter(section => section.items.length);
    this.setData({ sections });
  },

  openMenu(event) {
    const route = String(event.currentTarget.dataset.route || "");
    if (route) wx.navigateTo({ url: route });
  },

  async loadUnreadCount({ force = false } = {}) {
    const cached = Math.max(0, Number(wx.getStorageSync(NOTIFICATION_COUNT_KEY)) || 0);
    this.setData({ unreadCount: cached });
    if (!force && this.loadingUnread) return cached;
    this.loadingUnread = true;
    try {
      const result = await api.getNotificationUnreadCount();
      const count = Math.max(0, Number(result.unreadCount) || 0);
      wx.setStorageSync(NOTIFICATION_COUNT_KEY, count);
      this.setData({ unreadCount: count });
      return count;
    } catch (error) {
      return cached;
    } finally {
      this.loadingUnread = false;
    }
  },

  async loadPendingReviewCount() {
    try {
      const result = await api.getCategoryReviewPendingCount();
      this.setData({ pendingReviewCount: Math.max(0, Number(result.count) || 0) });
    } catch (error) {}
  },
});
