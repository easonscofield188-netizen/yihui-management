const api = require("../../utils/api");

const DELETABLE_STATUSES = new Set(["APPROVED", "REJECTED", "MERGED"]);

function nav() {
  const s = wx.getSystemInfoSync();
  const b = wx.getMenuButtonBoundingClientRect();
  const h = s.statusBarHeight || 0;
  return {
    statusBarHeight: h,
    navHeight: h + (b?.height ? b.height + Math.max(0, b.top - h) * 2 : 44),
  };
}

function timeText(v) {
  const d = new Date(Number(v) || 0);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

Page({
  data: {
    ...nav(),
    tabs: [
      { label: "待审核", value: "PENDING" },
      { label: "全部", value: "ALL" },
    ],
    tabIndex: 0,
    list: [],
    total: 0,
    page: 1,
    hasMore: true,
    loading: false,
    deleting: false,
    selectionMode: false,
    selectedIds: [],
    allSelected: false,
  },

  onShow() {
    const u = api.getCachedUserInfo() || {};
    if (u.role !== "ADMIN_SUPER") {
      wx.showToast({ title: "仅超级系统管理员有权限查看", icon: "none" });
      return this.back();
    }
    this.load(true);
  },

  onPullDownRefresh() {
    if (this.data.selectionMode) {
      wx.stopPullDownRefresh();
      return;
    }
    this.load(true).finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (!this.data.selectionMode && !this.data.loading && this.data.hasMore) {
      this.load(false);
    }
  },

  back() {
    if (this.data.selectionMode) {
      this.cancelSelection();
      return;
    }
    getCurrentPages().length > 1
      ? wx.navigateBack()
      : wx.navigateTo({ url: "/pages/admin-center/index" });
  },

  changeTab(e) {
    if (this.data.selectionMode) return;
    const i = Number(e.currentTarget.dataset.index);
    if (i === this.data.tabIndex) return;
    this.setData({ tabIndex: i, selectionMode: false, selectedIds: [], allSelected: false }, () => this.load(true));
  },

  async load(reset = true) {
    if (this.data.loading) return;
    const page = reset ? 1 : this.data.page;
    this.setData({ loading: true });
    try {
      const status = this.data.tabs[this.data.tabIndex].value;
      const r = await api.listCategoryReviews({
        status,
        page,
        pageSize: 20,
      });
      const selectedSet = new Set(this.data.selectedIds);
      const incoming = (r.list || []).map((x) => ({
        ...x,
        isDeletable: DELETABLE_STATUSES.has(x.status),
        timeText: timeText(x.latestTimestamp || x.createdTimestamp),
        selected: DELETABLE_STATUSES.has(x.status) && selectedSet.has(x._id),
      }));
      const total = Number(r.total) || 0;
      this.setData({
        list: reset ? incoming : this.data.list.concat(incoming),
        total,
        page: page + 1,
        hasMore: Boolean(r.hasMore),
      });
    } catch (e) {
      wx.showToast({ title: e.message || "审核列表加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  onCardTap(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    if (this.data.selectionMode) {
      const target = this.data.list.find((item) => item._id === id);
      if (target && !target.isDeletable) {
        wx.showToast({ title: "待审核记录需先完成审核，不可删除", icon: "none" });
        return;
      }
      this.toggleSelectionById(id);
      return;
    }
    wx.navigateTo({ url: `/pages/category-review-detail/index?id=${id}` });
  },

  onCardLongPress(e) {
    const u = api.getCachedUserInfo() || {};
    if (u.role !== "ADMIN_SUPER") return;
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const target = this.data.list.find((item) => item._id === id);
    if (target && !target.isDeletable) {
      wx.showToast({ title: "待审核状态记录不允许删除", icon: "none" });
      return;
    }
    if (wx.vibrateShort) wx.vibrateShort({ type: "light" });
    if (this.data.selectionMode) {
      this.toggleSelectionById(id);
      return;
    }
    this.applySelection([id], true);
  },

  toggleSelectionById(id) {
    const selectedIds = this.data.selectedIds.includes(id)
      ? this.data.selectedIds.filter((item) => item !== id)
      : this.data.selectedIds.concat(id);
    this.applySelection(selectedIds, true);
  },

  applySelection(selectedIds, selectionMode = this.data.selectionMode) {
    const selectedSet = new Set(selectedIds);
    const deletableItems = this.data.list.filter((item) => item.isDeletable);
    const deletableCount = deletableItems.length;
    this.setData({
      selectionMode,
      selectedIds,
      allSelected: deletableCount > 0 && selectedIds.length >= deletableCount,
      list: this.data.list.map((item) => ({
        ...item,
        selected: item.isDeletable && selectedSet.has(item._id),
      })),
    });
  },

  cancelSelection() {
    this.applySelection([], false);
  },

  async toggleSelectAll() {
    if (this.data.deleting) return;
    if (this.data.allSelected) {
      this.applySelection([], true);
      return;
    }
    try {
      this.setData({ loading: true });
      const status = this.data.tabs[this.data.tabIndex].value;
      const result = await api.listCategoryReviewIds({ status });
      const deletableIds = Array.isArray(result.ids) ? result.ids : [];
      if (!deletableIds.length) {
        wx.showToast({ title: "当前没有可删除的已审核记录", icon: "none" });
        return;
      }
      this.applySelection(deletableIds, true);
    } catch (error) {
      wx.showToast({ title: error.message || "全选失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  deleteSelected() {
    if (!this.data.selectedIds.length || this.data.deleting) return;
    this.confirmDelete(this.data.selectedIds);
  },

  confirmDelete(ids) {
    const count = ids.length;
    wx.showModal({
      title: count > 1 ? "批量删除审核记录" : "删除审核记录",
      content: count > 1 ? `确定删除选中的 ${count} 条已审核记录吗？` : "确定删除该条已审核记录吗？",
      confirmText: "删除",
      confirmColor: "#c62828",
      success: (result) => {
        if (result.confirm) this.performDelete(ids);
      },
    });
  },

  async performDelete(ids) {
    if (this.data.deleting) return;
    this.setData({ deleting: true });
    try {
      await api.deleteCategoryReviews(ids);
      wx.showToast({ title: "删除成功", icon: "success" });
      this.setData({ selectionMode: false, selectedIds: [], allSelected: false });
      await this.load(true);
    } catch (error) {
      wx.showToast({ title: error.message || "删除失败", icon: "none" });
    } finally {
      this.setData({ deleting: false });
    }
  },
});
