Component({
  data: {
    selected: 0,
    color: "#5b5f61",
    selectedColor: "#002045",
  },
  methods: {
    switchTab(event) {
      const { path, index } = event.currentTarget.dataset;
      if (index === this.data.selected) return;
      wx.switchTab({ url: path });
    },
    createProject() {
      wx.showToast({ title: "请在电脑端管理后台新建项目", icon: "none" });
    },
  },
});
