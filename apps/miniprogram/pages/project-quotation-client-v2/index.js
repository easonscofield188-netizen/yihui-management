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

function getVersionColorClass(versionLabel = "") {
  const str = String(versionLabel).toLowerCase();
  if (str.includes("v1") || str.includes("一")) return "version-v1";
  if (str.includes("v2") || str.includes("二")) return "version-v2";
  if (str.includes("v3") || str.includes("三")) return "version-v3";
  if (str.includes("v4") || str.includes("四")) return "version-v4";
  if (str.includes("v5") || str.includes("五")) return "version-v5";
  return "version-v1";
}

async function resolveDrawingImages(drawings = []) {
  const validDrawings = drawings.filter(item => {
    const name = String(item.name || item.url || item.fileId || "").toLowerCase();
    return !name.endsWith(".pdf");
  });

  const fileIds = validDrawings.map(item => item.fileId).filter(Boolean);
  const urlMap = {};
  if (fileIds.length) {
    try {
      const result = await wx.cloud.getTempFileURL({ fileList: fileIds });
      (result.fileList || []).forEach(item => {
        if (item.fileID && item.tempFileURL) urlMap[item.fileID] = item.tempFileURL;
      });
    } catch (error) {
      console.warn("解析设计图纸网络地址失败:", error);
    }
  }

  return validDrawings.map((item, index) => ({
    ...item,
    displayUrl: urlMap[item.fileId] || item.url || item.fileId || "",
    displayName: item.name || `设计效果图 ${index + 1}`,
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
    visibleDrawings: [],
    drawingsExpanded: false,
    fullTableVisible: false,
    notices: [
      "本报价单自分享之日起，有效期为 30 天。",
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
      this.showUnavailable("客户报价链接不完整或已失效，请联系客服重新发送。");
      return;
    }

    this.setData({ id, activeVersionId, shareToken });
    this.loadDetail();
  },

  onShareAppMessage() {
    const quotation = this.data.quotation || {};
    return {
      title: quotation.projectName
        ? `项目报价｜${quotation.projectName}-报价清单｜${quotation.versionBadgeText || quotation.versionLabel || "版本一"}`
        : "项目报价详情",
      path: `/pages/project-quotation-client-v2/index?id=${encodeURIComponent(this.data.id)}&token=${encodeURIComponent(this.data.shareToken)}&versionId=${encodeURIComponent(this.data.activeVersionId || this.data.id)}`,
      imageUrl: this.data.drawings[0]?.displayUrl || "",
    };
  },

  closePage() {
    wx.exitMiniProgram({
      fail: () => {
        const pages = getCurrentPages();
        if (pages.length > 1) {
          wx.navigateBack({ delta: 1 });
        }
      },
    });
  },

  showUnavailable(message) {
    this.setData({ loading: false });
    wx.showModal({
      title: "报价单已失效",
      content: message || "该报价单已失效，请联系客服重新发送。",
      showCancel: false,
      confirmText: "确认",
      confirmColor: "#2E9F8B",
      success: () => this.closePage(),
    });
  },

  async loadDetail() {
    this.setData({ loading: true });
    wx.showLoading({ title: "正在加载报价详情...", mask: true });

    try {
      const result = await api.getPublicProjectQuotation(
        this.data.id,
        this.data.shareToken,
        this.data.activeVersionId || this.data.id
      );

      const drawings = await resolveDrawingImages(result.drawings || []);
      const items = (result.items || []).map(item => {
        const rawTotal = item.totalAmount !== undefined && item.totalAmount !== null && item.totalAmount !== ""
          ? item.totalAmount
          : Number(item.unitPrice || 0) * Number(item.quantity || 0);
        return {
          ...item,
          totalAmount: rawTotal,
          totalText: money(rawTotal),
          unitPriceText: money(item.unitPrice || 0),
          quantityUnitText: `${item.quantity || 0} ${item.unit || "项"}`.trim(),
        };
      });

      const totalVal = result.totalAmount !== undefined && result.totalAmount !== null && result.totalAmount !== ""
        ? result.totalAmount
        : items.reduce((sum, item) => sum + Number(item.totalAmount || 0), 0);

      const amountStr = money(totalVal);
      const [amountInt, amountDec] = amountStr.split(".");
      const versionLabel = result.versionDisplayLabel || result.versionLabel || result.version || "版本一";
      const versions = Array.isArray(result.versions) ? result.versions : [];
      const maxSequence = versions.length
        ? Math.max(...versions.map(v => Number(v.versionSequence || 0)))
        : Number(result.versionSequence || 1);
      const isLatest = Number(result.versionSequence || 1) >= maxSequence || Boolean(result.isCurrentVersion);
      const cleanLabel = versionLabel.replace(/（最新）|\(最新\)|（最近）|\(最近\)/g, "").trim();
      const versionBadgeText = isLatest ? `${cleanLabel}（最新）` : cleanLabel;

      const quotation = {
        ...result,
        totalAmount: totalVal,
        amountText: amountStr,
        amountInteger: amountInt || "0",
        amountDecimal: amountDec ? `.${amountDec}` : ".00",
        versionLabel: cleanLabel,
        versionBadgeText,
        versionColorClass: getVersionColorClass(cleanLabel),
        items,
      };

      const visibleDrawings = this.data.drawingsExpanded ? drawings : drawings.slice(0, 2);

      this.setData({
        quotation,
        drawings,
        visibleDrawings,
        activeVersionId: result.id || this.data.activeVersionId,
        loading: false,
      });
    } catch (error) {
      this.showUnavailable(error.message);
    } finally {
      wx.hideLoading();
      this.setData({ loading: false });
    }
  },

  toggleDrawings() {
    const nextState = !this.data.drawingsExpanded;
    this.setData({
      drawingsExpanded: nextState,
      visibleDrawings: nextState ? this.data.drawings : this.data.drawings.slice(0, 2),
    });
  },

  previewDrawing(event) {
    const index = Number(event.currentTarget.dataset.index);
    const targetDrawing = this.data.visibleDrawings[index] || this.data.drawings[index];
    if (!targetDrawing || !targetDrawing.displayUrl) return;

    const urls = this.data.drawings.map(d => d.displayUrl).filter(Boolean);
    wx.previewImage({
      current: targetDrawing.displayUrl,
      urls,
    });
  },

  openFullTable() {
    this.setData({ fullTableVisible: true });
  },

  closeFullTable() {
    this.setData({ fullTableVisible: false });
  },

  preventBubble() {},
});
