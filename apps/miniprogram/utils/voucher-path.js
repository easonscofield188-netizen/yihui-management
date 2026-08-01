function normalizeExtension(extension) {
  const value = String(extension || "jpg").replace(/^\.+/, "").toLowerCase();
  return `.${value || "jpg"}`;
}

function createVoucherFileName(extension, now = new Date()) {
  const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const randomNum = Math.floor(Math.random() * 10000);
  return `${dateStr}_${randomNum}${normalizeExtension(extension)}`;
}

// 与后台 voucherService 的目录规则保持一致：bill_voucher/项目名称/日期_随机数.扩展名
function buildVoucherCloudPath(projectName, extension, fileName) {
  const folder = String(projectName || "未命名项目").trim() || "未命名项目";
  const storageFileName = fileName || createVoucherFileName(extension);
  return {
    cloudPath: `bill_voucher/${folder}/${storageFileName}`,
    fileName: storageFileName,
  };
}

module.exports = {
  buildVoucherCloudPath,
};
