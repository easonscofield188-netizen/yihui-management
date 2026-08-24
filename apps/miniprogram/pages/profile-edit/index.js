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
    userInfo: null,
    maskedEmail: "",

    // 表单输入
    usernameInput: "",
    nicknameInput: "",
    tempAvatarUrl: "",
    tempAvatarFileId: "",
    uploadingAvatar: false,

    // 提交与鉴权弹窗
    submitting: false,
    showConfirmModal: false,
    changedDiffList: [],
    currentPasswordInput: "",
    showModalPassword: false,
  },

  async onLoad() {
    let user = api.getCachedUserInfo();
    const cacheHasJobTitle = user
      && (Object.prototype.hasOwnProperty.call(user, "jobTitle")
        || Object.prototype.hasOwnProperty.call(user, "job_title"));
    if (!user || !user.username || !cacheHasJobTitle) {
      try {
        user = await api.getUserInfo();
        api.cacheUserInfo(user);
      } catch (err) {
        wx.showToast({ title: "加载账户信息失败", icon: "none" });
      }
    }

    if (user) {
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
        maskedEmail: user.email ? maskEmail(user.email) : "",
        usernameInput: user.username || "",
        nicknameInput: user.nickname || user.username || "",
      });
    }
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
    } else {
      wx.switchTab({ url: "/pages/profile/index" });
    }
  },

  preventTouchMove() {},

  onAvatarError() {
    this.setData({
      "userInfo.hasCustomAvatar": false,
      "userInfo.avatarDisplayUrl": "",
      tempAvatarUrl: "",
      tempAvatarFileId: "",
    });
  },

  async chooseAvatar() {
    if (this.data.uploadingAvatar) return;

    try {
      const res = await new Promise((resolve, reject) => {
        wx.chooseMedia({
          count: 1,
          mediaType: ["image"],
          sizeType: ["compressed"],
          sourceType: ["album", "camera"],
          success: resolve,
          fail: reject,
        });
      });

      const tempFilePath = res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath;
      if (!tempFilePath) return;

      this.setData({
        tempAvatarUrl: tempFilePath,
        uploadingAvatar: true,
      });

      const uploadRes = await api.uploadUserAvatar(tempFilePath);
      this.setData({
        tempAvatarFileId: uploadRes.fileID || uploadRes.fileId,
        uploadingAvatar: false,
      });
      wx.showToast({ title: "头像已选择", icon: "none" });
    } catch (err) {
      this.setData({ uploadingAvatar: false });
      if (err && err.errMsg && !err.errMsg.includes("cancel")) {
        wx.showToast({ title: "头像上传失败，请重试", icon: "none" });
      }
    }
  },

  onUsernameInput(event) {
    const val = (event.detail && event.detail.value) || "";
    this.setData({ usernameInput: val.trim() });
  },

  onNicknameInput(event) {
    const val = (event.detail && event.detail.value) || "";
    this.setData({ nicknameInput: val.trim() });
  },

  navToPasswordChange() {
    wx.navigateTo({ url: "/pages/password-change/index" });
  },

  onPreSubmit() {
    if (this.data.submitting || this.data.uploadingAvatar) return;

    const { usernameInput, nicknameInput, userInfo, tempAvatarFileId } = this.data;

    const cleanUsername = String(usernameInput || "").trim();
    const cleanNickname = String(nicknameInput || "").trim();

    if (!cleanUsername) {
      wx.showToast({ title: "请输入登录账号", icon: "none" });
      return;
    }
    if (!/^[a-zA-Z0-9_]{3,32}$/.test(cleanUsername)) {
      wx.showToast({ title: "登录账号须为 3-32 位字母数字或下划线", icon: "none" });
      return;
    }
    if (!cleanNickname) {
      wx.showToast({ title: "请输入用户昵称", icon: "none" });
      return;
    }
    if (cleanNickname.length > 30) {
      wx.showToast({ title: "昵称长度不能超过 30 个字符", icon: "none" });
      return;
    }

    // 检查是否有任何改动
    const originalUsername = userInfo.username || "";
    const originalNickname = userInfo.nickname || userInfo.username || "";

    const hasUsernameChange = cleanUsername !== originalUsername;
    const hasNicknameChange = cleanNickname !== originalNickname;
    const hasAvatarChange = Boolean(tempAvatarFileId);

    if (!hasUsernameChange && !hasNicknameChange && !hasAvatarChange) {
      wx.showToast({ title: "个人资料未做任何修改", icon: "none" });
      return;
    }

    // 构造变动清单
    const changedDiffList = [];
    if (hasUsernameChange) {
      changedDiffList.push(`登录账号：${originalUsername} → ${cleanUsername}`);
    }
    if (hasNicknameChange) {
      changedDiffList.push(`用户昵称：${originalNickname} → ${cleanNickname}`);
    }
    if (hasAvatarChange) {
      changedDiffList.push("更换个人头像图片");
    }

    this.setData({
      changedDiffList,
      currentPasswordInput: "",
      showConfirmModal: true,
      showModalPassword: false,
    });
  },

  closeConfirmModal() {
    this.setData({
      showConfirmModal: false,
      currentPasswordInput: "",
    });
  },

  onCurrentPasswordInput(event) {
    const val = (event.detail && event.detail.value) || "";
    this.setData({ currentPasswordInput: val });
  },

  toggleModalPassword(event) {
    if (event.detail && event.detail.trigger !== "suffix-icon") return;
    this.setData({ showModalPassword: !this.data.showModalPassword });
  },

  async onFinalSubmit() {
    if (this.data.submitting) return;

    const { usernameInput, nicknameInput, tempAvatarFileId, tempAvatarUrl, currentPasswordInput } = this.data;

    const password = String(currentPasswordInput || "").trim();
    if (!password) {
      wx.showToast({ title: "请输入当前登录密码进行验证", icon: "none" });
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: "正在保存资料...", mask: true });

    try {
      const payload = {
        username: usernameInput,
        nickname: nicknameInput,
        currentPassword: password,
      };
      if (tempAvatarFileId) {
        payload.avatarFileId = tempAvatarFileId;
        payload.avatarUrl = tempAvatarUrl;
      }

      const res = await api.updateUserInfo(payload);

      // 更新全局用户信息缓存
      const updatedUser = res.data || res;
      api.cacheUserInfo(updatedUser);
      try {
        getApp().globalData.userInfo = updatedUser;
      } catch (e) {}

      wx.hideLoading();
      this.setData({ showConfirmModal: false });

      await new Promise((resolve) => {
        wx.showModal({
          title: "资料修改成功",
          content: "您的个人资料已更新完成！",
          showCancel: false,
          confirmText: "确定",
          confirmColor: "#2E9F8B",
          success: resolve,
        });
      });

      this.goBack();
    } catch (err) {
      wx.hideLoading();
      wx.showModal({
        title: "验证失败",
        content: err.message || "密码错误或修改失败，请重试",
        showCancel: false,
      });
    } finally {
      wx.hideLoading();
      this.setData({ submitting: false });
    }
  },
});
