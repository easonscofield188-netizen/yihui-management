const api = require("../../utils/api");
const { isSettled } = require("../../utils/dictionary");

const DRAFT_KEY = "projectCreateDraft";
const FALLBACK_CATEGORIES = [{ label: "物流", value: "logistics" }];
const FIXED_SUPPLIER = "第三方商户";

function getNavMetrics() {
  const systemInfo = wx.getSystemInfoSync();
  const statusBarHeight = systemInfo.statusBarHeight || 0;
  const menuButton = wx.getMenuButtonBoundingClientRect();
  const contentHeight = menuButton && menuButton.height
    ? menuButton.height + Math.max(0, menuButton.top - statusBarHeight) * 2
    : 88;
  return { statusBarHeight, navHeight: statusBarHeight + contentHeight };
}

function cleanMoney(value) {
  const source = String(value == null ? "" : value).replace(/[^\d.]/g, "");
  if (!source) return "";
  const firstDot = source.indexOf(".");
  const whole = (firstDot === -1 ? source : source.slice(0, firstDot)).replace(/^0+(?=\d)/, "") || "0";
  if (firstDot === -1) return whole;
  return `${whole}.${source.slice(firstDot + 1).replace(/\./g, "").slice(0, 2)}`;
}

function money(value, digits = 2) {
  const amount = Number(value || 0);
  return Number.isFinite(amount)
    ? amount.toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : "0.00";
}

function normalizeCosts(costs) {
  return (Array.isArray(costs) ? costs : []).map((item, index) => ({
    id: item.id || item._id || `${Date.now()}-${index}`,
    category: item.category || item.categoryLabel || "其他",
    categoryCode: item.categoryCode || "",
    categoryLabel: item.categoryLabel || item.category || "其他",
    supplier: item.supplier || "未填写供应商",
    amount: Number(item.amount) || 0,
    isSettled: isSettled(item.isSettled),
  }));
}

Page({
  data: {
    statusBarHeight: 0,
    navHeight: 88,
    windowHeight: 667,
    keyboardHeight: 0,
    costScrollTarget: "",
    isEditMode: false,
    costCategories: FALLBACK_CATEGORIES,
    categoryIndex: 0,
    costs: [],
    totalCostText: "0.00",
    pendingCostText: "0.00",
    addCostVisible: false,
    editingCostId: "",
    categoryPickerVisible: false,
    categoryPickerValue: [FALLBACK_CATEGORIES[0].value],
    costForm: { categoryCode: FALLBACK_CATEGORIES[0].value, supplier: FIXED_SUPPLIER, amount: "", isSettled: true },
    isLongTerm: false,
    submitting: false,
  },

  onLoad() {
    wx.setNavigationBarColor({ frontColor: "#000000", backgroundColor: "#f9f9ff" });
    const systemInfo = wx.getSystemInfoSync();
    const draft = wx.getStorageSync(DRAFT_KEY) || {};
    const costs = normalizeCosts(draft.costs);
    const isLongTerm = draft.type === "long_term";
    this.setData({
      ...getNavMetrics(),
      windowHeight: systemInfo.windowHeight || systemInfo.screenHeight || 667,
      isEditMode: draft._mode === "edit",
      isLongTerm,
      costs,
    }, () => this.updateSummary());
    this.loadCategories();
    this.bindKeyboardListener();
  },

  onUnload() {
    this.unbindKeyboardListener();
  },

  bindKeyboardListener() {
    this.keyboardHandler = (res) => {
      const keyboardHeight = Math.max(0, Number(res.height) || 0);
      this.setData({
        keyboardHeight,
        costScrollTarget: keyboardHeight > 0 ? "cost-amount-anchor" : "",
      });
    };
    if (typeof wx.onKeyboardHeightChange === "function") {
      wx.onKeyboardHeightChange(this.keyboardHandler);
    }
  },

  unbindKeyboardListener() {
    if (this.keyboardHandler && typeof wx.offKeyboardHeightChange === "function") {
      wx.offKeyboardHeightChange(this.keyboardHandler);
    }
    this.keyboardHandler = null;
  },

  async loadCategories() {
    try {
      const configs = await api.getGlobalConfig();
      const costCategories = configs.COST_CATEGORY && configs.COST_CATEGORY.length ? configs.COST_CATEGORY : FALLBACK_CATEGORIES;
      const categoryCode = costCategories.some((item) => item.value === this.data.costForm.categoryCode)
        ? this.data.costForm.categoryCode
        : costCategories[0].value;
      this.setData({
        costCategories,
        categoryIndex: Math.max(0, costCategories.findIndex((item) => item.value === categoryCode)),
        "costForm.categoryCode": categoryCode,
        categoryPickerValue: [categoryCode],
      });
    } catch (error) {
      // 配置短暂不可用时继续使用内置成本类别。
    }
  },

  updateSummary() {
    const total = this.data.costs.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    const pending = this.data.costs
      .filter((item) => !item.isSettled)
      .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    this.setData({ totalCostText: money(total), pendingCostText: money(pending) });
  },

  openAddCost() {
    const firstCategory = this.data.costCategories[0] || FALLBACK_CATEGORIES[0];
    this.setData({
      addCostVisible: true,
      editingCostId: "",
      categoryIndex: 0,
      categoryPickerValue: [firstCategory.value],
      costForm: { categoryCode: firstCategory.value, supplier: FIXED_SUPPLIER, amount: "", isSettled: true },
    });
  },

  closeAddCost() {
    this.setData({
      addCostVisible: false,
      editingCostId: "",
      categoryPickerVisible: false,
      keyboardHeight: 0,
      costScrollTarget: "",
    });
  },

  onAddCostVisibleChange(event) {
    if (!event.detail.visible) this.closeAddCost();
  },

  onAmountFocus() {
    this.setData({ costScrollTarget: "cost-amount-anchor" });
  },

  onAmountBlur() {
    // 部分 Android 机型不会及时发送高度为 0 的事件，失焦时兜底恢复。
    setTimeout(() => {
      this.setData({ keyboardHeight: 0, costScrollTarget: "" });
    }, 180);
  },

  onCostInput(event) {
    const field = event.currentTarget.dataset.field;
    const value = field === "amount" ? cleanMoney(event.detail.value) : event.detail.value;
    this.setData({ [`costForm.${field}`]: value });
  },

  onSettledChange(event) {
    this.setData({ "costForm.isSettled": event.detail.value });
  },

  openCategoryPicker() {
    this.setData({ categoryPickerVisible: true, categoryPickerValue: [this.data.costForm.categoryCode] });
  },

  closeCategoryPicker() {
    this.setData({ categoryPickerVisible: false });
  },

  onCategoryConfirm(event) {
    const categoryCode = event.detail.value[0];
    this.setData({
      categoryIndex: Math.max(0, this.data.costCategories.findIndex((item) => item.value === categoryCode)),
      "costForm.categoryCode": categoryCode,
      categoryPickerVisible: false,
    });
  },

  saveCost() {
    const { categoryCode, amount, isSettled } = this.data.costForm;
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      wx.showToast({ title: "请填写成本金额", icon: "none" });
      return;
    }
    const category = this.data.costCategories.find((item) => item.value === categoryCode) || FALLBACK_CATEGORIES[0];
    const nextItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      category: category.label,
      categoryCode,
      categoryLabel: category.label,
      supplier: FIXED_SUPPLIER,
      amount: numericAmount,
      isSettled: Boolean(isSettled),
    };
    const costs = this.data.editingCostId
      ? this.data.costs.map((item) => String(item.id) === String(this.data.editingCostId) ? { ...nextItem, id: item.id } : item)
      : [...this.data.costs, nextItem];
    this.setData({ costs, addCostVisible: false, editingCostId: "", keyboardHeight: 0 }, () => this.updateSummary());
  },

  manageCost(event) {
    const id = event.currentTarget.dataset.id;
    wx.showActionSheet({
      itemList: ["编辑成本", "删除成本"],
      success: ({ tapIndex }) => {
        if (tapIndex === 0) {
          const item = this.data.costs.find((cost) => String(cost.id) === String(id));
          if (!item) return;
          const categoryIndex = Math.max(0, this.data.costCategories.findIndex((category) => category.value === item.categoryCode));
          const category = this.data.costCategories[categoryIndex] || this.data.costCategories[0];
          this.setData({ addCostVisible: true, editingCostId: id, categoryIndex, categoryPickerValue: [category.value], costForm: { categoryCode: category.value, supplier: item.supplier || FIXED_SUPPLIER, amount: String(item.amount), isSettled: Boolean(item.isSettled) } });
          return;
        }
        if (tapIndex !== 1) return;
        const costs = this.data.costs.filter((item) => item.id !== id);
        this.setData({ costs }, () => this.updateSummary());
      },
    });
  },

  close() {
    if (this.data.isEditMode) wx.navigateBack();
    else wx.switchTab({ url: "/pages/index/index" });
  },

  previous() {
    wx.navigateBack();
  },

  async submitDirectly() {
    if (this.data.submitting) return;
    const draft = wx.getStorageSync(DRAFT_KEY) || {};
    if (!draft.name || !draft.client || !draft.role || !draft.startDate) {
      wx.showToast({ title: "项目基础信息不完整", icon: "none" });
      return;
    }
    if (!draft.clientId) {
      wx.showToast({ title: "请选择已有客户，或先新增客户", icon: "none" });
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: "正在创建长期项目...", mask: true });
    try {
      const deliveryDate = String(draft.startDate).slice(0, 10);
      const res = await api.createProject({
        type: "long_term",
        name: draft.name.trim(),
        client: draft.client.trim(),
        clientId: draft.clientId,
        role: draft.role,
        clientSource: draft.source || "",
        scene: draft.scene || "",
        startDate: deliveryDate,
        amount: Number(draft.amount) || 0,
        receivedAmount: Number(draft.receivedAmount) || 0,
        staffCount: Number(draft.staffCount) || 1,
        costs: [],
        desc: draft.sceneLabel || (draft.scene === 'daily_maintenance' ? '日常维护' : draft.scene) || '日常维护',
        isHasContract: "否",
        isHasPreview: "否",
        isHasVoucher: "否",
      });

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
      this.setData({ submitting: false });
      wx.hideLoading();
    }
  },

  next() {
    const draft = wx.getStorageSync(DRAFT_KEY) || {};
    wx.setStorageSync(DRAFT_KEY, { ...draft, costs: this.data.costs });
    wx.navigateTo({ url: "/pages/project-create-step4/index" });
  },
});
