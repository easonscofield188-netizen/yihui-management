const api = require("../../utils/api");
const {
  FLOATING_NOTIFICATION_MODE,
  getFloatingNotificationMode,
  getFloatingNotificationPosition,
  setFloatingNotificationPosition,
} = require("../../utils/notification-preferences");

const NOTIFICATION_COUNT_KEY = "notificationUnreadCount";
const NOTIFICATION_COUNT_AT_KEY = "notificationUnreadCountCachedAt";
const NOTIFICATION_COUNT_TTL_MS = 30 * 1000;
const STATUS_OPTIONS = [
  { label: "全部", value: "" },
  { label: "已交付", value: "completed" },
  { label: "已结清", value: "closed" },
  { label: "已归档", value: "archived" },
];
const STATUS_LABELS = {
  negotiating: "洽谈中", constructing: "施工中", completed: "已交付",
  settling: "结算中", closed: "已结清", archived: "已归档", in_cooperation: "合作中", terminated: "已终止",
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
  if (Number.isNaN(date.getTime())) return "未设置";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const ALL_YEARS_VALUE = "all";

function getLocalYear() {
  return new Date().getFullYear();
}

function buildYearOptions(maxYear) {
  const end = Number(maxYear) || getLocalYear();
  const start = Math.max(2000, end - 15);
  const options = [{ label: "全部年份", value: ALL_YEARS_VALUE }];
  for (let year = end; year >= start; year -= 1) {
    options.push({ label: `${year}年`, value: String(year) });
  }
  return options;
}

function yearChipText(filterYear) {
  if (!filterYear || filterYear === ALL_YEARS_VALUE) return "全部年份";
  return `${filterYear}年`;
}

function loadingYearText(filterYear) {
  if (!filterYear || filterYear === ALL_YEARS_VALUE) return "全部年份";
  return `${filterYear}年`;
}

function decorateProject(project) {
  const isClosed = ["closed", "archived"].includes(project.status);
  const usesCheckIcon = ["completed", "closed", "archived"].includes(project.status);
  const statusIconColors = {
    completed: "#002045",
    closed: "#0f7a45",
    archived: "#6b7280",
  };
  const profitAmount = Number(project.profitAmount);
  return {
    ...project,
    projectCode: project.projectCode || project.code || project.projectNo ||
      `PRJ-${String(project._id || "").slice(-8).toUpperCase()}`,
    createDateText: (() => {
      const text = dateText(project.createTime);
      if (!text || text === "未设置") return "未设置";
      const matched = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!matched) return text;
      return `${matched[1]}年${matched[2]}月${matched[3]}日`;
    })(),
    statusLabel: STATUS_LABELS[project.status] || project.status || "未设置",
    isClosed,
    usesCheckIcon,
    statusIconColor: statusIconColors[project.status] || "#002045",
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
    projects: [],
    keyword: "",
    statusIndex: 0,
    statusOptions: STATUS_OPTIONS,
    filterYear: ALL_YEARS_VALUE,
    filterYearText: "全部年份",
    maxYear: getLocalYear(),
    yearOptions: buildYearOptions(getLocalYear()),
    yearPickerValue: [ALL_YEARS_VALUE],
    yearPickerVisible: false,
    page: 1,
    loading: false,
    hasMore: true,
    total: 0,
    queryLoading: false,
    loadingMessage: "正在加载项目...",
    statusBarHeight: 0,
    navHeight: 88,
    yearReady: false,
    floatingNotificationVisible: false,
    floatingNotificationMode: FLOATING_NOTIFICATION_MODE.UNREAD_ONLY,
    floatingNotificationCount: 0,
    floatingNotificationLeft: 0,
    floatingNotificationTop: 0,
    floatingNotificationDragging: false,
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
    const navHeight = statusBarHeight + contentHeight;
    this.setData({ statusBarHeight, navHeight });
    this.initializeFloatingNotification(systemInfo, navHeight);
  },

  ensureYearReady() {
    if (this.yearReadyPromise) return this.yearReadyPromise;
    this.yearReadyPromise = this.initFilterYear().finally(() => {
      // 允许失败后重试
      if (!this.data.yearReady) this.yearReadyPromise = null;
    });
    return this.yearReadyPromise;
  },

  async initFilterYear() {
    let year = getLocalYear();
    try {
      const result = await api.getServerDate();
      const serverDate = String((result && result.date) || "").slice(0, 10);
      const matched = serverDate.match(/^(\d{4})-/);
      if (matched) year = Number(matched[1]);
    } catch (error) {
      // 回退本地年份
    }
    this.setData({
      filterYear: ALL_YEARS_VALUE,
      filterYearText: "全部年份",
      maxYear: year,
      yearOptions: buildYearOptions(year),
      yearPickerValue: [ALL_YEARS_VALUE],
      yearReady: true,
    });
  },

  onShow() {
    if (!api.getToken()) {
      wx.reLaunch({ url: "/pages/login/index" });
      return;
    }
    const tabBar = this.getTabBar && this.getTabBar();
    if (tabBar) tabBar.setData({ selected: 0 });
    this.ensureYearThenLoad(true);
    this.loadFloatingNotification();
  },

  async ensureYearThenLoad(reset, loadingMessage = "") {
    await this.ensureYearReady();
    return this.loadProjects(reset, loadingMessage);
  },

  onPullDownRefresh() {
    Promise.all([
      this.ensureYearThenLoad(true),
      this.loadFloatingNotification({ force: true }),
    ]).finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (this.data.hasMore) this.loadProjects(false);
  },

  onUnload() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    if (this.floatTapTimer) clearTimeout(this.floatTapTimer);
  },

  initializeFloatingNotification(systemInfo, navHeight) {
    const windowWidth = Number(systemInfo.windowWidth) || 375;
    const windowHeight = Number(systemInfo.windowHeight) || 667;
    const size = Math.round(windowWidth * 104 / 750);
    const edge = Math.max(10, Math.round(windowWidth * 20 / 750));
    const tabBarReserved = Math.max(84, Math.round(windowWidth * 174 / 750));
    const bounds = {
      minX: edge,
      maxX: Math.max(edge, windowWidth - size - edge),
      minY: Math.max(navHeight + 12, edge),
      maxY: Math.max(navHeight + 12, windowHeight - size - tabBarReserved),
      size,
    };
    this.floatingNotificationBounds = bounds;
    const saved = getFloatingNotificationPosition();
    const xRatio = saved ? saved.xRatio : 1;
    const yRatio = saved ? saved.yRatio : 0.55;
    this.setData({
      floatingNotificationLeft: bounds.minX + (bounds.maxX - bounds.minX) * xRatio,
      floatingNotificationTop: bounds.minY + (bounds.maxY - bounds.minY) * yRatio,
    });
  },

  updateFloatingNotificationVisibility(mode, count) {
    const userInfo = api.getCachedUserInfo() || {};
    const isSuperAdmin = userInfo.role === "ADMIN_SUPER";
    const visible = isSuperAdmin
      && (mode === FLOATING_NOTIFICATION_MODE.ALWAYS || count > 0);
    this.setData({
      floatingNotificationMode: mode,
      floatingNotificationCount: count,
      floatingNotificationVisible: visible,
    });
  },

  loadFloatingNotification({ force = false } = {}) {
    const mode = getFloatingNotificationMode();
    const userInfo = api.getCachedUserInfo() || {};
    if (userInfo.role !== "ADMIN_SUPER") {
      this.updateFloatingNotificationVisibility(mode, 0);
      return Promise.resolve(0);
    }

    const cachedCount = Math.max(0, Number(wx.getStorageSync(NOTIFICATION_COUNT_KEY)) || 0);
    const cachedAt = Number(wx.getStorageSync(NOTIFICATION_COUNT_AT_KEY)) || 0;
    this.updateFloatingNotificationVisibility(mode, cachedCount);
    if (!force && cachedAt && Date.now() - cachedAt < NOTIFICATION_COUNT_TTL_MS) {
      return Promise.resolve(cachedCount);
    }
    if (this.floatingNotificationPromise) return this.floatingNotificationPromise;

    this.floatingNotificationPromise = api.getNotificationUnreadCount()
      .then((result) => {
        const count = Math.max(0, Number(result.unreadCount) || 0);
        wx.setStorageSync(NOTIFICATION_COUNT_KEY, count);
        wx.setStorageSync(NOTIFICATION_COUNT_AT_KEY, Date.now());
        this.updateFloatingNotificationVisibility(getFloatingNotificationMode(), count);
        return count;
      })
      .catch(() => cachedCount)
      .finally(() => {
        this.floatingNotificationPromise = null;
      });
    return this.floatingNotificationPromise;
  },

  onFloatingNotificationTouchStart(event) {
    const touch = event.touches && event.touches[0];
    if (!touch) return;
    this.floatingNotificationDrag = {
      startX: touch.clientX,
      startY: touch.clientY,
      originLeft: this.data.floatingNotificationLeft,
      originTop: this.data.floatingNotificationTop,
      moved: false,
    };
    this.setData({ floatingNotificationDragging: true });
  },

  onFloatingNotificationTouchMove(event) {
    const touch = event.touches && event.touches[0];
    const drag = this.floatingNotificationDrag;
    const bounds = this.floatingNotificationBounds;
    if (!touch || !drag || !bounds) return;
    const deltaX = touch.clientX - drag.startX;
    const deltaY = touch.clientY - drag.startY;
    if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) drag.moved = true;
    const left = Math.min(bounds.maxX, Math.max(bounds.minX, drag.originLeft + deltaX));
    const top = Math.min(bounds.maxY, Math.max(bounds.minY, drag.originTop + deltaY));
    this.setData({ floatingNotificationLeft: left, floatingNotificationTop: top });
  },

  onFloatingNotificationTouchEnd() {
    const drag = this.floatingNotificationDrag;
    const bounds = this.floatingNotificationBounds;
    this.floatingNotificationDrag = null;
    this.setData({ floatingNotificationDragging: false });
    if (!drag || !bounds || !drag.moved) return;
    const xRange = Math.max(1, bounds.maxX - bounds.minX);
    const yRange = Math.max(1, bounds.maxY - bounds.minY);
    setFloatingNotificationPosition({
      xRatio: (this.data.floatingNotificationLeft - bounds.minX) / xRange,
      yRatio: (this.data.floatingNotificationTop - bounds.minY) / yRange,
    });
    this.suppressFloatingNotificationTap = true;
    if (this.floatTapTimer) clearTimeout(this.floatTapTimer);
    this.floatTapTimer = setTimeout(() => {
      this.suppressFloatingNotificationTap = false;
      this.floatTapTimer = null;
    }, 120);
  },

  openFloatingNotifications() {
    if (this.suppressFloatingNotificationTap) return;
    wx.navigateTo({ url: "/pages/notification-list/index" });
  },

  openYearPicker() {
    const maxYear = this.data.maxYear || getLocalYear();
    const current = this.data.filterYear === ALL_YEARS_VALUE
      ? ALL_YEARS_VALUE
      : String(Math.min(Number(this.data.filterYear) || maxYear, maxYear));
    this.setData({
      yearPickerVisible: true,
      yearOptions: buildYearOptions(maxYear),
      yearPickerValue: [current],
    });
  },

  closeYearPicker() {
    this.setData({ yearPickerVisible: false });
  },

  onYearConfirm(event) {
    const raw = event.detail && event.detail.value;
    const selected = Array.isArray(raw) ? raw[0] : raw;
    const maxYear = this.data.maxYear || getLocalYear();
    this.setData({ yearPickerVisible: false });

    let nextYear = selected === ALL_YEARS_VALUE
      ? ALL_YEARS_VALUE
      : Number(selected);
    if (nextYear !== ALL_YEARS_VALUE) {
      if (!nextYear) return;
      if (nextYear > maxYear) nextYear = maxYear;
      nextYear = String(nextYear);
    }
    if (String(nextYear) === String(this.data.filterYear)) return;

    this.setData({
      filterYear: nextYear,
      filterYearText: yearChipText(nextYear),
      yearPickerValue: [String(nextYear)],
    }, () => {
      this.loadProjects(true, `正在加载${loadingYearText(nextYear)}项目...`);
    });
  },

  onKeywordInput(event) {
    const keyword = event.detail.value;
    this.setData({ keyword });
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.searchTimer = null;
      const message = keyword.trim()
        ? `正在搜索“${keyword.trim()}”...`
        : `正在加载${loadingYearText(this.data.filterYear)}项目...`;
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
    this.loadProjects(
      true,
      keyword ? `正在搜索“${keyword}”...` : `正在加载${loadingYearText(this.data.filterYear)}项目...`
    );
  },

  clearKeyword() {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    this.setData({ keyword: "" }, () => {
      this.loadProjects(true, `正在加载${loadingYearText(this.data.filterYear)}项目...`);
    });
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
    if (!this.data.yearReady) return;
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
      const yearParam = this.data.filterYear === ALL_YEARS_VALUE
        ? undefined
        : Number(this.data.filterYear);
      const result = await api.listProjects({
        page,
        pageSize: 20,
        keyword: this.data.keyword.trim(),
        status,
        ...(yearParam ? { year: yearParam } : {}),
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
