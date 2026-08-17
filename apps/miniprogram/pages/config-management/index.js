const api = require("../../utils/api");

const GROUP_META = {
  CLIENT_SOURCE: { title: "客户来源", description: "管理客户获客与流量渠道", icon: "root-list" },
  CLIENT_ROLE: { title: "客户角色", description: "配置客户在项目中的身份", icon: "usergroup" },
  COST_CATEGORY: { title: "成本项目", description: "维护项目材料与劳务成本科目", icon: "money" },
  PROJECT_SCENE: { title: "项目场景", description: "维护项目基础场景选项", icon: "map" },
  JOB_TITLE: { title: "岗位名称", description: "配置企业岗位与职能头衔", icon: "user-avatar" },
};

function getNavMetrics() {
  const systemInfo = wx.getSystemInfoSync();
  const statusBarHeight = systemInfo.statusBarHeight || 0;
  const menuButton = wx.getMenuButtonBoundingClientRect();
  const contentHeight = menuButton && menuButton.height ? menuButton.height + Math.max(0, menuButton.top - statusBarHeight) * 2 : 44;
  return { statusBarHeight, navHeight: statusBarHeight + contentHeight };
}

Page({
  data: {
    ...getNavMetrics(),
    group: "",
    meta: {},
    configs: [],
    activeCount: 0,
    loading: false,
    operating: false,
    loadingMessage: "正在加载配置...",
    editorVisible: false,
    editingId: "",
    editorTitle: "新增配置",
    form: { label: "", description: "", commonUnit: "" },
  },

  async onLoad(options = {}) {
    const group = String(options.group || "");
    const meta = GROUP_META[group];
    if (!meta) {
      wx.showToast({ title: "配置分类不存在", icon: "none" });
      setTimeout(() => this.goBack(), 300);
      return;
    }
    if (!(await this.authorize())) return;
    this.setData({ group, meta });
    this.loadConfigs();
  },

  async authorize() {
    if (!api.getToken()) {
      wx.showToast({ title: "请先登录", icon: "none" });
      setTimeout(() => this.goBack(), 300);
      return false;
    }
    let userInfo = api.getCachedUserInfo() || {};
    if (!userInfo.role || !api.isUserInfoCacheFresh()) {
      try {
        userInfo = await api.getUserInfo();
        api.cacheUserInfo(userInfo);
      } catch (error) {
        wx.showToast({ title: error.message || "身份校验失败", icon: "none" });
        setTimeout(() => this.goBack(), 300);
        return false;
      }
    }
    if (userInfo.role !== "ADMIN_SUPER") {
      wx.showToast({ title: "仅超级系统管理员可管理配置", icon: "none" });
      setTimeout(() => this.goBack(), 300);
      return false;
    }
    return true;
  },

  onPullDownRefresh() {
    this.loadConfigs().finally(() => wx.stopPullDownRefresh());
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack();
    else wx.navigateTo({ url: "/pages/data-config/index" });
  },

  decorateConfigs(list) {
    const sorted = list.slice().sort((left, right) => {
      const statusDifference = Number(left.isActive === false) - Number(right.isActive === false);
      return statusDifference || (Number(left.sortOrder) || 0) - (Number(right.sortOrder) || 0);
    });
    return sorted.map(item => {
      const peers = sorted.filter(peer => (peer.isActive !== false) === (item.isActive !== false));
      const peerIndex = peers.findIndex(peer => (peer._id || peer.id) === (item._id || item.id));
      return {
        ...item,
        id: item._id || item.id,
        statusLabel: item.isActive === false ? "已停用" : "启用中",
        canMoveUp: peerIndex > 0,
        canMoveDown: peerIndex < peers.length - 1,
      };
    });
  },

  async loadConfigs() {
    if (!this.data.group || this.data.loading) return;
    this.setData({ loading: true });
    try {
      const result = await api.queryConfigs(this.data.group, "all");
      const list = Array.isArray(result) ? result : [];
      this.setData({
        configs: this.decorateConfigs(list),
        activeCount: list.filter(item => item.isActive !== false).length,
      });
    } catch (error) {
      wx.showToast({ title: error.message || "配置加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  openCreate() {
    this.setData({ editorVisible: true, editingId: "", editorTitle: "新增配置", form: { label: "", description: "", commonUnit: "" } });
  },

  async editConfig(event) {
    const id = String(event.currentTarget.dataset.id || "");
    const config = this.data.configs.find(item => item.id === id);
    if (!config || this.data.operating) return;
    this.setData({ operating: true, loadingMessage: "正在检查配置引用..." });
    try {
      const usage = await api.getConfigUsage(id, this.data.group);
      this.setData({ operating: false });
      if (usage.referenceCount) {
        const names = (usage.references || []).slice(0, 6).map(item => item.name).join("、");
        const suffix = usage.referenceCount > 6 ? ` 等 ${usage.referenceCount} 条数据` : "";
        const quotationTip = usage.quotationReferenceCount
          ? "；历史报价单会保留原有名称和单位，不会随配置变化"
          : "";
        const syncTarget = this.data.group === "JOB_TITLE"
          ? "账号中的职位"
          : "客户及项目中的显示名称";
        wx.showModal({
          title: "配置已被引用",
          content: `“${config.label}”正在被 ${usage.referenceCount} 条数据引用：${names}${suffix}。修改名称后${syncTarget}会同步更新${quotationTip}，是否继续？`,
          confirmText: "继续编辑",
          success: result => { if (result.confirm) this.openEditor(config); },
        });
      } else {
        this.openEditor(config);
      }
    } catch (error) {
      this.setData({ operating: false });
      wx.showToast({ title: error.message || "引用检查失败", icon: "none" });
    }
  },

  openEditor(config) {
    this.setData({
      editorVisible: true,
      editingId: config.id,
      editorTitle: "编辑配置",
      form: { label: config.label || "", description: config.description || "", commonUnit: config.commonUnit || "" },
    });
  },

  closeEditor() {
    if (!this.data.operating) this.setData({ editorVisible: false });
  },

  onPopupVisibleChange(event) {
    if (!event.detail.visible) this.closeEditor();
  },

  onFormInput(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [`form.${field}`]: event.detail.value });
  },

  async saveConfig() {
    const label = this.data.form.label.trim();
    const commonUnit = this.data.form.commonUnit.trim();
    if (!label || this.data.operating) {
      if (!label) wx.showToast({ title: "请输入配置名称", icon: "none" });
      return;
    }
    if (this.data.group === "COST_CATEGORY" && !commonUnit) {
      wx.showToast({ title: "请输入常用单位", icon: "none" });
      return;
    }
    const isEditing = Boolean(this.data.editingId);
    this.setData({ operating: true, loadingMessage: isEditing ? "正在更新配置及引用数据..." : "正在新增配置..." });
    try {
      if (isEditing) {
        await api.updateConfig({ id: this.data.editingId, group: this.data.group, label, description: this.data.form.description.trim(), commonUnit });
      } else {
        await api.createConfig({ group: this.data.group, label, description: this.data.form.description.trim(), commonUnit });
      }
      this.setData({ editorVisible: false });
      await this.loadConfigs();
      this.setData({ operating: false });
      wx.showToast({ title: isEditing ? "配置已更新" : "配置已新增", icon: "success" });
    } catch (error) {
      this.setData({ operating: false });
      wx.showToast({ title: error.message || "配置保存失败", icon: "none" });
    }
  },

  toggleStatus(event) {
    const id = String(event.currentTarget.dataset.id || "");
    const config = this.data.configs.find(item => item.id === id);
    if (!config || this.data.operating) return;
    const nextActive = config.isActive === false;
    wx.showModal({
      title: nextActive ? "启用配置" : "停用配置",
      content: nextActive ? `确认启用“${config.label}”吗？` : `停用后新建项目将不能再选择“${config.label}”，已有数据不受影响。`,
      confirmText: nextActive ? "启用" : "停用",
      success: result => { if (result.confirm) this.performStatusUpdate(config, nextActive); },
    });
  },

  async performStatusUpdate(config, isActive) {
    this.setData({ operating: true, loadingMessage: isActive ? "正在启用配置..." : "正在停用配置..." });
    try {
      await api.updateConfigStatus({ id: config.id, group: this.data.group, isActive });
      await this.loadConfigs();
      this.setData({ operating: false });
      wx.showToast({ title: isActive ? "配置已启用" : "配置已停用", icon: "success" });
    } catch (error) {
      this.setData({ operating: false });
      wx.showToast({ title: error.message || "状态更新失败", icon: "none" });
    }
  },

  moveConfig(event) {
    const id = String(event.currentTarget.dataset.id || "");
    const direction = String(event.currentTarget.dataset.direction || "");
    const config = this.data.configs.find(item => item.id === id);
    if (!config || this.data.operating || (direction === "up" && !config.canMoveUp) || (direction === "down" && !config.canMoveDown)) return;
    this.performReorder(id, direction);
  },

  async performReorder(id, direction) {
    this.setData({ operating: true, loadingMessage: "正在调整排序..." });
    try {
      await api.reorderConfig({ id, group: this.data.group, direction });
      await this.loadConfigs();
      this.setData({ operating: false });
    } catch (error) {
      this.setData({ operating: false });
      wx.showToast({ title: error.message || "排序调整失败", icon: "none" });
    }
  },

  async requestDelete(event) {
    const id = String(event.currentTarget.dataset.id || "");
    const config = this.data.configs.find(item => item.id === id);
    if (!config || this.data.operating) return;
    this.setData({ operating: true, loadingMessage: "正在检查配置引用..." });
    try {
      const usage = await api.getConfigUsage(id, this.data.group);
      this.setData({ operating: false });
      if (usage.referenceCount) {
        this.guideReferencedConfig(config, usage);
        return;
      }
      wx.showModal({
        title: "删除配置",
        content: `确认永久删除“${config.label}”吗？该操作无法恢复。`,
        confirmText: "删除",
        confirmColor: "#c62828",
        success: result => { if (result.confirm) this.performDelete(config); },
      });
    } catch (error) {
      this.setData({ operating: false });
      wx.showToast({ title: error.message || "引用检查失败", icon: "none" });
    }
  },

  guideReferencedConfig(config, usage = {}) {
    const names = (usage.references || []).slice(0, 6).map(item => item.name).join("、");
    const suffix = Number(usage.referenceCount) > 6 ? `等 ${usage.referenceCount} 条数据` : "";
    const referenceText = [names, suffix].filter(Boolean).join("，");
    const isInactive = config.isActive === false;
    const canDisableNow = !isInactive && this.data.activeCount > 1;
    const actionText = canDisableNow ? "停用新增" : "去新增";
    const guidance = isInactive
      ? "该配置已经停用，可新建一个更合理的替代配置。"
      : canDisableNow
        ? "建议停用该配置，保留历史数据引用，再新建一个更合理的配置。"
        : "当前分组至少要保留一个启用项，请先新建替代配置，再回来停用该配置。";
    wx.showModal({
      title: "已被引用，不能删除",
      content: `“${config.label}”被以下数据使用：${referenceText || `${usage.referenceCount || 1} 条数据`}。${guidance}`,
      cancelText: "暂不处理",
      confirmText: actionText,
      confirmColor: "#173d6b",
      success: result => {
        if (!result.confirm) return;
        if (canDisableNow) this.disableAndCreateReplacement(config);
        else this.openCreate();
      },
    });
  },

  async disableAndCreateReplacement(config) {
    this.setData({ operating: true, loadingMessage: "正在停用原配置..." });
    try {
      await api.updateConfigStatus({ id: config.id, group: this.data.group, isActive: false });
      await this.loadConfigs();
      this.setData({ operating: false });
      this.openCreate();
      wx.showToast({ title: "原配置已停用，请新增替代项", icon: "none", duration: 1800 });
    } catch (error) {
      this.setData({ operating: false });
      wx.showToast({ title: error.message || "配置停用失败", icon: "none" });
    }
  },

  async performDelete(config) {
    this.setData({ operating: true, loadingMessage: "正在删除配置..." });
    try {
      await api.deleteConfig(config.id, this.data.group);
      await this.loadConfigs();
      this.setData({ operating: false });
      wx.showToast({ title: "配置已删除", icon: "success" });
    } catch (error) {
      this.setData({ operating: false });
      if (error.code === 409 && error.response && error.response.data) {
        this.guideReferencedConfig(config, error.response.data);
        return;
      }
      wx.showToast({ title: error.message || "配置删除失败", icon: "none" });
    }
  },

  stopPropagation() {},
});
