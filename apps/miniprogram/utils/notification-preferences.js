const FLOATING_NOTIFICATION_MODE_KEY = "floatingNotificationDisplayMode";
const FLOATING_NOTIFICATION_POSITION_KEY = "floatingNotificationPosition";

const FLOATING_NOTIFICATION_MODE = Object.freeze({
  UNREAD_ONLY: "unread_only",
  ALWAYS: "always",
});

function normalizeFloatingNotificationMode(value) {
  return value === FLOATING_NOTIFICATION_MODE.ALWAYS
    ? FLOATING_NOTIFICATION_MODE.ALWAYS
    : FLOATING_NOTIFICATION_MODE.UNREAD_ONLY;
}

function getFloatingNotificationMode() {
  return normalizeFloatingNotificationMode(wx.getStorageSync(FLOATING_NOTIFICATION_MODE_KEY));
}

function setFloatingNotificationMode(value) {
  const mode = normalizeFloatingNotificationMode(value);
  wx.setStorageSync(FLOATING_NOTIFICATION_MODE_KEY, mode);
  return mode;
}

function getFloatingNotificationPosition() {
  const value = wx.getStorageSync(FLOATING_NOTIFICATION_POSITION_KEY);
  if (!value || typeof value !== "object") return null;
  const xRatio = Number(value.xRatio);
  const yRatio = Number(value.yRatio);
  if (!Number.isFinite(xRatio) || !Number.isFinite(yRatio)) return null;
  return {
    xRatio: Math.min(1, Math.max(0, xRatio)),
    yRatio: Math.min(1, Math.max(0, yRatio)),
  };
}

function setFloatingNotificationPosition(position) {
  wx.setStorageSync(FLOATING_NOTIFICATION_POSITION_KEY, position);
}

module.exports = {
  FLOATING_NOTIFICATION_MODE,
  getFloatingNotificationMode,
  getFloatingNotificationPosition,
  setFloatingNotificationMode,
  setFloatingNotificationPosition,
};
