const api = require("../../utils/api");
const STATUS_OPTIONS = [
  { label: "全部", value: "" },
  { label: "已交付", value: "completed" },
  { label: "已结清", value: "closed" },
];
const STATUS_LABELS = {
  negotiating: "洽谈中", constructing: "施工中", completed: "已交付",
  settling: "结算中", closed: "已结清", in_cooperation: "合作中", terminated: "已终止",
};

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
  return Number.isNaN(date.getTime()) ? "未设置" : date.toISOString().slice(0, 10);
}

function decorateProject(project) {
  const isClosed = project.status === "closed";
  // 金额字段由后端 calculateFinancials 计算，前端仅做展示格式化
  const profitAmount = Number(project.profitAmount);
  return {
    ...project,
    projectCode: project.projectCode || project.code || project.projectNo ||
      `PRJ-${String(project._id || "").slice(-8).toUpperCase()}`,
    statusLabel: STATUS_LABELS[project.status] || project.status || "未设置",
    isClosed,
    amountLabel: "订单金额",
    amountText: money(project.amount),
    unreceivedText: money(project.unreceivedAmount),
    costText: money(project.payableAmount),
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
    projects: [], keyword: "", statusIndex: 0, statusOptions: STATUS_OPTIONS,
    page: 1, loading: false, hasMore: true, total: 0,
    queryLoading: false, loadingMessage: "正在加载项目...",
    statusBarHeight: 0, navHeight: 88,
  },
  onLoad() {
    wx.setNavigationBarColor({
      frontColor: "#000000",
      backgroundColor: "#ffffff",
      animation: { duration: 0, timingFunc: "linear" },
    });
    const systemInfo = wx.getSystemInfoSync();
    const statusBarHeight = systemInfo.statusBarHeight || 0;
    const menuButton = wx.getMenuButtonBoundingClientRect();
    const contentHeight = menuButton && menuButton.height
      ? menuButton.height + Math.max(0, menuButton.top - statusBarHeight) * 2
      : 88;
    this.setData({ statusBarHeight, navHeight: statusBarHeight + contentHeight });
  },
  onShow() {
    if (!api.getToken()) {
      wx.reLaunch({ url: "/pages/login/index" });
      return;
    }
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.setData({ selected: 0 });
    this.loadProjects(true);
  },
  onPullDownRefresh() {
    this.loadProjects(true).finally(() => wx.stopPullDownRefresh());
  },
  onReachBottom() {
    if (this.data.hasMore) this.loadProjects(false);
  },
  onUnload() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
  },
  onKeywordInput(event) {
    const keyword = event.detail.value;
    this.setData({ keyword });
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.searchTimer = null;
      const message = keyword.trim()
        ? `正在搜索“${keyword.trim()}”...`
        : "正在加载全部项目...";
      this.loadProjects(true, message);
    }, 350);
  },
  onSearch() {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    if (typeof wx.hideKeyboard === "function") wx.hideKeyboard();
    const keyword = this.data.keyword.trim();
    this.loadProjects(true, keyword ? `正在搜索“${keyword}”...` : "正在加载全部项目...");
  },
  clearKeyword() {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    this.setData({ keyword: "" }, () => this.loadProjects(true, "正在加载全部项目..."));
  },
  onStatusTap(event) {
    const statusIndex = Number(event.currentTarget.dataset.index);
    if (statusIndex === this.data.statusIndex) return;
    const statusLabel = this.data.statusOptions[statusIndex].label;
    this.setData({ statusIndex }, () => {
      this.loadProjects(true, `正在筛选“${statusLabel}”项目...`);
    });
  },
  openProject(event) {
    wx.navigateTo({ url: `/pages/project-detail/index?id=${event.currentTarget.dataset.id}` });
  },
  stopPropagation() {},
  async loadProjects(reset, loadingMessage = "") {
    if (!reset && this.data.loading) return;
    const requestId = (this.projectRequestId || 0) + 1;
    this.projectRequestId = requestId;
    const page = reset ? 1 : this.data.page;
    this.setData({
      loading: true,
      queryLoading: Boolean(loadingMessage),
      loadingMessage: loadingMessage || "正在加载项目...",
    });
    try {
      const status = this.data.statusOptions[this.data.statusIndex].value;
      const result = await api.listProjects({
        page,
        pageSize: 20,
        keyword: this.data.keyword.trim(),
        status,
      });
      const incoming = (result.list || []).map(decorateProject);
      if (requestId !== this.projectRequestId) return;
      this.setData({
        projects: reset ? incoming : this.data.projects.concat(incoming),
        total: result.total || 0,
        page: page + 1,
        hasMore: Boolean(result.hasMore),
      });
    } catch (error) {
      if (requestId !== this.projectRequestId) return;
      wx.showToast({ title: error.message || "项目加载失败", icon: "none" });
    } finally {
      if (requestId === this.projectRequestId) {
        this.setData({ loading: false, queryLoading: false });
      }
    }
  },
});
