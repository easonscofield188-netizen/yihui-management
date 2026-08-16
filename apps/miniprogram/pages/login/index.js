const api = require("../../utils/api");
const { openPrivacyContract } = require("../../utils/privacy-contract");

Page({
  data: {
    username: "",
    password: "",
    showPassword: false,
    agreementAccepted: false,
    loading: false,
    logoutNotice: "",
  },

  onLoad(options = {}) {
    const reason = options.reason
      ? decodeURIComponent(options.reason)
      : (wx.getStorageSync("logout_notice_message") || "");
    if (reason) {
      wx.removeStorageSync("logout_notice_message");
      this.setData({ logoutNotice: reason });
    }

    if (api.getToken() && !reason) {
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
    const val = (event.detail && event.detail.value) || "";
    this.data.username = val.trim();
  },

  onPasswordInput(event) {
    const val = (event.detail && event.detail.value) || "";
    this.data.password = val;
  },

  togglePassword(event) {
    if (event.detail && event.detail.trigger !== "suffix-icon") return;
    const showPassword = !this.data.showPassword;
    this.setData({
      showPassword,
      password: this.data.password || "",
    });
  },

  onAgreementToggle() {
    this.setData({ agreementAccepted: !this.data.agreementAccepted });
  },

  openPrivacyContract,

  async submit() {
    const { agreementAccepted, loading } = this.data;
    const username = (this.data.username || "").trim();
    const password = this.data.password || "";

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
