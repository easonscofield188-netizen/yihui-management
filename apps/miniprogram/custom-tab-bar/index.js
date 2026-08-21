Component({
  data: {
    selected: 0,
    color: "#5b5f61",
    selectedColor: "#adc7f7",
    menuVisible: false,
  },
  methods: {
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
    noop() {},
  },
});

