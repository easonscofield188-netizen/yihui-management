const api = require('../../utils/api');

function getNavMetrics() {
  const systemInfo = wx.getSystemInfoSync();
  const statusBarHeight = systemInfo.statusBarHeight || 0;
  const menuButton = wx.getMenuButtonBoundingClientRect();
  const contentHeight = menuButton && menuButton.height
    ? menuButton.height + Math.max(0, menuButton.top - statusBarHeight) * 2
    : 44;
  return { statusBarHeight, navHeight: statusBarHeight + contentHeight };
}

function formatMoney(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount)
    ? amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '0.00';
}

Page({
  data: {
    ...getNavMetrics(),
    rules: [],
    loading: false,
    isAdmin: false,
    
    // 统计
    activeCount: 0,
    totalMonthlyAmount: '0.00',
    
    // 编辑弹窗
    editPopupVisible: false,
    editingRule: null,
    editAmount: '',
    editRemark: '',
    saving: false,
  },

  onLoad() {
    this.checkAdminRole();
    this.loadRules();
  },

  onShow() {
    if (this.loadedOnce) {
      this.loadRules(true);
    }
  },

  checkAdminRole() {
    const userInfo = api.getCachedUserInfo() || {};
    const isAdmin = ['ADMIN_SUPER', 'ADMIN_COM', 'ADMIN'].includes(userInfo.role);
    this.setData({ isAdmin });
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
    } else {
      wx.redirectTo({ url: '/pages/expense-list/index' });
    }
  },

  goToCreate() {
    wx.navigateTo({ url: '/pages/expense-create/index' });
  },

  async loadRules(silent = false) {
    if (!silent) {
      this.setData({ loading: true });
    }

    try {
      const res = await api.listRecurringExpenseRules({});
      const rawList = (res && res.list) || [];

      let activeCount = 0;
      let monthlyTotal = 0;

      const formattedRules = rawList.map(rule => {
        const isActive = rule.status === 'active';
        if (isActive) {
          activeCount += 1;
          monthlyTotal += Number(rule.amountPerMonth) || 0;
        }

        let statusText = '进行中';
        let statusTone = 'active';
        if (rule.status === 'stopped') {
          statusText = '已停用';
          statusTone = 'stopped';
        } else if (rule.status === 'completed') {
          statusText = '已结束';
          statusTone = 'completed';
        }

        const progressPercent = rule.totalMonths > 0
          ? Math.min(100, Math.round((rule.passedMonths / rule.totalMonths) * 100))
          : 0;

        return {
          ...rule,
          amountText: formatMoney(rule.amountPerMonth),
          totalAmountText: formatMoney(rule.totalAmount),
          statusText,
          statusTone,
          isActive,
          progressPercent
        };
      });

      this.setData({
        rules: formattedRules,
        activeCount,
        totalMonthlyAmount: formatMoney(monthlyTotal)
      });
      this.loadedOnce = true;
    } catch (error) {
      wx.showToast({ title: error.message || '加载固定支出失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  onPullDownRefresh() {
    this.loadRules().finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  // 打开编辑弹窗
  openEditModal(event) {
    if (!this.data.isAdmin) return;
    const rule = event.currentTarget.dataset.rule;
    if (!rule) return;

    this.setData({
      editingRule: rule,
      editAmount: String(rule.amountPerMonth || ''),
      editRemark: String(rule.remark || ''),
      editPopupVisible: true
    });
  },

  closeEditModal() {
    this.setData({ editPopupVisible: false, editingRule: null });
  },

  onEditAmountInput(event) {
    this.setData({ editAmount: event.detail.value || '' });
  },

  onEditRemarkInput(event) {
    this.setData({ editRemark: event.detail.value || '' });
  },

  async onSaveEdit() {
    if (!this.data.editingRule || this.data.saving) return;

    const numAmount = Number(this.data.editAmount);
    if (!numAmount || numAmount <= 0) {
      wx.showToast({ title: '请输入有效的每月金额', icon: 'none' });
      return;
    }

    this.setData({ saving: true });

    try {
      await api.updateRecurringExpenseRule({
        id: this.data.editingRule._id,
        amountPerMonth: numAmount,
        remark: this.data.editRemark.trim()
      });

      wx.showToast({ title: '规则已更新', icon: 'success' });
      this.closeEditModal();
      this.loadRules(true);
    } catch (error) {
      wx.showToast({ title: error.message || '更新失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  // 停用规则
  onStopRule(event) {
    if (!this.data.isAdmin) return;
    const rule = event.currentTarget.dataset.rule;
    if (!rule || !rule._id) return;

    wx.showModal({
      title: '停用固定支出规则',
      content: `确定停用【${rule.categoryLabel}】规则吗？停用后已发生的月份记录保留，未来月份的分摊记录将被自动移除。`,
      confirmText: '确认停用',
      confirmColor: '#ba1a1a',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '正在停用...' });
          try {
            await api.stopRecurringExpenseRule(rule._id);
            wx.hideLoading();
            wx.showToast({ title: '已停用', icon: 'success' });
            this.loadRules(true);
          } catch (error) {
            wx.hideLoading();
            wx.showToast({ title: error.message || '停用失败', icon: 'none' });
          }
        }
      }
    });
  },

  // 删除规则
  onDeleteRule(event) {
    if (!this.data.isAdmin) return;
    const rule = event.currentTarget.dataset.rule;
    if (!rule || !rule._id) return;

    wx.showModal({
      title: '删除固定支出规则',
      content: `确定删除【${rule.categoryLabel}】规则吗？删除后该规则关联的所有月份分摊记录将一并删除，且不可恢复。`,
      confirmText: '确认删除',
      confirmColor: '#ba1a1a',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '正在删除...' });
          try {
            await api.deleteRecurringExpenseRule(rule._id);
            wx.hideLoading();
            wx.showToast({ title: '已删除', icon: 'success' });
            this.loadRules(true);
          } catch (error) {
            wx.hideLoading();
            wx.showToast({ title: error.message || '删除失败', icon: 'none' });
          }
        }
      }
    });
  }
});
