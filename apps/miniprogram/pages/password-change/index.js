const api = require("../../utils/api");

function getNavMetrics() {
  const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
  const statusBarHeight = windowInfo.statusBarHeight || 20;
  const menuButton = (wx.getMenuButtonBoundingClientRect && wx.getMenuButtonBoundingClientRect())
    || { top: statusBarHeight + 4, height: 32 };
  const navHeight = menuButton.top + menuButton.height + Math.max(0, menuButton.top - statusBarHeight);
  return { statusBarHeight, navHeight };
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

function maskEmail(email) {
  const value = String(email || "").trim();
  const [name, domain] = value.split("@");
  if (!name || !domain) return value ? "***" : "";
  return `${name.slice(0, 2)}***@${domain}`;
}

Page({
  data: {
    ...getNavMetrics(),
    step: "change", // 'bind' | 'change'
    userInfo: null,
    maskedEmail: "",

    // 绑定邮箱相关
    bindEmailInput: "",
    bindCodeInput: "",
    bindCountdown: 0,
    sendingBindCode: false,
    submittingBind: false,

    // 修改密码相关
    code: "",
    newPassword: "",
    confirmPassword: "",
    showPassword: false,
    showConfirmPassword: false,
    canSendCode: true,
    sendingCode: false,
    submitting: false,
    countdown: 0,
  },

  timer: null,
  bindTimer: null,

  async onLoad() {
    let user = api.getCachedUserInfo();
    if (!user || !user.username) {
      try {
        user = await api.getUserInfo();
        api.cacheUserInfo(user);
      } catch (err) {
        wx.showToast({ title: "加载用户信息失败", icon: "none" });
      }
    }

    if (user) {
      const hasEmail = Boolean(user.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email));
      const rawUrl = String(user.avatarUrl || "").trim();
      const validHttpUrl = !rawUrl.startsWith("http://tmp") && !rawUrl.startsWith("wxfile://") ? rawUrl : "";
      const avatarDisplayUrl = validHttpUrl
        || user.avatarFileId
        || toCloudFileId(rawUrl)
        || "";
      const decoratedUser = {
        ...user,
        avatarDisplayUrl,
        hasCustomAvatar: Boolean(avatarDisplayUrl),
      };
      this.setData({
        userInfo: decoratedUser,
        step: hasEmail ? "change" : "bind",
        maskedEmail: hasEmail ? maskEmail(user.email) : "",
      });
    }
  },

  onAvatarError() {
    this.setData({
      "userInfo.hasCustomAvatar": false,
      "userInfo.avatarDisplayUrl": "",
    });
  },

  onUnload() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.bindTimer) {
      clearInterval(this.bindTimer);
      this.bindTimer = null;
    }
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
    } else {
      wx.switchTab({ url: "/pages/index/index" });
    }
  },

  // 绑定邮箱相关事件
  onBindEmailInput(event) {
    const val = (event.detail && event.detail.value) || "";
    this.setData({ bindEmailInput: val.trim() });
  },

  onBindCodeInput(event) {
    const val = (event.detail && event.detail.value) || "";
    this.setData({ bindCodeInput: val.trim() });
  },

  async onSendBindCode() {
    if (this.data.sendingBindCode || this.data.bindCountdown > 0) return;
    const email = this.data.bindEmailInput.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      wx.showToast({ title: "请输入正确的邮箱格式", icon: "none" });
      return;
    }

    this.setData({ sendingBindCode: true });
    try {
      await api.sendBindEmailCode(email);
      wx.showToast({ title: "验证码已发送", icon: "success" });
      this.startBindCountdown();
    } catch (err) {
      wx.showModal({
        title: "发送失败",
        content: err.message || "发送验证码失败，请重试",
        showCancel: false,
      });
    } finally {
      this.setData({ sendingBindCode: false });
    }
  },

  startBindCountdown() {
    if (this.bindTimer) clearInterval(this.bindTimer);
    let seconds = 60;
    this.setData({ bindCountdown: seconds });

    this.bindTimer = setInterval(() => {
      seconds -= 1;
      if (seconds <= 0) {
        clearInterval(this.bindTimer);
        this.bindTimer = null;
        this.setData({ bindCountdown: 0 });
      } else {
        this.setData({ bindCountdown: seconds });
      }
    }, 1000);
  },

  async onBindEmailSubmit() {
    if (this.data.submittingBind) return;
    const email = String(this.data.bindEmailInput || "").trim();
    const code = String(this.data.bindCodeInput || "").trim();

    if (!email) {
      wx.showToast({ title: "请输入安全邮箱地址", icon: "none" });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      wx.showToast({ title: "请输入正确的邮箱格式", icon: "none" });
      return;
    }
    if (!code) {
      wx.showToast({ title: "请输入 6 位邮箱验证码", icon: "none" });
      return;
    }
    if (code.length !== 6) {
      wx.showToast({ title: "验证码应为 6 位数字", icon: "none" });
      return;
    }

    this.setData({ submittingBind: true });
    wx.showLoading({ title: "正在绑定邮箱...", mask: true });

    try {
      const res = await api.bindEmailWithCode(email, code);
      const updatedUser = { ...(this.data.userInfo || {}), email: res.email || email };
      api.cacheUserInfo(updatedUser);
      try {
        getApp().globalData.userInfo = updatedUser;
      } catch (e) {}

      wx.hideLoading();
      this.setData({
        userInfo: updatedUser,
        maskedEmail: maskEmail(email),
        step: "change",
      });

      wx.showModal({
        title: "邮箱绑定成功",
        content: `安全邮箱【${maskEmail(email)}】已成功绑定！现在可直接进行修改密码。`,
        showCancel: false,
        confirmText: "去修改密码",
        confirmColor: "#002045",
      });
    } catch (err) {
      wx.hideLoading();
      wx.showModal({
        title: "绑定失败",
        content: err.message || "验证码错误或绑定失败，请重试",
        showCancel: false,
      });
    } finally {
      wx.hideLoading();
      this.setData({ submittingBind: false });
    }
  },

  switchToBindEmail() {
    this.setData({ step: "bind" });
  },

  switchToChangePassword() {
    if (this.data.userInfo && this.data.userInfo.email) {
      this.setData({ step: "change" });
    }
  },

  // 修改密码相关事件
  onCodeInput(event) {
    const val = (event.detail && event.detail.value) || "";
    this.setData({ code: val.trim() });
  },

  onNewPasswordInput(event) {
    const val = (event.detail && event.detail.value) || "";
    this.setData({ newPassword: val });
  },

  onConfirmPasswordInput(event) {
    const val = (event.detail && event.detail.value) || "";
    this.setData({ confirmPassword: val });
  },

  togglePassword(event) {
    if (event.detail && event.detail.trigger !== "suffix-icon") return;
    this.setData({ showPassword: !this.data.showPassword });
  },

  toggleConfirmPassword(event) {
    if (event.detail && event.detail.trigger !== "suffix-icon") return;
    this.setData({ showConfirmPassword: !this.data.showConfirmPassword });
  },

  async onSendCode() {
    if (this.data.sendingCode || this.data.countdown > 0) return;
    if (!this.data.userInfo || !this.data.userInfo.email) {
      this.setData({ step: "bind" });
      wx.showToast({ title: "请先绑定安全邮箱", icon: "none" });
      return;
    }

    this.setData({ sendingCode: true });
    try {
      const res = await api.sendPasswordChangeCode();
      wx.showToast({ title: "验证码已发送", icon: "success" });
      if (res && res.maskedEmail) {
        this.setData({ maskedEmail: res.maskedEmail });
      }
      this.startCountdown();
    } catch (err) {
      wx.showModal({
        title: "发送失败",
        content: err.message || "无法发送验证码邮件，请检查网络或联系管理员",
        showCancel: false,
      });
    } finally {
      this.setData({ sendingCode: false });
    }
  },

  startCountdown() {
    if (this.timer) clearInterval(this.timer);
    let seconds = 60;
    this.setData({ countdown: seconds });

    this.timer = setInterval(() => {
      seconds -= 1;
      if (seconds <= 0) {
        clearInterval(this.timer);
        this.timer = null;
        this.setData({ countdown: 0 });
      } else {
        this.setData({ countdown: seconds });
      }
    }, 1000);
  },

  async onSubmit() {
    if (this.data.submitting) return;

    const { code, newPassword, confirmPassword, userInfo } = this.data;

    if (!userInfo || !userInfo.email) {
      this.setData({ step: "bind" });
      wx.showToast({ title: "请先绑定安全邮箱", icon: "none" });
      return;
    }
    const cleanCode = String(code || "").trim();
    if (!cleanCode) {
      wx.showToast({ title: "请输入邮箱验证码", icon: "none" });
      return;
    }
    if (cleanCode.length !== 6) {
      wx.showToast({ title: "验证码应为 6 位数字", icon: "none" });
      return;
    }
    if (!newPassword) {
      wx.showToast({ title: "请输入新登录密码", icon: "none" });
      return;
    }
    if (newPassword.length < 6 || newPassword.length > 64) {
      wx.showToast({ title: "新密码长度须为 6-64 位", icon: "none" });
      return;
    }
    if (!confirmPassword) {
      wx.showToast({ title: "请再次输入新密码确认", icon: "none" });
      return;
    }
    if (newPassword !== confirmPassword) {
      wx.showToast({ title: "两次输入的新密码不一致", icon: "none" });
      return;
    }
    if (newPassword === "yh8888") {
      wx.showToast({ title: "新密码不能与默认初始密码相同", icon: "none" });
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: "正在修改密码...", mask: true });

    try {
      await api.changePasswordWithCode(code, newPassword);

      // 更新本地用户信息中的密码变更标志
      const updatedUser = { ...(this.data.userInfo || {}), needPasswordChange: false };
      api.cacheUserInfo(updatedUser);
      try {
        getApp().globalData.userInfo = updatedUser;
      } catch (e) {}

      wx.hideLoading();
      await new Promise((resolve) => {
        wx.showModal({
          title: "密码修改成功",
          content: "您的登录密码已成功更新，下次请使用新密码登录。",
          showCancel: false,
          confirmText: "完成",
          confirmColor: "#002045",
          success: resolve,
        });
      });

      this.goBack();
    } catch (err) {
      wx.hideLoading();
      wx.showModal({
        title: "修改失败",
        content: err.message || "密码修改失败，请重试",
        showCancel: false,
      });
    } finally {
      wx.hideLoading();
      this.setData({ submitting: false });
    }
  },
});
