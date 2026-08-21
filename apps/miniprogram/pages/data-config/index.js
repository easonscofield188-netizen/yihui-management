const api = require("../../utils/api");

const CONFIG_GROUPS = [
  { group: "CLIENT_SOURCE", name: "客户来源", description: "管理客户获客与流量渠道", icon: "root-list", tone: "green" },
  { group: "CLIENT_ROLE", name: "客户角色", description: "配置客户在项目中的身份", icon: "usergroup", tone: "blue" },
  { group: "COST_CATEGORY", name: "成本项目", description: "维护项目材料与劳务成本", icon: "money", tone: "orange" },
  { group: "EXPENSE_CATEGORY", name: "支出类目", description: "维护公司日常运营支出分类", icon: "wallet", tone: "orange" },
  { group: "PROJECT_SCENE", name: "项目场景", description: "维护项目基础场景选项", icon: "map", tone: "violet" },
  { group: "JOB_TITLE", name: "岗位名称", description: "配置企业岗位与职能头衔", icon: "user-avatar", tone: "teal" },
];

function getNavMetrics() {
  const systemInfo = wx.getSystemInfoSync();
  const statusBarHeight = systemInfo.statusBarHeight || 0;
  const menuButton = wx.getMenuButtonBoundingClientRect();
  const contentHeight = menuButton && menuButton.height ? menuButton.height + Math.max(0, menuButton.top - statusBarHeight) * 2 : 44;
  return { statusBarHeight, navHeight: statusBarHeight + contentHeight };
}

Page({
  data: { ...getNavMetrics(), groups: CONFIG_GROUPS, loading: false },

  async onLoad() {
    if (!(await this.authorize())) return;
    this.loadCounts();
  },

  async authorize() {
    if (!api.getToken()) {
      wx.showToast({ title: "请先登录", icon: "none" });
      setTimeout(() => this.goBack(), 300);
      return false;
    }
    let userInfo = api.getCachedUserInfo() || {};
    if (!userInfo.role || !api.isUserInfoCacheFresh()) {
      try {
        userInfo = await api.getUserInfo();
        api.cacheUserInfo(userInfo);
      } catch (error) {
        wx.showToast({ title: error.message || "身份校验失败", icon: "none" });
        setTimeout(() => this.goBack(), 300);
        return false;
      }
    }
    if (userInfo.role !== "ADMIN_SUPER") {
      wx.showToast({ title: "仅超级系统管理员可管理数据配置", icon: "none" });
      setTimeout(() => this.goBack(), 300);
      return false;
    }
    return true;
  },

  onShow() {
    if (this.loadedOnce) this.loadCounts();
  },

  onPullDownRefresh() {
    this.loadCounts().finally(() => wx.stopPullDownRefresh());
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack();
    else wx.navigateTo({ url: "/pages/admin-center/index" });
  },

  async loadCounts() {
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      const results = await Promise.all(CONFIG_GROUPS.map(item => api.queryConfigs(item.group, "all")));
      const groups = CONFIG_GROUPS.map((item, index) => {
        const list = Array.isArray(results[index]) ? results[index] : [];
        return {
          ...item,
          total: list.length,
          activeCount: list.filter(config => config.isActive !== false).length,
          preview: list.filter(config => config.isActive !== false).slice(0, 4).map(config => config.label).join("、"),
        };
      });
      this.loadedOnce = true;
      this.setData({ groups });
    } catch (error) {
      wx.showToast({ title: error.message || "数据配置加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  openGroup(event) {
    const group = String(event.currentTarget.dataset.group || "");
    if (group) wx.navigateTo({ url: `/pages/config-management/index?group=${encodeURIComponent(group)}` });
  },
});
