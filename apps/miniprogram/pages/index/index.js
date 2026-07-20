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

function money(value, digits = 2) {
  const amount = Number(value || 0);
  return Number.isFinite(amount)
    ? amount.toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : digits ? "0.00" : "0";
}

function decorateProject(project) {
  const isClosed = project.status === "closed";
  return {
    ...project,
    projectCode: project.projectCode || project.code || project.projectNo ||
      `PRJ-${String(project._id || "").slice(-8).toUpperCase()}`,
    statusLabel: STATUS_LABELS[project.status] || project.status || "未设置",
    isClosed,
    amountLabel: isClosed ? "结算金额" : "订单金额",
    amountText: money(project.amount),
    unreceivedText: money(project.unreceivedAmount, 0),
    costText: money(project.payableAmount, 0),
  };
}

Page({
  data: {
    projects: [], keyword: "", statusIndex: 0, statusOptions: STATUS_OPTIONS,
    page: 1, loading: false, hasMore: true, total: 0,
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
  onKeywordInput(event) {
    this.setData({ keyword: event.detail.value });
  },
  onSearch() {
    this.loadProjects(true);
  },
  clearKeyword() {
    this.setData({ keyword: "" }, () => this.loadProjects(true));
  },
  onStatusTap(event) {
    const statusIndex = Number(event.currentTarget.dataset.index);
    if (statusIndex === this.data.statusIndex) return;
    this.setData({ statusIndex }, () => this.loadProjects(true));
  },
  openProject(event) {
    wx.navigateTo({ url: `/pages/project-detail/index?id=${event.currentTarget.dataset.id}` });
  },
  async loadProjects(reset) {
    if (this.data.loading) return;
    const page = reset ? 1 : this.data.page;
    this.setData({ loading: true });
    try {
      const status = this.data.statusOptions[this.data.statusIndex].value;
      const result = await api.listProjects({
        page, pageSize: 20, keyword: this.data.keyword.trim(), status,
      });
      const incoming = (result.list || []).map(decorateProject);
      this.setData({
        projects: reset ? incoming : this.data.projects.concat(incoming),
        total: result.total || 0,
        page: page + 1,
        hasMore: Boolean(result.hasMore),
      });
    } catch (error) {
      wx.showToast({ title: error.message || "项目加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },
});
