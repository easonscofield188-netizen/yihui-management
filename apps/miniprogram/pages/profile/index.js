const api = require("../../utils/api");

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
  },

  onLoad() {
    const cachedUser = wx.getStorageSync("userInfo");
    this.setData({
      ...getNavMetrics(),
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
    this.loadUser();
  },

  async loadUser() {
    this.setData({ loading: true, loadingMessage: "正在加载账户信息..." });
    try {
      const userInfo = await api.getUserInfo();
      const avatarUrl = await this.resolveAvatarUrl(userInfo);
      wx.setStorageSync("userInfo", userInfo);
      getApp().globalData.userInfo = userInfo;
      this.setData({ userInfo: decorateUser(userInfo, avatarUrl) });
    } catch (error) {
      wx.showToast({ title: error.message || "账户信息加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  async resolveAvatarUrl(userInfo) {
    if (!userInfo) return "";

    // 优先使用 cloud://，小程序 image 组件原生支持，不依赖临时 HTTPS 域名白名单
    const cloudFileId = userInfo.avatarFileId || toCloudFileId(userInfo.avatarUrl);
    if (cloudFileId) {
      try {
        const result = await wx.cloud.getTempFileURL({ fileList: [cloudFileId] });
        const file = result.fileList && result.fileList[0];
        if (file && file.tempFileURL && (!file.status || file.status === 0)) {
          return file.tempFileURL;
        }
      } catch (error) {
        // 换临时链接失败时，直接把 cloud:// 交给 image 组件加载
      }
      return cloudFileId;
    }

    return userInfo.avatarUrl || "";
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
