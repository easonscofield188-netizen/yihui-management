const api = require("../../utils/api");

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
  const amount = Number(value || 0);
  return amount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function displayImage(image) {
  return image.fileId || image.url || "";
}

async function resolveImageUrls(images) {
  const fileIds = images.map(item => item.fileId).filter(Boolean);
  if (!fileIds.length) {
    return images.map(item => ({ ...item, displayUrl: displayImage(item) })).filter(item => item.displayUrl);
  }
  try {
    const result = await wx.cloud.getTempFileURL({ fileList: fileIds });
    const urlMap = {};
    (result.fileList || []).forEach(item => {
      if (item.fileID && item.tempFileURL) urlMap[item.fileID] = item.tempFileURL;
    });
    return images
      .map(item => ({ ...item, displayUrl: urlMap[item.fileId] || displayImage(item) }))
      .filter(item => item.displayUrl);
  } catch (error) {
    return images.map(item => ({ ...item, displayUrl: displayImage(item) })).filter(item => item.displayUrl);
  }
}

async function downloadShareImage(image) {
  const fileId = image && image.fileId;
  const remoteUrl = image && (image.url || image.displayUrl);
  let result;
  if (fileId) {
    try {
      result = await wx.cloud.downloadFile({ fileID: fileId });
    } catch (error) {
      result = null;
    }
  }
  if (!result && remoteUrl) {
    result = await new Promise((resolve, reject) => wx.downloadFile({
      url: remoteUrl,
      success: response => response.statusCode === 200 ? resolve(response) : reject(new Error("封面下载失败")),
      fail: reject,
    }));
  }
  if (!result) throw new Error("案例没有可用封面");
  return new Promise((resolve, reject) => {
    const localPath = result.tempFilePath;
    if (!localPath) {
      reject(new Error("封面本地路径无效"));
      return;
    }
    wx.getImageInfo({
      src: localPath,
      success: info => resolve(info.path || localPath),
      fail: reject,
    });
  });
}

Page({
  data: {
    ...getNavMetrics(),
    id: "",
    loading: true,
    caseInfo: null,
    images: [],
    sharePreparing: true,
    shareImageUrl: "",
  },

  onLoad(options) {
    const id = String(options.id || "").trim();
    if (!id) {
      wx.showToast({ title: "缺少案例 ID", icon: "none" });
      return;
    }
    this.setData({ id });
    this.loadDetail(id);
  },

  onShareAppMessage() {
    const item = this.data.caseInfo || {};
    const shareData = {
      title: item.title ? `项目案例｜${item.title}` : "项目案例",
      path: `/pages/project-case-detail/index?id=${this.data.id}`,
    };
    if (this.data.shareImageUrl) shareData.imageUrl = this.data.shareImageUrl;
    return shareData;
  },

  onShareTap() {
    if (this.data.sharePreparing) {
      wx.showToast({ title: "封面准备中，请稍后再试", icon: "none" });
    }
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack();
    else wx.navigateTo({ url: "/pages/project-cases/index" });
  },

  previewImage(event) {
    const current = event.currentTarget.dataset.url;
    const urls = this.data.images.map(item => item.displayUrl).filter(Boolean);
    if (current && urls.length) wx.previewImage({ current, urls });
  },

  async saveCover() {
    const cover = this.data.images[0]?.displayUrl;
    if (!cover) {
      wx.showToast({ title: "暂无可保存的图片", icon: "none" });
      return;
    }
    wx.showLoading({ title: "正在保存", mask: true });
    try {
      const filePath = cover.startsWith("cloud://")
        ? (await wx.cloud.downloadFile({ fileID: cover })).tempFilePath
        : (await new Promise((resolve, reject) => wx.downloadFile({ url: cover, success: resolve, fail: reject }))).tempFilePath;
      await new Promise((resolve, reject) => wx.saveImageToPhotosAlbum({ filePath, success: resolve, fail: reject }));
      wx.showToast({ title: "图片已保存", icon: "success" });
    } catch (error) {
      if (String(error.errMsg || error.message || "").includes("auth deny")) {
        wx.showModal({
          title: "需要相册权限",
          content: "请在设置中允许保存图片到相册。",
          confirmText: "去设置",
          success: result => result.confirm && wx.openSetting(),
        });
      } else {
        wx.showToast({ title: "图片保存失败", icon: "none" });
      }
    } finally {
      wx.hideLoading();
    }
  },

  async loadDetail(id) {
    this.setData({ loading: true, sharePreparing: true, shareImageUrl: "" });
    try {
      const result = await api.getProjectCase(id);
      const images = await resolveImageUrls(result.images || []);
      const caseInfo = {
        ...result,
        amountText: money(result.amount),
        dateText: result.caseDate || "日期未设置",
      };
      this.setData({ caseInfo, images, loading: false });
      if (images.length) {
        try {
          const shareImageUrl = await downloadShareImage(images[0]);
          this.setData({ shareImageUrl });
        } catch (error) {
          console.warn("案例分享封面准备失败:", error);
        }
      }
    } catch (error) {
      wx.showToast({ title: error.message || "案例加载失败", icon: "none" });
      this.setData({ loading: false });
    } finally {
      this.setData({ sharePreparing: false });
    }
  },
});
