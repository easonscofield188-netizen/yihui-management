const api = require("../../utils/api");
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

function toCents(value) {
  const cleaned = cleanMoney(value);
  if (!cleaned) return 0;
  const num = Number(cleaned);
  return Number.isFinite(num) ? Math.round(num * 100) : 0;
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
    isFullySettled: false,
    isLongTerm: false,
    submitting: false,
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
    const amountStr = draft.amount === undefined ? "" : String(draft.amount);
    const receivedStr = draft.receivedAmount === undefined ? "" : String(draft.receivedAmount);
    const amountCents = toCents(amountStr);
    const receivedCents = toCents(receivedStr);
    const isFullySettled = amountCents > 0 && amountCents === receivedCents;

    this.setData({
      ...getNavMetrics(),
      pageTitle: isEditMode ? "编辑项目" : "新建项目",
      isEditMode,
      isClosedEdit: isEditMode && ["closed", "archived"].includes(draft._originalStatus || draft.status),
      isFullySettled,
      isLongTerm: draft.type === "long_term",
      form: {
        amount: amountStr,
        receivedAmount: receivedStr,
        staffCount: Math.min(99, Math.max(1, Number(draft.staffCount) || 1)),
      },
    });
  },

  onMoneyChange(event) {
    const field = event.currentTarget.dataset.field;
    if (this.data.isClosedEdit && field === "amount") return;
    if (this.data.isFullySettled && field === "receivedAmount") return;

    const value = cleanMoney(event.detail.value);

    if (field === "amount") {
      let isFullySettled = this.data.isFullySettled;
      let nextReceived = this.data.form.receivedAmount;

      // 开关打开的情况下，如果修改了订单金额：自动开关关闭，已收金额变成0(清空)
      if (isFullySettled) {
        isFullySettled = false;
        nextReceived = "";
      } else {
        const amountCents = toCents(value);
        const receivedCents = toCents(nextReceived);
        isFullySettled = amountCents > 0 && amountCents === receivedCents;
      }

      this.setData({
        "form.amount": value,
        "form.receivedAmount": nextReceived,
        isFullySettled,
      });
      return;
    }

    if (field === "receivedAmount") {
      const amountCents = toCents(this.data.form.amount);
      const receivedCents = toCents(value);
      const isFullySettled = amountCents > 0 && amountCents === receivedCents;

      this.setData({
        "form.receivedAmount": value,
        isFullySettled,
      });
    }
  },

  onFullySettledChange(event) {
    const isFullySettled = Boolean(event.detail && event.detail.value);
    if (!isFullySettled) {
      this.setData({ isFullySettled: false });
      return;
    }

    const amount = cleanMoney(this.data.form.amount);
    if (toCents(amount) <= 0) {
      this.setData({ isFullySettled: false });
      wx.showToast({ title: "请先填写订单金额", icon: "none" });
      return;
    }

    wx.hideKeyboard();
    this.setData({
      isFullySettled: true,
      "form.receivedAmount": amount,
    });
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
    const updatedDraft = {
      ...draft,
      amount,
      receivedAmount,
      staffCount: Number(this.data.form.staffCount),
    };
    wx.setStorageSync(DRAFT_KEY, updatedDraft);

    if (this.data.isLongTerm) {
      wx.showModal({
        title: "成本支出确认",
        content: "本次长期合作首次服务是否有成本支出？",
        cancelText: "无成本",
        confirmText: "有成本",
        confirmColor: "#2E9F8B",
        success: (res) => {
          if (res.confirm) {
            wx.navigateTo({ url: "/pages/project-create-step3/index" });
          } else {
            this.submitWithoutCost(updatedDraft);
          }
        },
      });
      return;
    }

    wx.navigateTo({ url: "/pages/project-create-step3/index" });
  },

  async submitWithoutCost(draft) {
    if (this.data.submitting) return;
    this.setData({ submitting: true });
    wx.showLoading({ title: "正在创建长期项目...", mask: true });
    try {
      const deliveryDate = String(draft.startDate).slice(0, 10);
      const res = await api.createProject({
        type: "long_term",
        name: draft.name ? draft.name.trim() : `${draft.client.trim()}-长期合作`,
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
});
