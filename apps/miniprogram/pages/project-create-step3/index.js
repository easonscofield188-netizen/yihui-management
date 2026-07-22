const api = require("../../utils/api");

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
    supplier: item.supplier || "未填写供应商",
    amount: Number(item.amount) || 0,
    isSettled: item.isSettled === true || item.isSettled === "是",
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
    categoryPickerVisible: false,
    categoryPickerValue: [FALLBACK_CATEGORIES[0].value],
    costForm: { categoryCode: FALLBACK_CATEGORIES[0].value, supplier: FIXED_SUPPLIER, amount: "", isSettled: true },
  },

  onLoad() {
    wx.setNavigationBarColor({ frontColor: "#000000", backgroundColor: "#f9f9ff" });
    const systemInfo = wx.getSystemInfoSync();
    const draft = wx.getStorageSync(DRAFT_KEY) || {};
    const costs = normalizeCosts(draft.costs);
    this.setData({
      ...getNavMetrics(),
      windowHeight: systemInfo.windowHeight || systemInfo.screenHeight || 667,
      isEditMode: draft._mode === "edit",
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
      categoryIndex: 0,
      categoryPickerValue: [firstCategory.value],
      costForm: { categoryCode: firstCategory.value, supplier: FIXED_SUPPLIER, amount: "", isSettled: true },
    });
  },

  closeAddCost() {
    this.setData({
      addCostVisible: false,
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
    const costs = [...this.data.costs, {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      category: category.label,
      categoryCode,
      supplier: FIXED_SUPPLIER,
      amount: numericAmount,
      isSettled: Boolean(isSettled),
    }];
    this.setData({ costs, addCostVisible: false, keyboardHeight: 0 }, () => this.updateSummary());
  },

  manageCost(event) {
    const id = event.currentTarget.dataset.id;
    wx.showActionSheet({
      itemList: ["删除成本"],
      success: ({ tapIndex }) => {
        if (tapIndex !== 0) return;
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

  next() {
    const draft = wx.getStorageSync(DRAFT_KEY) || {};
    wx.setStorageSync(DRAFT_KEY, { ...draft, costs: this.data.costs });
    wx.navigateTo({ url: "/pages/project-create-step4/index" });
  },
});
