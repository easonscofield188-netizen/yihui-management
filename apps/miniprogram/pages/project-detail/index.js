const api = require("../../utils/api");
const { getPdfDisplayName, openPdfFile } = require("../../utils/file-preview");
const { buildVoucherCloudPath } = require("../../utils/voucher-path");
const { isSettled } = require("../../utils/dictionary");

const WRITE_ROLES = ["ADMIN_SUPER", "ADMIN_COM", "ADMIN", "PROJECT_MANAGER", "FINANCE_MANAGER"];
const STATUS_LABELS = {
  negotiating: "洽谈中",
  constructing: "施工中",
  completed: "已交付",
  settling: "结账中",
  closed: "已结清",
  archived: "已归档",
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
  return isSettled(value);
}

function dateText(value) {
  if (!value) return "未设置";
  const raw = value.$date || value;
  return String(raw).slice(0, 10);
}

function decorateProject(project, config) {
  // 金额字段由后端 calculateFinancials 计算，前端仅做展示格式化
  const profitAmount = Number(project.profitAmount);
  const usesCheckIcon = ["completed", "closed", "archived"].includes(project.status);
  const statusIconColors = {
    completed: "#002045",
    closed: "#0f7a45",
    archived: "#6b7280",
  };
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
    statusLabel: project.type === "flower_plant" && project.status === "in_cooperation"
      ? "进行中"
      : (STATUS_LABELS[project.status] || project.status || "未设置"),
    usesCheckIcon,
    statusIconColor: statusIconColors[project.status] || "#002045",
    amountText: money(project.amount),
    receivedText: money(project.receivedAmount),
    unreceivedText: money(project.unreceivedAmount),
    payableText: money(project.payableAmount),
    paidText: money(project.paidAmount),
    profitText: money(project.profitAmount),
    profitRateText: `${Number(project.profitRate || 0).toFixed(1)}%`,
    profitPositive: Number.isFinite(profitAmount) ? profitAmount >= 0 : true,
    staffCountText: Number(project.staffCount || 0),
    roleText: configLabel(config, "CLIENT_ROLE", project.role),
    sourceText: configLabel(config, "CLIENT_SOURCE", project.clientSource || project.source),
    sceneText: configLabel(config, "PROJECT_SCENE", project.scene),
    deliveryDateText: dateText(
      project.latestServiceDate
      || project.startDate
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
    completionImages: [],
    visibleVouchers: [],
    visibleCompletionImages: [],
    vouchersExpanded: false,
    completionImagesExpanded: false,
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
    serviceRecords: [],
    serviceModalVisible: false,
    activeRecord: null,
    statementModalVisible: false,
    statementData: null,
    statementText: '',
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
      const [project, vouchers, config, serviceRecordsRes] = await Promise.all([
        api.getProject(this.data.projectId),
        api.getVouchers(this.data.projectId),
        api.getGlobalConfig().catch(() => null),
        api.listProjectServiceRecords(this.data.projectId, { page: 1, pageSize: 100 }).catch(() => ({ list: [] })),
      ]);
      const categories = this.extractCategories(config);
      const refreshedVouchers = await this.refreshVoucherUrls(vouchers || []);
      const completionImages = await this.refreshCompletionImageUrls(project && project.completionImageFileIds);
      const rawRecords = Array.isArray(serviceRecordsRes)
        ? serviceRecordsRes
        : (serviceRecordsRes && Array.isArray(serviceRecordsRes.list) ? serviceRecordsRes.list : []);
      const serviceRecords = await this.refreshRecordVouchers(rawRecords, vouchers || []);
      this.setData({
        project: decorateProject(project, config),
        vouchers: refreshedVouchers,
        completionImages,
        visibleVouchers: refreshedVouchers.slice(0, 3),
        visibleCompletionImages: completionImages.slice(0, 3),
        vouchersExpanded: false,
        completionImagesExpanded: false,
        serviceRecords,
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
        pdfDisplayName: getPdfDisplayName(item.fileName),
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
        pdfDisplayName: getPdfDisplayName(item.fileName),
        isImage: item.mimeType !== "application/pdf" && !/\.pdf$/i.test(item.fileName || ""),
      }));
    } catch (error) {
      return vouchers.map((item) => ({
        ...item,
        displayUrl: item.fileUrl,
        pdfDisplayName: getPdfDisplayName(item.fileName),
        isImage: item.mimeType !== "application/pdf" && !/\.pdf$/i.test(item.fileName || ""),
      }));
    }
  },

  async refreshRecordVouchers(records = [], projectVouchers = []) {
    const allFileIds = new Set();
    const projVoucherFileIds = (projectVouchers || []).map((v) => v.fileId || v.fileUrl).filter(Boolean);

    records.forEach((rec, idx) => {
      const recFiles = Array.isArray(rec.voucherFileIds)
        ? rec.voucherFileIds
        : (Array.isArray(rec.vouchers) ? rec.vouchers : []);
      recFiles.forEach((f) => f && allFileIds.add(f));
      (rec.costs || []).forEach((c) => {
        (c.voucherFileIds || []).forEach((f) => f && allFileIds.add(f));
      });
      if (idx === records.length - 1 && (!recFiles.length || recFiles.length === 0)) {
        projVoucherFileIds.forEach((f) => allFileIds.add(f));
      }
    });

    const fileList = Array.from(allFileIds).filter((f) => typeof f === "string" && f.startsWith("cloud://"));
    const urlMap = {};
    if (fileList.length) {
      try {
        const result = await wx.cloud.getTempFileURL({ fileList });
        (result.fileList || []).forEach((item) => {
          if (item.tempFileURL) urlMap[item.fileID] = item.tempFileURL;
        });
      } catch (err) {
        console.warn("获取服务流水凭证临时链接失败", err);
      }
    }

    const SCENE_NAME_MAP = {
      routine_maintenance: "日常维护",
      daily_maintenance: "日常维护",
      company_scenery: "公司布景",
      store_landscaping: "门店造景",
      government_unit: "机关单位",
      private_residence: "私人住宅",
      commercial_space: "商业空间",
      flower_supply: "鲜花供应",
      plant_supply: "绿植供应",
    };

    return records.map((rec, idx) => {
      let fileIds = Array.isArray(rec.voucherFileIds)
        ? [...rec.voucherFileIds]
        : (Array.isArray(rec.vouchers) ? [...rec.vouchers] : []);
      (rec.costs || []).forEach((c) => {
        (c.voucherFileIds || []).forEach((f) => {
          if (f && !fileIds.includes(f)) fileIds.push(f);
        });
      });
      if (idx === records.length - 1 && fileIds.length === 0 && projVoucherFileIds.length > 0) {
        fileIds = [...projVoucherFileIds];
      }

      const voucherUrls = fileIds.map((fid) => urlMap[fid] || fid).filter(Boolean);
      const rawContent = String(rec.content || rec.scene || "日常维护").trim();
      const displayContent =
        SCENE_NAME_MAP[rawContent] ||
        SCENE_NAME_MAP[rec.scene] ||
        (rawContent.includes("长期合作") ? "日常维护" : rawContent);

      return {
        ...rec,
        serviceDate: String(rec.serviceDate || '').slice(0, 10),
        displayContent,
        voucherUrls,
        voucherFileIds: fileIds,
        costAmountText: money(rec.costAmount),
        receivableText: money(rec.receivableAmount),
        receivedText: money(rec.receivedAmount),
        unreceivedText: money(rec.unreceivedAmount),
        profitRateText: `${Number(rec.profitRate || 0).toFixed(1)}%`,
      };
    });
  },

  previewVoucherThumbnail(e) {
    const current = e.currentTarget.dataset.url;
    const urls = e.currentTarget.dataset.urls || [current];
    if (!current) return;
    wx.previewImage({
      current,
      urls: Array.isArray(urls) && urls.length ? urls : [current],
    });
  },

  openAddServiceRecord() {
    this.setData({
      activeRecord: null,
      serviceModalVisible: true,
    });
  },

  editServiceRecord(e) {
    const item = e.currentTarget.dataset.item;
    this.setData({
      activeRecord: item,
      serviceModalVisible: true,
    });
  },

  deleteServiceRecord(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.showModal({
      title: "确认删除",
      content: "确定要删除这条服务履约记录吗？关联金额将重新聚合计算。",
      confirmText: "删除",
      confirmColor: "#ba1a1a",
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: "正在删除...", mask: true });
          try {
            await api.deleteProjectServiceRecord(id, this.data.projectId);
            wx.showToast({ title: "记录已删除", icon: "success" });
            this.loadDetail();
          } catch (err) {
            wx.showToast({ title: err.message || "删除失败", icon: "none" });
          } finally {
            wx.hideLoading();
          }
        }
      }
    });
  },

  async refreshCompletionImageUrls(fileIds) {
    const ids = (Array.isArray(fileIds) ? fileIds : []).filter((item) => typeof item === "string" && item);
    if (!ids.length) return [];
    try {
      const result = await wx.cloud.getTempFileURL({ fileList: ids });
      const urlMap = {};
      (result.fileList || []).forEach((item) => { urlMap[item.fileID] = item.tempFileURL; });
      return ids.map((fileId) => ({ fileId, displayUrl: urlMap[fileId] || fileId })).filter((item) => item.displayUrl);
    } catch (error) {
      return ids.map((fileId) => ({ fileId, displayUrl: fileId }));
    }
  },

  previewCompletionImage(event) {
    const current = event.currentTarget.dataset.url;
    const urls = this.data.completionImages.map((item) => item.displayUrl).filter(Boolean);
    if (current) wx.previewImage({ current, urls });
  },

  toggleVoucherExpand() {
    const expanded = !this.data.vouchersExpanded;
    this.setData({ vouchersExpanded: expanded, visibleVouchers: expanded ? this.data.vouchers : this.data.vouchers.slice(0, 3) });
  },

  toggleCompletionImages() {
    const expanded = !this.data.completionImagesExpanded;
    this.setData({ completionImagesExpanded: expanded, visibleCompletionImages: expanded ? this.data.completionImages : this.data.completionImages.slice(0, 3) });
  },

  openClientStatementForRecord(e) {
    const clientId = e.currentTarget.dataset.clientId;
    if (!clientId) {
      wx.showToast({ title: '暂无关联客户信息', icon: 'none' });
      return;
    }
    this.generateClientStatement(clientId);
  },

  async generateClientStatement(clientId) {
    if (!clientId) return;
    wx.showLoading({ title: '正在生成对账单...', mask: true });
    try {
      const res = await api.callFunction('projectService', 'getClientStatement', {
        projectId: this.data.projectId,
        clientId,
      });
      // api.callFunction 已返回云函数的 data 字段，不能再次取 .data。
      const data = res || {};
      const statementText = this.buildStatementText(data);
      this.setData({
        statementData: data,
        statementText,
        statementModalVisible: true,
      });
    } catch (err) {
      wx.showToast({ title: err.message || '对账单生成失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  buildStatementText(data) {
    const today = new Date().toISOString().slice(0, 10);
    let text = `【杭州亿辉文化 - 鲜花绿植供应对账单】\n`;
    text += `客户姓名：${data.clientName || '客户'}\n`;
    if (data.clientCompany) text += `单位公司：${data.clientCompany}\n`;
    if (data.clientPhone) text += `联系电话：${data.clientPhone}\n`;
    text += `对账日期：${today}\n`;
    text += `-----------------------------\n`;
    text += `服务笔数：${data.totalCount || 0} 笔\n`;
    text += `订单总金额：¥${money(data.totalReceivable)}\n`;
    text += `已付款金额：¥${money(data.totalReceived)}\n`;
    text += `待收尾款：¥${money(data.totalUnreceived)}\n`;
    text += `-----------------------------\n`;
    text += `【服务消费明细】\n`;
    (data.records || []).forEach((r, idx) => {
      text += `${idx + 1}. ${r.serviceDate} ${r.content} - 应收:¥${money(r.receivableAmount)} | ${r.isSettled ? '已结清' : '未结清(待付:¥' + money(r.unreceivedAmount) + ')'}\n`;
    });
    text += `-----------------------------\n`;
    text += `收款账号：杭州亿辉文化创意有限公司\n`;
    text += `感谢您的支持与配合！`;
    return text;
  },

  copyStatementText() {
    if (!this.data.statementText) return;
    wx.setClipboardData({
      data: this.data.statementText,
      success: () => {
        wx.showToast({ title: '对账单已复制', icon: 'success' });
      },
    });
  },

  closeStatementModal() {
    this.setData({ statementModalVisible: false });
  },

  previewVoucherUrls(e) {
    const urls = e.currentTarget.dataset.urls || [];
    if (urls.length) {
      wx.previewImage({ current: urls[0], urls });
    }
  },

  onServiceRecordClose() {
    this.setData({ serviceModalVisible: false });
  },

  onServiceRecordSuccess() {
    this.setData({ serviceModalVisible: false });
    this.loadDetail();
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
    wx.navigateTo({ url: `/pages/project-edit/index?id=${this.data.projectId}` });
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
      const cloudPath = buildVoucherCloudPath(this.data.project.name, extension).cloudPath;
      const uploadResult = await wx.cloud.uploadFile({
        cloudPath,
        filePath: file.tempFilePath,
      });
      uploadedFileId = uploadResult.fileID;
      const urlResult = await wx.cloud.getTempFileURL({ fileList: [uploadedFileId] });
      const fileUrl = urlResult.fileList[0].tempFileURL;
      const seqIndex = (this.data.vouchers || []).length + 1;
      const seqStr = String(seqIndex).padStart(2, "0");
      const formattedFileName = `成本凭证_${seqStr}${extension}`;
      await api.addVoucher({
        projectId: this.data.projectId,
        fileName: formattedFileName,
        fileId: uploadedFileId,
        fileUrl,
        fileSize: file.size || 0,
        mimeType: file.fileType === "video" ? "video/mp4" : "image/jpeg",
        uploadSeq: seqIndex,
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

  async previewVoucher(event) {
    const id = event.currentTarget.dataset.id;
    const target = this.data.vouchers.find((item) => String(item._id || item.id) === String(id));
    if (!target) return;

    if (target.isImage !== false) {
      const current = target.displayUrl || target.fileUrl;
      const urls = this.data.vouchers
        .filter((item) => item.isImage !== false)
        .map((item) => item.displayUrl || item.fileUrl)
        .filter(Boolean);
      if (current && urls.includes(current)) {
        wx.previewImage({ current, urls });
      }
      return;
    }

    wx.showLoading({ title: "打开中...", mask: true });
    try {
      await openPdfFile({
        filePath: target.displayUrl || target.fileUrl,
        fileId: target.fileId,
        fileUrl: target.displayUrl || target.fileUrl,
      });
    } catch (error) {
      wx.showToast({ title: (error && error.message) || "无法打开 PDF", icon: "none" });
    } finally {
      wx.hideLoading();
    }
  },
});
