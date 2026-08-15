const api = require("../../utils/api");
const LIST_REFRESH_KEY = "projectQuotationListRefreshV1";

function getNavMetrics() {
  const systemInfo = wx.getSystemInfoSync();
  const statusBarHeight = systemInfo.statusBarHeight || 0;
  const menuButton = wx.getMenuButtonBoundingClientRect();
  const contentHeight = menuButton && menuButton.height
    ? menuButton.height + Math.max(0, menuButton.top - statusBarHeight) * 2
    : 44;
  return { statusBarHeight, navHeight: statusBarHeight + contentHeight };
}

function defaultYears() {
  return ["2026", "2025", "2024"];
}

function moneyText(value) {
  const num = Number(value);
  const val = !isNaN(num) ? num : 0;
  const parts = val.toFixed(2).split(".");
  const integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${integerPart}.${parts[1]}`;
}

const CHINESE_NUMS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
function formatVersionLabel(sequence, rawVersion) {
  const seq = Number(sequence);
  if (seq >= 1 && seq <= 10) return `版本${CHINESE_NUMS[seq]}`;
  if (rawVersion) {
    const match = String(rawVersion).match(/\d+/);
    if (match && CHINESE_NUMS[Number(match[0])]) {
      return `版本${CHINESE_NUMS[Number(match[0])]}`;
    }
  }
  return `版本${seq || 1}`;
}

function decorateQuotation(item) {
  const seq = Number(item.versionSequence || 1);
  const colorIndex = ((seq - 1) % 5) + 1;
  return {
    ...item,
    projectName: item.projectName || "未命名项目",
    projectCode: item.projectCode || "-",
    version: item.version || "V1.0",
    versionSequence: seq,
    versionColorClass: `version-v${colorIndex}`,
    versionLabel: item.versionLabel || formatVersionLabel(seq, item.version),
    amountText: moneyText(item.totalAmount),
    createdDate: item.createdDate || "日期未设置",
  };
}

Page({
  data: {
    ...getNavMetrics(),
    keyword: "",
    yearOptions: [{ value: "", label: "全部年度" }].concat(
      defaultYears().map(year => ({ value: year, label: year }))
    ),
    yearIndex: 0,
    quotations: [],
    page: 1,
    total: 0,
    hasMore: true,
    loading: true,
    canManage: false,
    deleting: false,
    selectionMode: false,
    selectedIds: [],
    allSelected: false,
  },

  onLoad() {
    if (!api.getToken()) {
      wx.reLaunch({ url: "/pages/login/index" });
      return;
    }
    this.loadQuotations(true);
  },

  onShow() {
    const refreshMarker = wx.getStorageSync(LIST_REFRESH_KEY) || null;
    if (!refreshMarker) return;
    wx.removeStorageSync(LIST_REFRESH_KEY);
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.setData({ keyword: "", yearIndex: 0 });
    this.refreshTimer = setTimeout(() => {
      this.refreshAfterCreate(String(refreshMarker.id || ""));
    }, 300);
  },

  onUnload() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    if (this.refreshRetryTimer) clearTimeout(this.refreshRetryTimer);
    if (this.longPressTimer) clearTimeout(this.longPressTimer);
  },

  onPullDownRefresh() {
    if (this.data.selectionMode) {
      wx.stopPullDownRefresh();
      return;
    }
    this.loadQuotations(true).finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (!this.data.selectionMode && !this.data.loading && this.data.hasMore) this.loadQuotations(false);
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack({ delta: 1 });
      return;
    }
    wx.switchTab({
      url: "/pages/profile/index",
      fail: () => wx.reLaunch({ url: "/pages/profile/index" }),
    });
  },

  onKeywordChange(event) {
    const keyword = String(event.detail.value || "");
    this.setData({ keyword, selectionMode: false, selectedIds: [], allSelected: false });
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.loadQuotations(true), 300);
  },

  onYearTap(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!this.data.yearOptions[index] || index === this.data.yearIndex) return;
    this.setData({
      yearIndex: index,
      selectionMode: false,
      selectedIds: [],
      allSelected: false,
    }, () => this.loadQuotations(true));
  },

  openQuotation(event) {
    const id = String(event.currentTarget.dataset.id || "");
    if (!id) return;
    if (this.longPressedId === id) {
      this.longPressedId = "";
      return;
    }
    if (this.data.selectionMode) {
      this.toggleSelectionById(id);
      return;
    }
    wx.navigateTo({ url: `/pages/project-quotation-detail/index?id=${encodeURIComponent(id)}` });
  },

  enterSelectionMode(event) {
    if (!this.data.canManage) return;
    const id = String(event.currentTarget.dataset.id || "");
    if (!id) return;
    this.longPressedId = id;
    if (this.longPressTimer) clearTimeout(this.longPressTimer);
    this.longPressTimer = setTimeout(() => {
      this.longPressedId = "";
    }, 700);
    if (wx.vibrateShort) wx.vibrateShort({ type: "light" });
    if (this.data.selectionMode) {
      this.toggleSelectionById(id);
      return;
    }
    this.applySelection([id], true);
  },

  toggleSelectionById(id) {
    const selectedIds = this.data.selectedIds.includes(id)
      ? this.data.selectedIds.filter(item => item !== id)
      : this.data.selectedIds.concat(id);
    this.applySelection(selectedIds, true);
  },

  applySelection(selectedIds, selectionMode = this.data.selectionMode) {
    const selectedSet = new Set(selectedIds);
    const total = Number(this.data.total) || this.data.quotations.length;
    this.setData({
      selectionMode,
      selectedIds,
      allSelected: total > 0 && selectedIds.length === total,
      quotations: this.data.quotations.map(item => ({
        ...item,
        selected: selectedSet.has(item._id),
      })),
    });
  },

  cancelSelection() {
    this.applySelection([], false);
  },

  async toggleSelectAll() {
    if (this.data.deleting || !this.data.total) return;
    if (this.data.allSelected) {
      this.applySelection([], true);
      return;
    }
    try {
      this.setData({ loading: true });
      const year = this.data.yearOptions[this.data.yearIndex]?.value || "";
      const result = await api.listProjectQuotationIds({
        keyword: this.data.keyword.trim(),
        year,
      });
      this.applySelection(Array.isArray(result.ids) ? result.ids : [], true);
    } catch (error) {
      wx.showToast({ title: error.message || "全选失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  deleteSelected() {
    if (!this.data.selectedIds.length || this.data.deleting) return;
    const count = this.data.selectedIds.length;
    wx.showModal({
      title: count > 1 ? "批量删除报价单" : "删除报价单",
      content: count > 1
        ? `确定删除选中的 ${count} 份报价单吗？相关历史版本、图片及附件也会一并删除，且无法恢复。`
        : "确定删除这份报价单吗？相关历史版本、图片及附件也会一并删除，且无法恢复。",
      confirmText: "删除",
      confirmColor: "#c62828",
      success: result => {
        if (result.confirm) this.performDelete(this.data.selectedIds.slice());
      },
    });
  },

  async performDelete(ids) {
    if (this.data.deleting) return;
    this.setData({ deleting: true });
    try {
      await api.deleteProjectQuotations(ids);
      wx.showToast({ title: "删除成功", icon: "success" });
      this.setData({ selectionMode: false, selectedIds: [], allSelected: false });
      await this.loadQuotations(true);
    } catch (error) {
      wx.showToast({ title: error.message || "删除失败", icon: "none" });
    } finally {
      this.setData({ deleting: false });
    }
  },

  createQuotation() {
    wx.navigateTo({ url: "/pages/project-quotation-create/index" });
  },

  async refreshAfterCreate(createdId) {
    await this.loadQuotations(true);
    if (!createdId || this.data.quotations.some(item => item._id === createdId)) return;
    await new Promise(resolve => {
      this.refreshRetryTimer = setTimeout(resolve, 700);
    });
    await this.loadQuotations(true);
  },

  async loadQuotations(reset) {
    if (!reset && (this.data.loading || !this.data.hasMore)) return;
    const requestId = (this.requestId || 0) + 1;
    this.requestId = requestId;
    const page = reset ? 1 : this.data.page;
    const year = this.data.yearOptions[this.data.yearIndex]?.value || "";
    this.setData({ loading: true });
    try {
      const result = await api.listProjectQuotations({
        page,
        pageSize: 10,
        keyword: this.data.keyword.trim(),
        year,
      });
      if (requestId !== this.requestId) return;
      const selectedSet = new Set(this.data.selectedIds);
      const incoming = (result.list || []).map(item => ({
        ...decorateQuotation(item),
        selected: selectedSet.has(item._id),
      }));
      const remoteYears = Array.isArray(result.years) ? result.years : [];
      const yearValues = Array.from(new Set(defaultYears().concat(remoteYears)))
        .sort((left, right) => Number(right) - Number(left));
      const selectedYear = year;
      const yearOptions = [{ value: "", label: "全部年度" }].concat(
        yearValues.map(value => ({ value, label: value }))
      );
      const yearIndex = Math.max(0, yearOptions.findIndex(item => item.value === selectedYear));
      this.setData({
        yearOptions,
        yearIndex,
        quotations: reset ? incoming : this.data.quotations.concat(incoming),
        page: page + 1,
        total: Number(result.total) || 0,
        hasMore: Boolean(result.hasMore),
        canManage: Boolean(result.canManage),
      });
      return result;
    } catch (error) {
      if (requestId !== this.requestId) return;
      wx.showToast({ title: error.message || "报价单加载失败", icon: "none" });
      return null;
    } finally {
      if (requestId === this.requestId) this.setData({ loading: false });
    }
  },
});
