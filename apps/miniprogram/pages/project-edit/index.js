const api = require("../../utils/api");
const { getPdfDisplayName, openPdfFile } = require("../../utils/file-preview");
const { buildVoucherCloudPath } = require("../../utils/voucher-path");
const { isSettled, YES_NO } = require("../../utils/dictionary");

const FALLBACK_SCENES = [
  { label: "内部项目", value: "internal" },
  { label: "外部工程", value: "external" },
];
const FALLBACK_CATEGORIES = [{ label: "物流", value: "logistics" }];
const FIXED_SUPPLIER = "第三方商户";
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const UPLOAD_TIMEOUT_MS = 45000;
const SAVE_VOUCHER_TIMEOUT_MS = 20000;

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

function toCents(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100);
}

function cleanMoney(value) {
  const source = String(value == null ? "" : value).replace(/[^\d.]/g, "");
  if (!source) return "";
  const firstDot = source.indexOf(".");
  const whole = (firstDot === -1 ? source : source.slice(0, firstDot)).replace(/^0+(?=\d)/, "") || "0";
  if (firstDot === -1) return whole;
  return `${whole}.${source.slice(firstDot + 1).replace(/\./g, "").slice(0, 2)}`;
}

function dateOnly(value) {
  if (!value) return "";
  const raw = value.$date || value;
  const matched = String(raw).match(/^\d{4}-\d{2}-\d{2}/);
  return matched ? matched[0] : "";
}

function normalizeDateOnly(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  const matched = String(raw || "").match(/^\d{4}-\d{2}-\d{2}/);
  if (matched) return matched[0];
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getToday() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isSettledCost(value) {
  return isSettled(value);
}

function resolveCostCategory(config, item) {
  const value = item.categoryCode || item.category || "";
  const options = config && Array.isArray(config.COST_CATEGORY) ? config.COST_CATEGORY : [];
  const matched = options.find((option) => option.value === value || option.code === value);
  const label = item.categoryLabel
    || (matched && (matched.label || matched.name))
    || item.category
    || value
    || "其他成本";
  const code = item.categoryCode
    || (matched && (matched.value || matched.code))
    || value;
  return { code, label };
}

function fileExtension(path) {
  const match = String(path || "").match(/\.([a-zA-Z0-9]+)$/);
  return match ? match[1].toLowerCase() : "jpg";
}

function isImageFile(file) {
  return file.fileType === "image" || /\.(jpg|jpeg|png|webp)$/i.test(file.tempFilePath || file.path || "");
}

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

Page({
  data: {
    statusBarHeight: 0,
    navHeight: 88,
    windowHeight: 667,
    keyboardHeight: 0,
    costScrollTarget: "",
    formKeyboardPadding: 0,
    moneyFocusAnchor: "",
    isFullySettled: false,
    editScrollTop: 0,
    loading: true,
    saving: false,
    loadingMessage: "正在加载项目...",
    projectId: "",
    isClosedEdit: false,
    form: {
      name: "",
      scene: "",
      startDate: "",
      amount: "",
      receivedAmount: "",
      status: "completed",
      client: "",
      clientId: "",
      role: "",
      clientSource: "",
      staffCount: 1,
      desc: "无",
    },
    sceneOptions: FALLBACK_SCENES,
    sceneLabel: "",
    scenePickerVisible: false,
    scenePickerValue: [],
    datePickerVisible: false,
    today: getToday(),
    costs: [],
    orderCostText: "0.00",
    profitText: "0.00",
    profitRateText: "0%",
    vouchers: [],
    pendingUploads: [],
    deletedVoucherIds: [],
    addCostVisible: false,
    costCategories: FALLBACK_CATEGORIES,
    categoryIndex: 0,
    categoryPickerVisible: false,
    categoryPickerValue: [FALLBACK_CATEGORIES[0].value],
    costForm: {
      categoryCode: FALLBACK_CATEGORIES[0].value,
      supplier: FIXED_SUPPLIER,
      amount: "",
      isSettled: true,
    },
  },

  onLoad(options) {
    wx.setNavigationBarColor({ frontColor: "#000000", backgroundColor: "#f9f9ff" });
    const projectId = String((options && options.id) || "").trim();
    const systemInfo = wx.getSystemInfoSync();
    this.setData({
      ...getNavMetrics(),
      projectId,
      windowHeight: systemInfo.windowHeight || systemInfo.screenHeight || 667,
    });
    this.bindKeyboardListener();
    if (!projectId) {
      wx.showToast({ title: "缺少项目 ID", icon: "none" });
      setTimeout(() => wx.navigateBack({ fail: () => wx.switchTab({ url: "/pages/index/index" }) }), 800);
      return;
    }
    this.bootstrap(projectId);
  },

  onUnload() {
    if (this._moneyBlurTimer) {
      clearTimeout(this._moneyBlurTimer);
      this._moneyBlurTimer = null;
    }
    this.unbindKeyboardListener();
  },

  bindKeyboardListener() {
    this.keyboardHandler = (res) => {
      const keyboardHeight = Math.max(0, Number(res.height) || 0);
      if (this.data.addCostVisible) {
        this.setData({
          keyboardHeight,
          costScrollTarget: keyboardHeight > 0 ? "cost-amount-anchor" : "",
          formKeyboardPadding: 0,
        });
        return;
      }

      // 两个金额输入框交接焦点时，部分真机会短暂上报高度 0。
      // 忽略这次过渡事件，避免清除底部避让后触发滚动并关闭新键盘。
      if (
        keyboardHeight === 0
        && this.data.moneyFocusAnchor
        && Date.now() < (this._moneyFocusSwitchingUntil || 0)
      ) {
        return;
      }

      const formKeyboardPadding = this.data.moneyFocusAnchor && keyboardHeight > 0
        ? keyboardHeight
        : 0;
      this.setData({
        keyboardHeight: 0,
        formKeyboardPadding,
      }, () => {
        if (formKeyboardPadding && this.data.moneyFocusAnchor) {
          this.ensureMoneyFieldVisible(this.data.moneyFocusAnchor, formKeyboardPadding);
        }
      });
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

  onEditScroll(event) {
    this._editScrollTop = (event.detail && event.detail.scrollTop) || 0;
    // 程序化避让滚动不收起键盘；用户手势滑动才收起，避免原生 input 叠字
    if (this._programmaticScroll) return;
    // 点击另一个金额输入框时也可能产生轻微滚动，不能在焦点交接阶段关闭键盘。
    if (Date.now() < (this._moneyFocusSwitchingUntil || 0)) return;
    if (this.data.moneyFocusAnchor && !this._moneyScrollBlurring) {
      this._moneyScrollBlurring = true;
      if (this._moneyBlurTimer) {
        clearTimeout(this._moneyBlurTimer);
        this._moneyBlurTimer = null;
      }
      wx.hideKeyboard({
        complete: () => {
          this._moneyScrollBlurring = false;
          this.setData({
            moneyFocusAnchor: "",
            formKeyboardPadding: 0,
          });
        },
      });
    }
  },

  ensureMoneyFieldVisible(anchorId, keyboardHeight) {
    if (!anchorId || !keyboardHeight) return;
    const windowHeight = this.data.windowHeight || 667;
    wx.createSelectorQuery()
      .select(`#${anchorId}`)
      .boundingClientRect()
      .exec((rects) => {
        const fieldRect = rects && rects[0];
        if (!fieldRect) return;

        const safeGap = 20;
        const visibleBottom = windowHeight - keyboardHeight - safeGap;
        if (fieldRect.bottom <= visibleBottom) return;

        const delta = fieldRect.bottom - visibleBottom;
        const nextTop = Math.max(0, (this._editScrollTop || 0) + delta);
        this._programmaticScroll = true;
        this.setData(
          { editScrollTop: nextTop === this.data.editScrollTop ? nextTop + 0.5 : nextTop },
          () => {
            setTimeout(() => {
              this._programmaticScroll = false;
            }, 320);
          }
        );
      });
  },

  async bootstrap(projectId) {
    this.setData({ loading: true, loadingMessage: "正在加载项目..." });
    try {
      const [project, config, vouchers] = await Promise.all([
        api.getProject(projectId),
        api.getGlobalConfig().catch(() => ({})),
        api.getVouchers(projectId).catch(() => []),
      ]);
      this.config = config || {};
      this.originalProject = project || {};
      this.applyProject(project, config, vouchers);
    } catch (error) {
      wx.showToast({ title: error.message || "项目加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  applyProject(project, config, vouchers) {
    const scenes = (config.PROJECT_SCENE && config.PROJECT_SCENE.length)
      ? config.PROJECT_SCENE.map((item) => ({
        label: item.label || item.name || item.value,
        value: item.value || item.code,
      }))
      : FALLBACK_SCENES;
    const categories = (config.COST_CATEGORY && config.COST_CATEGORY.length)
      ? config.COST_CATEGORY.map((item) => ({
        label: item.label || item.name || item.value,
        value: item.value || item.code,
      }))
      : FALLBACK_CATEGORIES;
    const scene = project.scene || "";
    const sceneMatched = scenes.find((item) => item.value === scene);
    const costs = (project.costs || []).map((item, index) => {
      const category = resolveCostCategory(config, item);
      return {
        id: item.id || item._id || `cost-${index}`,
        persistedId: item.id || item._id || "",
        category: category.label,
        categoryCode: category.code,
        categoryLabel: category.label,
        supplier: item.supplier || FIXED_SUPPLIER,
        amount: Number(item.amount) || 0,
        amountText: money(item.amount),
        isSettled: isSettledCost(item.isSettled),
      };
    });
    const voucherList = (Array.isArray(vouchers) ? vouchers : []).map((item, index) => {
      const name = item.fileName || "凭证";
      return {
        id: item._id || item.id || item.fileId || `voucher-${index}`,
        fileId: item.fileId,
        tempFilePath: item.fileUrl || "",
        name,
        pdfDisplayName: getPdfDisplayName(name),
        size: Number(item.fileSize) || 0,
        isImage: !/\.pdf$/i.test(name) && item.mimeType !== "application/pdf",
        isExisting: true,
      };
    });
    const projectAmount = Number(project.amount) || 0;
    const projectReceivedAmount = Number(project.receivedAmount) || 0;
    const isFullySettled = projectAmount > 0 && toCents(projectAmount) === toCents(projectReceivedAmount);
    this.setData({
      isClosedEdit: ["closed", "archived"].includes(project.status),
      isFullySettled,
      sceneOptions: scenes,
      sceneLabel: (sceneMatched && sceneMatched.label) || scene || "",
      scenePickerValue: scene ? [scene] : (scenes[0] ? [scenes[0].value] : []),
      costCategories: categories,
      categoryIndex: 0,
      categoryPickerValue: [categories[0].value],
      costForm: {
        categoryCode: categories[0].value,
        supplier: FIXED_SUPPLIER,
        amount: "",
        isSettled: true,
      },
      form: {
        name: project.name || "",
        scene,
        startDate: dateOnly(project.startDate || project.completionTime || (project.period && project.period[0])),
        amount: String(projectAmount),
        receivedAmount: String(projectReceivedAmount),
        status: project.status || "completed",
        client: project.client || "",
        clientId: project.clientId || "",
        role: project.role || "",
        clientSource: project.clientSource || project.source || "",
        staffCount: Number(project.staffCount) || 1,
        desc: project.desc || "无",
      },
      costs,
      vouchers: voucherList,
      pendingUploads: [],
      deletedVoucherIds: [],
    }, () => {
      this.refreshProfit();
      this.resolveVoucherUrls(voucherList);
    });
  },

  async resolveVoucherUrls(list) {
    const fileIds = list.map((item) => item.fileId).filter(Boolean);
    if (!fileIds.length) return;
    try {
      const result = await wx.cloud.getTempFileURL({ fileList: fileIds });
      const urlMap = {};
      (result.fileList || []).forEach((item) => {
        urlMap[item.fileID] = item.tempFileURL;
      });
      const vouchers = this.data.vouchers.map((item) => ({
        ...item,
        tempFilePath: urlMap[item.fileId] || item.tempFilePath,
      }));
      this.setData({ vouchers });
    } catch (error) {
      // keep original urls
    }
  },

  refreshProfit() {
    const amountCents = toCents(this.data.form.amount);
    const costCents = (this.data.costs || []).reduce((sum, item) => sum + toCents(item.amount), 0);
    const profitCents = amountCents - costCents;
    const rate = amountCents > 0 ? (profitCents / amountCents) * 100 : 0;
    this.setData({
      orderCostText: money(costCents / 100),
      profitText: money(profitCents / 100),
      profitRateText: `${Math.round(rate)}%`,
    });
  },

  onFieldChange(event) {
    const field = event.currentTarget.dataset.field;
    const value = event.detail.value;
    this.setData({ [`form.${field}`]: value });
  },

  activateMoneyField(event) {
    const field = event.currentTarget.dataset.field;
    const moneyFocusAnchor = event.currentTarget.dataset.anchor || "";
    if (this.data.saving) return;
    if (this.data.isClosedEdit && field === "amount") return;
    if (this.data.isFullySettled && field === "receivedAmount") return;
    if (this.data.moneyFocusAnchor === moneyFocusAnchor) return;
    if (this._moneyBlurTimer) {
      clearTimeout(this._moneyBlurTimer);
      this._moneyBlurTimer = null;
    }
    this._moneyFocusSwitchingUntil = Date.now() + 500;
    // 直接切换焦点，避免先清空再聚焦导致键盘闪断
    this.setData({ moneyFocusAnchor });
  },

  onMoneyFocus(event) {
    if (this._moneyBlurTimer) {
      clearTimeout(this._moneyBlurTimer);
      this._moneyBlurTimer = null;
    }
    this._moneyFocusSwitchingUntil = Date.now() + 500;
    const moneyFocusAnchor = event.currentTarget.dataset.anchor || "";
    if (this.data.moneyFocusAnchor !== moneyFocusAnchor) {
      this.setData({ moneyFocusAnchor });
    }
  },

  onMoneyBlur(event) {
    if (this._moneyScrollBlurring) return;
    const blurredAnchor = event.currentTarget.dataset.anchor || "";
    if (this._moneyBlurTimer) {
      clearTimeout(this._moneyBlurTimer);
      this._moneyBlurTimer = null;
    }
    this._moneyBlurTimer = setTimeout(() => {
      this._moneyBlurTimer = null;
      if (this._moneyScrollBlurring) return;
      // 已切到另一个金额框时，保留新焦点，不要把键盘关掉
      if (this.data.moneyFocusAnchor && this.data.moneyFocusAnchor !== blurredAnchor) return;
      this.setData({
        moneyFocusAnchor: "",
        formKeyboardPadding: 0,
      });
    }, 220);
  },

  onMoneyInput(event) {
    const field = event.currentTarget.dataset.field;
    if (this.data.isClosedEdit && field === "amount") return;
    if (this.data.isFullySettled && field === "receivedAmount") return;
    const value = cleanMoney(event.detail.value);
    const patch = { [`form.${field}`]: value };

    const nextAmount = field === "amount" ? value : this.data.form.amount;
    const nextReceivedAmount = field === "receivedAmount" ? value : this.data.form.receivedAmount;
    const amountsEqual = toCents(nextAmount) > 0
      && toCents(nextAmount) === toCents(nextReceivedAmount);

    if (amountsEqual) {
      patch.isFullySettled = true;
      patch.moneyFocusAnchor = "";
      patch.formKeyboardPadding = 0;
    } else {
      patch.isFullySettled = false;
    }
    this.setData(patch, () => {
      if (amountsEqual) wx.hideKeyboard();
      this.refreshProfit();
    });
  },

  onFullySettledChange(event) {
    const isFullySettled = Boolean(event.detail && event.detail.value);
    if (!isFullySettled) {
      this.setData({ isFullySettled: false });
      return;
    }

    const amount = cleanMoney(this.data.form.amount);
    if (toCents(amount) <= 0) {
      this.setData({ isFullySettled: false });
      wx.showToast({ title: "请先填写订单总额", icon: "none" });
      return;
    }

    if (this._moneyBlurTimer) {
      clearTimeout(this._moneyBlurTimer);
      this._moneyBlurTimer = null;
    }
    wx.hideKeyboard();
    this.setData({
      isFullySettled: true,
      "form.receivedAmount": amount,
      moneyFocusAnchor: "",
      formKeyboardPadding: 0,
    }, () => this.refreshProfit());
  },

  openScenePicker() {
    if (this.data.isClosedEdit || this.data.saving) return;
    this.setData({
      scenePickerVisible: true,
      scenePickerValue: [this.data.form.scene || (this.data.sceneOptions[0] && this.data.sceneOptions[0].value)],
    });
  },

  closeScenePicker() {
    this.setData({ scenePickerVisible: false });
  },

  onSceneConfirm(event) {
    const raw = event.detail && event.detail.value;
    const value = Array.isArray(raw) ? raw[0] : raw;
    const matched = this.data.sceneOptions.find((item) => item.value === value);
    this.setData({
      scenePickerVisible: false,
      "form.scene": value || "",
      sceneLabel: (matched && matched.label) || value || "",
      scenePickerValue: value ? [value] : [],
    });
  },

  async loadServerDate() {
    try {
      const result = await api.getServerDate();
      const serverToday = normalizeDateOnly(result && result.date);
      if (serverToday) {
        this.setData({ today: serverToday });
        return serverToday;
      }
    } catch (error) {
      // fallback to local today
    }
    return this.data.today || getToday();
  },

  async openDatePicker() {
    if (this.data.saving) return;
    const serverToday = await this.loadServerDate();
    this.setData({
      today: serverToday,
      "form.startDate": normalizeDateOnly(this.data.form.startDate) || serverToday,
      datePickerVisible: true,
    });
  },

  closeDatePicker() {
    this.setData({ datePickerVisible: false });
  },

  onDateConfirm(event) {
    this.setData({
      "form.startDate": normalizeDateOnly(event.detail.value),
      datePickerVisible: false,
    });
  },

  openAddCost() {
    if (this.data.saving) return;
    const categories = this.data.costCategories;
    this.setData({
      addCostVisible: true,
      categoryIndex: 0,
      categoryPickerValue: [categories[0].value],
      costForm: {
        categoryCode: categories[0].value,
        supplier: FIXED_SUPPLIER,
        amount: "",
        isSettled: true,
      },
    });
  },

  closeAddCost() {
    this.setData({
      addCostVisible: false,
      categoryPickerVisible: false,
      keyboardHeight: 0,
      costScrollTarget: "",
    });
  },

  onAddCostVisibleChange(event) {
    if (event && event.detail && event.detail.visible === false) {
      this.closeAddCost();
    }
  },

  onCostAmountFocus() {
    this.setData({ costScrollTarget: "cost-amount-anchor" });
  },

  onCostAmountBlur() {
    setTimeout(() => {
      this.setData({ keyboardHeight: 0, costScrollTarget: "" });
    }, 180);
  },

  openCategoryPicker() {
    this.setData({
      categoryPickerVisible: true,
      categoryPickerValue: [this.data.costForm.categoryCode || this.data.costCategories[0].value],
    });
  },

  closeCategoryPicker() {
    this.setData({ categoryPickerVisible: false });
  },

  onCategoryConfirm(event) {
    const raw = event.detail && event.detail.value;
    const value = Array.isArray(raw) ? raw[0] : raw;
    const index = Math.max(0, this.data.costCategories.findIndex((item) => item.value === value));
    this.setData({
      categoryPickerVisible: false,
      categoryIndex: index,
      categoryPickerValue: [this.data.costCategories[index].value],
      "costForm.categoryCode": this.data.costCategories[index].value,
    });
  },

  onCostFormChange(event) {
    this.setData({ "costForm.amount": cleanMoney(event.detail.value) });
  },

  onSettledChange(event) {
    this.setData({ "costForm.isSettled": Boolean(event.detail.value) });
  },

  saveCost() {
    const amount = Number(this.data.costForm.amount);
    if (!amount || amount <= 0) {
      wx.showToast({ title: "请输入有效成本金额", icon: "none" });
      return;
    }
    const category = this.data.costCategories[this.data.categoryIndex] || this.data.costCategories[0];
    const item = {
      id: `cost-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      persistedId: "",
      category: category.label,
      categoryCode: category.value,
      categoryLabel: category.label,
      supplier: FIXED_SUPPLIER,
      amount,
      amountText: money(amount),
      isSettled: Boolean(this.data.costForm.isSettled),
    };
    this.setData({
      costs: this.data.costs.concat(item),
      addCostVisible: false,
    }, () => this.refreshProfit());
  },

  removeCost(event) {
    const id = event.currentTarget.dataset.id;
    wx.showModal({
      title: "移除成本",
      content: "确定移除该成本明细吗？",
      success: ({ confirm }) => {
        if (!confirm) return;
        this.setData({
          costs: this.data.costs.filter((item) => item.id !== id),
        }, () => this.refreshProfit());
      },
    });
  },

  chooseVoucher() {
    if (this.data.saving) return;
    const remaining = 9 - this.data.vouchers.length;
    if (remaining <= 0) {
      wx.showToast({ title: "最多上传 9 个附件", icon: "none" });
      return;
    }
    wx.showActionSheet({
      itemList: ["选择图片", "选择 PDF 文件"],
      success: ({ tapIndex }) => {
        if (tapIndex === 0) {
          wx.chooseMedia({
            count: remaining,
            mediaType: ["image"],
            sourceType: ["album", "camera"],
            sizeType: ["compressed"],
            success: ({ tempFiles }) => this.appendVouchers(tempFiles || []),
          });
        } else {
          wx.chooseMessageFile({
            count: remaining,
            type: "file",
            extension: ["pdf"],
            success: ({ tempFiles }) => this.appendVouchers(tempFiles || []),
          });
        }
      },
    });
  },

  appendVouchers(files) {
    const accepted = files
      .filter((file) => Number(file.size || 0) <= MAX_FILE_SIZE)
      .map((file) => {
        const tempFilePath = file.tempFilePath || file.path;
        const name = file.name || `凭证.${fileExtension(tempFilePath)}`;
        return {
          id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          tempFilePath,
          name,
          pdfDisplayName: getPdfDisplayName(name),
          size: Number(file.size) || 0,
          isImage: isImageFile(file),
          isExisting: false,
        };
      });
    if (accepted.length < files.length) wx.showToast({ title: "已忽略超过 10MB 的文件", icon: "none" });
    if (!accepted.length) return;
    this.setData({
      vouchers: this.data.vouchers.concat(accepted).slice(0, 9),
      pendingUploads: this.data.pendingUploads.concat(accepted),
    });
  },

  async previewVoucher(event) {
    const id = event.currentTarget.dataset.id;
    const target = this.data.vouchers.find((item) => item.id === id);
    if (!target) return;

    if (target.isImage) {
      const current = target.tempFilePath;
      const images = this.data.vouchers
        .filter((item) => item.isImage && item.tempFilePath)
        .map((item) => item.tempFilePath);
      if (current && images.includes(current)) {
        wx.previewImage({ current, urls: images });
      }
      return;
    }

    wx.showLoading({ title: "打开中...", mask: true });
    try {
      await openPdfFile({
        filePath: target.tempFilePath,
        fileId: target.fileId,
        fileUrl: target.tempFilePath,
      });
    } catch (error) {
      wx.showToast({ title: (error && error.message) || "无法打开 PDF", icon: "none" });
    } finally {
      wx.hideLoading();
    }
  },

  removeVoucher(event) {
    const { id, existing, fileId } = event.currentTarget.dataset;
    wx.showModal({
      title: "删除凭证",
      content: "确定删除该凭证吗？",
      success: ({ confirm }) => {
        if (!confirm) return;
        const target = this.data.vouchers.find((item) => item.id === id);
        const vouchers = this.data.vouchers.filter((item) => item.id !== id);
        const pendingUploads = this.data.pendingUploads.filter((item) => item.id !== id);
        const deletedVoucherIds = existing && target
          ? this.data.deletedVoucherIds.concat({
            id: target.id,
            fileId: target.fileId || fileId || "",
          })
          : this.data.deletedVoucherIds;
        this.setData({ vouchers, pendingUploads, deletedVoucherIds });
      },
    });
  },

  discard() {
    if (this.data.saving) return;
    wx.showModal({
      title: "放弃修改",
      content: "未保存的修改将丢失，确定离开吗？",
      success: ({ confirm }) => {
        if (!confirm) return;
        wx.navigateBack({ fail: () => wx.switchTab({ url: "/pages/index/index" }) });
      },
    });
  },

  async uploadOneVoucher(projectId, file) {
    const extension = fileExtension(file.tempFilePath);
    const existingCount = (this.data.vouchers || []).filter((item) => item.isExisting).length;
    const pendingIndex = (this.data.pendingUploads || []).findIndex((item) => item.id === file.id);
    const seqIndex = existingCount + (pendingIndex >= 0 ? pendingIndex : 0) + 1;
    const seqStr = String(seqIndex).padStart(2, "0");
    const extDot = extension.startsWith(".") ? extension : `.${extension}`;
    const formattedFileName = `成本凭证_${seqStr}${extDot}`;
    const cloudPath = buildVoucherCloudPath(this.data.form.name, extension).cloudPath;
    let fileId = "";
    const uploadResult = await withTimeout(
      wx.cloud.uploadFile({ cloudPath, filePath: file.tempFilePath }),
      UPLOAD_TIMEOUT_MS,
      `${formattedFileName} 上传超时`
    );
    fileId = uploadResult.fileID;
    const urlResult = await withTimeout(
      wx.cloud.getTempFileURL({ fileList: [fileId] }),
      SAVE_VOUCHER_TIMEOUT_MS,
      `${formattedFileName} 获取地址超时`
    );
    const fileUrl = urlResult.fileList[0] && urlResult.fileList[0].tempFileURL;
    if (!fileUrl) throw new Error(`${formattedFileName} 获取访问地址失败`);
    await withTimeout(
      api.addVoucher({
        projectId,
        fileName: formattedFileName,
        fileId,
        fileUrl,
        fileSize: file.size,
        mimeType: file.isImage ? `image/${extension === "jpg" ? "jpeg" : extension}` : "application/pdf",
        clientUploadId: file.id,
        uploadSeq: seqIndex,
      }),
      SAVE_VOUCHER_TIMEOUT_MS,
      `${formattedFileName} 保存记录超时`
    );
  },

  async save() {
    if (this.data.saving || this.data.loading) return;
    const form = this.data.form;
    const name = String(form.name || "").trim();
    const amount = Number(form.amount);
    const receivedAmount = Number(form.receivedAmount) || 0;
    if (!name) {
      wx.showToast({ title: "请填写项目名称", icon: "none" });
      return;
    }
    const startDate = normalizeDateOnly(form.startDate);
    if (!startDate) {
      wx.showToast({ title: "请选择交付日期", icon: "none" });
      return;
    }
    if (!amount || amount <= 0) {
      wx.showToast({ title: "请填写有效订单总额", icon: "none" });
      return;
    }
    if (receivedAmount < 0 || receivedAmount > amount) {
      wx.showToast({ title: "已收金额不能超过订单总额", icon: "none" });
      return;
    }

    this.setData({ saving: true, loadingMessage: "正在保存修改..." });
    try {
      const costs = this.data.costs.map((item) => ({
        id: item.persistedId || "",
        category: item.category,
        categoryCode: item.categoryCode || "",
        categoryLabel: item.categoryLabel || item.category,
        supplier: item.supplier || FIXED_SUPPLIER,
        amount: Number(item.amount) || 0,
        isSettled: Boolean(item.isSettled),
      }));
      const payload = {
        id: this.data.projectId,
        name,
        startDate,
        receivedAmount,
        desc: form.desc || "无",
        costs,
        isHasVoucher: this.data.vouchers.length > 0 ? YES_NO.YES : YES_NO.NO,
      };
      if (!this.data.isClosedEdit) {
        payload.scene = form.scene || "";
        payload.client = form.client || "";
        payload.clientId = form.clientId || "";
        payload.role = form.role || "";
        payload.clientSource = form.clientSource || "";
        payload.staffCount = Number(form.staffCount) || 1;
        payload.amount = amount;
      }

      await api.updateProject(payload);

      for (const item of this.data.deletedVoucherIds) {
        try {
          await api.deleteVoucher({
            id: item.id,
            fileId: item.fileId,
            projectId: this.data.projectId,
          });
        } catch (error) {
          // continue deleting others
        }
      }

      for (const file of this.data.pendingUploads) {
        await this.uploadOneVoucher(this.data.projectId, file);
      }

      wx.showToast({ title: "保存成功", icon: "success" });
      setTimeout(() => {
        wx.navigateBack({ fail: () => wx.reLaunch({ url: `/pages/project-detail/index?id=${this.data.projectId}` }) });
      }, 600);
    } catch (error) {
      wx.showToast({ title: error.message || "保存失败", icon: "none" });
    } finally {
      this.setData({ saving: false });
    }
  },

  stopPropagation() {},
});
