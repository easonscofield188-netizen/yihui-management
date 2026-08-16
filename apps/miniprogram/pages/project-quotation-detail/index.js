const api = require("../../utils/api");
const quotationExcel = require("../../utils/quotation-excel");

const DETAIL_REFRESH_KEY = "projectQuotationDetailRefreshV1";
const LIST_REFRESH_KEY = "projectQuotationListRefreshV1";

function getNavMetrics() {
  const systemInfo = wx.getSystemInfoSync();
  const statusBarHeight = systemInfo.statusBarHeight || 0;
  const menuButton = wx.getMenuButtonBoundingClientRect();
  const safeArea = systemInfo.safeArea || {};
  const contentHeight = menuButton && menuButton.height
    ? menuButton.height + Math.max(0, menuButton.top - statusBarHeight) * 2
    : 44;
  return {
    statusBarHeight,
    navHeight: statusBarHeight + contentHeight,
    navActionRight: menuButton && menuButton.left
      ? Math.max(96, systemInfo.windowWidth - menuButton.left + 8)
      : 96,
    landscapeTopInset: menuButton && menuButton.bottom
      ? menuButton.bottom + 6
      : statusBarHeight + 50,
    landscapeBottomInset: Math.max(
      18,
      Number(systemInfo.screenHeight || systemInfo.windowHeight || 0) - Number(safeArea.bottom || systemInfo.screenHeight || 0) + 12
    ),
  };
}

function money(value) {
  const num = Number(value);
  const val = !isNaN(num) ? num : 0;
  const parts = val.toFixed(2).split(".");
  const integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${integerPart}.${parts[1]}`;
}

function fileExtension(value) {
  return String(value || "").split("?")[0].match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase() || "";
}

const CHINESE_NUMS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
function formatVersionLabel(sequence, rawVersion) {
  const seq = Number(sequence);
  if (seq >= 1 && seq <= 10) return `版本${CHINESE_NUMS[seq]}`;
  if (rawVersion) {
    const match = String(rawVersion).match(/\d+/);
    if (match && CHINESE_NUMS[Number(match[0])]) {
      return `版本${CHINESE_NUMS[Number(match[0])]}`;
    }
  }
  return `版本${seq || 1}`;
}

function isPdf(item) {
  return String(item.fileType || fileExtension(item.name || item.url || item.fileId)).toLowerCase() === "pdf";
}

async function resolveDrawings(drawings) {
  const fileIds = drawings.map(item => item.fileId).filter(Boolean);
  const urlMap = {};
  if (fileIds.length) {
    try {
      const result = await wx.cloud.getTempFileURL({ fileList: fileIds });
      (result.fileList || []).forEach(item => {
        if (item.fileID && item.tempFileURL) {
          urlMap[item.fileID] = item.tempFileURL;
        } else if (item.status !== 0) {
          console.warn(`云存储文件获取临时链接失败 [${item.fileID}]: status=${item.status}, errMsg=${item.errMsg}`);
        }
      });
    } catch (error) {
      console.warn("报价图纸临时地址获取失败:", error);
    }
  }
  return drawings.map((item, index) => ({
    ...item,
    kind: isPdf(item) ? "pdf" : "image",
    displayUrl: urlMap[item.fileId] || item.url || item.fileId || "",
    displayName: item.name || `设计图纸${index + 1}`,
  }));
}

Page({
  data: {
    ...getNavMetrics(),
    id: "",
    loading: true,
    quotation: null,
    drawings: [],
    visibleDrawings: [],
    drawingsExpanded: false,
    fullTableVisible: false,
    shareImageUrl: "",
    clientShareToken: "",
    clientShareReady: false,
    versionPickerVisible: false,
    isSharedView: false,
  },

  onLoad(options = {}) {
    wx.hideShareMenu({ menus: ["shareAppMessage", "shareTimeline"] });
    const id = String(options.id || "").trim();
    if (!id) {
      wx.showToast({ title: "缺少报价单 ID", icon: "none" });
      return;
    }
    this.initialized = true;
    this.setData({ id, isSharedView: options.view === "shared" });
    this.loadDetail(id);
  },

  onShow() {
    if (!this.initialized) return;
    const marker = wx.getStorageSync(DETAIL_REFRESH_KEY) || null;
    if (!marker || !marker.id) return;
    wx.removeStorageSync(DETAIL_REFRESH_KEY);
    this.setData({ id: String(marker.id) });
    this.loadDetail(String(marker.id));
  },

  onShareAppMessage() {
    const quotation = this.data.quotation || {};
    const versionText = quotation.versionButtonText || quotation.versionLabel || "版本一";
    const payload = {
      title: quotation.projectName
        ? `项目报价｜${quotation.projectName}-报价清单｜${versionText}`
        : "项目报价",
      path: `/pages/project-quotation-client/index?id=${encodeURIComponent(this.data.id)}&token=${encodeURIComponent(this.data.clientShareToken)}&versionId=${encodeURIComponent(this.data.id)}`,
    };
    if (this.data.shareImageUrl) payload.imageUrl = this.data.shareImageUrl;
    return payload;
  },

  onShareTap() {
    if (this.data.clientShareReady) return;
    wx.showToast({ title: "客户分享链接准备中", icon: "none" });
  },

  goBack() {
    if (this.data.isSharedView) {
      wx.exitMiniProgram({
        fail: () => wx.redirectTo({ url: "/pages/project-quotations/index" }),
      });
      return;
    }
    const pages = getCurrentPages();
    const previous = pages[pages.length - 2];
    if (previous && previous.route === "pages/project-quotations/index") {
      wx.navigateBack({ delta: 1 });
      return;
    }
    wx.redirectTo({
      url: "/pages/project-quotations/index",
      fail: () => wx.reLaunch({ url: "/pages/project-quotations/index" }),
    });
  },

  async loadDetail(id) {
    wx.hideShareMenu({ menus: ["shareAppMessage", "shareTimeline"] });
    this.setData({
      loading: true,
      fullTableVisible: false,
      drawingsExpanded: false,
      clientShareToken: "",
      clientShareReady: false,
    });
    try {
      const result = await api.getProjectQuotation(id);
      const drawings = await resolveDrawings(result.drawings || []);
      const items = (result.items || []).map(item => {
        const rawTotal = item.totalAmount !== undefined && item.totalAmount !== null && item.totalAmount !== ""
          ? item.totalAmount
          : Number(item.unitPrice || 0) * Number(item.quantity || 0);
        return {
          ...item,
          quantityUnitText: `${item.quantity || 0} ${item.unit || ""}`.trim(),
          unitPriceText: money(item.unitPrice),
          totalAmount: rawTotal,
          totalText: money(rawTotal),
        };
      });
      const versions = (result.versions || []).map(version => ({ ...version }));
      const currentSequence = versions.length
        ? Math.max(...versions.map(item => item.versionSequence || 0))
        : Number(result.versionSequence || 1);
      const decoratedVersions = versions.map(version => {
        const vLabel = version.versionLabel || formatVersionLabel(version.versionSequence, version.version);
        const isCurrent = version.versionSequence === currentSequence;
        return {
          ...version,
          versionLabel: vLabel,
          versionDisplayLabel: `${vLabel}${isCurrent ? "（最新）" : ""}`,
          selected: version.id === id,
          current: isCurrent,
        };
      });
      const seq = Number(result.versionSequence || 1);
      const colorIndex = ((seq - 1) % 5) + 1;
      const currentVersionLabel = result.versionLabel || formatVersionLabel(result.versionSequence, result.version);
      const quotation = {
        ...result,
        items,
        versionSequence: seq,
        versionColorClass: `version-v${colorIndex}`,
        versionLabel: currentVersionLabel,
        versionButtonText: `${currentVersionLabel}${result.isCurrentVersion ? "（最新）" : ""}`,
        amountText: money(result.totalAmount),
        versions: decoratedVersions,
      };
      this.setData({
        quotation,
        drawings,
        visibleDrawings: drawings.slice(0, 2),
        drawingsExpanded: false,
        loading: false,
        shareImageUrl: "",
      });
      this.prepareShareImage(drawings);
      this.prepareClientShare(id);
    } catch (error) {
      this.setData({ loading: false });
      if (this.data.isSharedView && Number(error.code) === 404) {
        wx.showModal({
          title: "报价单已失效",
          content: "该报价单已失效，请联系重新发送。",
          showCancel: false,
          confirmText: "确认",
          confirmColor: "#173d6b",
          success: () => this.goBack(),
        });
        return;
      }
      wx.showToast({ title: error.message || "报价单加载失败", icon: "none" });
    }
  },

  async prepareClientShare(id) {
    try {
      const result = await api.prepareProjectQuotationShare(id);
      if (this.data.id !== id) return;
      this.setData({
        clientShareToken: String(result.shareToken || ""),
        clientShareReady: Boolean(result.shareToken),
      });
      if (result.shareToken) wx.showShareMenu({ menus: ["shareAppMessage"] });
    } catch (error) {
      if (this.data.id === id) this.setData({ clientShareReady: false });
    }
  },

  async prepareShareImage(drawings) {
    const image = drawings.find(item => item.kind === "image");
    if (!image) return;
    try {
      let localPath = "";
      if (image.fileId) {
        const result = await wx.cloud.downloadFile({ fileID: image.fileId });
        localPath = result.tempFilePath || "";
      }
      if (!localPath && image.displayUrl) {
        const result = await new Promise((resolve, reject) => wx.downloadFile({
          url: image.displayUrl,
          success: response => response.statusCode === 200 ? resolve(response) : reject(new Error("下载失败")),
          fail: reject,
        }));
        localPath = result.tempFilePath || "";
      }
      if (localPath) this.setData({ shareImageUrl: localPath });
    } catch (error) {
      // 分享无封面时仍可正常发送文字卡片。
    }
  },

  openVersionSelector() {
    if (!this.data.quotation || !Array.isArray(this.data.quotation.versions) || this.data.quotation.versions.length <= 1) return;
    this.setData({ versionPickerVisible: true });
  },

  closeVersionSelector() {
    this.setData({ versionPickerVisible: false });
  },

  onSelectVersionItem(event) {
    const id = String(event.currentTarget.dataset.id || "");
    this.closeVersionSelector();
    if (!id || id === this.data.id) return;
    this.setData({ id });
    this.loadDetail(id);
  },

  onVersionChange(event) {
    const id = String(event.detail.value || "");
    if (!id || id === this.data.id) return;
    this.setData({ id });
    this.loadDetail(id);
  },

  selectVersion(event) {
    const id = String(event.currentTarget.dataset.id || "");
    if (!id || id === this.data.id) {
      return;
    }
    this.setData({ id });
    this.loadDetail(id);
  },

  previewDrawing(event) {
    const index = Number(event.currentTarget.dataset.index);
    const drawing = this.data.drawings[index];
    if (!drawing) return;
    if (drawing.kind === "image") {
      const previewDrawings = this.data.drawingsExpanded ? this.data.drawings : this.data.visibleDrawings;
      const urls = previewDrawings.filter(item => item.kind === "image").map(item => item.displayUrl).filter(Boolean);
      if (drawing.displayUrl) wx.previewImage({ current: drawing.displayUrl, urls });
      return;
    }
    this.openPdf(drawing);
  },

  toggleDrawings() {
    if (this.data.drawings.length <= 2) return;
    const drawingsExpanded = !this.data.drawingsExpanded;
    this.setData({
      drawingsExpanded,
      visibleDrawings: drawingsExpanded ? this.data.drawings : this.data.drawings.slice(0, 2),
    });
  },

  async openPdf(drawing) {
    wx.showLoading({ title: "正在打开 PDF" });
    try {
      let filePath = "";
      if (drawing.fileId) {
        const result = await wx.cloud.downloadFile({ fileID: drawing.fileId });
        filePath = result.tempFilePath;
      } else if (drawing.displayUrl) {
        const result = await new Promise((resolve, reject) => wx.downloadFile({
          url: drawing.displayUrl,
          success: response => response.statusCode === 200 ? resolve(response) : reject(new Error("PDF 下载失败")),
          fail: reject,
        }));
        filePath = result.tempFilePath;
      }
      if (!filePath) throw new Error("PDF 文件地址无效");
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

  openFullTable() {
    this.setData({ fullTableVisible: true });
  },

  closeFullTable() {
    this.setData({ fullTableVisible: false });
  },

  preventBubble() {},

  /**
   * 生成表格文件并在微信中调起原生文档预览
   */
  async onExportSpreadsheet() {
    if (!this.data.quotation) return;
    wx.showLoading({ title: "正在生成表格文件...", mask: true });

    try {
      await quotationExcel.generateAndPreviewQuotationSpreadsheet(this.data.quotation);
    } catch (err) {
      wx.showModal({
        title: "生成表格失败",
        content: err.message || "无法生成表格文件，请重试",
        showCancel: false,
      });
    } finally {
      wx.hideLoading();
    }
  },

  editQuotation() {
    if (!this.data.quotation?.canManage || !this.data.quotation?.isCurrentVersion) return;
    wx.navigateTo({ url: `/pages/project-quotation-create/index?sourceId=${encodeURIComponent(this.data.id)}` });
  },
});
