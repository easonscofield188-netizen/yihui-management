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
  };
}

Page({
  data: {
    statusBarHeight: 0,
    navHeight: 88,
    invoiceEnabled: true,
    files: [],
    submitting: false,
  },

  onLoad() {
    wx.setNavigationBarColor({ frontColor: "#000000", backgroundColor: "#f9f9ff" });
    const draft = wx.getStorageSync(DRAFT_KEY) || {};
    this.setData({
      ...getNavMetrics(),
      invoiceEnabled: draft.invoiceEnabled !== false,
    });
  },

  onInvoiceChange(event) {
    this.setData({ invoiceEnabled: event.detail.value });
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
    const results = await Promise.all(
      this.data.files.map((file) => this.uploadVoucher(projectId, file))
    );
    return results.filter((item) => !item.success);
  },

  goToProjectList() {
    wx.removeStorageSync(DRAFT_KEY);
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
    wx.showLoading({ title: "正在创建项目", mask: true });
    let createdProjectId = "";
    try {
      const result = await api.createProject({
        name: draft.name.trim(),
        type: "normal",
        startDate: draft.startDate,
        period: [draft.startDate, draft.startDate],
        client: draft.client.trim(),
        clientId: draft.clientId || "",
        role: draft.role,
        clientSource: draft.source || "",
        staffCount: Number(draft.staffCount) || 1,
        amount: Number(draft.amount),
        receivedAmount: Number(draft.receivedAmount) || 0,
        desc: `${draft.name.trim()}项目`,
        costs: draft.costs,
        status: draft.status || "completed",
        isHistorical: false,
        isHasVoucher: this.data.invoiceEnabled && this.data.files.length ? "是" : "否",
      });
      createdProjectId = result.id;
      let failedVouchers = [];
      if (this.data.invoiceEnabled && this.data.files.length) {
        wx.showLoading({ title: "正在上传凭证", mask: true });
        failedVouchers = await this.uploadVouchers(createdProjectId);
      }
      wx.hideLoading();
      wx.removeStorageSync(DRAFT_KEY);
      if (failedVouchers.length) {
        await new Promise((resolve) => {
          wx.showModal({
            title: "项目已创建",
            content: `${failedVouchers.length} 个凭证上传失败，可进入项目详情重新上传。`,
            showCancel: false,
            confirmText: "知道了",
            complete: resolve,
          });
        });
        this.goToProjectList();
        return;
      }
      wx.showToast({ title: "项目创建成功", icon: "success" });
      setTimeout(() => this.goToProjectList(), 900);
    } catch (error) {
      wx.hideLoading();
      if (createdProjectId) {
        wx.removeStorageSync(DRAFT_KEY);
        wx.showModal({
          title: "项目已创建",
          content: "凭证处理未完成，可进入项目详情重新上传。",
          showCancel: false,
          confirmText: "知道了",
          complete: () => this.goToProjectList(),
        });
      } else {
        wx.showToast({ title: error.message || "创建项目失败", icon: "none" });
      }
    } finally {
      this.setData({ submitting: false });
    }
  },
});
