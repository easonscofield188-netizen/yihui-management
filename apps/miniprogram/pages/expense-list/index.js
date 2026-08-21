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

function formatMonth(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function formatDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function buildMonthGroups(list) {
  const groups = [];
  list.forEach(item => {
    const month = String(item.expenseMonth || item.expenseDate || '').slice(0, 7) || '未知月份';
    let group = groups.find(candidate => candidate.month === month);
    if (!group) {
      group = {
        month,
        label: /^\d{4}-\d{2}$/.test(month) ? `${month.slice(0, 4)}年${Number(month.slice(5, 7))}月` : month,
        items: []
      };
      groups.push(group);
    }
    group.items.push(item);
  });
  return groups;
}

const TYPE_OPTIONS = [
  { label: '全部类型', value: '' },
  { label: '固定分摊', value: 'recurring' },
  { label: '一次性支出', value: 'one_time' }
];

Page({
  data: {
    ...getNavMetrics(),
    currentMonth: formatMonth(new Date()),
    selectedMonth: formatMonth(new Date()),
    selectedCategory: '',
    selectedCategoryLabel: '全部类目',
    selectedType: '',
    selectedTypeLabel: '全部类型',
    
    categoryOptions: [],
    typeOptions: TYPE_OPTIONS,
    
    // 数据列表
    list: [],
    monthGroups: [],
    showMonthGroup: false,
    page: 1,
    pageSize: 20,
    hasMore: true,
    loading: false,
    refreshing: false,
    
    // 汇总指标
    summary: {
      totalAmountText: '0.00',
      recurringAmountText: '0.00',
      oneTimeAmountText: '0.00'
    },
    
    // 权限
    isAdmin: false,
    
    // Pickers
    monthPickerVisible: false,
    categoryPickerVisible: false,
    categoryPickerValue: [''],
    typePickerVisible: false,
    typePickerValue: [''],
  },

  onLoad() {
    const userInfo = api.getCachedUserInfo() || {};
    if (userInfo.role === 'VISITOR') {
      wx.showModal({
        title: '访问受限',
        content: '访客账号无公司支出数据访问权限',
        showCancel: false,
        confirmText: '返回',
        success: () => this.goBack()
      });
      return;
    }
    this.checkAdminRole();
    this.loadCategories();
    this.loadList(true);
  },

  onShow() {
    // 重新回到页面时刷新列表，以同步可能的新增数据
    if (this.loadedOnce) {
      this.loadList(true, true);
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
      wx.switchTab({ url: '/pages/index/index' });
    }
  },

  goToCreate() {
    wx.navigateTo({ url: '/pages/expense-create/index' });
  },

  goToRecurringManagement() {
    wx.navigateTo({ url: '/pages/expense-recurring/index' });
  },

  goToAnalysis() {
    wx.navigateTo({ url: '/pages/expense-analysis/index' });
  },

  async loadCategories() {
    let options = [{ label: '全部类目', value: '' }];

    try {
      const config = await api.getGlobalConfig();
      const list = config && Array.isArray(config.EXPENSE_CATEGORY) ? config.EXPENSE_CATEGORY : [];
      list.forEach(item => {
        options.push({ label: item.label || item.value, value: item.value });
      });
    } catch (e) {
      wx.showToast({ title: '支出类目加载失败', icon: 'none' });
    }

    this.setData({ categoryOptions: options });
  },

  async loadList(reset = false, silent = false) {
    if (this.data.loading) return;
    const page = reset ? 1 : this.data.page;

    if (!silent) {
      this.setData({ loading: true });
    }

    try {
      const res = await api.listExpenses({
        month: this.data.selectedMonth,
        category: this.data.selectedCategory,
        expenseType: this.data.selectedType,
        page,
        pageSize: this.data.pageSize
      });

      const rawList = (res && res.list) || [];
      const summary = (res && res.summary) || {};

      const formattedList = rawList.map(item => ({
        ...item,
        amountText: formatMoney(item.amount),
        isRecurring: item.expenseType === 'recurring',
        isPlanned: String(item.expenseDate || '') > formatDate(new Date()),
        typeLabel: item.expenseType === 'recurring' ? '固定分摊' : '一次性',
      }));

      this.setData({
        list: reset ? formattedList : this.data.list.concat(formattedList),
        monthGroups: buildMonthGroups(reset ? formattedList : this.data.list.concat(formattedList)),
        showMonthGroup: !this.data.selectedMonth,
        page: page + 1,
        hasMore: Boolean(res && res.hasMore),
        summary: {
          totalAmountText: formatMoney(summary.totalAmount),
          recurringAmountText: formatMoney(summary.recurringAmount),
          oneTimeAmountText: formatMoney(summary.oneTimeAmount)
        }
      });
      this.loadedOnce = true;
    } catch (error) {
      wx.showToast({ title: error.message || '加载支出记录失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  onPullDownRefresh() {
    this.loadList(true).finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) {
      this.loadList(false);
    }
  },

  // 筛选月份
  openMonthPicker() {
    wx.showActionSheet({
      itemList: ['查看全部账单', '选择具体月份'],
      success: result => {
        if (result.tapIndex === 0) this.clearMonthFilter();
        else this.setData({ monthPickerVisible: true });
      }
    });
  },

  closeMonthPicker() {
    this.setData({ monthPickerVisible: false });
  },

  onMonthConfirm(event) {
    const monthVal = String(event.detail.value || '').slice(0, 7);
    this.setData({
      selectedMonth: monthVal,
      monthPickerVisible: false
    }, () => {
      this.loadList(true);
    });
  },

  clearMonthFilter() {
    this.setData({
      selectedMonth: '',
      monthPickerVisible: false
    }, () => {
      this.loadList(true);
    });
  },

  // 筛选类目
  openCategoryPicker() {
    this.setData({
      categoryPickerVisible: true,
      categoryPickerValue: [this.data.selectedCategory]
    });
  },

  closeCategoryPicker() {
    this.setData({ categoryPickerVisible: false });
  },

  onCategoryConfirm(event) {
    const rawVal = event && event.detail ? event.detail.value : null;
    const selectedValue = Array.isArray(rawVal) ? rawVal[0] : rawVal;
    const option = this.data.categoryOptions.find(item => item.value === selectedValue);
    if (option) {
      this.setData({
        selectedCategory: option.value,
        selectedCategoryLabel: option.label,
        categoryPickerValue: [option.value],
        categoryPickerVisible: false
      }, () => {
        this.loadList(true);
      });
    } else {
      this.setData({ categoryPickerVisible: false });
    }
  },

  // 筛选类型
  openTypePicker() {
    this.setData({
      typePickerVisible: true,
      typePickerValue: [this.data.selectedType]
    });
  },

  closeTypePicker() {
    this.setData({ typePickerVisible: false });
  },

  onTypeConfirm(event) {
    const rawVal = event && event.detail ? event.detail.value : null;
    const selectedValue = Array.isArray(rawVal) ? rawVal[0] : rawVal;
    const option = this.data.typeOptions.find(item => item.value === selectedValue);
    if (option) {
      this.setData({
        selectedType: option.value,
        selectedTypeLabel: option.label,
        typePickerValue: [option.value],
        typePickerVisible: false
      }, () => {
        this.loadList(true);
      });
    } else {
      this.setData({ typePickerVisible: false });
    }
  },

  // 删除单条支出记录
  onDeleteExpense(event) {
    if (!this.data.isAdmin) return;
    const { id, label, amount } = event.currentTarget.dataset;
    if (!id) return;

    wx.showModal({
      title: '删除支出记录',
      content: `确定删除该条支出吗？（${label || '支出'} ¥${amount}）`,
      confirmText: '删除',
      confirmColor: '#ba1a1a',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '正在删除...' });
          try {
            await api.deleteExpense(id);
            wx.hideLoading();
            wx.showToast({ title: '已删除', icon: 'success' });
            this.loadList(true);
          } catch (error) {
            wx.hideLoading();
            wx.showToast({ title: error.message || '删除失败', icon: 'none' });
          }
        }
      }
    });
  }
});
