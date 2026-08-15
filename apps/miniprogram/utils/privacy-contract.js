function openPrivacyContract() {
  if (typeof wx.openPrivacyContract !== "function") {
    wx.showModal({
      title: "暂时无法查看",
      content: "当前微信版本不支持直接打开隐私保护指引，请升级微信后重试。",
      showCancel: false,
      confirmText: "知道了",
    });
    return;
  }

  wx.openPrivacyContract({
    fail(error) {
      console.warn("打开隐私保护指引失败", error);
      wx.showToast({
        title: "隐私保护指引暂时无法打开",
        icon: "none",
      });
    },
  });
}

module.exports = { openPrivacyContract };
