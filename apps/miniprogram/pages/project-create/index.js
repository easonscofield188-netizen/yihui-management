const api = require("../../utils/api");

const DRAFT_KEY = "projectCreateDraft";
const FALLBACK_SCENES = [{ label: "内部运营", value: "internal_operation" }];
const FALLBACK_ROLES = [{ label: "利益相关者", value: "stakeholder" }];
const FALLBACK_SOURCES = [{ label: "转介绍", value: "referral" }];

function getNavMetrics() {
  const systemInfo = wx.getSystemInfoSync();
  const statusBarHeight = systemInfo.statusBarHeight || 0;
  const menuButton = wx.getMenuButtonBoundingClientRect();
  const contentHeight = menuButton && menuButton.height
    ? menuButton.height + Math.max(0, menuButton.top - statusBarHeight) * 2
    : 88;
  const windowWidth = systemInfo.windowWidth || systemInfo.screenWidth || 375;
  const menuRightInset = menuButton && menuButton.left
    ? Math.max(16, windowWidth - menuButton.left + 12)
    : 16;
  return { statusBarHeight, navHeight: statusBarHeight + contentHeight, menuRightInset };
}

function getToday() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function preferredValue(options, currentValue) {
  if (currentValue && options.some((item) => item.value === currentValue)) return currentValue;
  return options[0] ? options[0].value : "";
}

Page({
  data: {
    statusBarHeight: 0,
    navHeight: 88,
    menuRightInset: 16,
    pageTitle: "新建项目",
    isEditMode: false,
    isClosedEdit: false,
    isDateLocked: false,
    today: getToday(),
    projectScenes: FALLBACK_SCENES,
    clientRoles: FALLBACK_ROLES,
    clientSources: FALLBACK_SOURCES,
    sceneIndex: 0,
    roleIndex: 0,
    sourceIndex: 0,
    clients: [],
    showClientList: false,
    pickerVisible: false,
    pickerField: "",
    pickerTitle: "",
    pickerOptions: [],
    pickerValue: [],
    datePickerVisible: false,
    newClientVisible: false,
    newClientPickerVisible: false,
    newClientPickerField: "",
    newClientPickerTitle: "",
    newClientPickerOptions: [],
    newClientPickerValue: [],
    creatingClient: false,
    newClient: {
      name: "",
      role: FALLBACK_ROLES[0].value,
      source: FALLBACK_SOURCES[0].value,
    },
    newClientRoleIndex: 0,
    newClientSourceIndex: 0,
    form: {
      name: "",
      status: "completed",
      scene: FALLBACK_SCENES[0].value,
      startDate: "",
      client: "",
      clientId: "",
      role: FALLBACK_ROLES[0].value,
      source: FALLBACK_SOURCES[0].value,
      createClient: false,
      desc: "",
    },
  },

  onLoad() {
    wx.setNavigationBarColor({ frontColor: "#000000", backgroundColor: "#f9f9ff" });
    const savedDraft = wx.getStorageSync(DRAFT_KEY) || {};
    const isEditMode = savedDraft._mode === "edit";
    this.setData({
      ...getNavMetrics(),
      pageTitle: isEditMode ? "编辑项目" : "新建项目",
      isEditMode,
      isClosedEdit: isEditMode && (savedDraft._originalStatus || savedDraft.status) === "closed",
      isDateLocked: isEditMode,
      form: { ...this.data.form, ...savedDraft },
    });
    this.loadOptions();
    this.loadClients();
  },

  async loadOptions() {
    try {
      const configs = await api.getGlobalConfig();
      const projectScenes = configs.PROJECT_SCENE && configs.PROJECT_SCENE.length ? configs.PROJECT_SCENE : FALLBACK_SCENES;
      const clientRoles = configs.CLIENT_ROLE && configs.CLIENT_ROLE.length ? configs.CLIENT_ROLE : FALLBACK_ROLES;
      const clientSources = configs.CLIENT_SOURCE && configs.CLIENT_SOURCE.length ? configs.CLIENT_SOURCE : FALLBACK_SOURCES;
      this.setData({
        projectScenes,
        clientRoles,
        clientSources,
        "form.scene": preferredValue(projectScenes, this.data.form.scene),
        "form.role": preferredValue(clientRoles, this.data.form.role),
        "form.source": preferredValue(clientSources, this.data.form.source),
        "newClient.role": preferredValue(clientRoles, this.data.newClient.role),
        "newClient.source": preferredValue(clientSources, this.data.newClient.source),
        sceneIndex: Math.max(0, projectScenes.findIndex((item) => item.value === preferredValue(projectScenes, this.data.form.scene))),
        roleIndex: Math.max(0, clientRoles.findIndex((item) => item.value === preferredValue(clientRoles, this.data.form.role))),
        sourceIndex: Math.max(0, clientSources.findIndex((item) => item.value === preferredValue(clientSources, this.data.form.source))),
        newClientRoleIndex: Math.max(0, clientRoles.findIndex((item) => item.value === preferredValue(clientRoles, this.data.newClient.role))),
        newClientSourceIndex: Math.max(0, clientSources.findIndex((item) => item.value === preferredValue(clientSources, this.data.newClient.source))),
      });
    } catch (error) {
      // 保留默认值，配置服务短暂不可用不阻塞表单填写。
    }
  },

  async loadClients(keyword = "") {
    try {
      const clients = await api.queryClients(keyword);
      this.setData({ clients: Array.isArray(clients) ? clients : [] });
    } catch (error) {
      this.setData({ clients: [] });
    }
  },

  onTextInput(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: event.detail.value });
  },

  onNameChange(event) {
    this.setData({ "form.name": event.detail.value });
  },

  onClientInput(event) {
    if (this.data.isClosedEdit) return;
    const value = event.detail.value;
    this.setData({ "form.client": value, "form.clientId": "", showClientList: !this.data.form.createClient });
    clearTimeout(this.clientSearchTimer);
    this.clientSearchTimer = setTimeout(() => this.loadClients(value), 250);
  },

  showClientSuggestions() {
    if (!this.data.isClosedEdit && !this.data.form.createClient) {
      this.setData({ showClientList: true });
    }
  },

  hideClientSuggestions() {
    clearTimeout(this.clientBlurTimer);
    this.clientBlurTimer = setTimeout(() => {
      if (!this.clientListInteracting) this.setData({ showClientList: false });
    }, 260);
  },

  onClientListTouchStart() {
    this.clientListInteracting = true;
    clearTimeout(this.clientBlurTimer);
    clearTimeout(this.clientListTouchTimer);
  },

  onClientListTouchEnd() {
    clearTimeout(this.clientListTouchTimer);
    this.clientListTouchTimer = setTimeout(() => {
      this.clientListInteracting = false;
    }, 360);
  },

  selectClient(event) {
    if (this.data.isClosedEdit) return;
    clearTimeout(this.clientBlurTimer);
    this.clientListInteracting = false;
    const client = event.currentTarget.dataset.client;
    const role = client.roleCode || client.role || this.data.form.role;
    const source = client.source || this.data.form.source;
    this.setData({
      "form.client": client.name,
      "form.clientId": client._id || client.id || "",
      "form.role": role,
      "form.source": source,
      roleIndex: Math.max(0, this.data.clientRoles.findIndex((item) => item.value === role)),
      sourceIndex: Math.max(0, this.data.clientSources.findIndex((item) => item.value === source)),
      showClientList: false,
    });
  },

  onUnload() {
    clearTimeout(this.clientSearchTimer);
    clearTimeout(this.clientBlurTimer);
    clearTimeout(this.clientListTouchTimer);
  },

  onStatusTap(event) {
    this.setData({ "form.status": event.currentTarget.dataset.value });
  },

  openPicker(event) {
    const field = event.currentTarget.dataset.field;
    if (this.data.isClosedEdit && ["scene", "role", "source"].includes(field)) return;
    const config = {
      scene: { title: "项目场景", options: this.data.projectScenes, value: this.data.form.scene },
      role: { title: "客户角色", options: this.data.clientRoles, value: this.data.form.role },
      source: { title: "来源渠道", options: this.data.clientSources, value: this.data.form.source },
    }[field];
    if (!config) return;
    this.setData({
      pickerVisible: true,
      pickerField: field,
      pickerTitle: config.title,
      pickerOptions: config.options,
      pickerValue: [config.value],
    });
  },

  closePicker() {
    this.setData({ pickerVisible: false });
  },

  onPickerConfirm(event) {
    const value = event.detail.value[0];
    const field = this.data.pickerField;
    if (field === "scene") {
      this.setData({ sceneIndex: Math.max(0, this.data.projectScenes.findIndex((item) => item.value === value)), "form.scene": value });
    } else if (field === "role") {
      this.setData({ roleIndex: Math.max(0, this.data.clientRoles.findIndex((item) => item.value === value)), "form.role": value });
    } else if (field === "source") {
      this.setData({ sourceIndex: Math.max(0, this.data.clientSources.findIndex((item) => item.value === value)), "form.source": value });
    }
    this.closePicker();
  },

  openDatePicker() {
    if (this.data.isDateLocked) {
      wx.showToast({ title: "编辑时不可修改交付日期", icon: "none" });
      return;
    }
    this.setData({ datePickerVisible: true });
  },

  closeDatePicker() {
    this.setData({ datePickerVisible: false });
  },

  onDateConfirm(event) {
    this.setData({ "form.startDate": event.detail.value, datePickerVisible: false });
  },

  onCreateClientChange(event) {
    if (this.data.isClosedEdit) return;
    const createClient = event.detail.value;
    this.setData({ "form.createClient": createClient, showClientList: false, newClientVisible: createClient });
  },

  closeNewClient() {
    this.setData({ newClientVisible: false, "form.createClient": false });
  },

  onNewClientPopupChange(event) {
    if (!event.detail.visible) this.closeNewClient();
  },

  onNewClientInput(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [`newClient.${field}`]: event.detail.value });
  },

  openNewClientPicker(event) {
    const field = event.currentTarget.dataset.field;
    const config = field === "role"
      ? { title: "客户角色", options: this.data.clientRoles, value: this.data.newClient.role }
      : { title: "来源渠道", options: this.data.clientSources, value: this.data.newClient.source };
    this.setData({
      newClientPickerVisible: true,
      newClientPickerField: field,
      newClientPickerTitle: config.title,
      newClientPickerOptions: config.options,
      newClientPickerValue: [config.value],
    });
  },

  closeNewClientPicker() {
    this.setData({ newClientPickerVisible: false });
  },

  onNewClientPickerConfirm(event) {
    const value = event.detail.value[0];
    if (this.data.newClientPickerField === "role") {
      this.setData({ newClientRoleIndex: Math.max(0, this.data.clientRoles.findIndex((item) => item.value === value)), "newClient.role": value });
    } else {
      this.setData({ newClientSourceIndex: Math.max(0, this.data.clientSources.findIndex((item) => item.value === value)), "newClient.source": value });
    }
    this.closeNewClientPicker();
  },

  async submitNewClient() {
    const { name, role, source } = this.data.newClient;
    if (!name.trim() || !role || !source) {
      wx.showToast({ title: "请完成客户信息", icon: "none" });
      return;
    }
    this.setData({ creatingClient: true });
    try {
      const result = await api.createClient({ name: name.trim(), role, roleCode: role, source });
      const clientId = result.id || "";
      this.setData({
        "form.client": name.trim(),
        "form.clientId": clientId,
        "form.role": role,
        "form.source": source,
        "form.createClient": false,
        roleIndex: Math.max(0, this.data.clientRoles.findIndex((item) => item.value === role)),
        sourceIndex: Math.max(0, this.data.clientSources.findIndex((item) => item.value === source)),
        newClientVisible: false,
      });
      this.loadClients();
      wx.showToast({ title: result.existed ? "客户已存在，已选中" : "客户添加成功", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "客户添加失败", icon: "none" });
    } finally {
      this.setData({ creatingClient: false });
    }
  },

  close() {
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack();
    else wx.switchTab({ url: "/pages/index/index" });
  },

  previous() {
    this.close();
  },

  next() {
    const { name, startDate, client, role, source } = this.data.form;
    if (!name.trim() || !startDate || !client.trim() || !role || !source) {
      wx.showToast({ title: "请完成本页必填信息", icon: "none" });
      return;
    }
    wx.setStorageSync(DRAFT_KEY, { ...(wx.getStorageSync(DRAFT_KEY) || {}), ...this.data.form });
    wx.navigateTo({ url: "/pages/project-create-step2/index" });
  },
});
