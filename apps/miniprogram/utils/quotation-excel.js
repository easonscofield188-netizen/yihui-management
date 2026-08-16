/**
 * 报价单表格生成与预览导出工具
 * 将报价单清单、项目信息、合计与条款生成为带 UTF-8 BOM 的标准表格文件，
 * 并自动调用微信原生文档查看器进行预览和转发。
 */

function formatMoney(value) {
  const num = Number(value);
  const val = !isNaN(num) ? num : 0;
  return val.toFixed(2);
}

function escapeCsvField(field) {
  if (field === null || field === undefined) return '""';
  const str = String(field).replace(/"/g, '""');
  return `"${str}"`;
}

/**
 * 将数字金额转换为中文大写（规范财务大写）
 */
function digitToChinese(n) {
  const fraction = ['角', '分'];
  const digit = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
  const unit = [['元', '万', '亿'], ['', '拾', '佰', '仟']];
  const head = n < 0 ? '欠' : '';
  n = Math.abs(n);
  let s = '';
  for (let i = 0; i < fraction.length; i++) {
    s += (digit[Math.floor(n * 10 * Math.pow(10, i)) % 10] + fraction[i]).replace(/零./, '');
  }
  s = s || '整';
  n = Math.floor(n);
  for (let i = 0; i < unit[0].length && n > 0; i++) {
    let p = '';
    for (let j = 0; j < unit[1].length && n > 0; j++) {
      p = digit[n % 10] + unit[1][j] + p;
      n = Math.floor(n / 10);
    }
    s = p.replace(/(零.)*零$/, '').replace(/^$/, '零') + unit[0][i] + s;
  }
  return head + s.replace(/(零.)*零元/, '元').replace(/(零.)+/g, '零').replace(/^整$/, '零元整');
}

/**
 * 生成并打开报价单表格文件进行预览和转发
 * @param {Object} quotation 报价单对象
 * @returns {Promise<string>} 返回生成的本地文件路径
 */
async function generateAndPreviewQuotationSpreadsheet(quotation) {
  if (!quotation) throw new Error("报价单数据为空");

  const items = quotation.items || [];
  const projectName = quotation.projectName || "项目报价单";
  const projectCode = quotation.projectCode || "未编号";
  const version = quotation.versionDisplayLabel || quotation.versionLabel || quotation.version || "V1.0";
  const updateDate = quotation.updatedDate || quotation.updatedAtFormatted || new Date().toISOString().split("T")[0];
  const totalAmount = quotation.totalAmount !== undefined && quotation.totalAmount !== null
    ? quotation.totalAmount
    : (items.reduce((sum, i) => sum + Number(i.totalAmount || 0), 0));
  const chineseTotal = digitToChinese(Number(totalAmount) || 0);

  const rows = [];

  // 1. 标题行
  rows.push([`杭州亿辉文化创意有限公司 - 项目报价清单`]);
  rows.push([]);

  // 2. 项目基本信息
  rows.push([`项目名称:`, projectName, ``, `项目编号:`, projectCode]);
  rows.push([`报价版本:`, version, ``, `更新日期:`, updateDate]);
  rows.push([`结算币种:`, `人民币 (CNY)`, ``, `服务单位:`, `杭州亿辉文化创意有限公司`]);
  rows.push([]);

  // 3. 表格明细表头
  rows.push([`序号`, `项目名称`, `单价 (¥)`, `数量`, `单位`, `小计 (¥)`, `备注`]);

  // 4. 清单数据行
  items.forEach((item, index) => {
    const rawPrice = item.unitPrice !== undefined ? item.unitPrice : 0;
    const rawQty = item.quantity !== undefined ? item.quantity : 1;
    const rawSubtotal = item.totalAmount !== undefined
      ? item.totalAmount
      : (Number(rawPrice) * Number(rawQty));
    rows.push([
      index + 1,
      item.name || `类目${index + 1}`,
      formatMoney(rawPrice),
      rawQty,
      item.unit || "项",
      formatMoney(rawSubtotal),
      item.remark || ""
    ]);
  });

  // 5. 汇总行
  rows.push([]);
  rows.push([`合计金额 (大写)`, chineseTotal, ``, ``, `合计金额 (小写)`, `¥ ${formatMoney(totalAmount)}`, ``]);
  rows.push([]);

  // 6. 报价须知与公司信息
  rows.push([`报价须知与服务条款:`]);
  rows.push([`1. 本报价单自分享之日起，有效期为 30 天。`]);
  rows.push([`2. 报价包含清单所列材料、人工及相关项目服务费用。`]);
  rows.push([`3. 若设计方案或实施范围发生重大变更，需重新核算报价。`]);
  rows.push([`4. 具体付款节点与质保约定以双方最终签订的合同为准。`]);
  rows.push([]);
  rows.push([`公司名称:`, `杭州亿辉文化创意有限公司`]);
  rows.push([`公司地址:`, `浙江省杭州市萧山区长三角国际珠宝产业园`]);

  // 7. 转为带 UTF-8 BOM 的 CSV 文本（Excel 与微信文档引擎 100% 正常显示中文字符）
  const csvContent = "\uFEFF" + rows.map(r => r.map(escapeCsvField).join(",")).join("\r\n");

  const fs = wx.getFileSystemManager();
  const safeProjectName = projectName.replace(/[\\/:*?"<>|]/g, "_");
  const fileName = `报价清单_${safeProjectName}_${version}.csv`;
  const filePath = `${wx.env.USER_DATA_PATH}/${fileName}`;

  await new Promise((resolve, reject) => {
    fs.writeFile({
      filePath,
      data: csvContent,
      encoding: "utf8",
      success: resolve,
      fail: (err) => reject(new Error((err && err.errMsg) || "生成表格文件失败")),
    });
  });

  // 8. 调起微信原生文档查看器，showMenu 为 true 允许右上角转发给好友或保存
  await new Promise((resolve, reject) => {
    wx.openDocument({
      filePath,
      fileType: "csv",
      showMenu: true,
      success: resolve,
      fail: (err) => reject(new Error((err && err.errMsg) || "打开表格预览失败")),
    });
  });

  return filePath;
}

module.exports = {
  generateAndPreviewQuotationSpreadsheet,
  digitToChinese,
};
