const api = require("../../utils/api");

const DRAFT_KEY = "projectQuotationCreateDraftV1";
const LIST_REFRESH_KEY = "projectQuotationListRefreshV1";
const DETAIL_REFRESH_KEY = "projectQuotationDetailRefreshV1";
const MAX_DRAWINGS = 9;
const MAX_FILE_SIZE = 10 * 1024 * 1024;

function getNavMetrics() {
  const systemInfo = wx.getSystemInfoSync();
  const statusBarHeight = systemInfo.statusBarHeight || 0;
  const menuButton = wx.getMenuButtonBoundingClientRect();
  const contentHeight = menuButton && menuButton.height
    ? menuButton.height + Math.max(0, menuButton.top - statusBarHeight) * 2
    : 44;
  return { statusBarHeight, navHeight: statusBarHeight + contentHeight };
}

function dateOnly(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  const matched = String(raw || "").match(/^\d{4}-\d{2}-\d{2}/);
  return matched ? matched[0] : "";
}

function today() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function draftTime() {
  const date = new Date();
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function cleanNumber(value, decimals = 2) {
  const source = String(value == null ? "" : value).replace(/[^\d.]/g, "");
  const dot = source.indexOf(".");
  if (dot < 0) return source.replace(/^0+(?=\d)/, "");
  const integer = source.slice(0, dot).replace(/^0+(?=\d)/, "") || "0";
  return `${integer}.${source.slice(dot + 1).replace(/\./g, "").slice(0, decimals)}`;
}

function money(value) {
  const num = Number(value);
  const val = !isNaN(num) ? num : 0;
  const parts = val.toFixed(2).split(".");
  const integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${integerPart}.${parts[1]}`;
}

function toCents(value) {
  const num = Number(value);
  return Math.round((!Number.isNaN(num) ? num : 0) * 100);
}

function calcItemTotal(quantity, unitPrice) {
  const qtyCents = toCents(quantity);
  const priceCents = toCents(unitPrice);
  const totalCents = Math.round((qtyCents * priceCents) / 100);
  return totalCents / 100;
}

function calcTotalAmount(items) {
  const centsSum = (items || []).reduce((sum, item) => sum + toCents(item.totalAmount), 0);
  return centsSum / 100;
}

function createItem(data = {}) {
  const quantity = String(data.quantity == null ? "1" : data.quantity);
  const unitPrice = String(data.unitPrice == null ? "" : data.unitPrice);
  const totalAmount = data.totalAmount !== undefined && data.totalAmount !== null && data.totalAmount !== ""
    ? Number(data.totalAmount)
    : calcItemTotal(quantity, unitPrice);
  return {
    localId: data.localId || `${Date.now()}_${Math.random().toString(16).slice(2)}`,
    name: String(data.name || ""),
    quantity,
    unit: String(data.unit || "项"),
    unitPrice,
    remark: String(data.remark || ""),
    totalAmount,
    totalText: money(totalAmount),
  };
}

function fileExtension(value) {
  return String(value || "").split("?")[0].match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase() || "";
}

function safePathPart(value) {
  return String(value || "quotation")
    .trim()
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, "_")
    .slice(0, 40) || "quotation";
}

function createRequestId() {
  return `quotation_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function uploadWithRetry(options, maxAttempts = 3) {
  return (async () => {
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await wx.cloud.uploadFile(options);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("文件上传失败");
  })();
}

Page({
  data: {
    ...getNavMetrics(),
    today: today(),
    form: {
      projectName: "",
      createdDate: today(),
    },
    versionValue: "V1.0",
    versionLabel: "版本一",
    versionLoading: false,
    editMode: false,
    sourceId: "",
    navTitle: "新增报价单",
    items: [createItem()],
    drawings: [],
    totalAmount: 0,
    totalText: "0.00",
    datePickerVisible: false,
    fileSourceVisible: false,
    importing: false,
    submitting: false,
    submitText: "确认提交",
  },

  onLoad(options = {}) {
    const sourceId = String(options.sourceId || "").trim();
    if (sourceId) {
      this.setData({
        editMode: true,
        sourceId,
        navTitle: "编辑报价单",
        versionLoading: true,
      });
      this.loadQuotationForEdit(sourceId);
      return;
    }
    const draft = wx.getStorageSync(DRAFT_KEY) || {};
    const draftCreatedDate = dateOnly(draft.form?.createdDate);
    this.useDefaultDate = !draftCreatedDate;
    const restoredItems = Array.isArray(draft.items) && draft.items.length
      ? draft.items.map(createItem)
      : [createItem()];
    const restoredDrawings = Array.isArray(draft.drawings) ? draft.drawings.slice(0, MAX_DRAWINGS) : [];
    this.setData({
      form: {
        projectName: String(draft.form?.projectName || ""),
        createdDate: draftCreatedDate || this.data.today,
      },
      items: restoredItems,
      drawings: restoredDrawings,
    });
    this.refreshTotal(restoredItems);
    this.loadServerDate();
    this.scheduleVersionLookup(String(draft.form?.projectName || ""), true);
  },

  onUnload() {
    if (this.draftTimer) clearTimeout(this.draftTimer);
    if (this.versionTimer) clearTimeout(this.versionTimer);
  },

  async loadServerDate() {
    try {
      const result = await api.getServerDate();
      const serverToday = dateOnly(result && result.date);
      if (!serverToday) return;
      const updates = { today: serverToday };
      if (this.useDefaultDate) updates["form.createdDate"] = serverToday;
      this.setData(updates);
      this.useDefaultDate = false;
    } catch (error) {
      // 使用设备日期兜底。
    }
  },

  scheduleDraftSave() {
    if (this.data.editMode) return;
    if (this.draftTimer) clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(() => this.saveDraft(), 260);
  },

  saveDraft() {
    if (this.data.editMode) return;
    const savedAt = draftTime();
    wx.setStorageSync(DRAFT_KEY, {
      form: this.data.form,
      items: this.data.items,
      drawings: this.data.drawings,
      savedAt,
    });
  },

  onBasicInput(event) {
    const field = event.currentTarget.dataset.field;
    if (!field) return;
    const value = String(event.detail.value || "");
    this.setData({ [`form.${field}`]: value });
    if (field === "projectName") this.scheduleVersionLookup(value);
    this.scheduleDraftSave();
  },

  async loadQuotationForEdit(sourceId) {
    try {
      const result = await api.getProjectQuotation(sourceId);
      const drawings = await this.resolvePersistedDrawings(result.drawings || []);
      const items = Array.isArray(result.items) && result.items.length
        ? result.items.map(createItem)
        : [createItem()];
      const nextVersion = await api.getNextProjectQuotationVersion(result.projectName || "");
      this.setData({
        form: {
          projectName: String(result.projectName || ""),
          createdDate: dateOnly(result.createdDateRaw) || this.data.today,
        },
        versionValue: nextVersion.value || "V1.0",
        versionLabel: nextVersion.label || "版本一",
        versionLoading: false,
        items,
        drawings,
      });
      this.refreshTotal(items);
    } catch (error) {
      this.setData({ versionLoading: false });
      wx.showModal({
        title: "报价单加载失败",
        content: error.message || "无法读取原报价内容",
        showCancel: false,
        success: () => this.leavePage(),
      });
    }
  },

  async resolvePersistedDrawings(drawings) {
    const fileIds = drawings.map(item => item.fileId).filter(Boolean);
    const tempUrlMap = {};
    if (fileIds.length) {
      try {
        const result = await wx.cloud.getTempFileURL({ fileList: fileIds });
        (result.fileList || []).forEach(item => {
          if (item.fileID && item.tempFileURL) tempUrlMap[item.fileID] = item.tempFileURL;
        });
      } catch (error) {
        // 图片仍可使用 cloud 文件 ID 作为兜底地址。
      }
    }
    return drawings.map((item, index) => ({
      localId: `persisted_${index}_${Date.now()}`,
      persisted: true,
      fileId: item.fileId || "",
      url: item.url || "",
      tempFilePath: tempUrlMap[item.fileId] || item.url || item.fileId || "",
      name: item.name || `设计图纸${index + 1}`,
      fileType: item.fileType || fileExtension(item.name),
      mimeType: item.mimeType || "",
      size: Number(item.size) || 0,
      kind: String(item.fileType || fileExtension(item.name)).toLowerCase() === "pdf" ? "pdf" : "image",
      sourceCode: item.sourceCode || "quotation_drawing",
    }));
  },

  scheduleVersionLookup(projectName, immediate = false) {
    if (this.versionTimer) clearTimeout(this.versionTimer);
    const normalizedName = String(projectName || "").trim();
    if (!normalizedName) {
      this.versionRequestId = (this.versionRequestId || 0) + 1;
      this.setData({ versionValue: "V1.0", versionLabel: "版本一", versionLoading: false });
      return;
    }
    this.setData({ versionLoading: true });
    this.versionTimer = setTimeout(() => this.loadNextVersion(normalizedName), immediate ? 0 : 400);
  },

  async loadNextVersion(projectName) {
    const requestId = (this.versionRequestId || 0) + 1;
    this.versionRequestId = requestId;
    try {
      const result = await api.getNextProjectQuotationVersion(projectName);
      if (requestId !== this.versionRequestId || this.data.form.projectName.trim() !== projectName) return;
      this.setData({
        versionValue: result.value || "V1.0",
        versionLabel: result.label || "版本一",
      });
    } catch (error) {
      if (requestId === this.versionRequestId) {
        wx.showToast({ title: "报价版本生成失败", icon: "none" });
      }
    } finally {
      if (requestId === this.versionRequestId) this.setData({ versionLoading: false });
    }
  },

  openDatePicker() {
    if (this.data.editMode) return;
    this.setData({ datePickerVisible: true });
  },

  closeDatePicker() {
    this.setData({ datePickerVisible: false });
  },

  confirmDate(event) {
    this.setData({
      "form.createdDate": dateOnly(event.detail.value) || this.data.today,
      datePickerVisible: false,
    });
    this.scheduleDraftSave();
  },

  onItemInput(event) {
    const index = Number(event.currentTarget.dataset.index);
    const field = event.currentTarget.dataset.field;
    if (!Number.isInteger(index) || !this.data.items[index] || !field) return;
    const rawValue = event.detail.value;
    const value = ["quantity", "unitPrice"].includes(field)
      ? cleanNumber(rawValue)
      : String(rawValue || "");
    const items = this.data.items.map(item => ({ ...item }));
    items[index][field] = value;
    const itemTotal = calcItemTotal(items[index].quantity, items[index].unitPrice);
    items[index].totalAmount = itemTotal;
    items[index].totalText = money(itemTotal);
    const totalAmount = calcTotalAmount(items);
    this.setData({
      [`items[${index}].${field}`]: value,
      [`items[${index}].totalAmount`]: itemTotal,
      [`items[${index}].totalText`]: money(itemTotal),
      totalAmount,
      totalText: money(totalAmount),
    });
    this.scheduleDraftSave();
  },

  refreshTotal(items = this.data.items) {
    const totalAmount = calcTotalAmount(items);
    this.setData({ totalAmount, totalText: money(totalAmount) });
  },

  addItem() {
    const items = this.data.items.concat(createItem());
    this.setData({ items });
    this.refreshTotal(items);
    this.scheduleDraftSave();
  },

  deleteItem(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index) || !this.data.items[index]) return;
    if (this.data.items.length === 1) {
      wx.showToast({ title: "至少保留一个报价类目", icon: "none" });
      return;
    }
    const items = this.data.items.filter((item, itemIndex) => itemIndex !== index);
    this.setData({ items });
    this.refreshTotal(items);
    this.scheduleDraftSave();
  },

  importItems() {
    if (this.data.importing) return;
    wx.chooseMessageFile({
      count: 1,
      type: "file",
      extension: ["xlsx", "xls"],
      success: response => this.importExcel(response.tempFiles?.[0]),
    });
  },

  async importExcel(file) {
    if (!file || !file.path) return;
    if (Number(file.size) > MAX_FILE_SIZE) {
      wx.showToast({ title: "Excel 文件不能超过 10MB", icon: "none" });
      return;
    }
    const extension = fileExtension(file.name || file.path);
    if (!["xlsx", "xls"].includes(extension)) {
      wx.showToast({ title: "请选择 Excel 表格文件", icon: "none" });
      return;
    }
    const requestId = createRequestId();
    const cloudPath = `project-quotation-imports/${requestId}.${extension}`;
    let uploadedFileId = "";
    this.setData({ importing: true });
    wx.showLoading({ title: "正在解析表格", mask: true });
    try {
      const upload = await uploadWithRetry({ cloudPath, filePath: file.path });
      uploadedFileId = upload.fileID;
      const result = await api.parseProjectQuotationExcel({
        fileId: uploadedFileId,
        fileName: file.name || `quotation.${extension}`,
      });
      uploadedFileId = "";
      const imported = (result.items || []).map(createItem);
      const currentItems = this.data.items.length === 1 && !this.data.items[0].name
        ? []
        : this.data.items;
      const items = currentItems.concat(imported).slice(0, 100);
      this.setData({ items });
      this.refreshTotal(items);
      this.scheduleDraftSave();
      wx.showToast({ title: `已导入 ${imported.length} 项`, icon: "success" });
    } catch (error) {
      if (uploadedFileId) wx.cloud.deleteFile({ fileList: [uploadedFileId] }).catch(() => {});
      wx.showToast({ title: error.message || "Excel 导入失败", icon: "none" });
    } finally {
      wx.hideLoading();
      this.setData({ importing: false });
    }
  },

  openFileSource() {
    if (this.data.drawings.length >= MAX_DRAWINGS) {
      wx.showToast({ title: `最多上传 ${MAX_DRAWINGS} 个文件`, icon: "none" });
      return;
    }
    this.setData({ fileSourceVisible: true });
  },

  closeFileSource(event) {
    if (event && event.detail && event.detail.visible === true) return;
    this.setData({ fileSourceVisible: false });
  },

  chooseDrawingImages() {
    this.setData({ fileSourceVisible: false });
    const count = MAX_DRAWINGS - this.data.drawings.length;
    wx.chooseMedia({
      count,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      sizeType: ["compressed"],
      success: result => {
        const files = (result.tempFiles || []).map((file, index) => ({
          localId: `${Date.now()}_${index}`,
          tempFilePath: file.tempFilePath,
          name: `drawing_${Date.now()}_${index}.${fileExtension(file.tempFilePath) || "jpg"}`,
          size: Number(file.size) || 0,
          kind: "image",
          fileType: fileExtension(file.tempFilePath) || "jpg",
          mimeType: file.fileType || "image/jpeg",
        }));
        this.addDrawings(files);
      },
    });
  },

  chooseDrawingPdfs() {
    this.setData({ fileSourceVisible: false });
    wx.chooseMessageFile({
      count: MAX_DRAWINGS - this.data.drawings.length,
      type: "file",
      extension: ["pdf"],
      success: result => {
        const files = (result.tempFiles || []).map((file, index) => ({
          localId: `${Date.now()}_${index}`,
          tempFilePath: file.path,
          name: file.name || `drawing_${Date.now()}_${index}.pdf`,
          size: Number(file.size) || 0,
          kind: "pdf",
          fileType: "pdf",
          mimeType: "application/pdf",
        }));
        this.addDrawings(files);
      },
    });
  },

  addDrawings(files) {
    const accepted = files.filter(file => file.tempFilePath && file.size <= MAX_FILE_SIZE);
    const rejectedCount = files.length - accepted.length;
    const drawings = this.data.drawings.concat(accepted).slice(0, MAX_DRAWINGS);
    this.setData({ drawings });
    this.scheduleDraftSave();
    if (rejectedCount) wx.showToast({ title: "部分文件超过 10MB，已忽略", icon: "none" });
  },

  deleteDrawing(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index) || !this.data.drawings[index]) return;
    this.setData({ drawings: this.data.drawings.filter((item, itemIndex) => itemIndex !== index) });
    this.scheduleDraftSave();
  },

  async previewDrawing(event) {
    const index = Number(event.currentTarget.dataset.index);
    const drawing = this.data.drawings[index];
    if (!drawing || !drawing.tempFilePath) return;
    if (drawing.kind === "image") {
      const urls = this.data.drawings.filter(item => item.kind === "image").map(item => item.tempFilePath);
      wx.previewImage({ current: drawing.tempFilePath, urls });
      return;
    }
    wx.showLoading({ title: "正在打开 PDF" });
    try {
      let filePath = drawing.tempFilePath;
      if (drawing.fileId) {
        const result = await wx.cloud.downloadFile({ fileID: drawing.fileId });
        filePath = result.tempFilePath;
      } else if (/^https?:/i.test(filePath)) {
        const result = await new Promise((resolve, reject) => wx.downloadFile({
          url: filePath,
          success: response => response.statusCode === 200 ? resolve(response) : reject(new Error("PDF 下载失败")),
          fail: reject,
        }));
        filePath = result.tempFilePath;
      }
      await new Promise((resolve, reject) => wx.openDocument({
        filePath,
        fileType: "pdf",
        showMenu: true,
        success: resolve,
        fail: reject,
      }));
    } catch (error) {
      wx.showToast({ title: error.message || "PDF 打开失败", icon: "none" });
    } finally {
      wx.hideLoading();
    }
  },

  cancel() {
    if (this.data.submitting) return;
    wx.showModal({
      title: this.data.editMode ? "取消编辑报价单" : "取消新增报价单",
      content: this.data.editMode ? "当前修改不会保存，确定返回吗？" : "当前内容已经保存为草稿，确定返回吗？",
      confirmText: "确定返回",
      confirmColor: "#173d6b",
      success: result => result.confirm && this.leavePage(),
    });
  },

  leavePage() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack({ delta: 1 });
      return;
    }
    wx.redirectTo({
      url: "/pages/project-quotations/index",
      fail: () => wx.reLaunch({ url: "/pages/project-quotations/index" }),
    });
  },

  validate() {
    if (!this.data.form.projectName.trim()) return "请输入项目名称";
    if (!this.data.form.createdDate) return "请选择创建日期";
    if (!this.data.items.length) return "请至少添加一个报价类目";
    const invalid = this.data.items.some(item => (
      !item.name.trim()
      || !item.unit.trim()
      || !String(item.quantity).trim()
      || Number(item.quantity) <= 0
      || !String(item.unitPrice).trim()
      || Number(item.unitPrice) < 0
    ));
    return invalid ? "请完善报价清单中的必填信息" : "";
  },

  async uploadDrawings(requestId) {
    const result = [];
    const date = this.data.form.createdDate.replace(/-/g, "");
    const projectName = safePathPart(this.data.form.projectName);
    for (let index = 0; index < this.data.drawings.length; index += 1) {
      const file = this.data.drawings[index];
      if (file.persisted && (file.fileId || file.url)) {
        result.push({
          fileId: file.fileId || "",
          url: file.url || "",
          name: file.name,
          fileType: file.fileType,
          mimeType: file.mimeType,
          size: file.size,
          sourceCode: file.sourceCode || "quotation_drawing",
        });
        continue;
      }
      this.setData({ submitText: `正在上传 ${index + 1}/${this.data.drawings.length}` });
      const extension = file.fileType || fileExtension(file.name || file.tempFilePath) || "jpg";
      const cloudPath = `project-quotations/${date}/${projectName}/${requestId}_${index}.${extension}`;
      const upload = await uploadWithRetry({ cloudPath, filePath: file.tempFilePath });
      result.push({
        fileId: upload.fileID,
        url: "",
        name: file.name,
        fileType: extension,
        mimeType: file.mimeType,
        size: file.size,
        sourceCode: "quotation_drawing",
      });
    }
    return result;
  },

  async submit() {
    if (this.data.submitting) return;
    const validationMessage = this.validate();
    if (validationMessage) {
      wx.showToast({ title: validationMessage, icon: "none" });
      return;
    }
    const requestId = this.pendingRequestId || createRequestId();
    this.pendingRequestId = requestId;
    if (this.draftTimer) {
      clearTimeout(this.draftTimer);
      this.draftTimer = null;
    }
      this.saveDraft();
    this.setData({ submitting: true, submitText: "正在准备" });
    try {
      const drawings = await this.uploadDrawings(requestId);
      this.setData({ submitText: this.data.editMode ? "正在生成新版本" : "正在创建报价单" });
      const payload = {
        projectName: this.data.form.projectName.trim(),
        createdDate: this.data.form.createdDate,
        items: this.data.items.map(item => ({
          name: item.name.trim(),
          quantity: Number(item.quantity),
          unit: item.unit.trim(),
          unitPrice: Number(item.unitPrice),
          remark: item.remark.trim(),
        })),
        drawings,
        clientRequestId: requestId,
      };
      const result = this.data.editMode
        ? await api.createProjectQuotationVersion({ ...payload, sourceId: this.data.sourceId })
        : await api.createProjectQuotation(payload);
      if (!this.data.editMode) wx.removeStorageSync(DRAFT_KEY);
      wx.setStorageSync(LIST_REFRESH_KEY, {
        id: result.id || "",
        createdAt: Date.now(),
      });
      if (this.data.editMode) {
        wx.setStorageSync(DETAIL_REFRESH_KEY, { id: result.id || "", createdAt: Date.now() });
      }
      this.pendingRequestId = "";
      wx.showToast({ title: this.data.editMode ? "新版本创建成功" : "报价单创建成功", icon: "success" });
      setTimeout(() => this.leavePage(), 500);
    } catch (error) {
      wx.showToast({ title: error.message || "报价单创建失败", icon: "none" });
      this.setData({ submitting: false, submitText: "确认提交" });
    }
  },
});
