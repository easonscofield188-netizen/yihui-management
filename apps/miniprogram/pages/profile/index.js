const api = require("../../utils/api");
const { getRuntimeVersion } = require("../../utils/app-version");
const { openPrivacyContract } = require("../../utils/privacy-contract");
const { CATEGORY_REVIEW_TEMPLATE_ID, PROJECT_CHANGE_TEMPLATE_ID } = require("../../utils/wechat-subscription");
const { requestLowCountSubscriptions } = require("../../utils/subscription-auto-prompt");

const NOTIFICATION_COUNT_KEY = "notificationUnreadCount";
const NOTIFICATION_COUNT_AT_KEY = "notificationUnreadCountCachedAt";
const NOTIFICATION_COUNT_TTL_MS = 30 * 1000;

function getNavMetrics() {
  const systemInfo = wx.getSystemInfoSync();
  const statusBarHeight = systemInfo.statusBarHeight || 0;
  const menuButton = wx.getMenuButtonBoundingClientRect();
  const contentHeight = menuButton && menuButton.height
    ? menuButton.height + Math.max(0, menuButton.top - statusBarHeight) * 2
    : 44;
  return { statusBarHeight, navHeight: statusBarHeight + contentHeight };
}

function toCloudFileId(avatarUrl) {
  const matched = String(avatarUrl || "").match(
    /^https?:\/\/([^.]+)\.tcb\.qcloud\.la\/(.+)$/i
  );
  if (!matched) return "";
  const cloudId = matched[1];
  const filePath = matched[2].split("?")[0];
  const env = (getApp().globalData && getApp().globalData.env) || "";
  if (!env || !cloudId || !filePath) return "";
  return `cloud://${env}.${cloudId}/${filePath}`;
}

function decorateUser(userInfo, avatarUrl = "") {
  const displayName = userInfo.nickname || userInfo.username || "亿辉用户";
  const avatarDisplayUrl = avatarUrl || "";
  return {
    ...userInfo,
    displayName,
    avatarText: String(displayName).slice(0, 1),
    avatarDisplayUrl,
    hasCustomAvatar: Boolean(avatarDisplayUrl),
    roleDisplayName: userInfo.roleName || userInfo.role || "普通用户",
    employeeDisplayNo: userInfo.employeeNo || "未设置",
  };
}

Page({
  data: {
    statusBarHeight: 0,
    navHeight: 88,
    userInfo: null,
    loading: false,
    loadingMessage: "正在加载账户信息...",
    versionText: "",
    unreadNotificationCount: 0,
    projectSubscription: null,
    categoryReviewSubscription: null,
  },

  onLoad() {
    const cachedUser = api.getCachedUserInfo();
    const runtimeVersion = getRuntimeVersion();
    const cachedUnreadCount = Number(wx.getStorageSync(NOTIFICATION_COUNT_KEY)) || 0;
    this.setData({
      ...getNavMetrics(),
      versionText: runtimeVersion.displayText,
      unreadNotificationCount: cachedUnreadCount,
      userInfo: cachedUser
        ? decorateUser(
          cachedUser,
          cachedUser.avatarFileId || toCloudFileId(cachedUser.avatarUrl) || cachedUser.avatarUrl
        )
        : null,
    });
  },

  onShow() {
    if (!api.getToken()) {
      wx.reLaunch({ url: "/pages/login/index" });
      return;
    }
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.setData({ selected: 1 });
    const cachedUser = api.getCachedUserInfo();
    if (cachedUser) this.showUser(cachedUser);
    if (cachedUser && cachedUser.role === "ADMIN_SUPER") {
      this.loadUnreadNotificationCount();
      this.loadSubscriptionStatuses();
    }
    if (!cachedUser || !api.isUserInfoCacheFresh()) {
      this.loadUser({ silent: Boolean(cachedUser) });
    }
  },

  onPullDownRefresh() {
    Promise.all([
      this.loadUser({ force: true, silent: true }),
      this.loadUnreadNotificationCount({ force: true }),
      this.loadSubscriptionStatuses(),
    ])
      .finally(() => wx.stopPullDownRefresh());
  },

  showUser(userInfo) {
    if (!userInfo) return;
    const avatarUrl = userInfo.avatarFileId
      || toCloudFileId(userInfo.avatarUrl)
      || userInfo.avatarUrl
      || "";
    this.setData({ userInfo: decorateUser(userInfo, avatarUrl) });
  },

  loadUser({ force = false, silent = false } = {}) {
    const cachedUser = api.getCachedUserInfo();
    if (!force && cachedUser && api.isUserInfoCacheFresh()) {
      this.showUser(cachedUser);
      return Promise.resolve(cachedUser);
    }
    if (this.userLoadPromise) return this.userLoadPromise;

    if (!silent) {
      this.setData({ loading: true, loadingMessage: "正在加载账户信息..." });
    }
    this.userLoadPromise = api.getUserInfo()
      .then((userInfo) => {
        api.cacheUserInfo(userInfo);
        this.showUser(userInfo);
        if (userInfo && userInfo.role === "ADMIN_SUPER") {
          this.loadUnreadNotificationCount();
          this.loadSubscriptionStatuses();
        } else {
          this.setData({ unreadNotificationCount: 0 });
        }
        return userInfo;
      })
      .catch((error) => {
        wx.showToast({ title: error.message || "账户信息加载失败", icon: "none" });
        return cachedUser || null;
      })
      .finally(() => {
        this.userLoadPromise = null;
        if (!silent) this.setData({ loading: false });
      });
    return this.userLoadPromise;
  },

  loadUnreadNotificationCount({ force = false } = {}) {
    const userInfo = this.data.userInfo || api.getCachedUserInfo() || {};
    if (userInfo.role !== "ADMIN_SUPER") {
      this.setData({ unreadNotificationCount: 0 });
      return Promise.resolve(0);
    }

    const cachedCount = Number(wx.getStorageSync(NOTIFICATION_COUNT_KEY)) || 0;
    const cachedAt = Number(wx.getStorageSync(NOTIFICATION_COUNT_AT_KEY)) || 0;
    if (!force && cachedAt && Date.now() - cachedAt < NOTIFICATION_COUNT_TTL_MS) {
      this.setData({ unreadNotificationCount: cachedCount });
      return Promise.resolve(cachedCount);
    }
    if (this.notificationCountPromise) return this.notificationCountPromise;

    this.notificationCountPromise = api.getNotificationUnreadCount()
      .then((result) => {
        const count = Math.max(0, Number(result.unreadCount) || 0);
        wx.setStorageSync(NOTIFICATION_COUNT_KEY, count);
        wx.setStorageSync(NOTIFICATION_COUNT_AT_KEY, Date.now());
        this.setData({ unreadNotificationCount: count });
        return count;
      })
      .catch(() => {
        this.setData({ unreadNotificationCount: cachedCount });
        return cachedCount;
      })
      .finally(() => {
        this.notificationCountPromise = null;
      });
    return this.notificationCountPromise;
  },

  onAvatarError() {
    this.setData({
      "userInfo.avatarDisplayUrl": "",
      "userInfo.hasCustomAvatar": false,
    });
  },

  openSecurity() {
    const userInfo = this.data.userInfo || {};
    wx.showModal({
      title: "账号安全",
      content: `当前账号：${userInfo.username || "未设置"}\n登录状态：正常`,
      showCancel: false,
      confirmText: "知道了",
    });
  },

  openProjects() {
    wx.navigateTo({ url: "/pages/project-overview/index" });
  },

  openProjectCases() {
    wx.navigateTo({ url: "/pages/project-cases/index" });
  },

  openProjectQuotations() {
    wx.navigateTo({ url: "/pages/project-quotations/index" });
  },

  openNotifications() {
    wx.navigateTo({ url: "/pages/notification-list/index" });
  },

  openClientManagement() {
    const userInfo = this.data.userInfo || {};
    if (userInfo.role !== "ADMIN_SUPER") {
      wx.showToast({ title: "仅超级系统管理员可管理客户", icon: "none" });
      return;
    }
    wx.navigateTo({ url: "/pages/client-management/index" });
  },

  openAdminCenter() {
    const userInfo = this.data.userInfo || {};
    if (userInfo.role !== "ADMIN_SUPER") {
      wx.showToast({ title: "仅超级系统管理员可进入管理中心", icon: "none" });
      return;
    }
    const navigate = () => wx.navigateTo({ url: "/pages/admin-center/index" });
    if (this.subscriptionPromptInFlight) return;
    this.subscriptionPromptInFlight = true;
    const requested = requestLowCountSubscriptions([
      {
        templateId: PROJECT_CHANGE_TEMPLATE_ID,
        status: this.data.projectSubscription,
        save: status => api.saveWechatSubscription({ templateId: PROJECT_CHANGE_TEMPLATE_ID, status }),
      },
      {
        templateId: CATEGORY_REVIEW_TEMPLATE_ID,
        status: this.data.categoryReviewSubscription,
        save: status => api.saveCategoryReviewSubscription({ templateId: CATEGORY_REVIEW_TEMPLATE_ID, status }),
      },
    ], () => {
      this.subscriptionPromptInFlight = false;
      navigate();
    });
    if (!requested) this.subscriptionPromptInFlight = false;
  },

  async loadSubscriptionStatuses() {
    try {
      const [projectSubscription, categoryReviewSubscription] = await Promise.all([
        api.getWechatSubscriptionStatus(),
        api.getCategoryReviewSubscriptionStatus(),
      ]);
      this.setData({ projectSubscription, categoryReviewSubscription });
    } catch (error) {}
  },

  openSystemSettings() {
    wx.navigateTo({ url: "/pages/system-settings/index" });
  },

  openCreateAccount() {
    const userInfo = this.data.userInfo || {};
    if (userInfo.role !== "ADMIN_SUPER") {
      wx.showToast({ title: "仅超级系统管理员可以创建账号", icon: "none" });
      return;
    }
    wx.navigateTo({ url: "/pages/account-create/index" });
  },

  openPrivacyContract,

  logout() {
    wx.showModal({
      title: "退出登录",
      content: "确定退出当前账号吗？",
      success: async ({ confirm }) => {
        if (!confirm) return;
        this.setData({ loading: true, loadingMessage: "正在退出登录..." });
        try {
          await api.logout();
        } catch (error) {
          api.clearSession();
        }
        wx.reLaunch({ url: "/pages/login/index" });
      },
    });
  },

  stopPropagation() {},
});
