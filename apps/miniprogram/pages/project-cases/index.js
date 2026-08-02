const api = require("../../utils/api");

const DEFAULT_CATEGORIES = [
  { value: "", label: "全部案例" },
  { value: "internal_operation", label: "内部运营" },
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

function dateText(value) {
  if (!value) return "日期未设置";
  const raw = value.$date || value;
  const direct = String(raw).match(/^\d{4}-\d{2}-\d{2}/);
  if (direct) return direct[0];
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "日期未设置";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function moneyText(value) {
  const amount = Number(value || 0);
  return amount.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function decorateCase(item) {
  const amount = Number(item.amount || 0);
  return {
    ...item,
    title: item.title || item.projectName || item.name || "未命名案例",
    categoryLabel: item.categoryLabel || "其他",
    dateText: dateText(item.caseDate),
    summary: item.summary || item.description || item.desc || "暂无案例简介",
    detailText: item.content || item.detail || item.summary || item.description || item.desc || "暂无详细内容",
    coverDisplayUrl: item.coverFileId || item.coverUrl || item.imageUrl || "",
    showAmount: item.amountEnabled !== false && amount > 0,
    amountText: moneyText(amount),
  };
}

Page({
  data: {
    ...getNavMetrics(),
    categories: DEFAULT_CATEGORIES,
    categoryIndex: 0,
    cases: [],
    page: 1,
    total: 0,
    hasMore: true,
    loading: false,
    canManage: false,
  },

  onLoad() {
    if (!api.getToken()) {
      wx.reLaunch({ url: "/pages/login/index" });
      return;
    }
    this.loadCases(true);
  },

  onShow() {
    if (this.hasShown) this.loadCases(true);
    this.hasShown = true;
  },

  onPullDownRefresh() {
    this.loadCases(true).finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (!this.data.loading && this.data.hasMore) this.loadCases(false);
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack();
    else wx.switchTab({ url: "/pages/profile/index" });
  },

  onCategoryTap(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!this.data.categories[index] || index === this.data.categoryIndex) return;
    this.setData({ categoryIndex: index }, () => this.loadCases(true));
  },

  onCoverError(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index) || !this.data.cases[index]) return;
    this.setData({ [`cases[${index}].coverDisplayUrl`]: "" });
  },

  openCase(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/project-case-detail/index?id=${id}` });
  },

  createCase() {
    wx.navigateTo({ url: "/pages/project-case-create/index" });
  },

  async loadCases(reset) {
    if (!reset && (this.data.loading || !this.data.hasMore)) return;
    const requestId = (this.requestId || 0) + 1;
    this.requestId = requestId;
    const page = reset ? 1 : this.data.page;
    const categoryCode = this.data.categories[this.data.categoryIndex]?.value || "";
    this.setData({ loading: true });
    try {
      const result = await api.listProjectCases({ page, pageSize: 10, categoryCode });
      if (requestId !== this.requestId) return;
      const incoming = (result.list || []).map(decorateCase);
      const remoteCategories = Array.isArray(result.categories) ? result.categories : [];
      const categories = remoteCategories.length
        ? [{ value: "", label: "全部案例" }].concat(remoteCategories)
        : this.data.categories;
      this.setData({
        categories,
        cases: reset ? incoming : this.data.cases.concat(incoming),
        page: page + 1,
        total: Number(result.total) || 0,
        hasMore: Boolean(result.hasMore),
        canManage: Boolean(result.canManage),
      });
    } catch (error) {
      if (requestId !== this.requestId) return;
      wx.showToast({ title: error.message || "案例加载失败", icon: "none" });
    } finally {
      if (requestId === this.requestId) this.setData({ loading: false });
    }
  },
});
