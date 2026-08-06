const api = require("../../utils/api");

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
    landscapeTopInset: menuButton && menuButton.bottom ? menuButton.bottom + 6 : statusBarHeight + 50,
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
        if (item.fileID && item.tempFileURL) urlMap[item.fileID] = item.tempFileURL;
      });
    } catch (error) {
      console.warn("客户报价图纸地址获取失败:", error);
    }
  }
  return drawings.map((item, index) => ({
    ...item,
    kind: isPdf(item) ? "pdf" : "image",
    displayUrl: urlMap[item.fileId] || item.url || item.fileId || "",
    displayName: item.name || `项目设计示意图${index + 1}`,
  }));
}

Page({
  data: {
    ...getNavMetrics(),
    id: "",
    activeVersionId: "",
    shareToken: "",
    loading: true,
    quotation: null,
    drawings: [],
    fullTableVisible: false,
    showAllDrawings: false,
    versionPickerVisible: false,
    notices: [
      "本报价单自分享之日起，有效期为30天。",
      "报价包含清单所列材料、人工及相关项目服务费用。",
      "若设计方案或实施范围发生重大变更，需重新核算报价。",
      "具体付款节点与质保约定以双方最终签订的合同为准。",
    ],
  },

  onLoad(options = {}) {
    const id = String(options.id || "").trim();
    const activeVersionId = String(options.versionId || id).trim();
    const shareToken = String(options.token || "").trim();
    if (!id || !shareToken) {
      this.showUnavailable("客户报价链接不完整，请联系重新发送。");
      return;
    }
    this.setData({ id, activeVersionId, shareToken });
    this.loadDetail();
  },

  onShareAppMessage() {
    const quotation = this.data.quotation || {};
    return {
      title: quotation.projectName
        ? `项目报价｜${quotation.projectName}｜${quotation.version || "V1.0"}`
        : "项目报价",
      path: `/pages/project-quotation-client/index?id=${encodeURIComponent(this.data.id)}&token=${encodeURIComponent(this.data.shareToken)}&versionId=${encodeURIComponent(this.data.activeVersionId || this.data.id)}`,
      imageUrl: this.data.drawings.find(item => item.kind === "image")?.displayUrl || "",
    };
  },

  closePage() {
    wx.exitMiniProgram({
      fail: () => {
        const pages = getCurrentPages();
        if (pages.length > 1) wx.navigateBack({ delta: 1 });
      },
    });
  },

  showUnavailable(message) {
    this.setData({ loading: false });
    wx.showModal({
      title: "报价单已失效",
      content: message || "该报价单已失效，请联系重新发送。",
      showCancel: false,
      confirmText: "确认",
      confirmColor: "#00cfe8",
      success: () => this.closePage(),
    });
  },

  async loadDetail() {
    this.setData({ loading: true });
    try {
      const result = await api.getPublicProjectQuotation(
        this.data.id,
        this.data.shareToken,
        this.data.activeVersionId || this.data.id
      );
      const drawings = await resolveDrawings(result.drawings || []);
      const items = (result.items || []).map(item => {
        const rawTotal = item.totalAmount !== undefined && item.totalAmount !== null && item.totalAmount !== ""
          ? item.totalAmount
          : Number(item.unitPrice || 0) * Number(item.quantity || 0);
        return {
          ...item,
          totalAmount: rawTotal,
          totalText: money(rawTotal),
          unitText: `${item.quantity || 0} ${item.unit || ""}`.trim(),
        };
      });
      const visibleRowCount = Math.min(items.length, 5);
      const totalVal = result.totalAmount !== undefined && result.totalAmount !== null && result.totalAmount !== ""
        ? result.totalAmount
        : items.reduce((sum, item) => sum + Number(item.totalAmount || 0), 0);
      const amountStr = money(totalVal);
      const [amountInt, amountDec] = amountStr.split(".");
      const quotation = {
        ...result,
        totalAmount: totalVal,
        amountText: amountStr,
        amountInteger: amountInt || "0",
        amountDecimal: amountDec ? `.${amountDec}` : ".00",
        hasLongRemarks: items.some(item => String(item.remark || "").length > 12),
        items,
        tableViewportHeight: 180 + visibleRowCount * 78,
      };
      this.setData({
        quotation,
        drawings,
        activeVersionId: result.id || this.data.activeVersionId,
        loading: false,
        versionPickerVisible: false,
        showAllDrawings: false,
      });
    } catch (error) {
      this.showUnavailable(error.message);
    }
  },

  viewQuotationItems() {
    wx.pageScrollTo({ selector: "#client-quotation-table", duration: 260 });
  },

  openFullTable() {
    this.setData({ fullTableVisible: true });
  },

  closeFullTable() {
    this.setData({ fullTableVisible: false });
  },

  toggleAllDrawings() {
    this.setData({ showAllDrawings: !this.data.showAllDrawings });
  },

  openVersionSelector() {
    const versions = this.data.quotation && this.data.quotation.versions;
    if (!Array.isArray(versions) || versions.length <= 1) return;
    this.setData({ versionPickerVisible: true });
  },

  closeVersionSelector() {
    this.setData({ versionPickerVisible: false });
  },

  onVersionPopupChange(event) {
    if (!event.detail.visible) this.closeVersionSelector();
  },

  selectVersion(event) {
    const versionId = String(event.currentTarget.dataset.id || "").trim();
    if (!versionId || versionId === this.data.activeVersionId) {
      this.closeVersionSelector();
      return;
    }
    this.setData({ activeVersionId: versionId, versionPickerVisible: false });
    this.loadDetail();
  },

  previewDrawing(event) {
    const index = Number(event.currentTarget.dataset.index);
    const drawing = this.data.drawings[index];
    if (!drawing) return;
    if (drawing.kind === "image") {
      const urls = this.data.drawings.filter(item => item.kind === "image").map(item => item.displayUrl).filter(Boolean);
      if (drawing.displayUrl) wx.previewImage({ current: drawing.displayUrl, urls });
      return;
    }
    this.openPdf(drawing);
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
});
