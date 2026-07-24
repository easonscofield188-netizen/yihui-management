const TOKEN_KEY = "authToken";
const USER_KEY = "userInfo";
const EXPIRES_KEY = "sessionExpiresAt";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function getStoredExpiresAt() {
  return Number(wx.getStorageSync(EXPIRES_KEY) || 0);
}

function touchLocalSession(expiresAt) {
  const nextExpiresAt = Number(expiresAt) || (Date.now() + SESSION_TTL_MS);
  wx.setStorageSync(EXPIRES_KEY, nextExpiresAt);
  return nextExpiresAt;
}

function getToken() {
  const token = wx.getStorageSync(TOKEN_KEY) || "";
  if (!token) return "";
  const expiresAt = getStoredExpiresAt();
  if (expiresAt && Date.now() > expiresAt) {
    clearSession();
    return "";
  }
  // 兼容旧登录态：无过期时间时补写 24 小时
  if (!expiresAt) {
    touchLocalSession(Date.now() + SESSION_TTL_MS);
  }
  return token;
}

function normalizeProjectList(result) {
  if (Array.isArray(result)) {
    return { list: result, total: result.length, hasMore: false };
  }
  return {
    ...(result || {}),
    list: Array.isArray(result && result.list) ? result.list : [],
    total: Number(result && result.total) || 0,
    hasMore: Boolean(result && result.hasMore),
  };
}

function saveSession(data) {
  wx.setStorageSync(TOKEN_KEY, data.token);
  wx.setStorageSync(USER_KEY, data.userInfo);
  touchLocalSession(data.expiresAt || (Date.now() + SESSION_TTL_MS));
  getApp().globalData.userInfo = data.userInfo;
}

function clearSession() {
  wx.removeStorageSync(TOKEN_KEY);
  wx.removeStorageSync(USER_KEY);
  wx.removeStorageSync(EXPIRES_KEY);
  try {
    getApp().globalData.userInfo = null;
  } catch (error) {
    // App 尚未初始化时忽略
  }
}

function redirectToLogin() {
  clearSession();
  const pages = getCurrentPages();
  const current = pages[pages.length - 1];
  if (!current || current.route !== "pages/login/index") {
    wx.reLaunch({ url: "/pages/login/index" });
  }
}

/** 冷启动 / 切回前台时校验登录态，超时则跳转登录页 */
function ensureAuthOnShow() {
  const pages = getCurrentPages();
  const current = pages[pages.length - 1];
  const onLoginPage = current && current.route === "pages/login/index";
  const token = wx.getStorageSync(TOKEN_KEY) || "";
  if (!token) return false;
  const expiresAt = getStoredExpiresAt();
  if (expiresAt && Date.now() > expiresAt) {
    if (!onLoginPage) redirectToLogin();
    else clearSession();
    return false;
  }
  return Boolean(getToken());
}

function callFunction(name, action, data = {}, options = {}) {
  const token = getToken();
  if (!token && !options.skipAuthRedirect && action) {
    redirectToLogin();
    return Promise.reject(Object.assign(new Error("登录状态已失效，请重新登录"), { code: 401 }));
  }
  const payload = action
    ? { action, data: { ...data, authToken: token } }
    : data;

  return wx.cloud.callFunction({ name, data: payload }).then(({ result }) => {
    const response = result || { code: 500, message: "服务暂无响应" };
    if (response.code === 401 && !options.skipAuthRedirect) {
      redirectToLogin();
    }
    if (response.code !== 0) {
      const error = new Error(response.message || "操作失败");
      error.code = response.code;
      error.response = response;
      throw error;
    }
    // 有操作则本地滑动续期 24 小时，与后端保持一致
    if (token) {
      touchLocalSession(Date.now() + SESSION_TTL_MS);
    }
    return response.data;
  });
}

function login(username, passwordPlain) {
  return callFunction(
    "loginService",
    "",
    { username, passwordPlain },
    { skipAuthRedirect: true }
  ).then((data) => {
    saveSession(data);
    return data;
  });
}

function getUserInfo() {
  return callFunction("loginService", "getUserInfo");
}

function createAccount(data) {
  return callFunction("loginService", "createAccount", data);
}

function getNextEmployeeNo(role) {
  return callFunction("loginService", "getNextEmployeeNo", { role });
}

function logout() {
  return callFunction("loginService", "logout").finally(clearSession);
}

function listProjects(params) {
  return callFunction("projectService", "list", params).then(normalizeProjectList);
}

function queryClients(keyword = "") {
  return callFunction("clientsService", "", { keyword });
}

function createProject(data) {
  return callFunction("projectService", "create", data);
}

function updateProject(data) {
  return callFunction("projectService", "update", data);
}

function createClient(data) {
  return callFunction("clientsService", "createClient", data);
}

function getProject(id) {
  return callFunction("projectService", "get", { id });
}

function getServerDate() {
  return callFunction("projectService", "getServerDate", {});
}

function getProjectOverview(params) {
  return callFunction("projectService", "overview", params);
}

function quickRecord(data) {
  return callFunction("projectService", "quickRecord", data);
}

function getVouchers(projectId) {
  return callFunction("voucherService", "list", { projectId });
}

function getGlobalConfig() {
  return callFunction("configService", "getGlobalConfig", {});
}

function addVoucher(data) {
  return callFunction("voucherService", "add", data);
}

function deleteVoucher(data) {
  return callFunction("voucherService", "delete", data);
}

module.exports = {
  addVoucher,
  callFunction,
  clearSession,
  createAccount,
  createClient,
  createProject,
  deleteVoucher,
  ensureAuthOnShow,
  getProject,
  getGlobalConfig,
  getNextEmployeeNo,
  getProjectOverview,
  getServerDate,
  getToken,
  getUserInfo,
  getVouchers,
  listProjects,
  login,
  logout,
  quickRecord,
  queryClients,
  updateProject,
};
