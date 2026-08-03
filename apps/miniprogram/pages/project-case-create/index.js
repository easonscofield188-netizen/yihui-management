const api = require("../../utils/api");
const caseCache = require("../../utils/project-case-cache");

const MAX_IMAGES = 9;
const COMPRESS_THRESHOLD = 800 * 1024;
const CATEGORY_OPTIONS = [
  { value: "internal_operation", label: "内部运营" },
];

function getNavMetrics() {
  const systemInfo = wx.getSystemInfoSync();
  const statusBarHeight = systemInfo.statusBarHeight || 0;
  const menuButton = wx.getMenuButtonBoundingClientRect();
  const contentHeight = menuButton && menuButton.height
    ? menuButton.height + Math.max(0, menuButton.top - statusBarHeight) * 2
    : 44;
  return { statusBarHeight, navHeight: statusBarHeight + contentHeight };
}

function cleanMoney(value) {
  const source = String(value == null ? "" : value).replace(/[^\d.]/g, "");
  const dot = source.indexOf(".");
  if (dot < 0) return source.replace(/^0+(?=\d)/, "");
  return `${source.slice(0, dot) || "0"}.${source.slice(dot + 1).replace(/\./g, "").slice(0, 2)}`;
}

function fileExtension(path) {
  return String(path || "").match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase() || "jpg";
}

function compressImage(path, size) {
  if (Number(size) < COMPRESS_THRESHOLD) return Promise.resolve(path);
  return new Promise((resolve) => {
    wx.getImageInfo({
      src: path,
      success: ({ width, height }) => {
        const longEdge = Math.max(Number(width) || 0, Number(height) || 0);
        const scale = longEdge > 2400 ? 2400 / longEdge : 1;
        wx.compressImage({
          src: path,
          quality: 82,
          compressedWidth: Math.max(1, Math.round(width * scale)),
          compressedHeight: Math.max(1, Math.round(height * scale)),
          success: result => resolve(result.tempFilePath || path),
          fail: () => resolve(path),
        });
      },
      fail: () => resolve(path),
    });
  });
}

function wait(delay) {
  return new Promise(resolve => setTimeout(resolve, delay));
}

async function uploadWithRetry(options, maxAttempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await wx.cloud.uploadFile(options);
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) await wait(attempt * 500);
    }
  }
  throw lastError || new Error("图片上传失败");
}

function createRequestId() {
  return `case-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function todayText() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

Page({
  data: {
    ...getNavMetrics(),
    today: todayText(),
    form: {
      projectId: "",
      projectCode: "",
      title: "",
      caseDate: "",
      categoryCode: "",
      categoryLabel: "选择场景",
      amountEnabled: true,
      amount: "",
      descriptionEnabled: false,
      content: "",
    },
    categories: CATEGORY_OPTIONS,
    datePickerVisible: false,
    categoryPickerVisible: false,
    categoryPickerValue: [],
    projectSelectorVisible: false,
    projectKeyword: "",
    projects: [],
    projectLoading: false,
    images: [],
    submitting: false,
    submitText: "确认新增",
  },

  onLoad() {
    if (!api.getToken()) {
      wx.reLaunch({ url: "/pages/login/index" });
      return;
    }
    this.loadCategoryOptions();
  },

  async loadCategoryOptions() {
    try {
      const result = await api.getGlobalConfig();
      const categories = (result.PROJECT_SCENE || []).filter(item => item && item.value && item.label);
      if (categories.length) this.setData({ categories });
    } catch (error) {
      // 保留内置字典，避免配置接口异常阻断新增流程。
    }
  },

  close() {
    const pages = getCurrentPages();
    const previous = pages[pages.length - 2];
    if (previous && previous.route === "pages/project-cases/index") {
      wx.navigateBack({ delta: 1 });
      return;
    }
    // 新增页只返回案例列表，不返回到其他业务页面或继续堆叠页面层级。
    wx.redirectTo({
      url: "/pages/project-cases/index",
      fail: () => wx.reLaunch({ url: "/pages/project-cases/index" }),
    });
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field;
    const value = event.detail.value;
    if (!field) return;
    this.setData({ [`form.${field}`]: field === "amount" ? cleanMoney(value) : value });
  },

  onAmountSwitch(event) {
    this.setData({ "form.amountEnabled": Boolean(event.detail.value) });
  },

  onDescriptionSwitch(event) {
    this.setData({ "form.descriptionEnabled": Boolean(event.detail.value) });
  },

  openDatePicker() {
    this.setData({ datePickerVisible: true });
  },

  closeDatePicker() {
    this.setData({ datePickerVisible: false });
  },

  confirmDate(event) {
    this.setData({
      "form.caseDate": String(event.detail.value || "").slice(0, 10),
      datePickerVisible: false,
    });
  },

  openCategoryPicker() {
    this.setData({
      categoryPickerVisible: true,
      categoryPickerValue: this.data.form.categoryCode ? [this.data.form.categoryCode] : [],
    });
  },

  closeCategoryPicker() {
    this.setData({ categoryPickerVisible: false });
  },

  confirmCategory(event) {
    const value = event.detail.value?.[0];
    const matched = this.data.categories.find(item => item.value === value);
    if (!matched) return;
    this.setData({
      categoryPickerVisible: false,
      categoryPickerValue: [value],
      "form.categoryCode": value,
      "form.categoryLabel": matched.label,
    });
  },

  openProjectSelector() {
    this.setData({ projectSelectorVisible: true }, () => this.loadProjects());
  },

  closeProjectSelector(event) {
    if (event && event.detail && event.detail.visible === true) return;
    this.setData({ projectSelectorVisible: false });
  },

  onProjectKeyword(event) {
    const projectKeyword = event.detail.value || "";
    this.setData({ projectKeyword });
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.loadProjects(), 300);
  },

  async loadProjects() {
    if (this.data.projectLoading) {
      this.pendingProjectReload = true;
      return;
    }
    this.setData({ projectLoading: true });
    try {
      const result = await api.listProjects({ page: 1, pageSize: 30, keyword: this.data.projectKeyword.trim() });
      this.setData({ projects: result.list || [] });
    } catch (error) {
      wx.showToast({ title: error.message || "项目加载失败", icon: "none" });
    } finally {
      this.setData({ projectLoading: false });
      if (this.pendingProjectReload) {
        this.pendingProjectReload = false;
        this.loadProjects();
      }
    }
  },

  async selectProject(event) {
    const projectId = event.currentTarget.dataset.id;
    if (!projectId) return;
    wx.showLoading({ title: "正在同步项目", mask: true });
    try {
      const result = await api.syncProjectToCase(projectId);
      const matchedCategory = this.data.categories.find(item => (
        item.value === result.sceneCode || item.label === result.sceneLabel
      ));
      const linkedImages = (result.images || []).slice(0, MAX_IMAGES).map((item, index) => ({
        id: `linked-${index}-${item.fileId || item.url}`,
        fileId: item.fileId || "",
        url: item.url || "",
        displayUrl: item.fileId || item.url || "",
        name: item.name || "",
        sourceCode: "linked_project",
        local: false,
      }));
      this.setData({
        projectSelectorVisible: false,
        "form.projectId": result.projectId,
        "form.projectCode": result.projectCode || "",
        "form.title": result.title || "",
        "form.caseDate": result.caseDate || "",
        "form.amount": result.amount ? String(result.amount) : "",
        "form.content": result.content || "",
        "form.descriptionEnabled": Boolean(result.content),
        "form.categoryCode": matchedCategory ? matchedCategory.value : "",
        "form.categoryLabel": matchedCategory ? matchedCategory.label : "选择场景",
        images: linkedImages,
      });
      wx.showToast({ title: "项目信息已同步", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "项目同步失败", icon: "none" });
    } finally {
      wx.hideLoading();
    }
  },

  chooseImages() {
    const remaining = MAX_IMAGES - this.data.images.length;
    if (remaining <= 0 || this.data.submitting) return;
    wx.chooseMedia({
      count: remaining,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      sizeType: ["original"],
      success: async ({ tempFiles }) => {
        wx.showLoading({ title: "正在压缩图片", mask: true });
        const prepared = [];
        for (const file of tempFiles || []) {
          const path = await compressImage(file.tempFilePath, file.size);
          prepared.push({
            id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            displayUrl: path,
            tempFilePath: path,
            name: `案例图片.${fileExtension(path)}`,
            sourceCode: "case_upload",
            local: true,
          });
        }
        wx.hideLoading();
        this.setData({ images: this.data.images.concat(prepared).slice(0, MAX_IMAGES) });
      },
    });
  },

  removeImage(event) {
    if (this.data.submitting) return;
    const id = event.currentTarget.dataset.id;
    this.setData({ images: this.data.images.filter(item => item.id !== id) });
  },

  previewImage(event) {
    const current = event.currentTarget.dataset.url;
    const urls = this.data.images.map(item => item.displayUrl).filter(Boolean);
    if (current && urls.length) wx.previewImage({ current, urls });
  },

  async uploadLocalImages(requestId) {
    const result = [];
    for (let index = 0; index < this.data.images.length; index += 1) {
      const image = this.data.images[index];
      if (!image.local) {
        result.push({ fileId: image.fileId, url: image.url, name: image.name, sourceCode: image.sourceCode });
        continue;
      }
      this.setData({ submitText: `上传图片 ${index + 1}/${this.data.images.length}` });
      const extension = fileExtension(image.tempFilePath);
      const safeTitle = this.data.form.title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 40) || "case";
      const date = todayText().replace(/-/g, "");
      const cloudPath = `project-cases/${date}/${safeTitle}/${requestId}_${index}.${extension}`;
      const upload = await uploadWithRetry({ cloudPath, filePath: image.tempFilePath });
      result.push({ fileId: upload.fileID, url: "", name: image.name, sourceCode: "case_upload" });
    }
    return result;
  },

  async submit() {
    if (this.data.submitting) return;
    const form = this.data.form;
    if (!form.title.trim()) return wx.showToast({ title: "请输入案例名称", icon: "none" });
    if (!form.caseDate) return wx.showToast({ title: "请选择交付日期", icon: "none" });
    if (!form.categoryCode) return wx.showToast({ title: "请选择项目场景", icon: "none" });
    if (form.amountEnabled && Number(form.amount) <= 0) return wx.showToast({ title: "请输入项目报价", icon: "none" });
    if (form.descriptionEnabled && !form.content.trim()) return wx.showToast({ title: "请输入案例自述", icon: "none" });
    if (!this.data.images.length) return wx.showToast({ title: "请至少上传一张图片", icon: "none" });

    const requestId = this.pendingRequestId || createRequestId();
    this.pendingRequestId = requestId;
    this.setData({ submitting: true, submitText: "准备上传" });
    try {
      const images = await this.uploadLocalImages(requestId);
      this.setData({ submitText: "正在创建案例" });
      const result = await api.createProjectCase({
        ...form,
        title: form.title.trim(),
        amount: Number(form.amount) || 0,
        summary: form.content.trim().slice(0, 180),
        content: form.content.trim(),
        images,
        clientRequestId: requestId,
      });
      caseCache.invalidateList();
      caseCache.invalidateDetail(result.id);
      this.pendingRequestId = "";
      wx.showToast({ title: "案例创建成功", icon: "success" });
      setTimeout(() => wx.redirectTo({ url: `/pages/project-case-detail/index?id=${result.id}` }), 500);
    } catch (error) {
      wx.showToast({ title: error.message || "案例创建失败", icon: "none" });
      this.setData({ submitting: false, submitText: "确认新增" });
    }
  },

  onUnload() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
  },
});
