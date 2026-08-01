const api = require("../../utils/api");
const { getRuntimeVersion } = require("../../utils/app-version");

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
  },

  onLoad() {
    const cachedUser = api.getCachedUserInfo();
    const runtimeVersion = getRuntimeVersion();
    this.setData({
      ...getNavMetrics(),
      versionText: runtimeVersion.displayText,
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
    if (!cachedUser || !api.isUserInfoCacheFresh()) {
      this.loadUser({ silent: Boolean(cachedUser) });
    }
  },

  onPullDownRefresh() {
    this.loadUser({ force: true, silent: true })
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

  openCreateAccount() {
    const userInfo = this.data.userInfo || {};
    if (userInfo.role !== "ADMIN_SUPER") {
      wx.showToast({ title: "仅超级系统管理员可以创建账号", icon: "none" });
      return;
    }
    wx.navigateTo({ url: "/pages/account-create/index" });
  },

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
