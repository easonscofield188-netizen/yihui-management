const api = require("../../utils/api");
const caseCache = require("../../utils/project-case-cache");

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

function withTimeout(promise, timeout = 7000) {
  return Promise.race([
    promise,
    new Promise((resolve, reject) => setTimeout(() => reject(new Error("图片加载超时")), timeout)),
  ]);
}

async function resolveCoverPath(item) {
  const fileId = item.coverFileId || "";
  const remoteUrl = item.coverUrl || item.imageUrl || "";
  const coverKey = fileId || remoteUrl;
  const cachedPath = caseCache.getImagePath(coverKey);
  if (cachedPath) return cachedPath;
  if (fileId) {
    try {
      const result = await withTimeout(wx.cloud.downloadFile({ fileID: fileId }));
      if (result.tempFilePath) {
        caseCache.setImagePath(coverKey, result.tempFilePath);
        return result.tempFilePath;
      }
    } catch (error) {
      try {
        const result = await withTimeout(wx.cloud.getTempFileURL({ fileList: [fileId] }));
        const tempUrl = result.fileList?.[0]?.tempFileURL || "";
        if (tempUrl) {
          caseCache.setImagePath(coverKey, tempUrl);
          return tempUrl;
        }
      } catch (fallbackError) {
        // 继续尝试数据库中保存的备用地址。
      }
    }
  }
  return remoteUrl;
}

function decorateCase(item) {
  const amount = Number(item.amount || 0);
  const coverFileId = item.coverFileId || "";
  const coverUrl = item.coverUrl || item.imageUrl || "";
  const coverKey = coverFileId || coverUrl;
  return {
    ...item,
    title: item.title || item.projectName || item.name || "未命名案例",
    categoryLabel: item.categoryLabel || "其他",
    dateText: dateText(item.caseDate),
    summary: item.summary || item.description || item.desc || "暂无案例简介",
    detailText: item.content || item.detail || item.summary || item.description || item.desc || "暂无详细内容",
    coverKey,
    coverDisplayUrl: "",
    coverLoading: Boolean(coverKey),
    showAmount: item.amountEnabled !== false && amount > 0,
    amountText: moneyText(amount),
  };
}

async function prepareLocalShareCover(item) {
  const fileId = item.coverFileId || "";
  const remoteUrl = item.coverUrl || item.imageUrl || item.coverDisplayUrl || "";
  const localDisplayUrl = item.coverDisplayUrl || caseCache.getImagePath(fileId || remoteUrl);
  if (localDisplayUrl && !/^(?:https?:|cloud:)/i.test(localDisplayUrl)) {
    return new Promise((resolve, reject) => wx.getImageInfo({
      src: localDisplayUrl,
      success: info => resolve(info.path || localDisplayUrl),
      fail: reject,
    }));
  }
  let result;
  if (fileId) {
    try {
      result = await wx.cloud.downloadFile({ fileID: fileId });
    } catch (error) {
      result = null;
    }
  }
  if (!result && remoteUrl && !remoteUrl.startsWith("cloud://")) {
    result = await new Promise((resolve, reject) => wx.downloadFile({
      url: remoteUrl,
      success: response => response.statusCode === 200 ? resolve(response) : reject(new Error("封面下载失败")),
      fail: reject,
    }));
  }
  if (!result || !result.tempFilePath) throw new Error("没有可用的案例封面");
  return new Promise((resolve, reject) => wx.getImageInfo({
    src: result.tempFilePath,
    success: info => resolve(info.path || result.tempFilePath),
    fail: reject,
  }));
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
    loading: true,
    canManage: false,
    actionVisible: false,
    actionCase: null,
    sharePreparing: false,
    shareImageUrl: "",
    deleting: false,
  },

  onShareAppMessage() {
    const item = this.data.actionCase;
    const shareData = {
      title: item ? `项目案例｜${item.title}` : "项目案例",
      path: item ? `/pages/project-case-detail/index?id=${encodeURIComponent(item._id)}&view=shared` : "/pages/project-cases/index",
    };
    if (this.data.shareImageUrl) shareData.imageUrl = this.data.shareImageUrl;
    setTimeout(() => this.setData({ actionVisible: false }), 0);
    return shareData;
  },

  onLoad() {
    if (!api.getToken()) {
      wx.reLaunch({ url: "/pages/login/index" });
      return;
    }
    this.loadCases(true);
  },

  onShow() {
    if (this.hasShown && caseCache.isListDirty()) this.loadCases(true, true);
    this.hasShown = true;
  },

  onPullDownRefresh() {
    this.loadCases(true, true).finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (!this.data.loading && this.data.hasMore) this.loadCases(false);
  },

  goBack() {
    // 案例列表是案例模块出口，固定返回“我的”，同时清理过深的非 Tab 页面栈。
    wx.switchTab({
      url: "/pages/profile/index",
      fail: () => wx.reLaunch({ url: "/pages/profile/index" }),
    });
  },

  onCategoryTap(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!this.data.categories[index] || index === this.data.categoryIndex) return;
    this.setData({ categoryIndex: index }, () => this.loadCases(true));
  },

  onCoverError(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index) || !this.data.cases[index]) return;
    caseCache.removeImagePath(this.data.cases[index].coverKey);
    this.setData({
      [`cases[${index}].coverDisplayUrl`]: "",
      [`cases[${index}].coverLoading`]: false,
    });
  },

  onCoverLoad(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index) || !this.data.cases[index]) return;
    this.setData({ [`cases[${index}].coverLoading`]: false });
  },

  openCase(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/project-case-detail/index?id=${id}` });
  },

  async openCaseActions(event) {
    const id = event.currentTarget.dataset.id;
    const actionCase = this.data.cases.find(item => item._id === id);
    if (!actionCase) return;
    const hasCover = Boolean(actionCase.coverFileId || actionCase.coverUrl || actionCase.coverDisplayUrl);
    const cachedShareImage = this.shareCoverCache && this.shareCoverCache[id];
    this.setData({
      actionVisible: true,
      actionCase,
      sharePreparing: hasCover && !cachedShareImage,
      shareImageUrl: cachedShareImage || "",
    });
    if (!hasCover || cachedShareImage) return;
    try {
      const shareImageUrl = await prepareLocalShareCover(actionCase);
      this.shareCoverCache = this.shareCoverCache || {};
      this.shareCoverCache[id] = shareImageUrl;
      if (this.data.actionCase && this.data.actionCase._id === id) this.setData({ shareImageUrl });
    } catch (error) {
      console.warn("案例列表分享封面准备失败:", error);
    } finally {
      if (this.data.actionCase && this.data.actionCase._id === id) this.setData({ sharePreparing: false });
    }
  },

  closeCaseActions(event) {
    if (event && event.detail && event.detail.visible === true) return;
    if (this.data.deleting) return;
    this.setData({ actionVisible: false });
  },

  onShareActionTap() {
    if (this.data.sharePreparing) {
      wx.showToast({ title: "封面准备中，请稍后再试", icon: "none" });
    }
  },

  deleteSelectedCase() {
    const item = this.data.actionCase;
    if (!item || this.data.deleting) return;
    wx.showModal({
      title: "删除案例",
      content: `确定删除《${item.title}》吗？案例独立上传的图片也会一并删除，且无法恢复。`,
      confirmText: "删除",
      confirmColor: "#c7363f",
      success: async result => {
        if (!result.confirm) return;
        this.setData({ deleting: true });
        wx.showLoading({ title: "正在删除", mask: true });
        try {
          await api.deleteProjectCase(item._id);
          caseCache.invalidateDetail(item._id);
          caseCache.invalidateList();
          if (this.shareCoverCache) delete this.shareCoverCache[item._id];
          this.setData({ actionVisible: false, actionCase: null });
          await this.loadCases(true, true);
          wx.showToast({ title: "案例已删除", icon: "success" });
        } catch (error) {
          wx.showToast({ title: error.message || "案例删除失败", icon: "none" });
        } finally {
          wx.hideLoading();
          this.setData({ deleting: false });
        }
      },
    });
  },

  createCase() {
    wx.navigateTo({ url: "/pages/project-case-create/index" });
  },

  async loadCases(reset, force = false) {
    if (!reset && (this.data.loading || !this.data.hasMore)) return;
    if (reset) this.shareCoverCache = {};
    const requestId = (this.requestId || 0) + 1;
    this.requestId = requestId;
    const page = reset ? 1 : this.data.page;
    const categoryCode = this.data.categories[this.data.categoryIndex]?.value || "";
    this.setData({ loading: true });
    try {
      const params = { page, pageSize: 10, categoryCode };
      const cachedUser = api.getCachedUserInfo() || {};
      const cacheParams = { ...params, cacheScope: cachedUser.role || "anonymous" };
      let result = force ? null : caseCache.getList(cacheParams);
      if (!result) {
        result = await api.listProjectCases(params);
        caseCache.setList(cacheParams, result);
      }
      if (requestId !== this.requestId) return;
      this.coverDisplayCache = this.coverDisplayCache || {};
      const incoming = (result.list || []).map(item => {
        const decorated = decorateCase(item);
        const cachedPath = this.coverDisplayCache[decorated.coverKey]
          || caseCache.getImagePath(decorated.coverKey)
          || "";
        return {
          ...decorated,
          coverDisplayUrl: cachedPath,
          coverLoading: Boolean(decorated.coverKey && !cachedPath),
        };
      });
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
      this.resolveCaseCovers(incoming);
      if (reset) caseCache.markListFresh();
    } catch (error) {
      if (requestId !== this.requestId) return;
      wx.showToast({ title: error.message || "案例加载失败", icon: "none" });
    } finally {
      if (requestId === this.requestId) this.setData({ loading: false });
    }
  },

  async resolveCaseCovers(cases) {
    const queue = cases.filter(item => item.coverKey && !item.coverDisplayUrl);
    let cursor = 0;
    const worker = async () => {
      while (cursor < queue.length) {
        const item = queue[cursor];
        cursor += 1;
        let displayUrl = "";
        try {
          displayUrl = await resolveCoverPath(item);
          if (displayUrl && !/^https?:\/\//i.test(displayUrl)) {
            this.coverDisplayCache[item.coverKey] = displayUrl;
            caseCache.setImagePath(item.coverKey, displayUrl);
          }
        } catch (error) {
          console.warn("案例封面加载失败:", error);
        }
        const index = this.data.cases.findIndex(current => (
          current._id === item._id && current.coverKey === item.coverKey
        ));
        if (index >= 0) {
          this.setData({
            [`cases[${index}].coverDisplayUrl`]: displayUrl,
            [`cases[${index}].coverLoading`]: Boolean(displayUrl),
          });
          if (displayUrl) {
            setTimeout(() => {
              const current = this.data.cases.find(caseItem => caseItem._id === item._id);
              if (current && current.coverLoading && current.coverDisplayUrl === displayUrl) {
                const currentIndex = this.data.cases.findIndex(caseItem => caseItem._id === item._id);
                if (currentIndex >= 0) {
                  this.setData({
                    [`cases[${currentIndex}].coverDisplayUrl`]: "",
                    [`cases[${currentIndex}].coverLoading`]: false,
                  });
                }
              }
            }, 8000);
          }
        }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  },
});
