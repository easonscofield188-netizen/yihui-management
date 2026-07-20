const api = require("../../utils/api");

Page({
  data: {
    userInfo: null,
    loading: false,
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
    this.setData({ loading: true });
    try {
      const userInfo = await api.getUserInfo();
      wx.setStorageSync("userInfo", userInfo);
      getApp().globalData.userInfo = userInfo;
      const avatarText = String(userInfo.nickname || userInfo.username || "易").slice(0, 1);
      this.setData({ userInfo: { ...userInfo, avatarText } });
    } catch (error) {
      wx.showToast({ title: error.message || "账户信息加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  logout() {
    wx.showModal({
      title: "退出登录",
      content: "确定退出当前账号吗？",
      success: async ({ confirm }) => {
        if (!confirm) return;
        try {
          await api.logout();
        } catch (error) {
          api.clearSession();
        }
        wx.reLaunch({ url: "/pages/login/index" });
      },
    });
  },
});
