const api = require("../../utils/api");

const DRAFT_KEY = "projectCreateDraft";
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const UPLOAD_TIMEOUT_MS = 45000;
const SAVE_VOUCHER_TIMEOUT_MS = 20000;

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
  };
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
  },

  onLoad() {
    wx.setNavigationBarColor({ frontColor: "#000000", backgroundColor: "#f9f9ff" });
    const draft = wx.getStorageSync(DRAFT_KEY) || {};
    const isEditMode = draft._mode === "edit" && Boolean(draft._projectId);
    this.setData({
      ...getNavMetrics(),
      pageTitle: isEditMode ? "编辑项目" : "新建项目",
      submitText: isEditMode ? "保存" : "提交",
      isEditMode,
      projectId: isEditMode ? draft._projectId : "",
      invoiceEnabled: draft.invoiceEnabled !== false,
    });
    if (isEditMode) this.loadExistingVouchers(draft._projectId);
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
      const files = list.map((item) => {
        const path = urlMap[item.fileId] || item.fileUrl || "";
        const name = item.fileName || "已有凭证";
        return {
          id: item._id || item.id || item.fileId,
          fileId: item.fileId,
          tempFilePath: path,
          name,
          size: Number(item.fileSize) || 0,
          isImage: !/\.pdf$/i.test(name) && item.mimeType !== "application/pdf",
          isExisting: true,
        };
      });
      this.setData({
        files,
        invoiceEnabled: files.length > 0 || this.data.invoiceEnabled,
      });
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
      sizeType: ["compressed"],
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

  appendFiles(files) {
    const accepted = files.filter((file) => Number(file.size || 0) <= MAX_FILE_SIZE).map(toUploadFile);
    if (accepted.length < files.length) wx.showToast({ title: "已忽略超过 10MB 的文件", icon: "none" });
    if (!accepted.length) return;
    this.setData({ files: [...this.data.files, ...accepted].slice(0, 9) });
  },

  removeFile(event) {
    const id = event.currentTarget.dataset.id;
    const target = this.data.files.find((item) => item.id === id);
    if (target && target.isExisting) {
      wx.showToast({ title: "已有凭证请在项目详情中管理", icon: "none" });
      return;
    }
    this.setData({ files: this.data.files.filter((item) => item.id !== id) });
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
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack();
    else wx.switchTab({ url: "/pages/index/index" });
  },

  async uploadVoucher(projectId, file) {
    const extension = fileExtension(file.tempFilePath);
    const cloudPath = `bill_voucher/mobile/${projectId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
    let fileId = "";
    try {
      const uploadResult = await withTimeout(
        wx.cloud.uploadFile({ cloudPath, filePath: file.tempFilePath }),
        UPLOAD_TIMEOUT_MS,
        `${file.name} 上传超时`
      );
      fileId = uploadResult.fileID;
      const urlResult = await withTimeout(
        wx.cloud.getTempFileURL({ fileList: [fileId] }),
        SAVE_VOUCHER_TIMEOUT_MS,
        `${file.name} 获取地址超时`
      );
      const fileUrl = urlResult.fileList[0] && urlResult.fileList[0].tempFileURL;
      await withTimeout(
        api.addVoucher({
          projectId,
          fileName: file.name,
          fileId,
          fileUrl,
          fileSize: file.size,
          mimeType: file.isImage ? `image/${extension === "jpg" ? "jpeg" : extension}` : "application/pdf",
        }),
        SAVE_VOUCHER_TIMEOUT_MS,
        `${file.name} 保存记录超时`
      );
      return { success: true, file };
    } catch (error) {
      if (fileId) {
        wx.cloud.deleteFile({ fileList: [fileId] }).catch(() => {});
      }
      return { success: false, file, error };
    }
  },

  async uploadVouchers(projectId) {
    const pendingFiles = this.data.files.filter((file) => !file.isExisting);
    const results = await Promise.all(
      pendingFiles.map((file) => this.uploadVoucher(projectId, file))
    );
    return results.filter((item) => !item.success);
  },

  goToResultPage(projectId, isEditMode) {
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

  async submit() {
    if (this.data.submitting) return;
    const draft = wx.getStorageSync(DRAFT_KEY) || {};
    if (!draft.name || !draft.client || !draft.role || !draft.startDate || !draft.amount || !Array.isArray(draft.costs)) {
      wx.showToast({ title: "请先完成前 3 步信息", icon: "none" });
      return;
    }
    this.setData({ submitting: true });
    const isEditMode = draft._mode === "edit" && Boolean(draft._projectId);
    const isClosedEdit = isEditMode && draft._originalStatus === "closed";
    const hasVoucher = isEditMode
      ? (this.data.files.length > 0 || draft.invoiceEnabled === true)
      : (this.data.invoiceEnabled && this.data.files.length > 0);
    wx.showLoading({ title: isEditMode ? "正在保存修改" : "正在创建项目", mask: true });
    let projectId = isEditMode ? draft._projectId : "";
    let projectSaved = false;
    try {
      const commonData = {
        name: draft.name.trim(),
        receivedAmount: Number(draft.receivedAmount) || 0,
        desc: String(draft.desc || "").trim() || `${draft.name.trim()}项目`,
        costs: draft.costs,
        status: draft.status || "completed",
        isHasVoucher: hasVoucher ? "是" : "否",
      };

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
          id: projectId,
          ...commonData,
          ...editableData,
        });
      } else {
        const result = await api.createProject({
          ...commonData,
          type: "normal",
          startDate: draft.startDate,
          period: [draft.startDate, draft.startDate],
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

      let failedVouchers = [];
      if (this.data.invoiceEnabled && this.data.files.some((file) => !file.isExisting)) {
        wx.showLoading({ title: "正在上传凭证", mask: true });
        failedVouchers = await this.uploadVouchers(projectId);
      }
      wx.hideLoading();
      wx.removeStorageSync(DRAFT_KEY);
      if (failedVouchers.length) {
        await new Promise((resolve) => {
          wx.showModal({
            title: isEditMode ? "修改已保存" : "项目已创建",
            content: `${failedVouchers.length} 个凭证上传失败，可进入项目详情重新上传。`,
            showCancel: false,
            confirmText: "知道了",
            complete: resolve,
          });
        });
        this.goToResultPage(projectId, isEditMode);
        return;
      }
      wx.showToast({ title: isEditMode ? "修改保存成功" : "项目创建成功", icon: "success" });
      setTimeout(() => this.goToResultPage(projectId, isEditMode), 900);
    } catch (error) {
      wx.hideLoading();
      if (projectSaved) {
        wx.removeStorageSync(DRAFT_KEY);
        wx.showModal({
          title: isEditMode ? "修改已保存" : "项目已创建",
          content: "凭证处理未完成，可进入项目详情重新上传。",
          showCancel: false,
          confirmText: "知道了",
          complete: () => this.goToResultPage(projectId, isEditMode),
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
