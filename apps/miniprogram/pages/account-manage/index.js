const api = require("../../utils/api");

const ROOT_SUPER_ADMIN_NO = "YH-ADMIN_SUPER-000";

function getNavMetrics() {
  const systemInfo = wx.getSystemInfoSync();
  const statusBarHeight = systemInfo.statusBarHeight || 0;
  const menuButton = wx.getMenuButtonBoundingClientRect();
  const contentHeight = menuButton && menuButton.height
    ? menuButton.height + Math.max(0, menuButton.top - statusBarHeight) * 2
    : 44;
  return { statusBarHeight, navHeight: statusBarHeight + contentHeight };
}

function formatDate(val) {
  if (!val) return "";
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return String(val);
    const pad = n => String(n).padStart(2, "0");
    const Y = d.getFullYear();
    const M = pad(d.getMonth() + 1);
    const D = pad(d.getDate());
    const h = pad(d.getHours());
    const m = pad(d.getMinutes());
    return `${Y}-${M}-${D} ${h}:${m}`;
  } catch (e) {
    return String(val);
  }
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

Page({
  data: {
    ...getNavMetrics(),
    tabs: [
      { label: "全部", value: "ALL" },
      { label: "正常", value: "ACTIVE" },
      { label: "已停用", value: "DISABLED" },
    ],
    tabIndex: 0,
    keyword: "",
    list: [],
    loading: false,
    totalCount: 0,
    activeCount: 0,
    disabledCount: 0,
    isDevEnvironment: true,
  },

  onLoad() {
    this.setData({ isDevEnvironment: api.isDevelopmentEnvironment() });
    this.checkPermissionAndLoad();
  },

  onShow() {
    if (this.authorized) {
      this.loadData();
    }
  },

  onPullDownRefresh() {
    this.loadData().finally(() => wx.stopPullDownRefresh());
  },

  async checkPermissionAndLoad() {
    let userInfo = api.getCachedUserInfo() || {};
    if (!userInfo.role || !api.isUserInfoCacheFresh()) {
      try {
        userInfo = await api.getUserInfo();
        api.cacheUserInfo(userInfo);
      } catch (error) {
        this.denyAccess("未能获取当前登录用户信息");
        return;
      }
    }

    if (userInfo.role !== "ADMIN_SUPER" || userInfo.employeeNo !== ROOT_SUPER_ADMIN_NO) {
      this.denyAccess("仅编号 000 的超级系统管理员拥有账号管理权限");
      return;
    }

    this.authorized = true;
    this.loadData();
  },

  denyAccess(message) {
    wx.showToast({ title: message || "无权访问", icon: "none" });
    setTimeout(() => {
      const pages = getCurrentPages();
      if (pages.length > 1) wx.navigateBack();
      else wx.switchTab({ url: "/pages/profile/index" });
    }, 600);
  },

  back() {
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack();
    else wx.switchTab({ url: "/pages/profile/index" });
  },

  navToCreate() {
    wx.navigateTo({ url: "/pages/account-create/index" });
  },

  changeTab(event) {
    const index = Number(event.currentTarget.dataset.index || 0);
    if (index === this.data.tabIndex) return;
    this.setData({ tabIndex: index }, () => this.loadData());
  },

  onSearchInput(event) {
    const keyword = String(event.detail.value || "");
    this.setData({ keyword });
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.loadData(), 300);
  },

  clearSearch() {
    this.setData({ keyword: "" }, () => this.loadData());
  },

  onAvatarError(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (isNaN(index)) return;
    const list = this.data.list || [];
    if (list[index]) {
      this.setData({
        [`list[${index}].hasCustomAvatar`]: false,
        [`list[${index}].avatarDisplayUrl`]: "",
      });
    }
  },

  async loadData() {
    if (this.data.loading) return;
    this.setData({ loading: true });

    const status = this.data.tabs[this.data.tabIndex].value;
    const keyword = this.data.keyword.trim();

    try {
      const result = await api.listAccounts({
        status,
        keyword,
      });

      const rawList = result.list || [];
      const list = rawList.map((item, index) => {
        const rawUrl = String(item.avatarUrl || "").trim();
        const validHttpUrl = !rawUrl.startsWith("http://tmp") && !rawUrl.startsWith("wxfile://") ? rawUrl : "";
        const avatarDisplayUrl = validHttpUrl
          || item.avatarFileId
          || toCloudFileId(rawUrl)
          || "";
        const isRootAdmin = item.isRootAdmin || item.employeeNo === ROOT_SUPER_ADMIN_NO;
        // 主账号专属 root 主题，其他账号交替采用不同色彩的立体阴影主题
        const cardTheme = isRootAdmin
          ? "root"
          : (index % 3 === 0 ? "blue" : (index % 3 === 1 ? "purple" : "teal"));

        return {
          ...item,
          avatarDisplayUrl,
          hasCustomAvatar: Boolean(avatarDisplayUrl),
          isRootAdmin,
          cardTheme,
          createdAtFormatted: formatDate(item.createdAt),
          lastLoginFormatted: formatDate(item.lastLoginTime),
        };
      });

      this.setData({
        list,
        totalCount: result.total !== undefined ? result.total : list.length,
        activeCount: result.activeCount !== undefined ? result.activeCount : list.filter(i => i.status === "active").length,
        disabledCount: result.disabledCount !== undefined ? result.disabledCount : list.filter(i => i.status === "disabled").length,
      });
    } catch (error) {
      wx.showToast({ title: error.message || "读取账号列表失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  onResetPassword(event) {
    const { id, username } = event.currentTarget.dataset;
    if (!id) return;

    wx.showModal({
      title: "重置登录密码",
      content: `确定将账号【${username}】的登录密码重置为默认密码【yh8888】吗？\n重置后该账号所有已登录会话将被立即强制下线。`,
      confirmText: "确认重置",
      confirmColor: "#ba1a1a",
      cancelText: "取消",
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: "正在重置..." });
          try {
            const result = await api.resetAccountPassword(id);
            wx.hideLoading();
            wx.showModal({
              title: "密码重置成功",
              content: `账号 ${username} 的新登录密码为：${result.defaultPassword || "yh8888"}，请及时通知使用人。`,
              showCancel: false,
            });
            this.loadData();
          } catch (error) {
            wx.hideLoading();
            wx.showToast({ title: error.message || "重置密码失败", icon: "none" });
          }
        }
      },
    });
  },

  onDisableAccount(event) {
    const { id, username } = event.currentTarget.dataset;
    if (!id) return;

    wx.showModal({
      title: "停用账号确认",
      content: `确定停用账号【${username}】吗？\n停用后该账号将立即被强制下线，并回收全部系统访问权限。`,
      confirmText: "确认停用",
      confirmColor: "#ba1a1a",
      cancelText: "取消",
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: "正在处理..." });
          try {
            await api.updateAccountStatus(id, "disabled");
            wx.hideLoading();
            wx.showToast({ title: "账号已停用并强制下线", icon: "success" });
            this.loadData();
          } catch (error) {
            wx.hideLoading();
            wx.showToast({ title: error.message || "停用失败", icon: "none" });
          }
        }
      },
    });
  },

  onEnableAccount(event) {
    const { id, username } = event.currentTarget.dataset;
    if (!id) return;

    wx.showModal({
      title: "恢复启用确认",
      content: `确定恢复启用账号【${username}】吗？启用后该账号可正常登录系统。`,
      confirmText: "确认启用",
      confirmColor: "#176c4b",
      cancelText: "取消",
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: "正在处理..." });
          try {
            await api.updateAccountStatus(id, "active");
            wx.hideLoading();
            wx.showToast({ title: "账号已成功启用", icon: "success" });
            this.loadData();
          } catch (error) {
            wx.hideLoading();
            wx.showToast({ title: error.message || "启用失败", icon: "none" });
          }
        }
      },
    });
  },

  onDeleteAccount(event) {
    const { id, username, employeeno } = event.currentTarget.dataset;
    if (!id) return;

    if (!this.data.isDevEnvironment) {
      wx.showToast({ title: "生产环境严禁删除账号", icon: "none" });
      return;
    }

    wx.showModal({
      title: "删除账号确认",
      content: `【开发环境专属特权】\n确定删除账号【${username}】（工号：${employeeno || "-"}）吗？\n删除后该账号数据将被彻底清除，其员工编号将立即释放供新账号分配使用。`,
      confirmText: "彻底删除",
      confirmColor: "#ba1a1a",
      cancelText: "取消",
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: "正在删除..." });
          try {
            const result = await api.deleteAccount(id);
            wx.hideLoading();
            wx.showModal({
              title: "账号删除成功",
              content: `账号 ${username} 已删除，员工编号【${result.releasedEmployeeNo || employeeno || "-"}】已成功释放，可在创建新账号时自动分配！`,
              showCancel: false,
            });
            this.loadData();
          } catch (error) {
            wx.hideLoading();
            wx.showToast({ title: error.message || "删除失败", icon: "none" });
          }
        }
      },
    });
  },
});
