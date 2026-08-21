const api = require('../../utils/api');
const { EXPENSE_TYPE } = require('../../utils/dictionary');
const RECENT_EXPENSE_TEMPLATE_KEY = 'recentExpenseTemplates';
const AUTO_COMMON_USAGE_THRESHOLD = 3;

function getNavMetrics() {
  const systemInfo = wx.getSystemInfoSync();
  const statusBarHeight = systemInfo.statusBarHeight || 0;
  const menuButton = wx.getMenuButtonBoundingClientRect();
  const contentHeight = menuButton && menuButton.height
    ? menuButton.height + Math.max(0, menuButton.top - statusBarHeight) * 2
    : 44;
  return { statusBarHeight, navHeight: statusBarHeight + contentHeight };
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatMonth(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function calculateMonthsDiff(startMonth, endMonth) {
  if (!startMonth || !endMonth) return 0;
  const [sYear, sM] = startMonth.split('-').map(Number);
  const [eYear, eM] = endMonth.split('-').map(Number);
  const diff = (eYear - sYear) * 12 + (eM - sM) + 1;
  return Math.max(0, diff);
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

Page({
  data: {
    ...getNavMetrics(),
    expenseType: EXPENSE_TYPE.ONE_TIME, // 'one_time' | 'recurring'
    allCategoryOptions: [],
    categoryOptions: [],
    quickCategoryOptions: [],
    recentTemplates: [],
    selectedCategoryIndex: -1,
    selectedCategoryCode: '',
    selectedCategoryLabel: '',
    amount: '',
    expenseDate: formatDate(new Date()),
    startMonth: formatMonth(new Date()),
    endMonth: '',
    isLongTerm: true,
    recurringMonthsCount: 0,
    recurringTotalAmount: '0.00',
    remark: '',
    submitting: false,
    checkingDuplicate: false,
    isAdmin: false,
    queuedExpenses: [],
    queuedTotalAmount: '0.00',
    
    // Pickers
    categoryPickerVisible: false,
    categoryPickerValue: [],
    datePickerVisible: false,
    startMonthPickerVisible: false,
    endMonthPickerVisible: false,
  },

  onLoad() {
    const userInfo = api.getCachedUserInfo() || {};
    this.setData({ isAdmin: ['ADMIN_SUPER', 'ADMIN_COM', 'ADMIN'].includes(userInfo.role) });
    this.loadRecentTemplates();
    this.loadCategories();
    this.updateRecurringSummary();
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
    } else {
      wx.switchTab({ url: '/pages/index/index' });
    }
  },

  async loadCategories() {
    try {
      const config = await api.getGlobalConfig();
      const list = config && Array.isArray(config.EXPENSE_CATEGORY) ? config.EXPENSE_CATEGORY : [];
      const options = list.map(item => ({
        label: item.label || item.value,
        value: item.value,
        expenseScope: item.expenseScope === EXPENSE_TYPE.RECURRING ? EXPENSE_TYPE.RECURRING : EXPENSE_TYPE.ONE_TIME,
        isCommon: item.isCommon === true,
        usageCount: Number(item.usageCount) || 0,
        sortOrder: Number(item.sortOrder) || 0,
      }));
      this.setData({ allCategoryOptions: options }, () => this.updateCategoryOptions(this.data.expenseType));
    } catch (e) {
      this.setData({ allCategoryOptions: [], categoryOptions: [], quickCategoryOptions: [] });
      wx.showToast({ title: '支出类目加载失败，请稍后重试', icon: 'none' });
    }
  },

  updateCategoryOptions(type) {
    const options = this.data.allCategoryOptions.filter(item => item.expenseScope === type);
    const selected = options.find(item => item.value === this.data.selectedCategoryCode) || options[0];
    const quickCategoryOptions = options
      .filter(item => item.isCommon || item.usageCount >= AUTO_COMMON_USAGE_THRESHOLD)
      .sort((left, right) => Number(right.isCommon) - Number(left.isCommon)
        || right.usageCount - left.usageCount
        || left.sortOrder - right.sortOrder)
      .slice(0, 8);
    this.setData({
      categoryOptions: options,
      quickCategoryOptions: type === EXPENSE_TYPE.ONE_TIME ? quickCategoryOptions : [],
      selectedCategoryIndex: selected ? options.findIndex(item => item.value === selected.value) : -1,
      selectedCategoryCode: selected ? selected.value : '',
      selectedCategoryLabel: selected ? selected.label : '',
      categoryPickerValue: selected ? [selected.value] : [],
    });
  },

  loadRecentTemplates() {
    try {
      const templates = wx.getStorageSync(RECENT_EXPENSE_TEMPLATE_KEY);
      this.setData({
        recentTemplates: Array.isArray(templates) ? templates.slice(0, 6) : []
      });
    } catch (error) {
      this.setData({ recentTemplates: [] });
    }
  },

  selectQuickCategory(event) {
    const code = event.currentTarget.dataset.code;
    const option = this.data.categoryOptions.find(item => item.value === code);
    if (!option) return;
    this.setData({
      selectedCategoryIndex: this.data.categoryOptions.findIndex(item => item.value === code),
      selectedCategoryCode: option.value,
      selectedCategoryLabel: option.label,
      categoryPickerValue: [option.value],
    });
  },

  applyRecentTemplate(event) {
    const id = event.currentTarget.dataset.id;
    const template = this.data.recentTemplates.find(item => item.id === id);
    if (!template) return;
    const option = this.data.categoryOptions.find(item => item.value === template.category);
    this.setData({
      expenseType: EXPENSE_TYPE.ONE_TIME,
      selectedCategoryIndex: option ? this.data.categoryOptions.findIndex(item => item.value === option.value) : this.data.selectedCategoryIndex,
      selectedCategoryCode: option ? option.value : template.category,
      selectedCategoryLabel: option ? option.label : template.categoryLabel,
      categoryPickerValue: [option ? option.value : template.category],
      amount: String(template.amount),
      remark: template.remark || '',
    });
  },

  saveRecentTemplates(items) {
    const newTemplates = items
      .filter(item => item.expenseType === EXPENSE_TYPE.ONE_TIME)
      .map(item => ({
        id: `${item.category}_${item.amount}_${item.remark || ''}`,
        category: item.category,
        categoryLabel: item.categoryLabel,
        amount: item.amount,
        amountText: formatMoney(item.amount),
        remark: item.remark || '',
      }));
    if (!newTemplates.length) return;
    const templates = [...newTemplates, ...this.data.recentTemplates]
      .filter((item, index, array) => array.findIndex(candidate => candidate.id === item.id) === index)
      .slice(0, 6);
    try {
      wx.setStorageSync(RECENT_EXPENSE_TEMPLATE_KEY, templates);
    } catch (error) {
      // 本地缓存不可用不影响记账结果。
    }
    this.setData({ recentTemplates: templates });
  },

  onTypeChange(event) {
    const type = event.currentTarget.dataset.type;
    if (type === this.data.expenseType) return;
    if (type === EXPENSE_TYPE.RECURRING && !this.data.isAdmin) {
      wx.showToast({ title: '仅管理员可设置固定支出规则', icon: 'none' });
      return;
    }
    this.setData({ expenseType: type }, () => {
      this.updateCategoryOptions(type);
      this.updateRecurringSummary();
    });
  },

  onAmountInput(event) {
    let val = String(event.detail.value || '').trim();
    // 限制数字和两位小数
    val = val.replace(/[^\d.]/g, '');
    const parts = val.split('.');
    if (parts.length > 2) {
      val = parts[0] + '.' + parts.slice(1).join('');
    }
    if (parts[1] && parts[1].length > 2) {
      val = parts[0] + '.' + parts[1].slice(0, 2);
    }
    this.setData({ amount: val }, () => {
      this.updateRecurringSummary();
    });
  },

  updateRecurringSummary() {
    if (this.data.expenseType !== EXPENSE_TYPE.RECURRING) return;
    if (this.data.isLongTerm) {
      this.setData({ recurringMonthsCount: 0, recurringTotalAmount: '长期按月发生' });
      return;
    }
    const months = calculateMonthsDiff(this.data.startMonth, this.data.endMonth);
    const amt = Number(this.data.amount) || 0;
    const total = (amt * months).toFixed(2);
    this.setData({
      recurringMonthsCount: months,
      recurringTotalAmount: total
    });
  },

  openCategoryPicker() {
    this.setData({
      categoryPickerVisible: true,
      categoryPickerValue: [this.data.selectedCategoryCode]
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
        selectedCategoryIndex: Math.max(0, this.data.categoryOptions.findIndex(item => item.value === selectedValue)),
        selectedCategoryCode: option.value,
        selectedCategoryLabel: option.label,
        categoryPickerValue: [option.value],
        categoryPickerVisible: false,
      });
    } else {
      this.setData({ categoryPickerVisible: false });
    }
  },

  openDatePicker() {
    this.setData({ datePickerVisible: true });
  },

  closeDatePicker() {
    this.setData({ datePickerVisible: false });
  },

  onDateConfirm(event) {
    const dateVal = String(event.detail.value || '').slice(0, 10);
    this.setData({
      expenseDate: dateVal,
      datePickerVisible: false
    });
  },

  openStartMonthPicker() {
    this.setData({ startMonthPickerVisible: true });
  },

  closeStartMonthPicker() {
    this.setData({ startMonthPickerVisible: false });
  },

  onStartMonthConfirm(event) {
    const monthVal = String(event.detail.value || '').slice(0, 7);
    this.setData({
      startMonth: monthVal,
      startMonthPickerVisible: false
    }, () => {
      if (!this.data.isLongTerm && this.data.startMonth > this.data.endMonth) {
        this.setData({ endMonth: this.data.startMonth });
      }
      this.updateRecurringSummary();
    });
  },

  openEndMonthPicker() {
    if (this.data.isLongTerm) return;
    this.setData({ endMonthPickerVisible: true });
  },

  toggleRecurringDuration() {
    const isLongTerm = !this.data.isLongTerm;
    const endMonth = isLongTerm ? '' : (this.data.endMonth || `${new Date().getFullYear()}-12`);
    this.setData({ isLongTerm, endMonth }, () => this.updateRecurringSummary());
  },

  closeEndMonthPicker() {
    this.setData({ endMonthPickerVisible: false });
  },

  onEndMonthConfirm(event) {
    const monthVal = String(event.detail.value || '').slice(0, 7);
    if (monthVal < this.data.startMonth) {
      wx.showToast({ title: '结束月份不能早于开始月份', icon: 'none' });
      return;
    }
    this.setData({
      endMonth: monthVal,
      isLongTerm: false,
      endMonthPickerVisible: false
    }, () => {
      this.updateRecurringSummary();
    });
  },

  onRemarkInput(event) {
    this.setData({ remark: event.detail.value || '' });
  },

  async onSubmit() {
    if (this.data.submitting || this.data.checkingDuplicate) return;

    const {
      expenseType,
      selectedCategoryCode,
      selectedCategoryLabel,
      amount,
      expenseDate,
      startMonth,
      endMonth,
      isLongTerm,
      remark
    } = this.data;

    if (!selectedCategoryCode) {
      wx.showToast({ title: '请选择支出类目', icon: 'none' });
      return;
    }

    const numAmount = Number(amount);
    if (!numAmount || numAmount <= 0) {
      wx.showToast({ title: '请输入有效的支出金额', icon: 'none' });
      return;
    }
    if (expenseType === EXPENSE_TYPE.RECURRING && !this.data.isAdmin) {
      wx.showToast({ title: '仅管理员可设置固定支出规则', icon: 'none' });
      return;
    }
    if (expenseType === EXPENSE_TYPE.RECURRING && !isLongTerm && (!endMonth || endMonth < startMonth)) {
      wx.showToast({ title: '请设置有效的结束月份', icon: 'none' });
      return;
    }
    if (this.data.queuedExpenses.length >= 50) {
      wx.showToast({ title: '单次最多添加 50 条，请先提交当前列表', icon: 'none' });
      return;
    }

    const queuedExpense = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      expenseType,
      category: selectedCategoryCode,
      categoryLabel: selectedCategoryLabel,
      amount: Number(numAmount.toFixed(2)),
      amountText: formatMoney(numAmount),
      expenseDate,
      startMonth,
      endMonth: isLongTerm ? '' : endMonth,
      isLongTerm,
      remark: remark.trim(),
      typeLabel: expenseType === EXPENSE_TYPE.RECURRING ? '固定分摊' : '一次性支出',
      periodLabel: expenseType === EXPENSE_TYPE.RECURRING
        ? (isLongTerm ? `${startMonth} 起长期有效` : `${startMonth} 至 ${endMonth}`)
        : expenseDate,
    };

    let duplicate = null;
    const localDuplicate = expenseType === EXPENSE_TYPE.ONE_TIME
      ? this.data.queuedExpenses.find(item => (
        item.expenseType === EXPENSE_TYPE.ONE_TIME
        && item.category === selectedCategoryCode
        && item.expenseDate === expenseDate
      ))
      : null;
    if (expenseType === EXPENSE_TYPE.ONE_TIME) {
      this.setData({ checkingDuplicate: true });
      try {
        duplicate = await api.checkDuplicateExpense({ category: selectedCategoryCode, expenseDate });
      } catch (error) {
        // 校验服务不可用时仍允许正常添加，避免阻塞日常记账。
      } finally {
        this.setData({ checkingDuplicate: false });
      }
    }

    const hasRemoteDuplicate = Boolean(duplicate && duplicate.exists && duplicate.expenseId);
    if (localDuplicate || hasRemoteDuplicate) {
      const existingAmount = hasRemoteDuplicate
        ? Number(duplicate.amount) + Number(localDuplicate ? localDuplicate.amount : 0)
        : Number(localDuplicate.amount);
      const displayLabel = (duplicate && duplicate.categoryLabel) || selectedCategoryLabel;
      wx.showModal({
        title: '发现今日重复支出',
        content: `今天已添加【${displayLabel}】¥${formatMoney(existingAmount)}，本次为 ¥${formatMoney(numAmount)}。确认后将合并为 ¥${formatMoney(existingAmount + numAmount)}。`,
        confirmText: '合并添加',
        confirmColor: '#002045',
        success: result => {
          if (!result.confirm) return;
          if (hasRemoteDuplicate) queuedExpense.mergeExpenseId = duplicate.expenseId;
          this.appendQueuedExpense(queuedExpense);
        }
      });
      return;
    }

    this.appendQueuedExpense(queuedExpense);
  },

  appendQueuedExpense(queuedExpense) {
    const mergeIndex = this.data.queuedExpenses.findIndex(item => (
      queuedExpense.mergeExpenseId
        ? item.mergeExpenseId === queuedExpense.mergeExpenseId
        : item.expenseType === EXPENSE_TYPE.ONE_TIME
          && item.category === queuedExpense.category
          && item.expenseDate === queuedExpense.expenseDate
          && !item.mergeExpenseId
    ));
    const queuedExpenses = this.data.queuedExpenses.slice();
    if (mergeIndex >= 0) {
      const existing = queuedExpenses[mergeIndex];
      const amount = Number(((Number(existing.amount) || 0) + queuedExpense.amount).toFixed(2));
      queuedExpenses[mergeIndex] = {
        ...existing,
        amount,
        amountText: formatMoney(amount),
        remark: existing.remark || queuedExpense.remark,
      };
    } else {
      queuedExpenses.push(queuedExpense);
    }
    const queuedTotal = queuedExpenses.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);

    this.setData({
      queuedExpenses,
      queuedTotalAmount: formatMoney(queuedTotal),
      amount: '',
      remark: '',
      expenseType: EXPENSE_TYPE.ONE_TIME,
    }, () => {
      this.updateCategoryOptions(EXPENSE_TYPE.ONE_TIME);
      this.updateRecurringSummary();
    });
    wx.showToast({ title: '已添加，可继续录入', icon: 'success' });
  },

  removeQueuedExpense(event) {
    if (this.data.submitting) return;
    const id = event.currentTarget.dataset.id;
    const queuedExpenses = this.data.queuedExpenses.filter(item => item.id !== id);
    const queuedTotal = queuedExpenses.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    this.setData({ queuedExpenses, queuedTotalAmount: formatMoney(queuedTotal) });
  },

  async submitAll() {
    if (this.data.submitting || !this.data.queuedExpenses.length) return;
    this.setData({ submitting: true });
    const failedItems = [];
    const successfulItems = [];
    let successCount = 0;
    try {
      for (const item of this.data.queuedExpenses) {
        try {
          if (item.expenseType === EXPENSE_TYPE.RECURRING) {
            await api.createRecurringExpenseRule({
              category: item.category,
              categoryLabel: item.categoryLabel,
              amountPerMonth: item.amount,
              startMonth: item.startMonth,
              endMonth: item.endMonth,
              remark: item.remark,
            });
          } else if (item.mergeExpenseId) {
            await api.mergeExpense({
              id: item.mergeExpenseId,
              category: item.category,
              expenseDate: item.expenseDate,
              amount: item.amount,
            });
          } else {
            await api.createExpense({
              category: item.category,
              categoryLabel: item.categoryLabel,
              amount: item.amount,
              expenseDate: item.expenseDate,
              remark: item.remark,
            });
          }
          successCount += 1;
          successfulItems.push(item);
        } catch (error) {
          failedItems.push(item);
        }
      }
      const failedTotal = failedItems.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
      this.setData({ queuedExpenses: failedItems, queuedTotalAmount: formatMoney(failedTotal) });
      this.saveRecentTemplates(successfulItems);
      if (failedItems.length) {
        wx.showToast({ title: `${successCount} 条已提交，${failedItems.length} 条待重试`, icon: 'none' });
      } else {
        wx.showToast({ title: `已成功提交 ${successCount} 条`, icon: 'success' });
        setTimeout(() => wx.redirectTo({ url: '/pages/expense-list/index' }), 500);
      }
    } finally {
      this.setData({ submitting: false });
    }
  }
});
