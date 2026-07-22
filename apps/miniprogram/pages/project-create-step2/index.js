const DRAFT_KEY = "projectCreateDraft";

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

function asMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

Page({
  data: {
    statusBarHeight: 0,
    navHeight: 88,
    pageTitle: "新建项目",
    isEditMode: false,
    isClosedEdit: false,
    form: {
      amount: "",
      receivedAmount: "",
      staffCount: 1,
    },
    quickTeams: [
      { label: "小团队 (2人)", value: 2 },
      { label: "中型团队 (5人)", value: 5 },
      { label: "大团队 (10人+)", value: 10 },
    ],
  },

  onLoad() {
    wx.setNavigationBarColor({ frontColor: "#000000", backgroundColor: "#f9f9ff" });
    const draft = wx.getStorageSync(DRAFT_KEY) || {};
    const isEditMode = draft._mode === "edit";
    this.setData({
      ...getNavMetrics(),
      pageTitle: isEditMode ? "编辑项目" : "新建项目",
      isEditMode,
      isClosedEdit: isEditMode && (draft._originalStatus || draft.status) === "closed",
      form: {
        amount: draft.amount === undefined ? "" : String(draft.amount),
        receivedAmount: draft.receivedAmount === undefined ? "" : String(draft.receivedAmount),
        staffCount: Math.min(99, Math.max(1, Number(draft.staffCount) || 1)),
      },
    });
  },

  onMoneyChange(event) {
    const field = event.currentTarget.dataset.field;
    if (this.data.isClosedEdit && field === "amount") return;
    this.setData({ [`form.${field}`]: cleanMoney(event.detail.value) });
  },

  onStaffChange(event) {
    if (this.data.isClosedEdit) return;
    const raw = String(event.detail.value || "").replace(/\D/g, "");
    const staffCount = Math.min(99, Math.max(1, Number(raw) || 1));
    this.setData({ "form.staffCount": staffCount });
  },

  setStaffCount(delta) {
    if (this.data.isClosedEdit) return;
    const staffCount = Math.min(99, Math.max(1, Number(this.data.form.staffCount) + delta));
    this.setData({ "form.staffCount": staffCount });
  },

  decreaseStaff() {
    this.setStaffCount(-1);
  },

  increaseStaff() {
    this.setStaffCount(1);
  },

  selectQuickTeam(event) {
    if (this.data.isClosedEdit) return;
    const staffCount = Number(event.currentTarget.dataset.value) || 1;
    this.setData({ "form.staffCount": staffCount });
  },

  showRecommendation() {
    wx.showToast({ title: "人员数量可按实际投入调整", icon: "none" });
  },

  close() {
    if (this.data.isEditMode) wx.navigateBack();
    else wx.switchTab({ url: "/pages/index/index" });
  },

  previous() {
    wx.navigateBack();
  },

  next() {
    const amount = asMoney(this.data.form.amount);
    const receivedAmount = this.data.form.receivedAmount === "" ? 0 : asMoney(this.data.form.receivedAmount);
    if (amount <= 0) {
      wx.showToast({ title: "请输入订单金额", icon: "none" });
      return;
    }
    if (receivedAmount < 0 || receivedAmount > amount) {
      wx.showToast({ title: "已收金额不能超过订单金额", icon: "none" });
      return;
    }
    const draft = wx.getStorageSync(DRAFT_KEY) || {};
    wx.setStorageSync(DRAFT_KEY, {
      ...draft,
      amount,
      receivedAmount,
      staffCount: Number(this.data.form.staffCount),
    });
    wx.navigateTo({ url: "/pages/project-create-step3/index" });
  },
});
