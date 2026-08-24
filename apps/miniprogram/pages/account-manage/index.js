const api = require("../../utils/api");

const ROOT_SUPER_ADMIN_NO = "YH-ADMIN_SUPER-000";
const CREATE_ROLE_OPTIONS = [
  { label: "超级系统管理员", value: "ADMIN_SUPER" },
  { label: "系统管理员", value: "ADMIN_COM" },
  { label: "项目经理", value: "PROJECT_MANAGER" },
  { label: "项目主管", value: "FINANCE_MANAGER" },
  { label: "普通访客", value: "VISITOR" },
];

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
    jobTitleOptions: [],
    jobTitlePickerVisible: false,
    jobTitlePickerValue: [],
    editingAccountId: "",
    editingAccountUsername: "",
    createPopupVisible: false,
    createPopupMounted: false,
    createSubmitting: false,
    createRoleOptions: CREATE_ROLE_OPTIONS,
    createRoleIndex: 1,
    createRolePickerVisible: false,
    createRolePickerValue: [CREATE_ROLE_OPTIONS[1].value],
    createJobTitlePickerVisible: false,
    createJobTitlePickerValue: [],
    createEmployeeNo: "",
    createEmployeeNoLoading: false,
    createForm: {
      username: "",
      nickname: "",
      email: "",
      role: CREATE_ROLE_OPTIONS[1].value,
      jobTitle: "",
    },
  },

  onLoad() {
    this.setData({ isDevEnvironment: api.isDevelopmentEnvironment() });
    this.checkPermissionAndLoad();
    this.loadJobTitleOptions();
  },

  async loadJobTitleOptions() {
    try {
      const result = await api.queryConfigs("JOB_TITLE");
      const list = Array.isArray(result) ? result : [];
      const activeList = list.filter((item) => item.isActive !== false);
      const options = activeList.map((item) => ({
        label: item.label,
        value: item.label,
      }));
      this.setData({ jobTitleOptions: options });
    } catch (error) {
      console.warn("加载岗位配置失败:", error);
    }
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
    if (this.createPopupCloseTimer) clearTimeout(this.createPopupCloseTimer);
    if (this.createPopupOpenTimer) clearTimeout(this.createPopupOpenTimer);
    this.setData({
      createPopupMounted: true,
      createPopupVisible: false,
      createSubmitting: false,
      createRoleIndex: 1,
      createRolePickerValue: [CREATE_ROLE_OPTIONS[1].value],
      createJobTitlePickerValue: [],
      createForm: {
        username: "",
        nickname: "",
        email: "",
        role: CREATE_ROLE_OPTIONS[1].value,
        jobTitle: "",
      },
    }, () => {
      this.loadNextCreateEmployeeNo();
      this.createPopupOpenTimer = setTimeout(() => {
        this.setData({ createPopupVisible: true });
        this.createPopupOpenTimer = null;
      }, 20);
    });
  },

  closeCreatePopup() {
    if (this.data.createSubmitting) return;
    if (this.createPopupOpenTimer) clearTimeout(this.createPopupOpenTimer);
    this.setData({ createPopupVisible: false });
    if (this.createPopupCloseTimer) clearTimeout(this.createPopupCloseTimer);
    this.createPopupCloseTimer = setTimeout(() => {
      this.setData({ createPopupMounted: false });
      this.createPopupCloseTimer = null;
    }, 260);
  },

  stopPopupTap() {},

  stopPopupTouchMove() {},

  onCreateInput(event) {
    const field = event.currentTarget.dataset.field;
    if (!field) return;
    this.setData({ [`createForm.${field}`]: event.detail.value || "" });
  },

  openCreateRolePicker() {
    this.setData({ createRolePickerVisible: true });
  },

  closeCreateRolePicker() {
    this.setData({ createRolePickerVisible: false });
  },

  onCreateRoleConfirm(event) {
    const role = Array.isArray(event.detail.value) ? event.detail.value[0] : event.detail.value;
    const roleIndex = this.data.createRoleOptions.findIndex(item => item.value === role);
    this.setData({
      createRolePickerVisible: false,
      createRoleIndex: roleIndex < 0 ? 1 : roleIndex,
      createRolePickerValue: [role],
      "createForm.role": role,
    }, () => this.loadNextCreateEmployeeNo());
  },

  openCreateJobTitlePicker() {
    if (!this.data.jobTitleOptions.length) {
      wx.showToast({ title: "暂无职位配置，请先在配置中心添加", icon: "none" });
      return;
    }
    this.setData({ createJobTitlePickerVisible: true });
  },

  closeCreateJobTitlePicker() {
    this.setData({ createJobTitlePickerVisible: false });
  },

  onCreateJobTitleConfirm(event) {
    const jobTitle = Array.isArray(event.detail.value) ? event.detail.value[0] : event.detail.value;
    this.setData({
      createJobTitlePickerVisible: false,
      createJobTitlePickerValue: jobTitle ? [jobTitle] : [],
      "createForm.jobTitle": jobTitle || "",
    });
  },

  async loadNextCreateEmployeeNo() {
    this.setData({ createEmployeeNoLoading: true, createEmployeeNo: "" });
    try {
      const result = await api.getNextEmployeeNo(this.data.createForm.role);
      this.setData({ createEmployeeNo: result.employeeNo || "" });
    } catch (error) {
      this.setData({ createEmployeeNo: "获取失败，请重试" });
    } finally {
      this.setData({ createEmployeeNoLoading: false });
    }
  },

  async submitCreateAccount() {
    if (this.data.createSubmitting) return;
    const form = this.data.createForm;
    const username = String(form.username || "").trim();
    const nickname = String(form.nickname || "").trim();
    const email = String(form.email || "").trim();
    if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) {
      wx.showToast({ title: "账号须为 3-32 位字母、数字或 ._-", icon: "none" });
      return;
    }
    if (!nickname) {
      wx.showToast({ title: "请输入账户昵称", icon: "none" });
      return;
    }

    this.setData({ createSubmitting: true });
    try {
      const createdAccount = await api.createAccount({
        username,
        nickname,
        email,
        role: form.role,
        jobTitle: form.jobTitle,
      });
      this.setData({ createPopupVisible: false });
      if (this.createPopupCloseTimer) clearTimeout(this.createPopupCloseTimer);
      this.createPopupCloseTimer = setTimeout(() => {
        this.setData({ createPopupMounted: false });
        this.createPopupCloseTimer = null;
      }, 260);
      await this.loadData();
      wx.showModal({
        title: "账号创建成功",
        content: `账号“${username}”已创建\n分配工号：${createdAccount.employeeNo || "-"}\n初始密码：yh8888`,
        showCancel: false,
        confirmText: "知道了",
        confirmColor: "#2E9F8B",
      });
    } catch (error) {
      wx.showToast({ title: error.message || "账号创建失败", icon: "none" });
    } finally {
      this.setData({ createSubmitting: false });
    }
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
          jobTitle: item.jobTitle || item.job_title || "",
          job_title: item.jobTitle || item.job_title || "",
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
      confirmColor: "#2E9F8B",
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

  async onEditJobTitle(event) {
    const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {};
    const id = dataset.id || "";
    const username = dataset.username || "";
    const jobTitle = dataset.jobTitle || dataset.jobtitle || "";
    if (!id && !username) return;

    if (!this.data.jobTitleOptions.length) {
      wx.showLoading({ title: "正在加载配置..." });
      await this.loadJobTitleOptions();
      wx.hideLoading();
      if (!this.data.jobTitleOptions.length) {
        wx.showToast({ title: "暂无岗位配置，请先在数据配置中心添加", icon: "none" });
        return;
      }
    }

    const defaultVal = jobTitle || (this.data.jobTitleOptions[0] ? this.data.jobTitleOptions[0].value : "");

    // 打开选择器时，将系统胶囊文字设为白色以完美融入深色遮罩层
    try {
      wx.setNavigationBarColor({ frontColor: "#ffffff", backgroundColor: "#000000" });
    } catch (e) {}

    this.setData({
      editingAccountId: id,
      editingAccountUsername: username,
      jobTitlePickerValue: defaultVal ? [defaultVal] : [],
      jobTitlePickerVisible: true,
    });
  },

  closeJobTitlePicker(event) {
    try {
      wx.setNavigationBarColor({ frontColor: "#000000", backgroundColor: "#ffffff" });
    } catch (e) {}

    const trigger = event && event.detail && event.detail.trigger;
    // TDesign Picker 会先触发 close，再触发 confirm。确认关闭时必须保留
    // 当前账号，交给 onJobTitleConfirm 完成保存；取消/遮罩关闭才清空。
    const closingByConfirm = trigger === "confirm-btn";
    this.setData({
      jobTitlePickerVisible: false,
      ...(closingByConfirm ? {} : {
        editingAccountId: "",
        editingAccountUsername: "",
      }),
    });
  },

  async onJobTitleConfirm(event) {
    try {
      wx.setNavigationBarColor({ frontColor: "#000000", backgroundColor: "#ffffff" });
    } catch (e) {}

    const detail = (event && event.detail) || {};
    let selectedJobTitle = "";
    if (Array.isArray(detail.value) && detail.value.length > 0) {
      selectedJobTitle = String(detail.value[0] || "").trim();
    } else if (typeof detail.value === "string") {
      selectedJobTitle = detail.value.trim();
    }
    if (!selectedJobTitle && Array.isArray(detail.label) && detail.label.length > 0) {
      selectedJobTitle = String(detail.label[0] || "").trim();
    }
    if (!selectedJobTitle && Array.isArray(detail.columns) && detail.columns.length > 0) {
      const opt = this.data.jobTitleOptions[detail.columns[0].index];
      if (opt) selectedJobTitle = String(opt.value || opt.label || "").trim();
    }
    if (!selectedJobTitle && this.data.jobTitleOptions[0]) {
      selectedJobTitle = String(this.data.jobTitleOptions[0].value || "").trim();
    }

    const accountId = this.data.editingAccountId;
    const username = this.data.editingAccountUsername;
    this.setData({
      jobTitlePickerVisible: false,
      editingAccountId: "",
      editingAccountUsername: "",
    });

    if (!accountId && !username) return;

    // 1. 立即前端本地乐观更新，确保 0 毫秒实时刷新界面
    const updatedList = (this.data.list || []).map(item => {
      const matchId = accountId && (String(item.id) === String(accountId) || String(item._id) === String(accountId));
      const matchUsername = username && String(item.username).toLowerCase() === String(username).toLowerCase();
      if (matchId || matchUsername) {
        return {
          ...item,
          jobTitle: selectedJobTitle,
          job_title: selectedJobTitle,
        };
      }
      return item;
    });
    this.setData({ list: updatedList });

    // 2. 如果修改的是当前登录用户自身的账号，同步更新本地全局用户信息缓存
    const currentUser = api.getCachedUserInfo();
    if (currentUser && ((accountId && (currentUser.id === accountId || currentUser._id === accountId)) || (username && currentUser.username === username))) {
      currentUser.jobTitle = selectedJobTitle;
      currentUser.job_title = selectedJobTitle;
      api.cacheUserInfo(currentUser);
    }

    wx.showLoading({ title: "正在更新职位..." });
    try {
      await api.updateAccountJobTitle(accountId || username, selectedJobTitle, username);
      wx.hideLoading();
      wx.showToast({ title: "职位已更新", icon: "success" });
      this.setData({ loading: false });
      await this.loadData();
    } catch (error) {
      wx.hideLoading();
      wx.showToast({ title: error.message || "更新职位失败", icon: "none" });
      this.setData({ loading: false });
      this.loadData();
    }
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
