const api = require('../../utils/api');

const SCENE_DEFAULT_DESCS = {
  daily_maintenance: '提供长效绿植巡检、浇水、修剪施肥与定期日常养护服务',
  '日常维护': '提供长效绿植巡检、浇水、修剪施肥与定期日常养护服务',
  company_scenery: '办公职场、前台大厅及会议室绿植美化与空间布景',
  '公司布景': '办公职场、前台大厅及会议室绿植美化与空间布景',
  store_landscaping: '商业门店、品牌专柜与橱窗绿植造景与氛围打造',
  '门店造景': '商业门店、品牌专柜与橱窗绿植造景与氛围打造',
  government_unit: '政企机关、事业单位公共空间绿植工程与长期维护',
  '机关单位': '政企机关、事业单位公共空间绿植工程与长期维护',
  private_residence: '高端私宅、别墅庭院及室内私享绿化定制与养护',
  '私人住宅': '高端私宅、别墅庭院及室内私享绿化定制与养护',
  commercial_space: '商场、展厅、餐饮会所沉浸式景观营造与维护',
  '商业空间': '商场、展厅、餐饮会所沉浸式景观营造与维护',
};

function getSceneDescription(sceneItem) {
  if (!sceneItem) return '';
  if (sceneItem.description && String(sceneItem.description).trim()) {
    return String(sceneItem.description).trim();
  }
  const val = String(sceneItem.value || '').trim();
  const label = String(sceneItem.label || '').trim();
  if (val && SCENE_DEFAULT_DESCS[val]) return SCENE_DEFAULT_DESCS[val];
  if (label && SCENE_DEFAULT_DESCS[label]) return SCENE_DEFAULT_DESCS[label];
  for (const [k, desc] of Object.entries(SCENE_DEFAULT_DESCS)) {
    if (label && label.includes(k)) return desc;
    if (val && val.includes(k)) return desc;
  }
  return SCENE_DEFAULT_DESCS['daily_maintenance'] || '提供长效绿植巡检、浇水、修剪施肥与定期日常养护服务';
}

const FALLBACK_PROJECT_SCENES = [
  { label: '日常维护', value: 'daily_maintenance', description: '提供长效绿植巡检、浇水、修剪施肥与定期日常养护服务' },
  { label: '公司布景', value: 'company_scenery', description: '办公职场、前台大厅及会议室绿植美化与空间布景' },
  { label: '门店造景', value: 'store_landscaping', description: '商业门店、品牌专柜与橱窗绿植造景与氛围打造' },
  { label: '机关单位', value: 'government_unit', description: '政企机关、事业单位公共空间绿植工程与长期维护' },
  { label: '私人住宅', value: 'private_residence', description: '高端私宅、别墅庭院及室内私享绿化定制与养护' },
  { label: '商业空间', value: 'commercial_space', description: '商场、展厅、餐饮会所沉浸式景观营造与维护' },
];

const DEFAULT_COST_CATEGORIES = [
  { label: '材料费', value: 'material' },
  { label: '人工费', value: 'labor' },
  { label: '真植物', value: 'real_plant' },
  { label: '仿真植物', value: 'fake_plant' },
  { label: '物流运输', value: 'logistics' },
  { label: '其他', value: 'other' },
];

function getTodayString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
      observer(newVal) {
        if (newVal) {
          this.initFormData();
        }
      },
    },
    projectId: {
      type: String,
      value: '',
    },
    projectName: {
      type: String,
      value: '',
    },
    record: {
      type: Object,
      value: null,
      observer(newVal) {
        if (newVal && this.data.visible) {
          this.initFormData();
        }
      },
    },
  },

  data: {
    isEdit: false,
    serviceDate: '',
    maxDate: getTodayString(),
    content: '',
    projectScenes: FALLBACK_PROJECT_SCENES,
    selectedScene: '',
    selectedSceneDescription: '',
    costs: [],
    receivableAmount: '',
    receivedAmount: '',
    isSettled: true,
    calculatedUnreceived: 0,
    calculatedUnreceivedText: '0.00',
    datePickerVisible: false,
    costPickerVisible: false,
    costPickerValue: ['material'],
    scenePickerVisible: false,
    scenePickerValue: ['daily_maintenance'],
    pickerPopupProps: {
      zIndex: 13000,
      overlayProps: { zIndex: 12500 },
    },
    activeCostIndex: 0,
    costCategories: DEFAULT_COST_CATEGORIES,
    vouchers: [],
    submitting: false,
  },

  lifetimes: {
    attached() {
      this.loadConfigurations();
    },
  },

  methods: {
    async loadConfigurations() {
      try {
        const configs = await api.getGlobalConfig();
        const patch = {};
        if (configs && configs.COST_CATEGORY && configs.COST_CATEGORY.length) {
          patch.costCategories = configs.COST_CATEGORY;
        }
        if (configs && configs.PROJECT_SCENE && configs.PROJECT_SCENE.length) {
          const scenes = configs.PROJECT_SCENE.map((item) => {
            const label = item.label || item.name || '';
            const value = item.value || item.code || '';
            const description = getSceneDescription({ label, value, description: item.description });
            return {
              label,
              value,
              description,
            };
          });
          patch.projectScenes = scenes;
          const curScene = scenes.find((s) => s.value === this.data.selectedScene || s.label === this.data.content);
          if (curScene) {
            patch.selectedSceneDescription = getSceneDescription(curScene);
          }
        }
        if (Object.keys(patch).length) {
          this.setData(patch);
        }
      } catch (e) {
        // fallback
      }
    },

    initFormData() {
      const rec = this.data.record;
      const today = getTodayString();
      const defaultScene = (this.data.projectScenes && this.data.projectScenes[0]) || FALLBACK_PROJECT_SCENES[0];
      if (rec) {
        const receivable = Number(rec.receivableAmount) || 0;
        const received = Number(rec.receivedAmount) || 0;
        const unreceived = Math.max(0, receivable - received);
        let matchedScene = (this.data.projectScenes || []).find((s) => s.value === rec.scene || s.label === rec.content);
        if (!matchedScene && rec.content) {
          matchedScene = (this.data.projectScenes || []).find((s) => rec.content.includes(s.label) || s.label.includes(rec.content));
        }
        if (!matchedScene) {
          matchedScene = (this.data.projectScenes || []).find((s) => s.value === 'daily_maintenance' || s.label === '日常维护') || defaultScene;
        }
        const finalContent = matchedScene ? matchedScene.label : '日常维护';
        const desc = matchedScene ? getSceneDescription(matchedScene) : getSceneDescription(defaultScene);
        const existingVouchers = Array.isArray(rec.voucherFileIds)
          ? [...rec.voucherFileIds]
          : (Array.isArray(rec.vouchers) ? [...rec.vouchers] : []);
        (rec.costs || []).forEach((c) => {
          (c.voucherFileIds || []).forEach((f) => {
            if (f && !existingVouchers.includes(f)) existingVouchers.push(f);
          });
        });
        this.setData({
          isEdit: true,
          serviceDate: String(rec.serviceDate || today).slice(0, 10),
          content: finalContent,
          selectedScene: matchedScene ? matchedScene.value : 'daily_maintenance',
          scenePickerValue: [matchedScene ? matchedScene.value : 'daily_maintenance'],
          selectedSceneDescription: desc,
          costs: Array.isArray(rec.costs) ? JSON.parse(JSON.stringify(rec.costs)) : [],
          vouchers: existingVouchers,
          receivableAmount: receivable > 0 ? String(receivable) : '',
          receivedAmount: received > 0 ? String(received) : '',
          isSettled: rec.isSettled !== undefined ? Boolean(rec.isSettled) : true,
          calculatedUnreceived: unreceived,
          calculatedUnreceivedText: unreceived.toFixed(2),
        });
      } else {
        const initScene = (this.data.projectScenes || []).find((s) => s.label.includes('日常维护') || s.value === 'daily_maintenance') || defaultScene;
        const desc = initScene ? getSceneDescription(initScene) : '';
        this.setData({
          isEdit: false,
          serviceDate: today,
          content: initScene ? initScene.label : '日常维护',
          selectedScene: initScene ? initScene.value : 'daily_maintenance',
          scenePickerValue: [initScene ? initScene.value : 'daily_maintenance'],
          selectedSceneDescription: desc,
          costs: [],
          vouchers: [],
          receivableAmount: '',
          receivedAmount: '',
          isSettled: true,
          calculatedUnreceived: 0,
          calculatedUnreceivedText: '0.00',
        });
      }
    },

    recalculateUnreceived() {
      const receivable = Number(this.data.receivableAmount) || 0;
      const isSettled = this.data.isSettled;
      const received = isSettled ? receivable : (Number(this.data.receivedAmount) || 0);
      const unreceived = Math.max(0, receivable - received);
      this.setData({
        calculatedUnreceived: unreceived,
        calculatedUnreceivedText: unreceived.toFixed(2),
      });
    },

    onContentChange(e) {
      this.setData({ content: e.detail.value || '' });
    },

    openScenePicker() {
      const currentVal = this.data.selectedScene || (this.data.projectScenes[0] && this.data.projectScenes[0].value) || 'daily_maintenance';
      this.setData({
        scenePickerVisible: true,
        scenePickerValue: [currentVal],
      });
    },

    closeScenePicker() {
      this.setData({ scenePickerVisible: false });
    },

    onSceneConfirm(e) {
      const val = (e.detail && e.detail.value && e.detail.value[0]) != null ? e.detail.value[0] : '';
      const label = (e.detail && e.detail.label && e.detail.label[0]) != null ? e.detail.label[0] : '';
      const idx = (e.detail && e.detail.index && e.detail.index[0]) != null ? e.detail.index[0] : -1;

      let sceneItem = (this.data.projectScenes || []).find(
        (s) => s.value === val || s.label === val || (label && s.label === label)
      );
      if (!sceneItem && idx >= 0 && this.data.projectScenes[idx]) {
        sceneItem = this.data.projectScenes[idx];
      }
      if (!sceneItem) {
        this.closeScenePicker();
        return;
      }
      const desc = getSceneDescription(sceneItem);
      this.setData({
        selectedScene: sceneItem.value,
        scenePickerValue: [sceneItem.value],
        content: sceneItem.label,
        selectedSceneDescription: desc,
        scenePickerVisible: false,
      });
    },

    openDatePicker() {
      this.setData({ datePickerVisible: true });
    },

    closeDatePicker() {
      this.setData({ datePickerVisible: false });
    },

    onDateConfirm(e) {
      const rawVal = e.detail.value || getTodayString();
      const dateOnly = String(rawVal).slice(0, 10);
      this.setData({
        serviceDate: dateOnly,
        datePickerVisible: false,
      });
    },

    addCostItem() {
      const firstCat = this.data.costCategories[0] || { label: '材料费', value: 'material' };
      const newItem = {
        id: `cost-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        category: firstCat.label,
        categoryCode: firstCat.value,
        categoryLabel: firstCat.label,
        amount: '',
        remark: '',
        voucherFileIds: [],
        settled: true,
      };
      this.setData({
        costs: [...this.data.costs, newItem],
      });
    },

    deleteCostItem(e) {
      const idx = Number(e.currentTarget.dataset.index);
      const nextCosts = [...this.data.costs];
      nextCosts.splice(idx, 1);
      this.setData({ costs: nextCosts });
    },

    openCostCategoryPicker(e) {
      const idx = Number(e.currentTarget.dataset.index);
      const currentItem = this.data.costs[idx];
      const currentVal = (currentItem && currentItem.categoryCode) || (this.data.costCategories[0] && this.data.costCategories[0].value) || 'material';
      this.setData({
        activeCostIndex: idx,
        costPickerValue: [currentVal],
        costPickerVisible: true,
      });
    },

    closeCostCategoryPicker() {
      this.setData({ costPickerVisible: false });
    },

    onCostCategoryConfirm(e) {
      const val = e.detail.value && e.detail.value[0];
      const found = this.data.costCategories.find(c => c.value === val) || this.data.costCategories[0];
      const idx = this.data.activeCostIndex;
      const nextCosts = [...this.data.costs];
      if (nextCosts[idx] && found) {
        nextCosts[idx].category = found.label;
        nextCosts[idx].categoryCode = found.value;
        nextCosts[idx].categoryLabel = found.label;
      }
      this.setData({
        costs: nextCosts,
        costPickerVisible: false,
      });
    },

    onCostAmountChange(e) {
      const idx = Number(e.currentTarget.dataset.index);
      const val = e.detail.value || '';
      const nextCosts = [...this.data.costs];
      if (nextCosts[idx]) {
        nextCosts[idx].amount = val;
      }
      this.setData({ costs: nextCosts });
    },

    onCostRemarkChange(e) {
      const idx = Number(e.currentTarget.dataset.index);
      const val = e.detail.value || '';
      const nextCosts = [...this.data.costs];
      if (nextCosts[idx]) {
        nextCosts[idx].remark = val;
      }
      this.setData({ costs: nextCosts });
    },

    async uploadUnifiedVoucher() {
      const currentCount = this.data.vouchers ? this.data.vouchers.length : 0;
      const maxCount = Math.max(1, 9 - currentCount);
      if (maxCount <= 0) {
        wx.showToast({ title: '最多上传9张发票凭证', icon: 'none' });
        return;
      }
      try {
        const chooseRes = await wx.chooseMedia({
          count: Math.min(9, maxCount),
          mediaType: ['image'],
          sourceType: ['album', 'camera'],
        });
        const tempFiles = chooseRes.tempFiles || [];
        if (!tempFiles.length) return;

        wx.showLoading({ title: '上传凭证中...', mask: true });
        const uploadPromises = tempFiles.map((file) => {
          const cloudPath = `vouchers/service_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
          return wx.cloud.uploadFile({
            cloudPath,
            filePath: file.tempFilePath,
          }).then((res) => res.fileID);
        });

        const uploadedFileIds = await Promise.all(uploadPromises);
        this.setData({
          vouchers: [...(this.data.vouchers || []), ...uploadedFileIds],
        });
        wx.showToast({ title: `成功上传 ${uploadedFileIds.length} 张凭证`, icon: 'success' });
      } catch (err) {
        if (err.errMsg && err.errMsg.includes('cancel')) return;
        wx.showToast({ title: '上传失败，请重试', icon: 'none' });
      } finally {
        wx.hideLoading();
      }
    },

    deleteUnifiedVoucher(e) {
      const idx = Number(e.currentTarget.dataset.index);
      const nextVouchers = [...(this.data.vouchers || [])];
      nextVouchers.splice(idx, 1);
      this.setData({ vouchers: nextVouchers });
    },

    previewUnifiedVoucher(e) {
      const idx = Number(e.currentTarget.dataset.index);
      const vouchers = this.data.vouchers || [];
      if (vouchers[idx]) {
        wx.previewImage({
          current: vouchers[idx],
          urls: vouchers,
        });
      }
    },

    onReceivableChange(e) {
      const val = e.detail.value || '';
      this.setData({ receivableAmount: val }, () => {
        this.recalculateUnreceived();
      });
    },

    onReceivedChange(e) {
      const val = e.detail.value || '';
      this.setData({ receivedAmount: val }, () => {
        this.recalculateUnreceived();
      });
    },

    onSettledChange(e) {
      const val = Boolean(e.detail.value);
      this.setData({ isSettled: val }, () => {
        this.recalculateUnreceived();
      });
    },

    onPopupVisibleChange(e) {
      if (!e.detail.visible) {
        this.closeModal();
      }
    },

    closeModal() {
      this.setData({ visible: false });
      this.triggerEvent('close');
    },

    async submitRecord() {
      const { projectId, serviceDate, content, costs, receivableAmount, receivedAmount, isSettled, isEdit, record } = this.data;
      if (!projectId) {
        wx.showToast({ title: '缺少项目信息', icon: 'none' });
        return;
      }
      if (!serviceDate) {
        wx.showToast({ title: '请选择服务日期', icon: 'none' });
        return;
      }
      if (!content.trim()) {
        wx.showToast({ title: '请填写服务内容', icon: 'none' });
        return;
      }

      const numReceivable = Number(receivableAmount) || 0;
      const numReceived = isSettled ? numReceivable : (Number(receivedAmount) || 0);

      if (numReceivable > 0 && !isSettled && numReceived > numReceivable) {
        wx.showToast({ title: '实收金额不能大于应收金额', icon: 'none' });
        return;
      }

      const normalizedCosts = costs.map(c => ({
        id: c.id,
        category: c.category || '其他',
        categoryCode: c.categoryCode || 'other',
        categoryLabel: c.categoryLabel || c.category || '其他',
        amount: Number(c.amount) || 0,
        remark: String(c.remark || '').trim(),
        voucherFileIds: Array.isArray(c.voucherFileIds) ? c.voucherFileIds : [],
        settled: c.settled !== undefined ? Boolean(c.settled) : true,
      }));

      const payload = {
        projectId,
        serviceDate,
        content: content.trim(),
        scene: this.data.selectedScene || '',
        costs: normalizedCosts,
        voucherFileIds: this.data.vouchers || [],
        vouchers: this.data.vouchers || [],
        receivableAmount: numReceivable,
        receivedAmount: numReceived,
        isSettled: Boolean(isSettled),
      };

      this.setData({ submitting: true });
      wx.showLoading({ title: isEdit ? '正在保存修改...' : '正在保存记录...', mask: true });

      try {
        let res;
        if (isEdit && record && (record._id || record.id)) {
          payload.recordId = record._id || record.id;
          res = await api.updateProjectServiceRecord(payload);
        } else {
          res = await api.addProjectServiceRecord(payload);
        }

        wx.showToast({ title: isEdit ? '修改成功' : '记录成功', icon: 'success' });
        this.setData({ visible: false });
        this.triggerEvent('success', { record: res.data, project: res.data?.project });
      } catch (err) {
        wx.showToast({ title: err.message || '保存失败', icon: 'none' });
      } finally {
        this.setData({ submitting: false });
        wx.hideLoading();
      }
    },
  },
});
