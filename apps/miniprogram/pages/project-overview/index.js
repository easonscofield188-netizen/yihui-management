const api = require("../../utils/api");

const RANGE_OPTIONS = [
  { label: "全部", value: "all" },
  { label: "月度", value: "month" },
  { label: "季度", value: "quarter" },
  { label: "本年度", value: "year" },
];

function getNavMetrics() {
  const systemInfo = wx.getSystemInfoSync();
  const statusBarHeight = systemInfo.statusBarHeight || 0;
  const menuButton = wx.getMenuButtonBoundingClientRect();
  const contentHeight = menuButton && menuButton.height
    ? menuButton.height + Math.max(0, menuButton.top - statusBarHeight) * 2
    : 44;
  return { statusBarHeight, navHeight: statusBarHeight + contentHeight };
}

function formatMoney(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount)
    ? amount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "0.00";
}

function formatDateTime(value) {
  if (!value) return "-";
  const raw = value.$date || value;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "-";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function decorateOverview(result) {
  const metrics = (result && result.metrics) || {};
  const trendPercent = Number(metrics.trendPercent || 0);
  const recentProjects = Array.isArray(result && result.recentProjects)
    ? result.recentProjects.map((item, index) => ({
      id: item.id || `project-${index}`,
      name: item.name || `订单 #${String(item.id || "").slice(-5).toUpperCase()}`,
      timeText: formatDateTime(item.time || item.createTime),
      amountText: formatMoney(item.amount),
      statusLabel: item.statusLabel || "进行中",
      statusTone: item.statusTone || "doing",
      icon: item.statusTone === "done" ? "check-circle" : "time",
    }))
    : [];

  return {
    periodLabel: (result && result.periodLabel) || "",
    metrics: {
      profitText: formatMoney(metrics.profit),
      totalAmountText: formatMoney(metrics.totalAmount),
      orderCountText: String(metrics.orderCount || 0),
      unpaidText: `¥${formatMoney(metrics.unpaidAmount)}`,
      unpaidCostText: `¥${formatMoney(metrics.unpaidCost)}`,
      costText: `¥${formatMoney(metrics.totalCost)}`,
      profitRateText: `${Number(metrics.profitRate || 0).toFixed(1)}%`,
      costRateText: `${Number(metrics.costRate || 0).toFixed(1)}%`,
      profitRateWidth: Math.max(0, Math.min(100, Number(metrics.profitRate || 0))),
      costRateWidth: Math.max(0, Math.min(100, Number(metrics.costRate || 0))),
      trendText: `${trendPercent >= 0 ? "+" : ""}${trendPercent.toFixed(1)}%`,
      trendPositive: trendPercent >= 0,
    },
    recentProjects,
  };
}

Page({
  data: {
    statusBarHeight: 0,
    navHeight: 88,
    rangeOptions: RANGE_OPTIONS,
    rangeIndex: 0,
    rangeValue: "all",
    customRange: [],
    customRangeText: "",
    periodLabel: "",
    loading: false,
    loadingMessage: "正在加载项目总览...",
    metrics: {
      profitText: "0.00",
      totalAmountText: "0.00",
      orderCountText: "0",
      unpaidText: "¥0.00",
      unpaidCostText: "¥0.00",
      costText: "¥0.00",
      profitRateText: "0.0%",
      costRateText: "0.0%",
      profitRateWidth: 0,
      costRateWidth: 0,
      trendText: "0.0%",
      trendPositive: true,
    },
    recentProjects: [],
    customPopupVisible: false,
    customStartDate: "",
    customEndDate: "",
    datePickerVisible: false,
    datePickerField: "",
    datePickerValue: "",
    today: "",
  },

  onLoad() {
    const today = new Date();
    const todayText = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    this.setData({
      ...getNavMetrics(),
      today: todayText,
      customStartDate: todayText,
      customEndDate: todayText,
      datePickerValue: todayText,
    });
  },

  onShow() {
    if (!api.getToken()) {
      wx.reLaunch({ url: "/pages/login/index" });
      return;
    }
    this.loadOverview();
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack();
    else wx.switchTab({ url: "/pages/profile/index" });
  },

  onRangeTap(event) {
    const rangeIndex = Number(event.currentTarget.dataset.index);
    const range = this.data.rangeOptions[rangeIndex];
    if (!range || (rangeIndex === this.data.rangeIndex && !this.data.customRange.length)) return;
    this.setData({
      rangeIndex,
      rangeValue: range.value,
      customRange: [],
      customRangeText: "",
    }, () => this.loadOverview());
  },

  openCustomRange() {
    const [start = this.data.today, end = this.data.today] = this.data.customRange;
    this.setData({
      customPopupVisible: true,
      customStartDate: start,
      customEndDate: end,
    });
  },

  closeCustomPopup(event) {
    if (event && event.detail && event.detail.visible === true) return;
    this.setData({ customPopupVisible: false, datePickerVisible: false });
  },

  openDatePicker(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({
      datePickerField: field,
      datePickerValue: field === "start" ? this.data.customStartDate : this.data.customEndDate,
      datePickerVisible: true,
    });
  },

  closeDatePicker() {
    this.setData({ datePickerVisible: false });
  },

  onDateConfirm(event) {
    const value = String(event.detail.value || "").slice(0, 10);
    if (this.data.datePickerField === "start") {
      this.setData({ customStartDate: value, datePickerVisible: false });
    } else {
      this.setData({ customEndDate: value, datePickerVisible: false });
    }
  },

  confirmCustomRange() {
    const start = this.data.customStartDate;
    const end = this.data.customEndDate;
    if (!start || !end) {
      wx.showToast({ title: "请选择完整日期范围", icon: "none" });
      return;
    }
    if (start > end) {
      wx.showToast({ title: "开始日期不能晚于结束日期", icon: "none" });
      return;
    }
    this.setData({
      customRange: [start, end],
      customRangeText: `${start} ~ ${end}`,
      customPopupVisible: false,
      rangeValue: "custom",
    }, () => this.loadOverview());
  },

  async loadOverview() {
    const requestId = (this.overviewRequestId || 0) + 1;
    this.overviewRequestId = requestId;
    this.setData({ loading: true, loadingMessage: "正在加载项目总览..." });
    try {
      const isCustom = this.data.customRange.length === 2;
      const result = await api.getProjectOverview({
        rangeType: isCustom ? "custom" : this.data.rangeValue,
        startDate: isCustom ? this.data.customRange[0] : "",
        endDate: isCustom ? this.data.customRange[1] : "",
      });
      if (requestId !== this.overviewRequestId) return;
      const decorated = decorateOverview(result);
      this.setData(decorated);
    } catch (error) {
      if (requestId !== this.overviewRequestId) return;
      wx.showToast({ title: error.message || "总览加载失败", icon: "none" });
    } finally {
      if (requestId === this.overviewRequestId) {
        this.setData({ loading: false });
      }
    }
  },

  openProject(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/project-detail/index?id=${id}` });
  },

  stopPropagation() {},
});
