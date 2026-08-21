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
  if (!Number.isFinite(amount)) return '0.00';
  const fixed = amount.toFixed(2);
  const [integer, decimal] = fixed.split('.');
  const sign = integer.startsWith('-') ? '-' : '';
  const groupedInteger = integer.replace(/^-/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${groupedInteger}.${decimal}`;
}

function formatMonth(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

const RANGE_TABS = [
  { label: '月度', value: 'month' },
  { label: '季度', value: 'quarter' },
  { label: '半年', value: 'half_year' },
  { label: '年度', value: 'year' },
  { label: '自定义', value: 'custom' }
];

const CHART_COLORS = [
  '#002045', // 深海蓝
  '#2563eb', // 皇家蓝
  '#d97706', // 金橙
  '#059669', // 翡翠绿
  '#7c3aed', // 紫罗兰
  '#dc2626', // 珊瑚红
  '#0891b2', // 青蓝
  '#ca8a04', // 琥珀黄
  '#475569', // 铁灰
  '#db2777'  // 玫红
];

Page({
  data: {
    ...getNavMetrics(),
    rangeTabs: RANGE_TABS,
    rangeType: 'month',
    targetMonth: formatMonth(new Date()),
    startDate: '',
    endDate: '',
    
    // 分析结果
    periodLabel: '',
    totalAmountText: '0.00',
    recurringAmountText: '0.00',
    recurringPercent: 0,
    oneTimeAmountText: '0.00',
    oneTimePercent: 0,
    categoryList: [],
    maxCategory: null,
    monthlyTrend: [],
    trendItems: [],
    trendSummary: null,
    trendPeak: null,
    trendAxis: { topLabel: '¥0', middleLabel: '¥0', bottomLabel: '¥0' },
    
    loading: false,
    modalActive: false,
    suppressCustomClose: false,
    
    // 自定义范围弹窗
    customPopupVisible: false,
    customStart: '',
    customEnd: '',
    monthPickerVisible: false,
    datePickerVisible: false,
    datePickerField: '',
    datePickerValue: '',
  },

  onLoad() {
    this.loadAnalysis();
  },

  goBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
    } else {
      wx.redirectTo({ url: '/pages/expense-list/index' });
    }
  },

  onRangeChange(event) {
    const type = event.currentTarget.dataset.type;
    if (type === this.data.rangeType && type !== 'custom') return;

    if (type === 'custom') {
      const now = new Date();
      const end = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const startD = new Date();
      startD.setDate(startD.getDate() - 30);
      const start = `${startD.getFullYear()}-${String(startD.getMonth() + 1).padStart(2, '0')}-${String(startD.getDate()).padStart(2, '0')}`;
      
      this.setData({
        customStart: this.data.startDate || start,
        customEnd: this.data.endDate || end,
        customPopupVisible: true,
        modalActive: true,
        suppressCustomClose: false
      });
      return;
    }

    this.setData({ rangeType: type }, () => {
      this.loadAnalysis();
    });
  },

  openMonthPicker() {
    if (this.data.rangeType !== 'month') return;
    this.setData({ monthPickerVisible: true });
  },

  closeMonthPicker() {
    this.setData({ monthPickerVisible: false });
  },

  onMonthConfirm(event) {
    const monthVal = String(event.detail.value || '').slice(0, 7);
    this.setData({
      targetMonth: monthVal,
      monthPickerVisible: false
    }, () => {
      this.loadAnalysis();
    });
  },

  async loadAnalysis() {
    this.setData({ loading: true });

    try {
      const res = await api.getExpenseAnalysis({
        rangeType: this.data.rangeType,
        targetMonth: this.data.targetMonth,
        startDate: this.data.startDate,
        endDate: this.data.endDate
      });

      const data = res || {};
      const categoryList = (data.categoryList || []).map((item, idx) => ({
        ...item,
        amountText: formatMoney(item.amount),
        color: CHART_COLORS[idx % CHART_COLORS.length]
      }));

      const maxCategory = data.maxCategory ? {
        ...data.maxCategory,
        amountText: formatMoney(data.maxCategory.amount)
      } : null;
      const rawTrend = data.monthlyTrend || [];
      const backendSummary = data.trendSummary;
      const trendSummary = backendSummary ? {
        avgAmountText: formatMoney(backendSummary.averageAmount),
        peakMonth: backendSummary.peakMonth ? String(backendSummary.peakMonth).slice(5) + '月' : '-',
        peakAmountText: formatMoney(backendSummary.peakAmount),
        minMonth: backendSummary.minimumMonth ? String(backendSummary.minimumMonth).slice(5) + '月' : '-',
        minAmountText: formatMoney(backendSummary.minimumAmount)
      } : null;

      this.setData({
        periodLabel: data.periodLabel || '',
        totalAmountText: formatMoney(data.totalAmount),
        recurringAmountText: formatMoney(data.recurringAmount),
        recurringPercent: data.recurringPercent || 0,
        oneTimeAmountText: formatMoney(data.oneTimeAmount),
        oneTimePercent: data.oneTimePercent || 0,
        categoryList,
        maxCategory,
        monthlyTrend: rawTrend,
        trendSummary,
        trendAxis: data.trendAxis || { topLabel: '¥0', middleLabel: '¥0', bottomLabel: '¥0' },
        activeTrendIndex: -1,
        activeTrendInfo: '',
        trendPeak: data.trendPeak ? {
          monthLabel: String(data.trendPeak.month || '').slice(5) + '月',
          amountText: formatMoney(data.trendPeak.amount)
        } : null
      }, () => {
        this.renderDonutChart(categoryList);
        this.renderTrendChart(rawTrend, -1);
      });
    } catch (error) {
      wx.showToast({ title: error.message || '加载分析数据失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  onPullDownRefresh() {
    this.loadAnalysis().finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  // 绘制环形饼图 (Canvas 2D)
  renderDonutChart(categories) {
    const query = wx.createSelectorQuery().in(this);
    query.select('#donutCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) return;
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const dpr = wx.getSystemInfoSync().pixelRatio || 2;
        const width = res[0].width;
        const height = res[0].height;

        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        ctx.clearRect(0, 0, width, height);

        const centerX = width / 2;
        const centerY = height / 2;
        const radius = Math.min(centerX, centerY) - 16;
        const innerRadius = radius * 0.62;

        if (!categories.length) {
          // 空数据时画灰色圆环
          ctx.beginPath();
          ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
          ctx.arc(centerX, centerY, innerRadius, Math.PI * 2, 0, true);
          ctx.fillStyle = '#f1f5f9';
          ctx.fill();

          ctx.font = 'bold 14px sans-serif';
          ctx.fillStyle = '#94a3b8';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('暂无支出', centerX, centerY);
          return;
        }

        let startAngle = -Math.PI / 2;

        categories.forEach((item) => {
          const sliceAngle = ((Number(item.percent) || 0) / 100) * (Math.PI * 2);
          const endAngle = startAngle + sliceAngle;

          ctx.beginPath();
          ctx.arc(centerX, centerY, radius, startAngle, endAngle);
          ctx.arc(centerX, centerY, innerRadius, endAngle, startAngle, true);
          ctx.closePath();
          ctx.fillStyle = item.color;
          ctx.fill();

          startAngle = endAngle;
        });

        // 环心文字
        ctx.font = '12px sans-serif';
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('总支出', centerX, centerY - 12);

        ctx.font = 'bold 16px sans-serif';
        ctx.fillStyle = '#002045';
        ctx.fillText(`¥${this.data.totalAmountText}`, centerX, centerY + 12);
      });
  },

  // 走势图触摸交互
  onTrendTouch(event) {
    if (!this.data.monthlyTrend || !this.data.monthlyTrend.length) return;
    const touch = (event.touches && event.touches[0]) || (event.changedTouches && event.changedTouches[0]);
    if (!touch) return;

    const query = wx.createSelectorQuery().in(this);
    query.select('#trendCanvas')
      .boundingClientRect()
      .exec((res) => {
        if (!res || !res[0]) return;
        const rect = res[0];
        const touchX = touch.clientX - rect.left;

        const padding = { top: 36, right: 16, bottom: 30, left: 54 };
        const chartW = rect.width - padding.left - padding.right;
        const count = this.data.monthlyTrend.length;

        if (touchX < padding.left || touchX > rect.width - padding.right) return;

        const colW = chartW / count;
        const idx = Math.floor((touchX - padding.left) / colW);
        const clampedIndex = Math.max(0, Math.min(count - 1, idx));

        const targetItem = this.data.monthlyTrend[clampedIndex];
        if (targetItem) {
          const monthShort = String(targetItem.month || '').slice(5) + '月';
          const infoText = `${monthShort} 支出 · ¥${formatMoney(targetItem.total)}`;
          this.setData({
            activeTrendIndex: clampedIndex,
            activeTrendInfo: infoText
          }, () => {
            this.renderTrendChart(this.data.monthlyTrend, clampedIndex);
          });
        }
      });
  },

  onTrendTouchEnd() {
    if (this.trendTouchTimer) clearTimeout(this.trendTouchTimer);
    this.trendTouchTimer = setTimeout(() => {
      this.setData({
        activeTrendIndex: -1,
        activeTrendInfo: ''
      }, () => {
        this.renderTrendChart(this.data.monthlyTrend, -1);
      });
    }, 1800);
  },

  // 绘制月度趋势柱状图
  renderTrendChart(trendData, selectedIndex = -1) {
    if (!trendData || !trendData.length) return;

    const query = wx.createSelectorQuery().in(this);
    query.select('#trendCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) return;
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const dpr = wx.getSystemInfoSync().pixelRatio || 2;
        const width = res[0].width;
        const height = res[0].height;

        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        ctx.clearRect(0, 0, width, height);

        const padding = { top: 36, right: 16, bottom: 30, left: 54 };
        const chartW = width - padding.left - padding.right;
        const chartH = height - padding.top - padding.bottom;

        const barWidth = Math.max(8, (chartW / trendData.length) * 0.52);
        const currentM = formatMonth(new Date());

        // 金额刻度和参考线
        [
          { ratio: 1, label: this.data.trendAxis.topLabel },
          { ratio: 0.5, label: this.data.trendAxis.middleLabel },
          { ratio: 0, label: this.data.trendAxis.bottomLabel }
        ].forEach(item => {
          const ratio = item.ratio;
          const y = padding.top + chartH * (1 - ratio);
          ctx.beginPath();
          ctx.moveTo(padding.left, y);
          ctx.lineTo(width - padding.right, y);
          ctx.strokeStyle = '#e9eef5';
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.font = '10px sans-serif';
          ctx.fillStyle = '#94a3b8';
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          ctx.fillText(item.label || '¥0', padding.left - 7, y);
        });

        ctx.beginPath();
        trendData.forEach((d, i) => {
          const pointX = padding.left + (i + 0.5) * (chartW / trendData.length);
          const pointY = padding.top + chartH - ((Number(d.chartPercent) || 0) / 100) * chartH;
          if (i === 0) ctx.moveTo(pointX, pointY);
          else ctx.lineTo(pointX, pointY);
        });
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 3;
        ctx.stroke();

        trendData.forEach((d, i) => {
          const x = padding.left + (i + 0.5) * (chartW / trendData.length) - barWidth / 2;
          const barH = ((Number(d.chartPercent) || 0) / 100) * chartH;
          const y = padding.top + chartH - barH;

          const isSelected = selectedIndex === i;
          const isCurrent = d.month === currentM;

          // 绘制柱子背景条
          ctx.beginPath();
          ctx.arc(x + barWidth / 2, y, isSelected || isCurrent ? 5 : 4, 0, Math.PI * 2);
          ctx.fillStyle = selectedIndex >= 0
            ? (isSelected ? '#002045' : '#93c5fd')
            : (isCurrent ? '#002045' : '#3b82f6');
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#ffffff';
          ctx.stroke();

          // 触摸选中时的虚线与高亮 Tooltip 气泡
          if (isSelected) {
            ctx.beginPath();
            ctx.setLineDash([2, 2]);
            ctx.moveTo(x + barWidth / 2, padding.top);
            ctx.lineTo(x + barWidth / 2, padding.top + chartH);
            ctx.strokeStyle = '#002045';
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.setLineDash([]); // 恢复实线

            // 顶点实心卡圈
            ctx.beginPath();
            ctx.arc(x + barWidth / 2, y, 4, 0, Math.PI * 2);
            ctx.fillStyle = '#002045';
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#ffffff';
            ctx.stroke();

            // 精致 Tooltip 气泡
            const bubbleText = `¥${formatMoney(d.total)}`;
            ctx.font = 'bold 11px sans-serif';
            const textWidth = ctx.measureText(bubbleText).width;
            const bubbleW = textWidth + 16;
            const bubbleH = 22;
            let bubbleX = x + barWidth / 2 - bubbleW / 2;

            if (bubbleX < padding.left) bubbleX = padding.left;
            if (bubbleX + bubbleW > width - padding.right) bubbleX = width - padding.right - bubbleW;

            const bubbleY = Math.max(4, y - bubbleH - 6);

            ctx.fillStyle = '#002045';
            ctx.beginPath();
            ctx.roundRect(bubbleX, bubbleY, bubbleW, bubbleH, 6);
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(bubbleText, bubbleX + bubbleW / 2, bubbleY + bubbleH / 2);
          }

          // 横轴仅显示关键月份，避免 12 个标签在窄屏上重叠。
          const showMonthLabel = i === 0
            || i === trendData.length - 1
            || (i + 1) % 3 === 0
            || isSelected
            || isCurrent;
          if (showMonthLabel) {
            ctx.font = isSelected || isCurrent ? 'bold 11px sans-serif' : '10px sans-serif';
            ctx.fillStyle = isSelected || isCurrent ? '#002045' : '#94a3b8';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            const monthShort = d.month.slice(5) + '月';
            ctx.fillText(monthShort, x + barWidth / 2, padding.top + chartH + 8);
          }
        });
      });
  },

  // 自定义时间范围
  closeCustomPopup() {
    if (this.data.suppressCustomClose) return;
    this.setData({ customPopupVisible: false, modalActive: false }, () => {
      setTimeout(() => {
        if (!this.data.modalActive) {
          this.renderDonutChart(this.data.categoryList);
          this.renderTrendChart(this.data.monthlyTrend);
        }
      }, 80);
    });
  },

  openCustomDatePicker(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({
      datePickerField: field,
      datePickerValue: field === 'start' ? this.data.customStart : this.data.customEnd,
      customPopupVisible: false,
      modalActive: true,
      suppressCustomClose: true
    }, () => {
      setTimeout(() => this.setData({ datePickerVisible: true }), 120);
    });
  },

  closeDatePicker() {
    this.setData({ datePickerVisible: false, customPopupVisible: true, modalActive: true, suppressCustomClose: false });
  },

  onCustomDateConfirm(event) {
    const val = String(event.detail.value || '').slice(0, 10);
    if (this.data.datePickerField === 'start') {
      this.setData({ customStart: val, datePickerVisible: false, customPopupVisible: true, modalActive: true, suppressCustomClose: false });
    } else {
      this.setData({ customEnd: val, datePickerVisible: false, customPopupVisible: true, modalActive: true, suppressCustomClose: false });
    }
  },

  onConfirmCustomRange() {
    const { customStart, customEnd } = this.data;
    if (!customStart || !customEnd) {
      wx.showToast({ title: '请选择完整日期范围', icon: 'none' });
      return;
    }
    if (customStart > customEnd) {
      wx.showToast({ title: '开始日期不能晚于结束日期', icon: 'none' });
      return;
    }

    this.setData({
      rangeType: 'custom',
      startDate: customStart,
      endDate: customEnd,
      customPopupVisible: false,
      modalActive: false,
      suppressCustomClose: false
    }, () => {
      this.loadAnalysis();
    });
  }
});
