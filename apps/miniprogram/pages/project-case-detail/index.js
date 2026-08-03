const api = require("../../utils/api");
const caseCache = require("../../utils/project-case-cache");
const CASE_MANAGE_ROLES = new Set(["ADMIN_SUPER", "ADMIN_COM", "ADMIN"]);

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

function withTimeout(promise, timeout = 5000) {
  return Promise.race([
    promise,
    new Promise((resolve, reject) => setTimeout(() => reject(new Error("图片请求超时")), timeout)),
  ]);
}

function findCoverIndex(images, coverFileId, coverUrl) {
  const matchedIndex = images.findIndex(image => (
    (coverFileId && image.fileId === coverFileId)
    || (coverUrl && image.url === coverUrl)
  ));
  return matchedIndex >= 0 ? matchedIndex : 0;
}

async function resolveImageUrls(images) {
  const fileIds = images.map(item => item.fileId).filter(Boolean);
  const localUrlMap = {};
  fileIds.forEach(fileId => {
    const cachedPath = caseCache.getImagePath(fileId);
    if (cachedPath) localUrlMap[fileId] = cachedPath;
  });
  if (fileIds.length) {
    await Promise.all(fileIds.filter(fileId => !localUrlMap[fileId]).map(async fileId => {
      try {
        const result = await withTimeout(wx.cloud.downloadFile({ fileID: fileId }), 5000);
        if (result.tempFilePath) {
          localUrlMap[fileId] = result.tempFilePath;
          caseCache.setImagePath(fileId, result.tempFilePath);
        }
      } catch (error) {
        // 统一在下一步通过临时链接兜底。
      }
    }));
  }

  const unresolvedFileIds = fileIds.filter(fileId => !localUrlMap[fileId]);
  const tempUrlMap = {};
  if (unresolvedFileIds.length) {
    try {
      const result = await withTimeout(wx.cloud.getTempFileURL({ fileList: unresolvedFileIds }), 4000);
      (result.fileList || []).forEach(item => {
        if (item.fileID && item.tempFileURL) {
          tempUrlMap[item.fileID] = item.tempFileURL;
          caseCache.setImagePath(item.fileID, item.tempFileURL);
        }
      });
    } catch (error) {
      console.warn("案例图片临时地址获取失败:", error);
    }
  }

  return images
    .map(item => ({
      ...item,
      displayUrl: localUrlMap[item.fileId] || tempUrlMap[item.fileId] || item.url || displayImage(item),
      localDisplay: Boolean(localUrlMap[item.fileId]),
    }))
    .filter(item => item.displayUrl);
}

async function downloadShareImage(image) {
  const fileId = image && image.fileId;
  const remoteUrl = image && (image.url || image.displayUrl);
  const localDisplayUrl = image && image.displayUrl;
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
    settingCoverIndex: -1,
    isSharedView: false,
  },

  onLoad(options) {
    const id = String(options.id || "").trim();
    const isSharedView = options.view === "shared";
    if (!id) {
      wx.showToast({ title: "缺少案例 ID", icon: "none" });
      return;
    }
    this.setData({ id, isSharedView });
    this.loadDetail(id);
  },

  onShareAppMessage() {
    const item = this.data.caseInfo || {};
    const shareData = {
      title: item.title ? `项目案例｜${item.title}` : "项目案例",
      path: `/pages/project-case-detail/index?id=${encodeURIComponent(this.data.id)}&view=shared`,
    };
    if (this.data.shareImageUrl) shareData.imageUrl = this.data.shareImageUrl;
    return shareData;
  },

  onShareTap() {
    if (this.data.sharePreparing) {
      wx.showToast({ title: "封面准备中，请稍后再试", icon: "none" });
    }
  },

  showUnavailableSharedCase() {
    wx.showModal({
      title: "案例已失效",
      content: "该案例已失效，请联系重新发送。",
      showCancel: false,
      confirmText: "确认",
      confirmColor: "#173d6b",
      success: result => {
        if (!result.confirm) return;
        this.closeSharedPage();
      },
    });
  },

  closeSharedPage() {
    wx.exitMiniProgram({
      fail: () => {
        const pages = getCurrentPages();
        if (pages.length > 1) {
          wx.navigateBack({ delta: 1 });
          return;
        }
        wx.redirectTo({
          url: "/pages/project-cases/index",
          fail: () => wx.reLaunch({ url: "/pages/project-cases/index" }),
        });
      },
    });
  },

  goBack() {
    if (this.data.isSharedView) {
      this.closeSharedPage();
      return;
    }
    const pages = getCurrentPages();
    const previous = pages[pages.length - 2];
    if (previous && previous.route === "pages/project-cases/index") {
      wx.navigateBack({ delta: 1 });
      return;
    }
    // 分享卡片或其他入口直接打开详情时，用替换方式补回案例列表，避免不断叠加页面。
    wx.redirectTo({
      url: "/pages/project-cases/index",
      fail: () => wx.reLaunch({ url: "/pages/project-cases/index" }),
    });
  },

  previewImage(event) {
    const current = event.currentTarget.dataset.url;
    const urls = this.data.images.map(item => item.displayUrl).filter(Boolean);
    if (current && urls.length) wx.previewImage({ current, urls });
  },

  onGalleryImageLoad(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index) || !this.data.images[index]) return;
    this.setData({ [`images[${index}].imageLoading`]: false });
  },

  onGalleryImageError(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index) || !this.data.images[index]) return;
    caseCache.removeImagePath(this.data.images[index].fileId);
    this.setData({
      [`images[${index}].imageLoading`]: false,
      [`images[${index}].imageLoadFailed`]: true,
    });
  },

  setCover(event) {
    const index = Number(event.currentTarget.dataset.index);
    const image = this.data.images[index];
    if (!image || image.isCover || this.data.settingCoverIndex >= 0) return;
    wx.showModal({
      title: "设置案例封面",
      content: "设置后，案例列表和微信分享将使用这张图片作为封面。",
      confirmText: "设为封面",
      confirmColor: "#173d6b",
      success: async result => {
        if (!result.confirm) return;
        this.setData({ settingCoverIndex: index });
        try {
          const cover = await api.setProjectCaseCover(this.data.id, image);
          const selectedImage = { ...image, isCover: true };
          const images = [selectedImage].concat(
            this.data.images
              .filter((item, itemIndex) => itemIndex !== index)
              .map(item => ({ ...item, isCover: false }))
          );
          this.setData({
            images,
            "caseInfo.coverFileId": cover.coverFileId || image.fileId || "",
            "caseInfo.coverUrl": cover.coverUrl || image.url || "",
            sharePreparing: true,
            shareImageUrl: "",
          });
          caseCache.setDetail(this.data.id, {
            ...this.data.caseInfo,
            images: images.map(item => ({
              fileId: item.fileId || "",
              url: item.url || "",
              name: item.name || "",
              sourceCode: item.sourceCode || "",
            })),
            coverFileId: cover.coverFileId || image.fileId || "",
            coverUrl: cover.coverUrl || image.url || "",
          });
          caseCache.invalidateList();
          try {
            const shareImageUrl = await downloadShareImage(images[0]);
            this.setData({ shareImageUrl });
          } catch (error) {
            console.warn("新封面分享图片准备失败:", error);
          }
          wx.showToast({ title: "封面设置成功", icon: "success" });
        } catch (error) {
          wx.showToast({ title: error.message || "封面设置失败", icon: "none" });
        } finally {
          this.setData({ settingCoverIndex: -1, sharePreparing: false });
        }
      },
    });
  },

  async loadDetail(id) {
    this.setData({ loading: true, sharePreparing: true, shareImageUrl: "" });
    try {
      let result = this.data.isSharedView ? null : caseCache.getDetail(id);
      if (!result) {
        result = await api.getProjectCase(id);
        caseCache.setDetail(id, result);
      }
      const resolvedImages = await resolveImageUrls(result.images || []);
      const coverIndex = findCoverIndex(resolvedImages, result.coverFileId, result.coverUrl);
      const markedImages = resolvedImages.map((item, index) => ({
        ...item,
        isCover: index === coverIndex,
        imageLoading: !item.localDisplay,
        imageLoadFailed: false,
      }));
      const images = coverIndex > 0
        ? [markedImages[coverIndex]].concat(markedImages.filter((item, index) => index !== coverIndex))
        : markedImages;
      const cachedUser = api.getCachedUserInfo() || {};
      const caseInfo = {
        ...result,
        canManage: CASE_MANAGE_ROLES.has(cachedUser.role),
        amountText: money(result.amount),
        dateText: result.caseDate || "日期未设置",
      };
      this.setData({ caseInfo, images, loading: false });
      images.forEach((image, index) => {
        setTimeout(() => {
          const current = this.data.images[index];
          if (current && current.displayUrl === image.displayUrl && current.imageLoading) {
            this.setData({
              [`images[${index}].imageLoading`]: false,
              [`images[${index}].imageLoadFailed`]: true,
            });
          }
        }, 8000);
      });
      const coverImage = images.find(item => item.isCover) || images[0];
      if (coverImage) {
        try {
          const shareImageUrl = await downloadShareImage(coverImage);
          this.setData({ shareImageUrl });
        } catch (error) {
          console.warn("案例分享封面准备失败:", error);
        }
      }
    } catch (error) {
      this.setData({ loading: false });
      if (this.data.isSharedView && Number(error.code) === 404) {
        caseCache.invalidateDetail(id);
        this.showUnavailableSharedCase();
        return;
      }
      wx.showToast({ title: error.message || "案例加载失败", icon: "none" });
    } finally {
      this.setData({ sharePreparing: false });
    }
  },
});
