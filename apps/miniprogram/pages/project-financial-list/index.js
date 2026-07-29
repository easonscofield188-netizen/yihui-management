const api = require("../../utils/api");

const FINANCIAL_TYPES = Object.freeze({
  UNRECEIVED: "unreceived",
  UNPAID_COST: "unpaid_cost",
});

const TYPE_META = Object.freeze({
  [FINANCIAL_TYPES.UNRECEIVED]: {
    title: "待收款项目",
    summaryLabel: "总待收金额",
    emptyTitle: "暂无待收款项目",
    emptyHint: "当前时间范围内没有待收款项目",
  },
  [FINANCIAL_TYPES.UNPAID_COST]: {
    title: "待付成本项目",
    summaryLabel: "总待付成本",
    emptyTitle: "暂无待付成本项目",
    emptyHint: "当前时间范围内没有待付成本项目",
  },
});

const STATUS_LABELS = {
  negotiating: "洽谈中",
  constructing: "施工中",
  completed: "已交付",
  settling: "结算中",
  closed: "已结清",
  archived: "已归档",
  in_cooperation: "合作中",
  terminated: "已终止",
};

function getNavMetrics() {
  const systemInfo = wx.getSystemInfoSync();
  const statusBarHeight = systemInfo.statusBarHeight || 0;
  const menuButton = wx.getMenuButtonBoundingClientRect();
  const contentHeight = menuButton && menuButton.height
    ? menuButton.height + Math.max(0, menuButton.top - statusBarHeight) * 2
    : 44;
  return { statusBarHeight, navHeight: statusBarHeight + contentHeight };
}

function money(value) {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? amount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "0.00";
}

function dateText(value) {
  if (!value) return "未设置";
  const raw = value.$date || value;
  const directDate = String(raw).match(/^\d{4}-\d{2}-\d{2}/);
  if (directDate) return directDate[0];
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "未设置";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function decorateProject(project, type) {
  const isClosed = ["closed", "archived"].includes(project.status);
  const usesCheckIcon = ["completed", "closed", "archived"].includes(project.status);
  const statusIconColors = {
    completed: "#002045",
    closed: "#0f7a45",
    archived: "#6b7280",
  };
  const profitAmount = Number(project.profitAmount);
  const isUnpaidCost = type === FINANCIAL_TYPES.UNPAID_COST;
  const createdDate = dateText(project.createTime);
  const createdDateMatch = createdDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return {
    ...project,
    createDateText: createdDateMatch
      ? `${createdDateMatch[1]}年${createdDateMatch[2]}月${createdDateMatch[3]}日`
      : createdDate,
    statusLabel: STATUS_LABELS[project.status] || project.status || "未设置",
    isClosed,
    usesCheckIcon,
    statusIconColor: statusIconColors[project.status] || "#002045",
    amountText: money(project.amount),
    unreceivedText: money(project.unreceivedAmount),
    costLabel: isUnpaidCost ? "待付成本" : "项目成本",
    costText: money(isUnpaidCost ? project.unpaidCostAmount : project.payableAmount),
    profitText: money(project.profitAmount),
    profitPositive: Number.isFinite(profitAmount) ? profitAmount >= 0 : true,
    deliveryDateText: dateText(
      project.startDate
      || project.completionTime
      || (project.period && project.period[1])
    ),
  };
}

Page({
  data: {
    statusBarHeight: 0,
    navHeight: 88,
    filterType: FINANCIAL_TYPES.UNRECEIVED,
    rangeType: "all",
    startDate: "",
    endDate: "",
    pageTitle: TYPE_META[FINANCIAL_TYPES.UNRECEIVED].title,
    summaryLabel: TYPE_META[FINANCIAL_TYPES.UNRECEIVED].summaryLabel,
    summaryAmountText: "0.00",
    periodLabel: "全部项目",
    emptyTitle: TYPE_META[FINANCIAL_TYPES.UNRECEIVED].emptyTitle,
    emptyHint: TYPE_META[FINANCIAL_TYPES.UNRECEIVED].emptyHint,
    projects: [],
    total: 0,
    page: 1,
    hasMore: true,
    loading: false,
  },

  onLoad(options = {}) {
    const type = Object.prototype.hasOwnProperty.call(TYPE_META, options.type)
      ? options.type
      : FINANCIAL_TYPES.UNRECEIVED;
    const meta = TYPE_META[type];
    this.setData({
      ...getNavMetrics(),
      filterType: type,
      rangeType: ["all", "month", "quarter", "year", "custom"].includes(options.rangeType)
        ? options.rangeType
        : "all",
      startDate: String(options.startDate || "").slice(0, 10),
      endDate: String(options.endDate || "").slice(0, 10),
      pageTitle: meta.title,
      summaryLabel: meta.summaryLabel,
      emptyTitle: meta.emptyTitle,
      emptyHint: meta.emptyHint,
    });
  },

  onShow() {
    if (!api.getToken()) {
      wx.reLaunch({ url: "/pages/login/index" });
      return;
    }
    this.loadProjects(true);
  },

  onPullDownRefresh() {
    this.loadProjects(true).finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) this.loadProjects(false);
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack();
    else wx.navigateTo({ url: "/pages/project-overview/index" });
  },

  openProject(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/project-detail/index?id=${id}` });
  },

  async loadProjects(reset) {
    if (!reset && (this.data.loading || !this.data.hasMore)) return;
    const requestId = (this.requestId || 0) + 1;
    this.requestId = requestId;
    const page = reset ? 1 : this.data.page;
    this.setData({ loading: true });
    try {
      const result = await api.listFinancialProjects({
        type: this.data.filterType,
        rangeType: this.data.rangeType,
        startDate: this.data.startDate,
        endDate: this.data.endDate,
        page,
        pageSize: 20,
      });
      if (requestId !== this.requestId) return;
      const incoming = (result.list || []).map((project) => (
        decorateProject(project, this.data.filterType)
      ));
      this.setData({
        projects: reset ? incoming : this.data.projects.concat(incoming),
        total: Number(result.total) || 0,
        summaryAmountText: money(result.summaryAmount),
        periodLabel: result.periodLabel || "全部项目",
        page: page + 1,
        hasMore: Boolean(result.hasMore),
      });
    } catch (error) {
      if (requestId !== this.requestId) return;
      wx.showToast({ title: error.message || "项目加载失败", icon: "none" });
    } finally {
      if (requestId === this.requestId) this.setData({ loading: false });
    }
  },
});
