const api = require("../../utils/api");

const FALLBACK_ROLES = [{ label: "利益相关者", value: "stakeholder" }];
const FALLBACK_SOURCES = [{ label: "转介绍", value: "referral" }];

function getNavMetrics() {
  const systemInfo = wx.getSystemInfoSync();
  const statusBarHeight = systemInfo.statusBarHeight || 0;
  const menuButton = wx.getMenuButtonBoundingClientRect();
  const contentHeight = menuButton && menuButton.height
    ? menuButton.height + Math.max(0, menuButton.top - statusBarHeight) * 2
    : 44;
  return { statusBarHeight, navHeight: statusBarHeight + contentHeight };
}

function timeText(value) {
  const raw = value && value.$date ? value.$date : value;
  const date = new Date(raw || 0);
  if (Number.isNaN(date.getTime())) return "暂无记录";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function optionLabel(options, value) {
  return options.find(item => item.value === value)?.label || value || "未设置";
}

Page({
  data: {
    ...getNavMetrics(),
    clients: [],
    keyword: "",
    page: 1,
    total: 0,
    hasMore: true,
    loading: false,
    operating: false,
    loadingMessage: "正在加载客户...",
    roleOptions: FALLBACK_ROLES,
    sourceOptions: FALLBACK_SOURCES,
    roleFilters: [{ label: "全部角色", value: "" }, ...FALLBACK_ROLES],
    sourceFilters: [{ label: "全部渠道", value: "" }, ...FALLBACK_SOURCES],
    roleFilter: "",
    sourceFilter: "",
    impactVisible: false,
    impactMode: "edit",
    prepared: null,
    editorVisible: false,
    editForm: {
      id: "",
      name: "",
      roleCode: "",
      source: "",
      paymentCycle: "",
      description: "",
    },
    editRoleLabel: "",
    editSourceLabel: "",
    pickerVisible: false,
    pickerField: "",
    pickerTitle: "",
    pickerOptions: [],
    pickerValue: [],
  },

  onLoad() {
    if (!api.getToken()) {
      wx.showToast({ title: "仅超级系统管理员可管理客户", icon: "none" });
      setTimeout(() => this.goBack(), 300);
      return;
    }
    this.authorizeAndInitialize();
  },

  async authorizeAndInitialize() {
    let userInfo = api.getCachedUserInfo() || {};
    if (!userInfo.role || !api.isUserInfoCacheFresh()) {
      try {
        userInfo = await api.getUserInfo();
        api.cacheUserInfo(userInfo);
      } catch (error) {
        wx.showToast({ title: error.message || "账号权限校验失败", icon: "none" });
        setTimeout(() => this.goBack(), 300);
        return;
      }
    }
    if (userInfo.role !== "ADMIN_SUPER") {
      wx.showToast({ title: "仅超级系统管理员可管理客户", icon: "none" });
      setTimeout(() => this.goBack(), 300);
      return;
    }
    this.initialize();
  },

  onUnload() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
  },

  onPullDownRefresh() {
    this.loadClients(true).finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (!this.data.loading && !this.data.operating && this.data.hasMore) this.loadClients(false);
  },

  async initialize() {
    try {
      const configs = await api.getGlobalConfig();
      const roleOptions = configs.CLIENT_ROLE?.length ? configs.CLIENT_ROLE : FALLBACK_ROLES;
      const sourceOptions = configs.CLIENT_SOURCE?.length ? configs.CLIENT_SOURCE : FALLBACK_SOURCES;
      this.setData({
        roleOptions,
        sourceOptions,
        roleFilters: [{ label: "全部角色", value: "" }, ...roleOptions],
        sourceFilters: [{ label: "全部渠道", value: "" }, ...sourceOptions],
      });
    } catch (error) {
      // 配置读取失败时使用本地兜底项，不影响客户列表加载。
    }
    await this.loadClients(true);
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack();
    else wx.switchTab({ url: "/pages/profile/index" });
  },

  decorateClient(client, listIndex = 0) {
    return {
      ...client,
      avatarText: String(client.name || "客").slice(0, 1),
      cardToneClass: listIndex % 2 === 0 ? "tone-blue" : "tone-green",
      roleLabel: optionLabel(this.data.roleOptions, client.roleCode || client.role),
      sourceLabel: optionLabel(this.data.sourceOptions, client.source),
      updateTimeText: timeText(client.updateTime),
    };
  },

  async loadClients(reset) {
    if (this.data.loading || (!reset && !this.data.hasMore)) return;
    const page = reset ? 1 : this.data.page;
    this.setData({ loading: true });
    try {
      const result = await api.listManagedClients({
        page,
        pageSize: 20,
        keyword: this.data.keyword.trim(),
        roleCode: this.data.roleFilter,
        source: this.data.sourceFilter,
      });
      const listOffset = (page - 1) * 20;
      const incoming = (result.list || []).map((item, index) => this.decorateClient(item, listOffset + index));
      this.setData({
        clients: reset ? incoming : this.data.clients.concat(incoming),
        total: Number(result.total) || 0,
        page: page + 1,
        hasMore: Boolean(result.hasMore),
      });
    } catch (error) {
      wx.showToast({ title: error.message || "客户加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  onKeywordInput(event) {
    const keyword = String(event.detail.value || "");
    this.setData({ keyword });
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.loadClients(true), 300);
  },

  clearKeyword() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.setData({ keyword: "" }, () => this.loadClients(true));
  },

  selectRoleFilter(event) {
    const value = String(event.currentTarget.dataset.value || "");
    if (value === this.data.roleFilter) return;
    this.setData({ roleFilter: value }, () => this.loadClients(true));
  },

  selectSourceFilter(event) {
    const value = String(event.currentTarget.dataset.value || "");
    if (value === this.data.sourceFilter) return;
    this.setData({ sourceFilter: value }, () => this.loadClients(true));
  },

  async editClient(event) {
    await this.prepareClientAction(String(event.currentTarget.dataset.id || ""), "edit");
  },

  async requestDeleteClient(event) {
    await this.prepareClientAction(String(event.currentTarget.dataset.id || ""), "delete");
  },

  async prepareClientAction(id, mode) {
    if (!id || this.data.operating) return;
    this.setData({ operating: true, loadingMessage: "正在检查项目引用..." });
    try {
      const prepared = await api.prepareClientUpdate(id);
      this.setData({ prepared, impactMode: mode });
      if (prepared.referenceCount > 0) {
        this.setData({ impactVisible: true });
      } else if (mode === "edit") {
        this.openEditor(prepared);
      } else {
        this.confirmDelete(prepared);
      }
    } catch (error) {
      this.setData({ operating: false });
      wx.showToast({ title: error.message || "引用检查失败", icon: "none" });
    } finally {
      if (this.data.operating) this.setData({ operating: false });
    }
  },

  closeImpact() {
    this.setData({ impactVisible: false });
  },

  continueEdit() {
    const prepared = this.data.prepared;
    this.setData({ impactVisible: false });
    if (prepared) this.openEditor(prepared);
  },

  openEditor(prepared) {
    const client = prepared.client || {};
    this.setData({
      editorVisible: true,
      prepared,
      editRoleLabel: optionLabel(this.data.roleOptions, client.roleCode || client.role),
      editSourceLabel: optionLabel(this.data.sourceOptions, client.source),
      editForm: {
        id: client.id || "",
        name: client.name || "",
        roleCode: client.roleCode || client.role || this.data.roleOptions[0]?.value || "",
        source: client.source || this.data.sourceOptions[0]?.value || "",
        paymentCycle: client.paymentCycle || "",
        description: client.description || "",
      },
    });
  },

  closeEditor() {
    if (this.data.operating) return;
    this.setData({ editorVisible: false, pickerVisible: false });
  },

  onEditNameInput(event) {
    this.setData({ "editForm.name": event.detail.value });
  },

  openEditPicker(event) {
    const field = event.currentTarget.dataset.field;
    const isRole = field === "roleCode";
    const options = isRole ? this.data.roleOptions : this.data.sourceOptions;
    this.setData({
      pickerVisible: true,
      pickerField: field,
      pickerTitle: isRole ? "选择客户角色" : "选择来源渠道",
      pickerOptions: options,
      pickerValue: [this.data.editForm[field]],
    });
  },

  closePicker() {
    this.setData({ pickerVisible: false });
  },

  onPickerConfirm(event) {
    const value = event.detail.value[0];
    const field = this.data.pickerField;
    const options = field === "roleCode" ? this.data.roleOptions : this.data.sourceOptions;
    this.setData({
      [`editForm.${field}`]: value,
      ...(field === "roleCode"
        ? { editRoleLabel: optionLabel(options, value) }
        : { editSourceLabel: optionLabel(options, value) }),
      pickerVisible: false,
    });
  },

  onImpactVisibleChange(event) {
    if (!event.detail.visible) this.closeImpact();
  },

  onEditorVisibleChange(event) {
    if (!event.detail.visible) this.closeEditor();
  },

  saveClient() {
    if (this.data.operating) return;
    const form = this.data.editForm;
    if (!form.name.trim() || !form.roleCode || !form.source) {
      wx.showToast({ title: "请完善客户名称、角色和来源渠道", icon: "none" });
      return;
    }
    const referenceCount = Number(this.data.prepared?.referenceCount) || 0;
    wx.showModal({
      title: "确认修改客户信息",
      content: referenceCount
        ? `保存后将同步修改引用该客户的 ${referenceCount} 个项目，是否确认？`
        : "确认保存当前客户信息吗？",
      confirmText: "确认修改",
      confirmColor: "#2E9F8B",
      success: result => {
        if (result.confirm) this.performUpdate();
      },
    });
  },

  async performUpdate() {
    const form = this.data.editForm;
    const prepared = this.data.prepared || {};
    this.setData({ operating: true, loadingMessage: "正在同步客户及项目信息..." });
    try {
      const result = await api.updateClient({
        ...form,
        name: form.name.trim(),
        confirmed: true,
        impactToken: prepared.impactToken || "",
      });
      this.setData({ editorVisible: false, prepared: null, operating: false });
      await this.loadClients(true);
      wx.showToast({
        title: result.updatedProjects ? `已同步 ${result.updatedProjects} 个项目` : "客户信息已修改",
        icon: "success",
      });
    } catch (error) {
      if (error.code === 409 && error.response?.data) {
        this.setData({
          editorVisible: false,
          prepared: error.response.data,
          impactMode: "edit",
          impactVisible: true,
          operating: false,
        });
      } else {
        this.setData({ operating: false });
      }
      wx.showToast({ title: error.message || "客户修改失败", icon: "none" });
    } finally {
      if (this.data.operating) this.setData({ operating: false });
    }
  },

  confirmDelete(prepared) {
    wx.showModal({
      title: "删除客户",
      content: `确认删除客户“${prepared.client.name}”吗？删除后不会再出现在客户选择列表中。`,
      confirmText: "删除",
      confirmColor: "#c62828",
      success: result => {
        if (result.confirm) this.performDelete(prepared.client.id);
      },
    });
  },

  async performDelete(id) {
    if (this.data.operating) return;
    this.setData({ operating: true, loadingMessage: "正在删除客户..." });
    try {
      await api.deleteClient(id);
      this.setData({ operating: false });
      await this.loadClients(true);
      wx.showToast({ title: "客户已删除", icon: "success" });
    } catch (error) {
      if (error.code === 409 && error.response?.data) {
        this.setData({
          prepared: error.response.data,
          impactMode: "delete",
          impactVisible: true,
          operating: false,
        });
      } else {
        this.setData({ operating: false });
      }
      wx.showToast({ title: error.message || "客户删除失败", icon: "none" });
    } finally {
      if (this.data.operating) this.setData({ operating: false });
    }
  },

  stopPropagation() {},
});
