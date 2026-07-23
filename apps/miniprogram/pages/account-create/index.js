const api = require("../../utils/api");

const ROLE_OPTIONS = [
  { label: "超级系统管理员", value: "ADMIN_SUPER" },
  { label: "系统管理员", value: "ADMIN_COM" },
  { label: "项目经理", value: "PROJECT_MANAGER" },
  { label: "财务主管", value: "FINANCE_MANAGER" },
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
    form: {
      username: "",
      password: "",
      confirmPassword: "",
      nickname: "",
      email: "",
      role: ROLE_OPTIONS[1].value,
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
    if (form.password.length < 6 || form.password.length > 64) {
      wx.showToast({ title: "密码长度须为 6-64 位", icon: "none" });
      return;
    }
    if (form.password !== form.confirmPassword) {
      wx.showToast({ title: "两次输入的密码不一致", icon: "none" });
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
        passwordPlain: form.password,
        nickname,
        email,
        role: form.role,
      });
      await new Promise((resolve) => {
        wx.showModal({
          title: "创建成功",
          content: `账号 ${username} 已创建，工号：${createdAccount.employeeNo}。`,
          showCancel: false,
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
