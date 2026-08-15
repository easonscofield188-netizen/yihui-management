const api = require("../../utils/api");
const { openPrivacyContract } = require("../../utils/privacy-contract");

Page({
  data: {
    username: "",
    password: "",
    showPassword: false,
    agreementAccepted: false,
    loading: false,
  },

  onLoad() {
    if (api.getToken()) {
      api.getUserInfo()
        .then((userInfo) => {
          wx.setStorageSync("userInfo", userInfo);
          getApp().globalData.userInfo = userInfo;
          wx.switchTab({ url: "/pages/index/index" });
        })
        .catch(() => {});
    }
  },

  onUsernameInput(event) {
    this.setData({ username: event.detail.value.trim() });
  },

  onPasswordInput(event) {
    this.setData({ password: event.detail.value });
  },

  togglePassword(event) {
    if (event.detail && event.detail.trigger !== "suffix-icon") return;
    this.setData({ showPassword: !this.data.showPassword });
  },

  onAgreementToggle() {
    this.setData({ agreementAccepted: !this.data.agreementAccepted });
  },

  openPrivacyContract,

  async submit() {
    const { username, password, agreementAccepted, loading } = this.data;
    if (loading) return;
    if (!agreementAccepted) {
      wx.showToast({ title: "请先阅读并同意隐私保护指引", icon: "none" });
      return;
    }
    if (!username || !password) {
      wx.showToast({ title: "请输入账号和密码", icon: "none" });
      return;
    }

    this.setData({ loading: true });
    try {
      await api.login(username, password);
      wx.switchTab({ url: "/pages/index/index" });
    } catch (error) {
      wx.showToast({ title: error.message || "登录失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },
});
