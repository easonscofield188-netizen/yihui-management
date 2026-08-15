'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const PAGE = Object.freeze({ width: 595.28, height: 841.89, margin: 42 });
const COLORS = Object.freeze({
  navy: '#002045',
  blue: '#455f88',
  paleBlue: '#e7eeff',
  lighterBlue: '#f4f7ff',
  border: '#d9e3f9',
  text: '#121c2c',
  muted: '#74777f',
  white: '#ffffff'
});
const PDF_LAYOUT_VERSION = 1;

function resolveChineseFontPath() {
  const packagePath = require.resolve('@openfonts/noto-sans-sc_chinese-simplified/package.json');
  const packageDirectory = path.dirname(packagePath);
  const preferredNames = [
    'noto-sans-sc-chinese-simplified-400.woff2',
    'noto-sans-sc-chinese-simplified-400.woff',
    'noto-sans-sc-chinese-simplified-regular.woff2',
    'noto-sans-sc-chinese-simplified-regular.woff',
    'NotoSansSC-Regular.woff2',
    'NotoSansSC-Regular.woff'
  ];
  for (const name of preferredNames) {
    const filePath = path.join(packageDirectory, 'files', name);
    if (fs.existsSync(filePath)) return filePath;
  }
  const fontDirectories = [packageDirectory, path.join(packageDirectory, 'files'), path.join(packageDirectory, 'fonts')];
  for (const directory of fontDirectories) {
    if (!fs.existsSync(directory)) continue;
    const fallback = fs.readdirSync(directory)
      .find(name => /(noto.*sans.*sc.*(regular|400)|(regular|400).*noto.*sans.*sc).*\.woff2?$/i.test(name));
    if (fallback) return path.join(directory, fallback);
  }
  throw new Error('报价单 PDF 中文字体文件缺失');
}

function text(value, fallback = '-') {
  const normalized = String(value == null ? '' : value).trim();
  return normalized || fallback;
}

function money(value) {
  const amount = Number(value);
  return (Number.isFinite(amount) ? amount : 0).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function dateText(value) {
  const matched = String(value || '').match(/^\d{4}-\d{2}-\d{2}/);
  if (matched) return matched[0];
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime())) return '-';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function cnyUppercase(value) {
  const amount = Math.max(0, Math.round((Number(value) || 0) * 100));
  const digits = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
  const smallUnits = ['', '拾', '佰', '仟'];
  const largeUnits = ['', '万', '亿', '兆'];
  const groupText = group => {
    const source = String(group).padStart(4, '0');
    let output = '';
    let needsZero = false;
    source.split('').forEach((digitText, index) => {
      const digit = Number(digitText);
      if (digit === 0) {
        if (output) needsZero = true;
        return;
      }
      if (needsZero) output += '零';
      output += `${digits[digit]}${smallUnits[3 - index]}`;
      needsZero = false;
    });
    return output;
  };
  const integerText = integer => {
    if (!integer) return '零';
    const groups = [];
    let remaining = integer;
    while (remaining > 0) {
      groups.push(remaining % 10000);
      remaining = Math.floor(remaining / 10000);
    }
    let output = '';
    let zeroGroup = false;
    for (let index = groups.length - 1; index >= 0; index -= 1) {
      const group = groups[index];
      if (!group) {
        if (output) zeroGroup = true;
        continue;
      }
      if (output && (zeroGroup || group < 1000)) output += '零';
      output += `${groupText(group)}${largeUnits[index] || ''}`;
      zeroGroup = false;
    }
    return output;
  };
  const integer = Math.floor(amount / 100);
  const jiao = Math.floor((amount % 100) / 10);
  const fen = amount % 10;
  let result = `${integerText(integer)}元`;
  if (!jiao && !fen) return `${result}整`;
  if (jiao) result += `${digits[jiao]}角`;
  else if (fen) result += '零';
  if (fen) result += `${digits[fen]}分`;
  return result;
}

function roundedRect(doc, x, y, width, height, radius, fill, stroke = '') {
  doc.roundedRect(x, y, width, height, radius);
  if (fill && stroke) doc.fillAndStroke(fill, stroke);
  else if (fill) doc.fill(fill);
  else if (stroke) doc.stroke(stroke);
}

function drawPageChrome(doc, quotation, pageNumber) {
  const contentWidth = PAGE.width - PAGE.margin * 2;
  doc.save();
  doc.rect(0, 0, PAGE.width, 8).fill(COLORS.navy);
  doc.fillColor(COLORS.navy).fontSize(10).text('亿辉艺术 · 项目报价单', PAGE.margin, 22);
  doc.fillColor(COLORS.muted).fontSize(8)
    .text(`${text(quotation.projectCode)} · ${text(quotation.versionLabel || quotation.version)}`, PAGE.margin, 23, {
      width: contentWidth,
      align: 'right'
    });
  doc.moveTo(PAGE.margin, 39).lineTo(PAGE.width - PAGE.margin, 39).lineWidth(0.7).stroke(COLORS.border);
  doc.fillColor(COLORS.muted).fontSize(7.5)
    .text('本报价单由亿辉艺术管理系统生成', PAGE.margin, PAGE.height - 28, { width: contentWidth - 80 });
  doc.text(`第 ${pageNumber} 页`, PAGE.width - PAGE.margin - 80, PAGE.height - 28, { width: 80, align: 'right' });
  doc.restore();
}

function addPage(doc, quotation, state) {
  if (state.pageNumber > 0) doc.addPage();
  state.pageNumber += 1;
  drawPageChrome(doc, quotation, state.pageNumber);
  state.y = 56;
}

function measureRowHeight(doc, item, columns) {
  const values = [
    '',
    text(item.name),
    money(item.unitPrice),
    `${money(item.quantity).replace(/\.00$/, '')} ${text(item.unit, '')}`.trim(),
    money(item.totalAmount),
    text(item.remark, '无')
  ];
  return Math.max(34, ...values.map((value, index) => {
    if (!value) return 0;
    return doc.heightOfString(value, { width: columns[index] - 10, lineGap: 1 }) + 14;
  }));
}

function drawTableRow(doc, x, y, columns, values, height, options = {}) {
  let cursor = x;
  const background = options.header ? COLORS.paleBlue : (options.striped ? COLORS.lighterBlue : COLORS.white);
  doc.rect(x, y, columns.reduce((sum, width) => sum + width, 0), height).fill(background);
  values.forEach((value, index) => {
    const width = columns[index];
    doc.rect(cursor, y, width, height).lineWidth(0.55).stroke(COLORS.border);
    doc.fillColor(options.header ? COLORS.navy : COLORS.text)
      .fontSize(options.header ? 8 : 7.8)
      .text(String(value == null ? '' : value), cursor + 5, y + (options.header ? 10 : 7), {
        width: width - 10,
        height: height - 10,
        align: index === 0 ? 'center' : ([2, 3, 4].includes(index) ? 'right' : 'left'),
        lineGap: 1,
        ellipsis: false
      });
    cursor += width;
  });
}

function drawTableHeader(doc, y, columns) {
  drawTableRow(doc, PAGE.margin, y, columns, ['序号', '类目名称', '单价（元）', '数量/单位', '小计（元）', '备注'], 32, { header: true });
  return y + 32;
}

function buildQuotationPdf(quotation) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({
      size: 'A4',
      margin: PAGE.margin,
      bufferPages: true,
      autoFirstPage: true,
      info: {
        Title: `${text(quotation.projectName, '项目')}报价单`,
        Author: '亿辉艺术',
        Subject: '项目报价单'
      }
    });
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    const fontPath = resolveChineseFontPath();
    doc.registerFont('NotoSansSC', fontPath);
    doc.font('NotoSansSC');

    const state = { pageNumber: 1, y: 56 };
    drawPageChrome(doc, quotation, state.pageNumber);
    const contentWidth = PAGE.width - PAGE.margin * 2;

    doc.fillColor(COLORS.navy).fontSize(24).text('项目报价单', PAGE.margin, state.y, {
      width: contentWidth,
      align: 'center'
    });
    state.y += 43;
    doc.fillColor(COLORS.muted).fontSize(9).text('PROJECT QUOTATION', PAGE.margin, state.y, {
      width: contentWidth,
      align: 'center',
      characterSpacing: 1.5
    });
    state.y += 36;

    roundedRect(doc, PAGE.margin, state.y, contentWidth, 102, 8, COLORS.navy);
    doc.fillColor(COLORS.white).fontSize(9).text('项目名称', PAGE.margin + 18, state.y + 16);
    doc.fontSize(18).text(text(quotation.projectName), PAGE.margin + 18, state.y + 34, { width: contentWidth - 190 });
    doc.fontSize(8.5).fillColor('#d9e3f9')
      .text(`项目编号：${text(quotation.projectCode)}`, PAGE.margin + 18, state.y + 75)
      .text(`报价版本：${text(quotation.versionLabel || quotation.version)}`, PAGE.margin + contentWidth - 160, state.y + 18, { width: 140, align: 'right' })
      .text(`报价日期：${dateText(quotation.createdDate)}`, PAGE.margin + contentWidth - 160, state.y + 39, { width: 140, align: 'right' })
      .text(`附件数量：${Array.isArray(quotation.drawings) ? quotation.drawings.length : 0} 个`, PAGE.margin + contentWidth - 160, state.y + 60, { width: 140, align: 'right' });
    state.y += 126;

    doc.fillColor(COLORS.navy).fontSize(13).text('报价清单', PAGE.margin, state.y);
    state.y += 25;
    const columns = [30, 142, 72, 72, 82, 123];
    state.y = drawTableHeader(doc, state.y, columns);
    const items = Array.isArray(quotation.items) ? quotation.items : [];
    items.forEach((item, index) => {
      doc.fontSize(7.8);
      const rowHeight = measureRowHeight(doc, item, columns);
      if (state.y + rowHeight > PAGE.height - 64) {
        addPage(doc, quotation, state);
        state.y = drawTableHeader(doc, state.y, columns);
      }
      const quantityText = `${money(item.quantity).replace(/\.00$/, '')} ${text(item.unit, '')}`.trim();
      drawTableRow(doc, PAGE.margin, state.y, columns, [
        index + 1,
        text(item.name),
        money(item.unitPrice),
        quantityText,
        money(item.totalAmount),
        text(item.remark, '无')
      ], rowHeight, { striped: index % 2 === 1 });
      state.y += rowHeight;
    });

    const summaryHeight = 82;
    if (state.y + summaryHeight > PAGE.height - 64) addPage(doc, quotation, state);
    state.y += 18;
    roundedRect(doc, PAGE.margin, state.y, contentWidth, summaryHeight, 8, COLORS.lighterBlue, COLORS.border);
    doc.fillColor(COLORS.muted).fontSize(9).text('报价总额（CNY）', PAGE.margin + 16, state.y + 15);
    doc.fillColor(COLORS.navy).fontSize(19)
      .text(`¥ ${money(quotation.totalAmount)}`, PAGE.margin + contentWidth - 220, state.y + 12, { width: 202, align: 'right' });
    doc.fillColor(COLORS.muted).fontSize(8.5)
      .text(`人民币大写：${cnyUppercase(quotation.totalAmount)}`, PAGE.margin + 16, state.y + 49, { width: contentWidth - 32 });

    const generatedAt = new Date();
    doc.fillColor(COLORS.muted).fontSize(7.5)
      .text(`生成时间：${dateText(generatedAt)}  ·  报价版本内容以本 PDF 文件为准`, PAGE.margin, state.y + summaryHeight + 18, {
        width: contentWidth,
        align: 'right'
      });

    doc.end();
  });
}

module.exports = {
  PDF_LAYOUT_VERSION,
  buildQuotationPdf
};
