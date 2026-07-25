/**
 * 打开 PDF：本地路径直接预览，云文件 / 网络地址先下载再打开。
 */
function isRemoteUrl(path) {
  const value = String(path || "");
  return /^https?:\/\//i.test(value) && !/^http:\/\/(tmp|usr)\//i.test(value);
}

function isCloudFileId(fileId) {
  return /^cloud:\/\//i.test(String(fileId || ""));
}

function isLocalFilePath(path) {
  const value = String(path || "");
  if (!value) return false;
  if (/^(wxfile:\/\/|file:\/\/|http:\/\/(tmp|usr)\/|\/)/i.test(value)) return true;
  if (isRemoteUrl(value) || isCloudFileId(value)) return false;
  return true;
}

function downloadByUrl(url) {
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300 && res.tempFilePath) {
          resolve(res.tempFilePath);
          return;
        }
        reject(new Error("PDF 下载失败"));
      },
      fail: (error) => reject(error || new Error("PDF 下载失败")),
    });
  });
}

function openLocalDocument(filePath) {
  return new Promise((resolve, reject) => {
    wx.openDocument({
      filePath,
      fileType: "pdf",
      // 隐藏保存、转发等菜单，只在微信临时目录中预览。
      showMenu: false,
      success: resolve,
      fail: (error) => reject(error || new Error("无法打开 PDF")),
    });
  });
}

async function resolvePdfLocalPath({ filePath, fileId, fileUrl } = {}) {
  if (isLocalFilePath(filePath)) return filePath;

  if (fileId && isCloudFileId(fileId)) {
    const result = await wx.cloud.downloadFile({ fileID: fileId });
    if (!result || !result.tempFilePath) throw new Error("PDF 下载失败");
    return result.tempFilePath;
  }

  const remoteUrl = fileUrl || (isRemoteUrl(filePath) ? filePath : "");
  if (remoteUrl) return downloadByUrl(remoteUrl);

  throw new Error("未找到可预览的 PDF 文件");
}

async function openPdfFile(options = {}) {
  const localPath = await resolvePdfLocalPath(options);
  await openLocalDocument(localPath);
  return localPath;
}

module.exports = {
  openPdfFile,
  resolvePdfLocalPath,
};
