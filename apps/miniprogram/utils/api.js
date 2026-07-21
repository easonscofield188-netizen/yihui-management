const TOKEN_KEY = "authToken";
const USER_KEY = "userInfo";

function getToken() {
  return wx.getStorageSync(TOKEN_KEY) || "";
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
  getApp().globalData.userInfo = data.userInfo;
}

function clearSession() {
  wx.removeStorageSync(TOKEN_KEY);
  wx.removeStorageSync(USER_KEY);
  getApp().globalData.userInfo = null;
}

function redirectToLogin() {
  clearSession();
  const pages = getCurrentPages();
  const current = pages[pages.length - 1];
  if (!current || current.route !== "pages/login/index") {
    wx.reLaunch({ url: "/pages/login/index" });
  }
}

function callFunction(name, action, data = {}, options = {}) {
  const token = getToken();
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

module.exports = {
  addVoucher,
  callFunction,
  clearSession,
  createClient,
  createProject,
  getProject,
  getGlobalConfig,
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
