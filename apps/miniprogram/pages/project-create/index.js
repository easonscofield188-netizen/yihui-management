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

function normalizeDateOnly(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  const matched = String(raw || "").match(/^\d{4}-\d{2}-\d{2}/);
  if (matched) return matched[0];
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
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
    today: "",
    serverToday: "",
    projectScenes: FALLBACK_SCENES,
    clientRoles: FALLBACK_ROLES,
    clientSources: FALLBACK_SOURCES,
    sceneIndex: 0,
    roleIndex: 0,
    sourceIndex: 0,
    clients: [],
    clientSelectVisible: false,
    clientSearchKeyword: "",
    clientLoading: false,
    clientLoadFailed: false,
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
    formScrollTop: 0,
    scrollTarget: "",
    form: {
      type: "normal",
      name: "",
      amount: "",
      scene: FALLBACK_SCENES[0].value,
      startDate: "",
      client: "",
      clientId: "",
      role: FALLBACK_ROLES[0].value,
      source: FALLBACK_SOURCES[0].value,
      createClient: false,
      desc: "无",
    },
  },

  onLoad() {
    wx.setNavigationBarColor({ frontColor: "#000000", backgroundColor: "#f9f9ff" });
    const savedDraft = wx.getStorageSync(DRAFT_KEY) || {};
    const isEditMode = savedDraft._mode === "edit" && Boolean(savedDraft._projectId);
    const form = {
      ...this.data.form,
      ...savedDraft,
      desc: isEditMode ? (savedDraft.desc || "无") : "无",
    };
    this.setData({
      ...getNavMetrics(),
      pageTitle: isEditMode ? "编辑项目" : "新建项目",
      isEditMode,
      isClosedEdit: isEditMode && ["closed", "archived"].includes(savedDraft._originalStatus || savedDraft.status),
      isDateLocked: false,
      form,
    });
    this.loadServerDate();
    this.loadOptions();
  },

  async loadServerDate() {
    try {
      const result = await api.getServerDate();
      const serverToday = normalizeDateOnly(result && result.date);
      if (serverToday) this.setData({ serverToday, today: serverToday });
      return serverToday;
    } catch (error) {
      return "";
    }
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

  async loadClients(keyword = "", { showError = false } = {}) {
    const requestId = (this.clientRequestId || 0) + 1;
    this.clientRequestId = requestId;
    this.setData({ clientLoading: true, clientLoadFailed: false });
    try {
      const clients = await api.queryClients(keyword);
      if (requestId !== this.clientRequestId) return;
      const roleMap = new Map((this.data.clientRoles || []).map((r) => [r.value, r.label]));
      const sourceMap = new Map((this.data.clientSources || []).map((s) => [s.value, s.label]));
      const enrichedClients = (Array.isArray(clients) ? clients : []).map((c) => {
        const role = c.roleCode || c.role || "";
        const source = c.source || "";
        return {
          ...c,
          roleLabel: roleMap.get(role) || role,
          sourceLabel: sourceMap.get(source) || source,
        };
      });
      this.setData({
        clients: enrichedClients,
        clientLoading: false,
        clientLoadFailed: false,
      });
    } catch (error) {
      if (requestId !== this.clientRequestId) return;
      this.setData({ clients: [], clientLoading: false, clientLoadFailed: true });
      if (showError) {
        wx.showToast({ title: error.message || "客户列表加载失败", icon: "none" });
      }
    }
  },

  onTextInput(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: event.detail.value });
  },

  onProjectTypeChange(event) {
    const type = event.currentTarget.dataset.type || "normal";
    const patch = { "form.type": type };
    if (type === "long_term") {
      const dailyIndex = this.data.projectScenes.findIndex(
        (item) => item.label.includes("日常维护") || item.label.includes("维护") || item.value === "daily_maintenance"
      );
      if (dailyIndex >= 0) {
        patch.sceneIndex = dailyIndex;
        patch["form.scene"] = this.data.projectScenes[dailyIndex].value;
      }
    }
    this.setData(patch);
  },

  onNameChange(event) {
    this.setData({ "form.name": event.detail.value });
  },

  onAmountChange(event) {
    this.setData({ "form.amount": event.detail.value });
  },

  openClientSelectPopup() {
    if (this.data.isClosedEdit) return;
    this.setData({
      clientSelectVisible: true,
      clientSearchKeyword: "",
    });
    this.loadClients("");
  },

  closeClientSelectPopup() {
    this.setData({ clientSelectVisible: false });
  },

  onClientSelectPopupChange(event) {
    if (!event.detail.visible) {
      this.closeClientSelectPopup();
    }
  },

  onClientSearchInput(event) {
    const keyword = (event.detail && event.detail.value) || "";
    this.setData({ clientSearchKeyword: keyword });
    clearTimeout(this.clientSearchTimer);
    this.clientSearchTimer = setTimeout(() => {
      this.loadClients(keyword);
    }, 250);
  },

  onClientSearchClear() {
    this.setData({ clientSearchKeyword: "" });
    clearTimeout(this.clientSearchTimer);
    this.loadClients("");
  },

  openNewClientFromSearch() {
    const searchName = (this.data.clientSearchKeyword || "").trim();
    const defaultRole = preferredValue(this.data.clientRoles, "");
    const defaultSource = preferredValue(this.data.clientSources, "");
    this.setData({
      clientSelectVisible: false,
      newClientVisible: true,
      "form.createClient": true,
      newClient: {
        name: searchName,
        role: defaultRole,
        source: defaultSource,
      },
      newClientRoleIndex: Math.max(0, this.data.clientRoles.findIndex((item) => item.value === defaultRole)),
      newClientSourceIndex: Math.max(0, this.data.clientSources.findIndex((item) => item.value === defaultSource)),
    });
  },

  selectClient(event) {
    if (this.data.isClosedEdit) return;
    const client = event.currentTarget.dataset.client;
    if (!client) return;
    const role = client.roleCode || client.role || this.data.form.role;
    const source = client.source || this.data.form.source;
    const currentName = this.data.form.name ? this.data.form.name.trim() : "";
    const name = currentName || (this.data.form.type === "long_term" ? `${client.name}-长期合作` : "");
    this.setData({
      "form.client": client.name,
      "form.clientId": client._id || client.id || "",
      "form.role": role,
      "form.source": source,
      "form.name": name,
      roleIndex: Math.max(0, this.data.clientRoles.findIndex((item) => item.value === role)),
      sourceIndex: Math.max(0, this.data.clientSources.findIndex((item) => item.value === source)),
      clientSelectVisible: false,
    });
    this.scrollToBottom();
  },

  scrollToBottom() {
    setTimeout(() => {
      this.setData({
        scrollTarget: "form-bottom-anchor",
        formScrollTop: (this.data.formScrollTop || 0) >= 9999 ? 9998 : 9999,
      });
    }, 200);
  },

  onUnload() {
    this.clientRequestId = (this.clientRequestId || 0) + 1;
    clearTimeout(this.clientSearchTimer);
  },

  openPicker(event) {
    const field = event.currentTarget.dataset.field;
    if (this.data.isClosedEdit && ["scene", "role", "source"].includes(field)) return;
    if (this.data.form.clientId && ["role", "source"].includes(field)) {
      wx.showToast({ title: "已有客户的角色和来源不可修改", icon: "none" });
      return;
    }
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

  async openDatePicker() {
    if (this.data.isDateLocked) {
      wx.showToast({ title: "当前不可修改交付日期", icon: "none" });
      return;
    }
    const serverToday = await this.loadServerDate();
    if (!serverToday) {
      wx.showToast({ title: "服务器时间获取失败，请稍后重试", icon: "none" });
      return;
    }
    this.setData({
      today: serverToday,
      "form.startDate": normalizeDateOnly(this.data.form.startDate) || serverToday,
      datePickerVisible: true,
    });
  },

  closeDatePicker() {
    this.setData({ datePickerVisible: false });
  },

  onDateConfirm(event) {
    this.setData({
      "form.startDate": normalizeDateOnly(event.detail.value),
      datePickerVisible: false,
    });
  },

  onCreateClientChange(event) {
    if (this.data.isClosedEdit) return;
    const createClient = event.detail.value;
    const defaultRole = preferredValue(this.data.clientRoles, "");
    const defaultSource = preferredValue(this.data.clientSources, "");
    this.setData({
      "form.createClient": createClient,
      newClientVisible: createClient,
      ...(createClient ? {
        newClient: {
          name: "",
          role: defaultRole,
          source: defaultSource,
        },
        newClientRoleIndex: Math.max(0, this.data.clientRoles.findIndex((item) => item.value === defaultRole)),
        newClientSourceIndex: Math.max(0, this.data.clientSources.findIndex((item) => item.value === defaultSource)),
      } : {}),
    });
  },

  closeNewClient() {
    const defaultRole = preferredValue(this.data.clientRoles, "");
    const defaultSource = preferredValue(this.data.clientSources, "");
    this.setData({
      newClientVisible: false,
      "form.createClient": false,
      newClient: {
        name: "",
        role: defaultRole,
        source: defaultSource,
      },
      newClientRoleIndex: Math.max(0, this.data.clientRoles.findIndex((item) => item.value === defaultRole)),
      newClientSourceIndex: Math.max(0, this.data.clientSources.findIndex((item) => item.value === defaultSource)),
    });
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
      const canonicalName = result.name || name.trim();
      const canonicalRole = result.roleCode || result.role || role;
      const canonicalSource = result.source || source;
      const defaultRole = preferredValue(this.data.clientRoles, "");
      const defaultSource = preferredValue(this.data.clientSources, "");
      this.setData({
        "form.client": canonicalName,
        "form.clientId": clientId,
        "form.role": canonicalRole,
        "form.source": canonicalSource,
        "form.createClient": false,
        roleIndex: Math.max(0, this.data.clientRoles.findIndex((item) => item.value === canonicalRole)),
        sourceIndex: Math.max(0, this.data.clientSources.findIndex((item) => item.value === canonicalSource)),
        newClient: {
          name: "",
          role: defaultRole,
          source: defaultSource,
        },
        newClientRoleIndex: Math.max(0, this.data.clientRoles.findIndex((item) => item.value === defaultRole)),
        newClientSourceIndex: Math.max(0, this.data.clientSources.findIndex((item) => item.value === defaultSource)),
        newClientVisible: false,
        clientSelectVisible: false,
      });
      this.loadClients();
      this.scrollToBottom();
      wx.showToast({ title: result.existed ? "客户已存在，已选中" : "客户添加成功", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "客户添加失败", icon: "none" });
    } finally {
      this.setData({ creatingClient: false });
    }
  },

  close() {
    if (this.data.isEditMode) wx.navigateBack();
    else wx.switchTab({ url: "/pages/index/index" });
  },

  previous() {
    this.close();
  },

  async submitLongTermProject() {
    const { name, startDate, client, clientId, role, source, scene, amount } = this.data.form;
    if (!name.trim()) {
      wx.showToast({ title: "请输入项目名称", icon: "none" });
      return;
    }
    if (!clientId) {
      wx.showToast({ title: "请选择客户", icon: "none" });
      return;
    }
    const createData = {
      name: name.trim(),
      type: "long_term",
      client: client.trim(),
      clientId,
      role,
      source,
      scene,
      startDate: startDate || this.data.today || new Date().toISOString().slice(0, 10),
      amount: amount !== undefined && amount !== "" ? Number(amount) : 0,
      receivedAmount: 0,
      costs: [],
      desc: scene === 'daily_maintenance' ? '日常维护' : (scene || '日常维护'),
      staffCount: 1,
      isHasContract: "no",
      isHasPreview: "no",
      isHasVoucher: "no",
    };
    wx.showLoading({ title: "正在创建项目...", mask: true });
    try {
      const res = await api.createProject(createData);
      wx.removeStorageSync(DRAFT_KEY);
      wx.showToast({ title: "长期项目创建成功", icon: "success" });
      const targetId = res.id || res._id || (res.data && (res.data.id || res.data._id)) || "";
      setTimeout(() => {
        if (targetId) {
          wx.redirectTo({ url: `/pages/project-detail/index?id=${targetId}` });
        } else {
          wx.switchTab({ url: "/pages/index/index" });
        }
      }, 500);
    } catch (err) {
      wx.showToast({ title: err.message || "创建失败", icon: "none" });
    } finally {
      wx.hideLoading();
    }
  },

  next() {
    const { type, name, startDate, client, clientId, role, source } = this.data.form;
    if (!startDate || !client.trim() || !role || !source) {
      wx.showToast({ title: "请完成本页必填信息", icon: "none" });
      return;
    }
    if (type === "normal" && !name.trim()) {
      wx.showToast({ title: "请输入项目名称", icon: "none" });
      return;
    }
    if (!clientId) {
      wx.showToast({ title: "请从列表选择或新增客户", icon: "none" });
      return;
    }
    const finalName = type === "long_term" ? (client.trim() || "长期维护项目") : name.trim();
    const finalForm = { ...this.data.form, name: finalName };
    wx.setStorageSync(DRAFT_KEY, { ...(wx.getStorageSync(DRAFT_KEY) || {}), ...finalForm });
    wx.navigateTo({ url: "/pages/project-create-step2/index" });
  },
});
