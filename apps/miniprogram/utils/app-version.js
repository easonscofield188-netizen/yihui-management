/** 本地维护版本号：平台取不到时使用（开发版/体验版） */
const APP_VERSION = "1.1.0";

/**
 * 优先读取微信公众平台上传版本号；
 * 开发版/体验版取不到时，回退到本地 APP_VERSION。
 */
function getRuntimeVersion() {
  try {
    const accountInfo = wx.getAccountInfoSync();
    const miniProgram = (accountInfo && accountInfo.miniProgram) || {};
    const platformVersion = String(miniProgram.version || "").trim();
    const envVersion = String(miniProgram.envVersion || "develop");
    const envLabel = {
      develop: "开发版",
      trial: "体验版",
      release: "正式版",
    }[envVersion] || "";

    const version = platformVersion || APP_VERSION;
    return {
      version,
      envVersion,
      envLabel,
      fromPlatform: Boolean(platformVersion),
      displayText: envLabel ? `v${version} · ${envLabel}` : `v${version}`,
    };
  } catch (error) {
    return {
      version: APP_VERSION,
      envVersion: "develop",
      envLabel: "开发版",
      fromPlatform: false,
      displayText: `v${APP_VERSION} · 开发版`,
    };
  }
}

module.exports = {
  APP_VERSION,
  getRuntimeVersion,
};
