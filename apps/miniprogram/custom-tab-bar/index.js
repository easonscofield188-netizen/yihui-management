Component({
  data: {
    selected: 0,
    color: "#5b5f61",
    selectedColor: "#adc7f7",
  },
  methods: {
    switchTab(event) {
      const { path, index } = event.currentTarget.dataset;
      if (index === this.data.selected) return;
      wx.switchTab({ url: path });
    },
    createProject() {
      wx.removeStorageSync("projectCreateDraft");
      wx.navigateTo({ url: "/pages/project-create/index" });
    },
  },
});
