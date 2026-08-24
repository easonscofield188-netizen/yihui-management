const api = require("../utils/api");

Component({
  data: {
    selected: 0,
    color: "#748582",
    selectedColor: "#2E9F8B",
    menuVisible: false,
    flowerLedgerExists: false,
    flowerLedgerLoading: false,
  },
  lifetimes: {
    attached() {
      this.refreshFlowerLedgerState();
    },
  },
  pageLifetimes: {
    show() {
      this.refreshFlowerLedgerState();
    },
  },
  methods: {
    async refreshFlowerLedgerState() {
      if (!api.getToken()) return;
      try {
        // 同时在前端按 type 复核：云函数尚未更新时可能会忽略 projectType 参数。
        const result = await api.listProjects({ page: 1, pageSize: 50, projectType: "flower_plant" });
        const list = Array.isArray(result) ? result : ((result && result.list) || []);
        this.setData({ flowerLedgerExists: list.some((item) => item && item.type === "flower_plant") });
      } catch (error) {
        // 查询失败时保留入口，避免网络短暂异常阻断管理员创建账本。
        this.setData({ flowerLedgerExists: false });
      }
    },
    switchTab(event) {
      const { path, index } = event.currentTarget.dataset;
      if (index === this.data.selected) return;
      this.setData({ menuVisible: false });
      wx.switchTab({ url: path });
    },
    openCreateMenu() {
      this.setData({ menuVisible: !this.data.menuVisible });
    },
    closeCreateMenu() {
      this.setData({ menuVisible: false });
    },
    navigateToCreateProject() {
      this.setData({ menuVisible: false });
      wx.removeStorageSync("projectCreateDraft");
      wx.navigateTo({ url: "/pages/project-create/index" });
    },
    navigateToCreateExpense() {
      this.setData({ menuVisible: false });
      wx.navigateTo({ url: "/pages/expense-create/index" });
    },
    createFlowerPlantLedger() {
      if (this.data.flowerLedgerExists || this.data.flowerLedgerLoading) return;
      wx.showModal({
        title: "生成鲜花绿植供应账本",
        content: "将创建唯一的“鲜花绿植供应账本”，客户信息在每条业务记录中单独绑定。",
        confirmText: "立即生成",
        confirmColor: "#2E9F8B",
        success: async (result) => {
          if (!result.confirm) return;
          this.setData({ flowerLedgerLoading: true });
          wx.showLoading({ title: "正在生成账本...", mask: true });
          try {
            const ledger = await api.createProject({
              type: "flower_plant",
              name: "鲜花绿植供应账本",
            });
            const id = ledger && (ledger.id || ledger._id);
            this.setData({ flowerLedgerExists: true, menuVisible: false });
            wx.showToast({ title: ledger && ledger.existed ? "账本已存在" : "账本已生成", icon: "success" });
            if (id) wx.navigateTo({ url: `/pages/project-detail/index?id=${id}` });
          } catch (error) {
            wx.showToast({ title: error.message || "生成失败", icon: "none" });
          } finally {
            wx.hideLoading();
            this.setData({ flowerLedgerLoading: false });
          }
        },
      });
    },
    noop() {},
  },
});

