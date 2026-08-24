const api = require("../../utils/api");

const ROLE_OPTIONS = [
  { label: "超级系统管理员", value: "ADMIN_SUPER" },
  { label: "系统管理员", value: "ADMIN_COM" },
  { label: "项目经理", value: "PROJECT_MANAGER" },
  { label: "项目主管", value: "FINANCE_MANAGER" },
  { label: "普通访客", value: "VISITOR" },
];

Page({
  data: {
    roleOptions: ROLE_OPTIONS,
    roleIndex: 1,
    rolePickerVisible: false,
    rolePickerValue: [ROLE_OPTIONS[1].value],
    employeeNo: "",
    employeeNoLoading: false,
    submitting: false,
    // 职位选择相关
    jobTitleOptions: [],
    jobTitleLoading: false,
    jobTitleIndex: -1,
    jobTitlePickerVisible: false,
    jobTitlePickerValue: [],
    form: {
      username: "",
      nickname: "",
      email: "",
      role: ROLE_OPTIONS[1].value,
      jobTitle: "",
    },
  },

  onLoad() {
    const currentUser = wx.getStorageSync("userInfo") || {};
    if (currentUser.role !== "ADMIN_SUPER") {
      wx.showToast({ title: "无权访问", icon: "none" });
      setTimeout(() => wx.navigateBack(), 600);
      return;
    }
    this.loadNextEmployeeNo();
    this.loadJobTitleOptions();
  },

  /** 加载岗位名称配置选项 */
  async loadJobTitleOptions() {
    this.setData({ jobTitleLoading: true });
    try {
      const result = await api.queryConfigs("JOB_TITLE");
      const list = Array.isArray(result) ? result : [];
      // 只取启用中的配置项
      const activeList = list.filter((item) => item.isActive !== false);
      const options = activeList.map((item) => ({
        label: item.label,
        value: item.label,
      }));
      this.setData({ jobTitleOptions: options });
    } catch (error) {
      console.warn("加载岗位配置失败:", error);
    } finally {
      this.setData({ jobTitleLoading: false });
    }
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: event.detail.value });
  },

  openRolePicker() {
    this.setData({ rolePickerVisible: true });
  },

  closeRolePicker() {
    this.setData({ rolePickerVisible: false });
  },

  onRoleConfirm(event) {
    const role = event.detail.value[0];
    const roleIndex = this.data.roleOptions.findIndex((item) => item.value === role);
    this.setData({
      roleIndex: roleIndex < 0 ? 1 : roleIndex,
      rolePickerValue: [role],
      rolePickerVisible: false,
      "form.role": role,
    }, () => this.loadNextEmployeeNo());
  },

  /** 打开职位选择器 */
  openJobTitlePicker() {
    if (!this.data.jobTitleOptions.length) {
      wx.showToast({ title: "暂无岗位配置，请先在数据配置中心添加", icon: "none" });
      return;
    }
    this.setData({ jobTitlePickerVisible: true });
  },

  closeJobTitlePicker() {
    this.setData({ jobTitlePickerVisible: false });
  },

  onJobTitleConfirm(event) {
    const selected = event.detail.value[0];
    const idx = this.data.jobTitleOptions.findIndex((item) => item.value === selected);
    this.setData({
      jobTitleIndex: idx,
      jobTitlePickerValue: [selected],
      jobTitlePickerVisible: false,
      "form.jobTitle": selected,
    });
  },

  async loadNextEmployeeNo() {
    this.setData({ employeeNoLoading: true, employeeNo: "" });
    try {
      const result = await api.getNextEmployeeNo(this.data.form.role);
      this.setData({ employeeNo: result.employeeNo || "" });
    } catch (error) {
      this.setData({ employeeNo: "获取失败，请重试" });
    } finally {
      this.setData({ employeeNoLoading: false });
    }
  },

  close() {
    wx.navigateBack();
  },

  async submit() {
    if (this.data.submitting) return;
    const form = this.data.form;
    const username = form.username.trim();
    const nickname = form.nickname.trim();
    const email = form.email.trim();

    if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) {
      wx.showToast({ title: "账号须为 3-32 位字母、数字或 ._-", icon: "none" });
      return;
    }
    if (!nickname) {
      wx.showToast({ title: "请输入账户昵称", icon: "none" });
      return;
    }

    this.setData({ submitting: true });
    try {
      const createdAccount = await api.createAccount({
        username,
        nickname,
        email,
        role: form.role,
        jobTitle: form.jobTitle,
      });
      await new Promise((resolve) => {
        wx.showModal({
          title: "账号创建成功",
          content: `账号【${username}】已创建！\n分配工号：${createdAccount.employeeNo}\n初始默认密码：yh8888\n\n使用人首次登录时系统将主动提醒修改密码。`,
          showCancel: false,
          confirmText: "知道了",
          confirmColor: "#2E9F8B",
          success: resolve,
        });
      });
      wx.navigateBack();
    } catch (error) {
      wx.showToast({ title: error.message || "账号创建失败", icon: "none" });
    } finally {
      this.setData({ submitting: false });
    }
  },
});
