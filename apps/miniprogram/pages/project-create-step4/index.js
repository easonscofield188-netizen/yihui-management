const api = require("../../utils/api");

const DRAFT_KEY = "projectCreateDraft";
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const IMAGE_COMPRESS_THRESHOLD = 800 * 1024;
const IMAGE_COMPRESS_QUALITY = 82;
const IMAGE_MAX_LONG_EDGE = 2400;
const UPLOAD_TIMEOUT_MS = 45000;
const SAVE_VOUCHER_TIMEOUT_MS = 20000;
const UPLOAD_MAX_RETRY = 3;
const UPLOAD_CONCURRENCY = 2;
const UPLOAD_QUEUE_PREFIX = "projectVoucherUploadQueue:";

function withTimeout(promise, timeout, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeout);
    Promise.resolve(promise).then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function getNavMetrics() {
  const systemInfo = wx.getSystemInfoSync();
  const statusBarHeight = systemInfo.statusBarHeight || 0;
  const menuButton = wx.getMenuButtonBoundingClientRect();
  const contentHeight = menuButton && menuButton.height
    ? menuButton.height + Math.max(0, menuButton.top - statusBarHeight) * 2
    : 88;
  return { statusBarHeight, navHeight: statusBarHeight + contentHeight };
}

function fileExtension(path) {
  const match = String(path || "").match(/\.([a-zA-Z0-9]+)$/);
  return match ? match[1].toLowerCase() : "jpg";
}

function isImageFile(file) {
  return file.fileType === "image" || /\.(jpg|jpeg|png|webp)$/i.test(file.tempFilePath || file.path || "");
}

function toUploadFile(file) {
  const tempFilePath = file.tempFilePath || file.path;
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    tempFilePath,
    name: file.name || `凭证.${fileExtension(tempFilePath)}`,
    size: Number(file.size) || 0,
    isImage: isImageFile(file),
    isExisting: false,
    uploadStatus: "pending",
    uploadError: "",
    isSavedFile: Boolean(file.isSavedFile),
  };
}

function queueKey(projectId) {
  return `${UPLOAD_QUEUE_PREFIX}${projectId || "draft"}`;
}

function saveLocalFile(tempFilePath) {
  return new Promise((resolve, reject) => {
    wx.saveFile({ tempFilePath, success: resolve, fail: reject });
  });
}

function getLocalFileSize(filePath, fallbackSize = 0) {
  return new Promise((resolve) => {
    wx.getFileSystemManager().stat({
      path: filePath,
      success: ({ stats }) => resolve(Number(stats && stats.size) || Number(fallbackSize) || 0),
      fail: () => resolve(Number(fallbackSize) || 0),
    });
  });
}

function getImageInfo(src) {
  return new Promise((resolve) => {
    wx.getImageInfo({ src, success: resolve, fail: () => resolve(null) });
  });
}

function compressImage(src, resizeOptions = {}) {
  return new Promise((resolve, reject) => {
    wx.compressImage({
      src,
      quality: IMAGE_COMPRESS_QUALITY,
      ...resizeOptions,
      success: resolve,
      fail: reject,
    });
  });
}

async function prepareFile(file) {
  const sourcePath = file.tempFilePath || file.path;
  const sourceSize = await getLocalFileSize(sourcePath, file.size);
  if (!isImageFile(file) || sourceSize < IMAGE_COMPRESS_THRESHOLD) {
    return { ...file, tempFilePath: sourcePath, size: sourceSize, compressed: false };
  }

  try {
    const imageInfo = await getImageInfo(sourcePath);
    const resizeOptions = {};
    if (imageInfo && Math.max(imageInfo.width, imageInfo.height) > IMAGE_MAX_LONG_EDGE) {
      if (imageInfo.width >= imageInfo.height) resizeOptions.compressedWidth = IMAGE_MAX_LONG_EDGE;
      else resizeOptions.compressedHeight = IMAGE_MAX_LONG_EDGE;
    }
    const result = await compressImage(sourcePath, resizeOptions);
    const compressedPath = result.tempFilePath || sourcePath;
    const compressedSize = await getLocalFileSize(compressedPath, sourceSize);
    if (compressedPath !== sourcePath && compressedSize > 0 && compressedSize < sourceSize) {
      return {
        ...file,
        tempFilePath: compressedPath,
        size: compressedSize,
        originalSize: sourceSize,
        compressed: true,
      };
    }
  } catch (error) {
    // 个别图片格式或旧版客户端不支持压缩时，回退原文件，避免阻断凭证上传。
  }
  return { ...file, tempFilePath: sourcePath, size: sourceSize, compressed: false };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapWithConcurrency(list, concurrency, worker) {
  const results = new Array(list.length);
  let nextIndex = 0;

  async function run() {
    while (nextIndex < list.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await worker(list[current], current);
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, list.length) }, () => run());
  await Promise.all(runners);
  return results;
}

Page({
  data: {
    statusBarHeight: 0,
    navHeight: 88,
    pageTitle: "新建项目",
    submitText: "提交",
    isEditMode: false,
    projectId: "",
    invoiceEnabled: true,
    files: [],
    submitting: false,
    createdProjectId: "",
    uploadProgressText: "",
  },

  onLoad() {
    wx.setNavigationBarColor({ frontColor: "#000000", backgroundColor: "#f9f9ff" });
    const draft = wx.getStorageSync(DRAFT_KEY) || {};
    const isEditMode = draft._mode === "edit" && Boolean(draft._projectId);
    const createdProjectId = draft._createdProjectId || "";
    const queueProjectId = isEditMode ? draft._projectId : createdProjectId;
    const savedQueue = wx.getStorageSync(queueKey(queueProjectId)) || [];
    this.setData({
      ...getNavMetrics(),
      pageTitle: isEditMode ? "编辑项目" : "新建项目",
      submitText: isEditMode ? "保存" : "提交",
      isEditMode,
      projectId: isEditMode ? draft._projectId : (createdProjectId || ""),
      createdProjectId,
      invoiceEnabled: draft.invoiceEnabled !== false,
      files: Array.isArray(savedQueue) ? savedQueue.map((item) => ({
        ...item,
        uploadStatus: item.uploadStatus === "uploading" ? "pending" : (item.uploadStatus || "pending"),
        uploadError: item.uploadError || "",
        isExisting: false,
      })) : [],
    });
    if (queueProjectId) this.loadExistingVouchers(queueProjectId);
  },

  persistUploadQueue(projectId = this.data.createdProjectId || this.data.projectId) {
    const tasks = this.data.files
      .filter((item) => !item.isExisting)
      .map((item) => ({
        id: item.id,
        tempFilePath: item.tempFilePath,
        name: item.name,
        size: item.size,
        isImage: item.isImage,
        isSavedFile: item.isSavedFile,
        uploadStatus: item.uploadStatus === "uploading" ? "pending" : item.uploadStatus,
        uploadError: item.uploadError || "",
      }));
    const key = queueKey(projectId);
    if (tasks.length) wx.setStorageSync(key, tasks);
    else wx.removeStorageSync(key);
    if (!projectId) {
      const draft = wx.getStorageSync(DRAFT_KEY) || {};
      wx.setStorageSync(DRAFT_KEY, { ...draft, invoiceEnabled: this.data.invoiceEnabled });
    }
  },

  cleanupSavedFiles(files) {
    (files || []).filter((item) => item.isSavedFile && item.tempFilePath).forEach((item) => {
      wx.removeSavedFile({ filePath: item.tempFilePath, fail: () => {} });
    });
  },

  onInvoiceChange(event) {
    if (this.data.isEditMode && !event.detail.value) {
      wx.showToast({ title: "编辑时请在项目详情管理凭证", icon: "none" });
      this.setData({ invoiceEnabled: true });
      return;
    }
    this.setData({ invoiceEnabled: event.detail.value });
  },

  async loadExistingVouchers(projectId) {
    try {
      const vouchers = await api.getVouchers(projectId);
      const list = Array.isArray(vouchers) ? vouchers : [];
      const fileIds = list.map((item) => item.fileId).filter(Boolean);
      const urlMap = {};
      if (fileIds.length) {
        const result = await wx.cloud.getTempFileURL({ fileList: fileIds });
        (result.fileList || []).forEach((item) => {
          urlMap[item.fileID] = item.tempFileURL;
        });
      }
      const existingFiles = list.map((item) => {
        const path = urlMap[item.fileId] || item.fileUrl || "";
        const name = item.fileName || "已有凭证";
        return {
          id: item._id || item.id || item.fileId,
          voucherId: item._id || item.id || "",
          fileId: item.fileId,
          tempFilePath: path,
          name,
          size: Number(item.fileSize) || 0,
          isImage: !/\.pdf$/i.test(name) && item.mimeType !== "application/pdf",
          isExisting: true,
          uploadStatus: "success",
          uploadError: "",
          clientUploadId: item.clientUploadId || "",
        };
      });
      const existingTaskIds = new Set(existingFiles.map((item) => item.clientUploadId).filter(Boolean));
      const completedLocalTasks = this.data.files.filter((item) => !item.isExisting && existingTaskIds.has(item.id));
      this.cleanupSavedFiles(completedLocalTasks);
      const pendingFiles = this.data.files.filter((item) => !item.isExisting && !existingTaskIds.has(item.id));
      this.setData({
        files: [...existingFiles, ...pendingFiles],
        invoiceEnabled: existingFiles.length > 0 || pendingFiles.length > 0 || this.data.invoiceEnabled,
      }, () => this.persistUploadQueue(projectId));
    } catch (error) {
      wx.showToast({ title: "已有凭证加载失败", icon: "none" });
    }
  },

  chooseFile() {
    if (this.data.submitting || !this.data.invoiceEnabled) return;
    const remaining = 9 - this.data.files.length;
    if (remaining <= 0) {
      wx.showToast({ title: "最多上传 9 个附件", icon: "none" });
      return;
    }
    wx.showActionSheet({
      itemList: ["选择图片", "选择 PDF 文件"],
      success: ({ tapIndex }) => {
        if (tapIndex === 0) this.chooseImages(remaining);
        else this.choosePdf(remaining);
      },
    });
  },

  chooseImages(count) {
    wx.chooseMedia({
      count,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      // 统一在 appendFiles 中控制压缩质量，避免系统预压缩后再次损伤画质。
      sizeType: ["original"],
      success: ({ tempFiles }) => this.appendFiles(tempFiles || []),
    });
  },

  choosePdf(count) {
    wx.chooseMessageFile({
      count,
      type: "file",
      extension: ["pdf"],
      success: ({ tempFiles }) => this.appendFiles(tempFiles || []),
    });
  },

  async appendFiles(files) {
    if (!files.length) return;
    wx.showLoading({ title: "正在压缩图片", mask: true });
    const accepted = [];
    let oversizedCount = 0;
    let cacheFailedCount = 0;
    for (const file of files) {
      try {
        const prepared = await prepareFile(file);
        if (prepared.size > MAX_FILE_SIZE) {
          oversizedCount += 1;
          continue;
        }
        const saved = await saveLocalFile(prepared.tempFilePath);
        accepted.push(toUploadFile({ ...prepared, tempFilePath: saved.savedFilePath, isSavedFile: true }));
      } catch (error) {
        // 未能持久化的临时文件不进入队列，避免重启后无法重试。
        cacheFailedCount += 1;
      }
    }
    wx.hideLoading();
    if (oversizedCount) wx.showToast({ title: "已忽略压缩后仍超过 10MB 的文件", icon: "none" });
    else if (cacheFailedCount) wx.showToast({ title: "部分文件缓存失败，请重选", icon: "none" });
    if (!accepted.length) return;
    this.setData({ files: [...this.data.files, ...accepted].slice(0, 9) }, () => this.persistUploadQueue());
  },

  async removeFile(event) {
    if (this.data.submitting) {
      wx.showToast({ title: "正在提交，请稍候", icon: "none" });
      return;
    }
    const id = event.currentTarget.dataset.id;
    const target = this.data.files.find((item) => item.id === id);
    if (!target) return;
    if (this.data.isEditMode && target.isExisting) {
      wx.showToast({ title: "已有凭证请在项目详情中管理", icon: "none" });
      return;
    }

    if (target.isExisting) {
      const voucherId = target.voucherId || target.id;
      if (!voucherId || !target.fileId) {
        wx.showToast({ title: "凭证信息不完整，请重试", icon: "none" });
        return;
      }
      wx.showLoading({ title: "正在删除", mask: true });
      try {
        await api.deleteVoucher({ id: voucherId, fileId: target.fileId });
      } catch (error) {
        wx.hideLoading();
        wx.showToast({ title: error.message || "删除失败", icon: "none" });
        return;
      }
      wx.hideLoading();
    }

    if (target.isSavedFile) this.cleanupSavedFiles([target]);
    const files = this.data.files.filter((item) => item.id !== id);
    this.setData({ files }, async () => {
      this.persistUploadQueue();
      if (target.isExisting && (this.data.createdProjectId || this.data.projectId)) {
        const hasVoucher = files.some((item) => item.isExisting || item.uploadStatus === "success");
        await this.syncVoucherFlag(this.data.createdProjectId || this.data.projectId, hasVoucher);
      }
    });
  },

  previewFile(event) {
    const current = event.currentTarget.dataset.path;
    const images = this.data.files.filter((item) => item.isImage).map((item) => item.tempFilePath);
    if (images.includes(current)) wx.previewImage({ current, urls: images });
  },

  previous() {
    wx.navigateBack();
  },

  close() {
    if (this.data.isEditMode) wx.navigateBack();
    else wx.switchTab({ url: "/pages/index/index" });
  },

  async uploadVoucherOnce(projectId, file) {
    const extension = fileExtension(file.tempFilePath);
    const safeTaskId = String(file.id).replace(/[^a-zA-Z0-9_-]/g, "");
    const cloudPath = `bill_voucher/mobile/${projectId}/${safeTaskId}.${extension}`;
    try {
      const uploadResult = await withTimeout(
        wx.cloud.uploadFile({ cloudPath, filePath: file.tempFilePath }),
        UPLOAD_TIMEOUT_MS,
        `${file.name} 上传超时`
      );
      const fileId = uploadResult.fileID;
      const urlResult = await withTimeout(
        wx.cloud.getTempFileURL({ fileList: [fileId] }),
        SAVE_VOUCHER_TIMEOUT_MS,
        `${file.name} 获取地址超时`
      );
      const fileUrl = urlResult.fileList[0] && urlResult.fileList[0].tempFileURL;
      if (!fileUrl) throw new Error(`${file.name} 获取访问地址失败`);
      const voucher = await withTimeout(
        api.addVoucher({
          projectId,
          fileName: file.name,
          fileId,
          fileUrl,
          fileSize: file.size,
          mimeType: file.isImage ? `image/${extension === "jpg" ? "jpeg" : extension}` : "application/pdf",
          clientUploadId: file.id,
        }),
        SAVE_VOUCHER_TIMEOUT_MS,
        `${file.name} 保存记录超时`
      );
      return { success: true, fileId, voucherId: voucher && voucher.id };
    } catch (error) {
      // 超时不代表底层请求已取消。保留固定路径文件，后续重试会覆盖同一路径，
      // 服务端也会按 clientUploadId 幂等写入，避免误删已成功关联的凭证。
      throw error;
    }
  },

  async uploadVoucher(projectId, file) {
    let lastError = null;
    for (let attempt = 1; attempt <= UPLOAD_MAX_RETRY; attempt += 1) {
      try {
        const result = await this.uploadVoucherOnce(projectId, file);
        return { success: true, file, fileId: result.fileId, voucherId: result.voucherId };
      } catch (error) {
        lastError = error;
        if (attempt < UPLOAD_MAX_RETRY) {
          await sleep(600 * attempt);
        }
      }
    }
    return {
      success: false,
      file,
      error: lastError || new Error(`${file.name} 上传失败`),
    };
  },

  markFileUploadState(fileId, patch) {
    // 同步写回 this.data，避免并发 setData 互相覆盖
    const files = this.data.files.map((item) => (
      item.id === fileId ? { ...item, ...patch } : item
    ));
    this.data.files = files;
    this.setData({ files });
    this.persistUploadQueue();
  },

  refreshSubmitText() {
    const hasFailed = this.data.files.some((file) => file.uploadStatus === "failed");
    const submitText = hasFailed
      ? "重试上传"
      : (this.data.isEditMode ? "保存" : "提交");
    this.setData({ submitText });
  },

  async uploadVouchers(projectId, onlyFailed = false) {
    const pendingFiles = this.data.files.filter((file) => {
      if (file.isExisting) return false;
      if (onlyFailed) return file.uploadStatus === "failed";
      return file.uploadStatus !== "success";
    });
    if (!pendingFiles.length) return [];

    let finished = 0;
    const total = pendingFiles.length;
    this.setData({ uploadProgressText: `正在上传凭证 0/${total}` });

    const results = await mapWithConcurrency(pendingFiles, UPLOAD_CONCURRENCY, async (file) => {
      this.markFileUploadState(file.id, { uploadStatus: "uploading", uploadError: "" });
      const result = await this.uploadVoucher(projectId, file);
      finished += 1;
      this.setData({ uploadProgressText: `正在上传凭证 ${finished}/${total}` });
      if (result.success) {
        this.markFileUploadState(file.id, {
          uploadStatus: "success",
          uploadError: "",
          isExisting: true,
          fileId: result.fileId,
          voucherId: result.voucherId,
        });
      } else {
        this.markFileUploadState(file.id, {
          uploadStatus: "failed",
          uploadError: (result.error && result.error.message) || "上传失败",
        });
      }
      return result;
    });

    this.setData({ uploadProgressText: "" });
    this.refreshSubmitText();
    return results.filter((item) => !item.success);
  },

  async syncVoucherFlag(projectId, hasVoucher) {
    for (let attempt = 1; attempt <= UPLOAD_MAX_RETRY; attempt += 1) {
      try {
        await api.updateProject({ id: projectId, isHasVoucher: hasVoucher ? "是" : "否" });
        return true;
      } catch (error) {
        if (attempt < UPLOAD_MAX_RETRY) await sleep(500 * attempt);
      }
    }
    return false;
  },

  countUploadedVouchers() {
    return this.data.files.filter((file) => file.isExisting || file.uploadStatus === "success").length;
  },

  goToResultPage(projectId, isEditMode) {
    this.cleanupSavedFiles(this.data.files);
    wx.removeStorageSync(queueKey(projectId));
    wx.removeStorageSync(DRAFT_KEY);
    if (isEditMode) {
      const pages = getCurrentPages();
      const detailIndex = pages.findIndex((page) => page.route === "pages/project-detail/index");
      const delta = detailIndex >= 0 ? pages.length - 1 - detailIndex : 0;
      if (delta > 0) {
        wx.navigateBack({ delta });
        return;
      }
      wx.reLaunch({ url: `/pages/project-detail/index?id=${projectId}` });
      return;
    }
    wx.reLaunch({ url: "/pages/index/index" });
  },

  async retryFailedUploads() {
    if (this.data.submitting) return;
    const projectId = this.data.createdProjectId || this.data.projectId;
    if (!projectId) {
      wx.showToast({ title: "请先提交项目", icon: "none" });
      return;
    }
    const failedCount = this.data.files.filter((file) => file.uploadStatus === "failed").length;
    if (!failedCount) {
      wx.showToast({ title: "没有待重试的凭证", icon: "none" });
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: "正在重试上传", mask: true });
    try {
      const failedVouchers = await this.uploadVouchers(projectId, true);
      const uploadedCount = this.countUploadedVouchers();
      await this.syncVoucherFlag(projectId, uploadedCount > 0);
      wx.hideLoading();

      if (failedVouchers.length) {
        wx.showModal({
          title: "仍有凭证上传失败",
          content: `还有 ${failedVouchers.length} 个凭证失败，请继续重试。上传队列已保存，重新进入本页也可恢复。`,
          confirmText: "继续重试",
          showCancel: false,
          success: ({ confirm }) => {
            if (confirm) this.retryFailedUploads();
          },
        });
        return;
      }

      wx.showToast({ title: "凭证上传完成", icon: "success" });
      setTimeout(() => this.goToResultPage(projectId, this.data.isEditMode), 800);
    } catch (error) {
      wx.hideLoading();
      wx.showToast({ title: error.message || "重试失败", icon: "none" });
    } finally {
      this.setData({ submitting: false });
    }
  },

  async submit() {
    if (this.data.submitting) return;
    const draft = wx.getStorageSync(DRAFT_KEY) || {};
    if (!draft.name || !draft.client || !draft.role || !draft.startDate || !draft.amount || !Array.isArray(draft.costs)) {
      wx.showToast({ title: "请先完成前 3 步信息", icon: "none" });
      return;
    }

    // 新建且开启凭证时，必须先选文件，避免创建出无凭证项目
    if (!this.data.isEditMode && this.data.invoiceEnabled && !this.data.files.length) {
      wx.showToast({ title: "请先选择凭证图片，或关闭“是否有发票”", icon: "none" });
      return;
    }

    // 项目已创建但凭证失败时，改为继续补传
    if (this.data.createdProjectId && this.data.files.some((file) => file.uploadStatus === "failed")) {
      await this.retryFailedUploads();
      return;
    }

    this.setData({ submitting: true });
    const isEditMode = draft._mode === "edit" && Boolean(draft._projectId);
    const isClosedEdit = isEditMode && draft._originalStatus === "closed";
    const deliveryDate = String(draft.startDate).slice(0, 10);
    const needUpload = this.data.invoiceEnabled && this.data.files.some((file) => !file.isExisting && file.uploadStatus !== "success");
    wx.showLoading({ title: isEditMode ? "正在保存修改" : "正在创建项目", mask: true });
    let projectId = this.data.createdProjectId || (isEditMode ? draft._projectId : "");
    let projectSaved = Boolean(projectId);
    try {
      const commonData = {
        name: draft.name.trim(),
        receivedAmount: Number(draft.receivedAmount) || 0,
        desc: isEditMode ? (String(draft.desc || "").trim() || "无") : "无",
        costs: draft.costs,
        status: draft.status || "completed",
        // 创建时先标记为无凭证，至少一张凭证真正落库后再同步为“是”。
        isHasVoucher: this.countUploadedVouchers() > 0 ? "是" : "否",
      };

      if (!projectId) {
        if (isEditMode) {
          const editableData = isClosedEdit ? {} : {
            scene: draft.scene || "",
            client: draft.client.trim(),
            clientId: draft.clientId || "",
            role: draft.role,
            clientSource: draft.source || "",
            staffCount: Number(draft.staffCount) || 1,
            amount: Number(draft.amount),
          };
          await api.updateProject({
            id: draft._projectId,
            ...commonData,
            ...editableData,
          });
          projectId = draft._projectId;
        } else {
          const result = await api.createProject({
            ...commonData,
            type: "normal",
            startDate: deliveryDate,
            period: [deliveryDate, deliveryDate],
            scene: draft.scene || "",
            client: draft.client.trim(),
            clientId: draft.clientId || "",
            role: draft.role,
            clientSource: draft.source || "",
            staffCount: Number(draft.staffCount) || 1,
            amount: Number(draft.amount),
            isHistorical: false,
          });
          projectId = result.id;
        }
        projectSaved = true;
        this.setData({ createdProjectId: projectId });
        const draftQueue = wx.getStorageSync(queueKey("")) || [];
        if (draftQueue.length) {
          wx.setStorageSync(queueKey(projectId), draftQueue);
          wx.removeStorageSync(queueKey(""));
        }
        this.persistUploadQueue(projectId);
      }

      let failedVouchers = [];
      if (needUpload) {
        wx.showLoading({ title: "正在上传凭证", mask: true });
        failedVouchers = await this.uploadVouchers(projectId, false);
      }

      const uploadedCount = this.countUploadedVouchers();
      await this.syncVoucherFlag(projectId, uploadedCount > 0);
      wx.hideLoading();

      if (failedVouchers.length) {
        // 保留草稿与页面状态，方便直接重试失败凭证，避免项目无图
        wx.setStorageSync(DRAFT_KEY, {
          ...draft,
          _createdProjectId: projectId,
          invoiceEnabled: this.data.invoiceEnabled,
        });
        await new Promise((resolve) => {
          wx.showModal({
            title: isEditMode ? "修改已保存" : "项目已创建",
            content: `${failedVouchers.length} 个凭证上传失败，请立即重试。上传队列已安全保存。`,
            confirmText: "立即重试",
            showCancel: false,
            success: ({ confirm }) => {
              if (confirm) {
                // submit 尚未退出，此处需先释放锁，否则 retryFailedUploads 会直接返回。
                this.setData({ submitting: false }, () => {
                  this.retryFailedUploads().finally(resolve);
                });
              }
            },
            fail: resolve,
          });
        });
        return;
      }

      wx.removeStorageSync(DRAFT_KEY);
      wx.showToast({ title: isEditMode ? "修改保存成功" : "项目创建成功", icon: "success" });
      setTimeout(() => this.goToResultPage(projectId, isEditMode), 900);
    } catch (error) {
      wx.hideLoading();
      if (projectSaved && projectId) {
        this.setData({ createdProjectId: projectId });
        wx.setStorageSync(DRAFT_KEY, {
          ...draft,
          _createdProjectId: projectId,
          invoiceEnabled: this.data.invoiceEnabled,
        });
        wx.showModal({
          title: isEditMode ? "修改已保存" : "项目已创建",
          content: "凭证处理未完成，可点击提交继续补传凭证。",
          showCancel: false,
          confirmText: "知道了",
        });
      } else {
        wx.showToast({
          title: error.message || (isEditMode ? "保存修改失败" : "创建项目失败"),
          icon: "none",
        });
      }
    } finally {
      this.setData({ submitting: false });
    }
  },
});
