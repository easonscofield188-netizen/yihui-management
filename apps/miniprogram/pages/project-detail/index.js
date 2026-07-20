const api = require("../../utils/api");

const WRITE_ROLES = ["ADMIN_SUPER", "ADMIN_COM", "ADMIN", "PROJECT_MANAGER", "FINANCE_MANAGER"];
const STATUS_LABELS = {
  negotiating: "洽谈中",
  constructing: "施工中",
  completed: "已交付",
  settling: "结账中",
  closed: "已结清",
  in_cooperation: "合作中",
  terminated: "已终止",
};

function money(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount)
    ? amount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "0.00";
}

function createRequestId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function decorateProject(project) {
  return {
    ...project,
    costs: (project.costs || []).map((item, index) => ({
      ...item,
      id: item.id || `cost-${index}`,
    })),
    statusLabel: STATUS_LABELS[project.status] || project.status || "未设置",
    amountText: money(project.amount),
    receivedText: money(project.receivedAmount),
    unreceivedText: money(project.unreceivedAmount),
    payableText: money(project.payableAmount),
    paidText: money(project.paidAmount),
  };
}

Page({
  data: {
    projectId: "",
    project: null,
    vouchers: [],
    loading: true,
    submitting: false,
    uploading: false,
    canWrite: false,
    formMode: "",
    amountInput: "",
    supplierInput: "",
    settled: false,
    categoryIndex: 0,
    categories: ["真植物", "人工", "材料", "运输", "伙食", "其他"],
    requestId: "",
  },

  onLoad(options) {
    const user = wx.getStorageSync("userInfo") || {};
    this.setData({
      projectId: options.id || "",
      canWrite: WRITE_ROLES.includes(user.role),
    });
  },

  onShow() {
    if (this.data.projectId) this.loadDetail();
  },

  async loadDetail() {
    this.setData({ loading: true });
    try {
      const [project, vouchers, config] = await Promise.all([
        api.getProject(this.data.projectId),
        api.getVouchers(this.data.projectId),
        api.getGlobalConfig().catch(() => null),
      ]);
      const categories = this.extractCategories(config);
      const refreshedVouchers = await this.refreshVoucherUrls(vouchers || []);
      this.setData({
        project: decorateProject(project),
        vouchers: refreshedVouchers,
        categories: categories.length ? categories : this.data.categories,
      });
      wx.setNavigationBarTitle({ title: project.name || "项目详情" });
    } catch (error) {
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  extractCategories(config) {
    const raw = config && (config.COST_CATEGORY || config.costCategories);
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((item) => item && item.isActive !== false)
      .map((item) => item.label || item.name || item.value)
      .filter(Boolean);
  },

  async refreshVoucherUrls(vouchers) {
    const fileList = vouchers.filter((item) => item.fileId).map((item) => item.fileId);
    if (!fileList.length) return vouchers;
    try {
      const result = await wx.cloud.getTempFileURL({ fileList });
      const urlMap = {};
      (result.fileList || []).forEach((item) => {
        urlMap[item.fileID] = item.tempFileURL;
      });
      return vouchers.map((item) => ({ ...item, displayUrl: urlMap[item.fileId] || item.fileUrl }));
    } catch (error) {
      return vouchers.map((item) => ({ ...item, displayUrl: item.fileUrl }));
    }
  },

  openReceipt() {
    this.setData({
      formMode: "receipt",
      amountInput: "",
      requestId: createRequestId(),
    });
  },

  openCost() {
    this.setData({
      formMode: "cost",
      amountInput: "",
      supplierInput: "",
      settled: false,
      categoryIndex: 0,
      requestId: createRequestId(),
    });
  },

  closeForm() {
    if (!this.data.submitting) this.setData({ formMode: "" });
  },

  stopPropagation() {},

  onAmountInput(event) {
    this.setData({ amountInput: event.detail.value });
  },

  onSupplierInput(event) {
    this.setData({ supplierInput: event.detail.value });
  },

  onCategoryChange(event) {
    this.setData({ categoryIndex: Number(event.detail.value) });
  },

  onSettledChange(event) {
    this.setData({ settled: event.detail.value });
  },

  async submitRecord() {
    if (this.data.submitting) return;
    const amount = Number(this.data.amountInput);
    if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001) {
      wx.showToast({ title: "请输入有效金额，最多两位小数", icon: "none" });
      return;
    }

    const payload = {
      projectId: this.data.projectId,
      recordType: this.data.formMode,
      amount,
      requestId: this.data.requestId,
    };
    if (this.data.formMode === "cost") {
      payload.category = this.data.categories[this.data.categoryIndex];
      payload.supplier = this.data.supplierInput.trim() || "无";
      payload.isSettled = this.data.settled;
    }

    this.setData({ submitting: true });
    try {
      const result = await api.quickRecord(payload);
      wx.showToast({ title: result.duplicated ? "该笔已提交" : "记账成功", icon: "success" });
      this.setData({ formMode: "", requestId: "" });
      await this.loadDetail();
    } catch (error) {
      wx.showToast({ title: error.message || "提交失败", icon: "none" });
    } finally {
      this.setData({ submitting: false });
    }
  },

  chooseVoucher() {
    if (this.data.uploading) return;
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      sizeType: ["compressed"],
      success: ({ tempFiles }) => {
        if (tempFiles && tempFiles[0]) this.uploadVoucher(tempFiles[0]);
      },
    });
  },

  async uploadVoucher(file) {
    this.setData({ uploading: true });
    wx.showLoading({ title: "上传中", mask: true });
    let uploadedFileId = "";
    try {
      const extensionMatch = String(file.tempFilePath).match(/\.[a-zA-Z0-9]+$/);
      const extension = extensionMatch ? extensionMatch[0].toLowerCase() : ".jpg";
      const cloudPath = `bill_voucher/mobile/${this.data.projectId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extension}`;
      const uploadResult = await wx.cloud.uploadFile({
        cloudPath,
        filePath: file.tempFilePath,
      });
      uploadedFileId = uploadResult.fileID;
      const urlResult = await wx.cloud.getTempFileURL({ fileList: [uploadedFileId] });
      const fileUrl = urlResult.fileList[0].tempFileURL;
      await api.addVoucher({
        projectId: this.data.projectId,
        fileName: cloudPath.split("/").pop(),
        fileId: uploadedFileId,
        fileUrl,
        fileSize: file.size || 0,
        mimeType: file.fileType === "video" ? "video/mp4" : "image/jpeg",
      });
      wx.showToast({ title: "凭证已上传", icon: "success" });
      await this.loadDetail();
    } catch (error) {
      if (uploadedFileId) {
        wx.cloud.deleteFile({ fileList: [uploadedFileId] }).catch(() => {});
      }
      wx.showToast({ title: error.message || "上传失败", icon: "none" });
    } finally {
      wx.hideLoading();
      this.setData({ uploading: false });
    }
  },

  previewVoucher(event) {
    const current = event.currentTarget.dataset.url;
    const urls = this.data.vouchers.map((item) => item.displayUrl || item.fileUrl).filter(Boolean);
    wx.previewImage({ current, urls });
  },
});
