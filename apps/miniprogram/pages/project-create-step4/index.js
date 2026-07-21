const api = require("../../utils/api");

const DRAFT_KEY = "projectCreateDraft";
const MAX_FILE_SIZE = 10 * 1024 * 1024;

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

  async uploadVouchers(projectId) {
    for (const file of this.data.files) {
      const extension = fileExtension(file.tempFilePath);
      const cloudPath = `bill_voucher/mobile/${projectId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
      const uploadResult = await wx.cloud.uploadFile({ cloudPath, filePath: file.tempFilePath });
      const urlResult = await wx.cloud.getTempFileURL({ fileList: [uploadResult.fileID] });
      const fileUrl = urlResult.fileList[0] && urlResult.fileList[0].tempFileURL;
      await api.addVoucher({
        projectId,
        fileName: file.name,
        fileId: uploadResult.fileID,
        fileUrl,
        fileSize: file.size,
        mimeType: file.isImage ? `image/${extension === "jpg" ? "jpeg" : extension}` : "application/pdf",
      });
    }
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
      const projectId = result.id;
      if (this.data.invoiceEnabled && this.data.files.length) {
        wx.showLoading({ title: "正在上传凭证", mask: true });
        await this.uploadVouchers(projectId);
      }
      wx.removeStorageSync(DRAFT_KEY);
      wx.hideLoading();
      wx.showToast({ title: "项目创建成功", icon: "success" });
      setTimeout(() => wx.reLaunch({ url: "/pages/index/index" }), 1200);
    } catch (error) {
      wx.hideLoading();
      wx.showToast({ title: error.message || "创建项目失败", icon: "none" });
    } finally {
      this.setData({ submitting: false });
    }
  },
});
