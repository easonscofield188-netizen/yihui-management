const api = require("../../utils/api");

const PROJECT_DRAFT_KEY = "projectCreateDraft";
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
  return Number.isFinite(amount)
    ? amount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "0.00";
}

function createRequestId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function configLabel(config, group, value, fallback = "未设置") {
  const options = config && Array.isArray(config[group]) ? config[group] : [];
  const matched = options.find((item) => item.value === value || item.code === value);
  return (matched && (matched.label || matched.name)) || value || fallback;
}

function costCategoryLabel(config, item) {
  const value = item.categoryCode || item.category || "";
  const options = config && Array.isArray(config.COST_CATEGORY) ? config.COST_CATEGORY : [];
  const matched = options.find((option) => option.value === value || option.code === value);
  const legacyLabels = {
    real_plant: "真植物",
    fake_plant: "仿真植物",
    labor: "人工费",
    food: "伙食费",
    logistics: "物流运输",
    material: "材料费",
    other: "其他",
  };
  return item.categoryLabel
    || (matched && (matched.label || matched.name))
    || legacyLabels[value]
    || value
    || "其他成本";
}

function supplierLabel(value) {
  const supplier = String(value == null ? "" : value).trim();
  return ["", "none", "null", "undefined", "n/a", "无"].includes(supplier.toLowerCase())
    ? "无"
    : supplier;
}

function isSettledCost(value) {
  if (value === undefined || value === null || value === "") return true;
  return value === true || value === 1 || ["是", "true", "已支付", "已结清"].includes(String(value).toLowerCase());
}

function dateText(value) {
  if (!value) return "未设置";
  const raw = value.$date || value;
  return String(raw).slice(0, 10);
}

function decorateProject(project, config) {
  const payableAmount = Number(project.payableAmount || 0);
  const profit = Number(project.amount || 0) - payableAmount;
  return {
    ...project,
    costs: (project.costs || []).map((item, index) => {
      const categoryText = costCategoryLabel(config, item);
      const supplierText = supplierLabel(item.supplier);
      return {
        ...item,
        id: item.id || `cost-${index}`,
        amountText: money(item.amount),
        displayName: categoryText,
        subText: supplierText === "无" ? "无供应商" : supplierText,
        settled: isSettledCost(item.isSettled),
      };
    }),
    statusLabel: STATUS_LABELS[project.status] || project.status || "未设置",
    amountText: money(project.amount),
    receivedText: money(project.receivedAmount),
    unreceivedText: money(project.unreceivedAmount),
    payableText: money(payableAmount),
    paidText: money(project.paidAmount),
    profitText: money(profit),
    profitPositive: profit >= 0,
    staffCountText: Number(project.staffCount || 0),
    roleText: configLabel(config, "CLIENT_ROLE", project.role),
    sourceText: configLabel(config, "CLIENT_SOURCE", project.clientSource || project.source),
    sceneText: configLabel(config, "PROJECT_SCENE", project.scene),
    deliveryDateText: dateText(
      project.startDate
      || project.completionTime
      || (project.period && project.period[1])
    ),
  };
}

Page({
  data: {
    statusBarHeight: 0,
    navHeight: 88,
    projectId: "",
    project: null,
    vouchers: [],
    loading: true,
    submitting: false,
    uploading: false,
    canWrite: false,
    canEdit: false,
    formMode: "",
    amountInput: "",
    supplierInput: "",
    settled: false,
    categoryIndex: 0,
    categories: ["真植物", "人工", "材料", "运输", "伙食", "其他"],
    requestId: "",
    keyboardHeight: 0,
    windowHeight: 667,
  },

  onLoad(options) {
    const user = wx.getStorageSync("userInfo") || {};
    const systemInfo = wx.getSystemInfoSync();
    this.setData({
      ...getNavMetrics(),
      projectId: options.id || "",
      canWrite: WRITE_ROLES.includes(user.role),
      windowHeight: systemInfo.windowHeight || systemInfo.screenHeight || 667,
    });
    this.bindKeyboardListener();
  },

  onUnload() {
    this.unbindKeyboardListener();
  },

  bindKeyboardListener() {
    this.keyboardHandler = (res) => {
      this.setData({ keyboardHeight: Math.max(0, Number(res.height) || 0) });
    };
    if (typeof wx.onKeyboardHeightChange === "function") {
      wx.onKeyboardHeightChange(this.keyboardHandler);
    }
  },

  unbindKeyboardListener() {
    if (this.keyboardHandler && typeof wx.offKeyboardHeightChange === "function") {
      wx.offKeyboardHeightChange(this.keyboardHandler);
    }
    this.keyboardHandler = null;
  },

  onShow() {
    if (this.data.projectId) this.loadDetail();
  },

  goBack() {
    wx.navigateBack();
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
        project: decorateProject(project, config),
        vouchers: refreshedVouchers,
        categories: categories.length ? categories : this.data.categories,
        canEdit: this.data.canWrite && (project.type || "normal") === "normal",
      });
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
    if (!fileList.length) {
      return vouchers.map((item) => ({
        ...item,
        displayUrl: item.fileUrl,
        isImage: item.mimeType !== "application/pdf" && !/\.pdf$/i.test(item.fileName || ""),
      }));
    }
    try {
      const result = await wx.cloud.getTempFileURL({ fileList });
      const urlMap = {};
      (result.fileList || []).forEach((item) => {
        urlMap[item.fileID] = item.tempFileURL;
      });
      return vouchers.map((item) => ({
        ...item,
        displayUrl: urlMap[item.fileId] || item.fileUrl,
        isImage: item.mimeType !== "application/pdf" && !/\.pdf$/i.test(item.fileName || ""),
      }));
    } catch (error) {
      return vouchers.map((item) => ({
        ...item,
        displayUrl: item.fileUrl,
        isImage: item.mimeType !== "application/pdf" && !/\.pdf$/i.test(item.fileName || ""),
      }));
    }
  },

  openReceipt() {
    if (!this.data.canWrite) return;
    this.setData({
      formMode: "receipt",
      amountInput: "",
      requestId: createRequestId(),
    });
  },

  editProject() {
    const project = this.data.project;
    if (!project || !this.data.canEdit) return;
    const rawDeliveryDate = project.startDate
      || project.completionTime
      || (project.period && project.period[0])
      || "";
    const deliveryDate = String(rawDeliveryDate).slice(0, 10);
    wx.setStorageSync(PROJECT_DRAFT_KEY, {
      _mode: "edit",
      _projectId: this.data.projectId,
      _originalStatus: project.status || "",
      name: project.name || "",
      status: project.status || "completed",
      scene: project.scene || "",
      startDate: deliveryDate,
      client: project.client || "",
      clientId: project.clientId || "",
      role: project.role || "",
      source: project.clientSource || project.source || "",
      createClient: false,
      amount: Number(project.amount) || 0,
      receivedAmount: Number(project.receivedAmount) || 0,
      staffCount: Number(project.staffCount) || 1,
      desc: project.desc || "",
      costs: (project.costs || []).map((item) => ({
        id: item.id,
        category: item.category || "",
        categoryCode: item.categoryCode || "",
        supplier: item.supplier || "无",
        amount: Number(item.amount) || 0,
        isSettled: item.isSettled === true || item.isSettled === "是",
      })),
      invoiceEnabled: this.data.vouchers.length > 0 || project.isHasVoucher === "是",
    });
    wx.navigateTo({ url: `/pages/project-create/index?mode=edit&id=${this.data.projectId}` });
  },

  openCost() {
    if (!this.data.canWrite) return;
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
    if (!this.data.submitting) {
      this.setData({ formMode: "", keyboardHeight: 0 });
    }
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
      this.setData({ formMode: "", requestId: "", keyboardHeight: 0 });
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
    const urls = this.data.vouchers
      .filter((item) => item.isImage !== false)
      .map((item) => item.displayUrl || item.fileUrl)
      .filter(Boolean);
    if (!current || !urls.includes(current)) return;
    wx.previewImage({ current, urls });
  },
});
