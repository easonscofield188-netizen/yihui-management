const TOKEN_KEY = "authToken";
const USER_KEY = "userInfo";
const USER_CACHE_AT_KEY = "userInfoCachedAt";
const EXPIRES_KEY = "sessionExpiresAt";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const USER_CACHE_TTL_MS = 5 * 60 * 1000;
const PUBLIC_ROUTES = new Set([
  "pages/project-quotation-client/index",
  "pages/project-quotation-client-v2/index",
]);

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
  cacheUserInfo(data.userInfo);
  touchLocalSession(data.expiresAt || (Date.now() + SESSION_TTL_MS));
}

function cacheUserInfo(userInfo) {
  if (!userInfo) return;
  wx.setStorageSync(USER_KEY, userInfo);
  wx.setStorageSync(USER_CACHE_AT_KEY, Date.now());
  try {
    getApp().globalData.userInfo = userInfo;
  } catch (error) {
    // App 尚未初始化时仅保留本地缓存
  }
}

function getCachedUserInfo() {
  try {
    const globalUser = getApp().globalData && getApp().globalData.userInfo;
    if (globalUser) return globalUser;
  } catch (error) {
    // App 尚未初始化时读取本地缓存
  }
  return wx.getStorageSync(USER_KEY) || null;
}

function isUserInfoCacheFresh() {
  const cachedAt = Number(wx.getStorageSync(USER_CACHE_AT_KEY) || 0);
  return Boolean(getCachedUserInfo() && cachedAt && Date.now() - cachedAt < USER_CACHE_TTL_MS);
}

function invalidateUserInfoCache() {
  wx.removeStorageSync(USER_CACHE_AT_KEY);
}

function clearSession() {
  wx.removeStorageSync(TOKEN_KEY);
  wx.removeStorageSync(USER_KEY);
  wx.removeStorageSync(USER_CACHE_AT_KEY);
  wx.removeStorageSync(EXPIRES_KEY);
  wx.removeStorageSync("notificationUnreadCount");
  wx.removeStorageSync("notificationUnreadCountCachedAt");
  try {
    getApp().globalData.userInfo = null;
  } catch (error) {
    // App 尚未初始化时忽略
  }
}

let isRedirectingToLogin = false;
function redirectToLogin(reasonMessage) {
  clearSession();
  const pages = getCurrentPages();
  const current = pages[pages.length - 1];
  const message = reasonMessage || "登录状态已失效，请重新登录";

  if (isRedirectingToLogin) return;
  isRedirectingToLogin = true;

  wx.setStorageSync("logout_notice_message", message);

  if (current && current.route === "pages/login/index") {
    isRedirectingToLogin = false;
    wx.showToast({ title: message, icon: "none", duration: 3000 });
    return;
  }

  wx.showModal({
    title: "系统安全提示",
    content: message,
    showCancel: false,
    confirmText: "去登录",
    confirmColor: "#002045",
    complete: () => {
      isRedirectingToLogin = false;
      wx.reLaunch({
        url: `/pages/login/index?reason=${encodeURIComponent(message)}`,
      });
    },
  });
}

/** 冷启动 / 切回前台时校验登录态，超时则跳转登录页 */
function ensureAuthOnShow() {
  const pages = getCurrentPages();
  const current = pages[pages.length - 1];
  const onLoginPage = current && current.route === "pages/login/index";
  const onPublicPage = Boolean(current && PUBLIC_ROUTES.has(current.route));
  const token = wx.getStorageSync(TOKEN_KEY) || "";
  if (!token) return onPublicPage;
  const expiresAt = getStoredExpiresAt();
  if (expiresAt && Date.now() > expiresAt) {
    if (onPublicPage) {
      clearSession();
      return true;
    }
    if (!onLoginPage) redirectToLogin("登录已过期，请重新登录");
    else clearSession();
    return false;
  }
  return Boolean(getToken());
}

function callFunction(name, action, data = {}, options = {}) {
  const token = getToken();
  if (!token && !options.skipAuthRedirect && action) {
    redirectToLogin("登录状态已失效，请重新登录");
    return Promise.reject(Object.assign(new Error("登录状态已失效，请重新登录"), { code: 401 }));
  }
  let miniProgramState = "formal";
  try {
    const envVersion = getApp().globalData?.envVersion
      || wx.getAccountInfoSync().miniProgram.envVersion;
    miniProgramState = envVersion === "develop"
      ? "developer"
      : envVersion === "trial" ? "trial" : "formal";
  } catch (error) {
    // 无法识别运行版本时按正式版处理，避免生产通知误入开发版。
  }
  const payload = action
    ? { action, data: { ...data, authToken: token, _miniProgramState: miniProgramState } }
    : data;

  return wx.cloud.callFunction({ name, data: payload }).then(({ result }) => {
    const response = result || { code: 500, message: "服务暂无响应" };
    // 401 才代表会话失效；403 是权限不足，必须保留当前登录态。
    if (response.code === 401 && !options.skipAuthRedirect) {
      redirectToLogin(response.message);
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

function updateUserInfo(data) {
  return callFunction("loginService", "updateUserInfo", data);
}

function uploadUserAvatar(filePath) {
  const extension = String(filePath).split(".").pop() || "png";
  const cloudPath = `avatars/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${extension}`;
  return wx.cloud.uploadFile({
    cloudPath,
    filePath,
  }).then(res => ({
    fileID: res.fileID,
    fileId: res.fileID,
  }));
}

function createAccount(data) {
  return callFunction("loginService", "createAccount", data);
}

function getNextEmployeeNo(role) {
  return callFunction("loginService", "getNextEmployeeNo", { role });
}

function listAccounts(params = {}) {
  return callFunction("loginService", "listAccounts", params);
}

function resetAccountPassword(userId) {
  return callFunction("loginService", "resetAccountPassword", { userId });
}

function updateAccountStatus(userId, status) {
  return callFunction("loginService", "updateAccountStatus", { userId, status });
}

function deleteAccount(userId) {
  return callFunction("loginService", "deleteAccount", { userId });
}

function updateAccountJobTitle(userId, jobTitle, username = "") {
  return callFunction("loginService", "updateAccountJobTitle", {
    userId,
    id: userId,
    username,
    jobTitle,
  });
}

function sendPasswordChangeCode() {
  return callFunction("loginService", "sendPasswordChangeCode");
}

function changePasswordWithCode(code, newPassword) {
  return callFunction("loginService", "changePasswordWithCode", { code, newPassword });
}

function sendBindEmailCode(email) {
  return callFunction("loginService", "sendBindEmailCode", { email });
}

function bindEmailWithCode(email, code) {
  return callFunction("loginService", "bindEmailWithCode", { email, code });
}

function isDevelopmentEnvironment() {
  try {
    const info = wx.getAccountInfoSync && wx.getAccountInfoSync();
    const envVersion = (info && info.miniProgram && info.miniProgram.envVersion) || "develop";
    return envVersion !== "release";
  } catch (e) {
    return true;
  }
}

function logout() {
  return callFunction("loginService", "logout").finally(clearSession);
}

function listProjects(params) {
  return callFunction("projectService", "list", params).then(normalizeProjectList);
}

function listProjectIds(params = {}) {
  return callFunction("projectService", "listIds", params);
}

function deleteProjects(ids) {
  return callFunction("projectService", "deleteBatch", { ids });
}

function listFinancialProjects(params) {
  return callFunction("projectService", "financialList", params).then(normalizeProjectList);
}

function queryClients(keyword = "") {
  return callFunction("clientsService", "listForSelection", { keyword });
}

function listManagedClients(params = {}) {
  return callFunction("clientsService", "manageList", params);
}

function prepareClientUpdate(id) {
  return callFunction("clientsService", "prepareUpdate", { id });
}

function updateClient(data) {
  return callFunction("clientsService", "updateClient", data);
}

function deleteClient(id) {
  return callFunction("clientsService", "deleteClient", { id });
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

function addProjectServiceRecord(data) {
  return callFunction("projectService", "addServiceRecord", data);
}

function listProjectServiceRecords(projectId, params = {}) {
  return callFunction("projectService", "listServiceRecords", { projectId, ...params });
}

function updateProjectServiceRecord(data) {
  return callFunction("projectService", "updateServiceRecord", data);
}

function deleteProjectServiceRecord(recordId, projectId) {
  return callFunction("projectService", "deleteServiceRecord", { recordId, projectId });
}

function getServerDate() {
  return callFunction("projectService", "getServerDate", {});
}

function getProjectOverview(params) {
  return callFunction("projectService", "overview", params);
}

function listProjectCases(params = {}) {
  return callFunction("caseService", "list", params).then(normalizeProjectList);
}

function listProjectQuotations(params = {}) {
  return callFunction("quotationService", "list", params).then(normalizeProjectList);
}

function listProjectQuotationIds(params = {}) {
  return callFunction("quotationService", "listIds", params);
}

function deleteProjectQuotations(ids) {
  return callFunction("quotationService", "deleteBatch", { ids });
}

function createProjectQuotation(data) {
  return callFunction("quotationService", "create", data);
}

function createProjectQuotationVersion(data) {
  return callFunction("quotationService", "createVersion", data);
}

function getProjectQuotation(id) {
  return callFunction("quotationService", "detail", { id });
}

function prepareProjectQuotationShare(id) {
  return callFunction("quotationService", "prepareShare", { id });
}

function getPublicProjectQuotation(id, shareToken, versionId = "") {
  return callFunction(
    "quotationService",
    "publicDetail",
    { id, shareToken, versionId },
    { skipAuthRedirect: true }
  );
}

function getNextProjectQuotationVersion(projectName) {
  return callFunction("quotationService", "nextVersion", { projectName });
}

function parseProjectQuotationExcel(data) {
  return callFunction("quotationService", "parseExcel", data);
}

function getProjectCase(id) {
  return callFunction("caseService", "detail", { id }, { skipAuthRedirect: true });
}

function syncProjectToCase(projectId) {
  return callFunction("caseService", "syncProject", { projectId });
}

function createProjectCase(data) {
  return callFunction("caseService", "create", data);
}

function deleteProjectCase(id) {
  return callFunction("caseService", "delete", { id });
}

function setProjectCaseCover(id, image) {
  return callFunction("caseService", "setCover", {
    id,
    fileId: image.fileId || "",
    url: image.url || "",
  });
}

function listNotifications(params = {}) {
  return callFunction("notificationService", "list", params).then(normalizeProjectList);
}

function getNotificationUnreadCount() {
  return callFunction("notificationService", "unreadCount", {}).then((result = {}) => ({
    ...result,
    unreadCount: Math.max(0, Number(result.count) || 0),
  }));
}

function getNotificationDetail(id) {
  return callFunction("notificationService", "detail", { id });
}

function listNotificationIds(readStatus = "") {
  return callFunction("notificationService", "listIds", { readStatus });
}

function deleteNotification(id) {
  return callFunction("notificationService", "delete", { id });
}

function deleteNotifications(ids) {
  return callFunction("notificationService", "deleteBatch", { ids });
}

function markAllNotificationsRead() {
  return callFunction("notificationService", "markAllRead", {});
}

function getWechatSubscriptionStatus() {
  return callFunction("notificationService", "getWechatSubscriptionStatus", {});
}

function saveWechatSubscription(data) {
  return callFunction("notificationService", "saveWechatSubscription", data);
}

function getCategoryReviewSubscriptionStatus() {
  return callFunction("notificationService", "getCategoryReviewSubscriptionStatus", {});
}

function saveCategoryReviewSubscription(data) {
  return callFunction("notificationService", "saveCategoryReviewSubscription", data);
}

function listCategoryReviews(data = {}) {
  return callFunction("quotationService", "reviewList", data);
}

function listCategoryReviewIds(data = {}) {
  return callFunction("quotationService", "reviewListIds", data);
}

function deleteCategoryReviews(ids) {
  const normalizedIds = Array.isArray(ids) ? ids : [ids];
  return callFunction("quotationService", "reviewDelete", { ids: normalizedIds });
}

function getCategoryReviewDetail(id) {
  return callFunction("quotationService", "reviewDetail", { id });
}

function getCategoryReviewPendingCount() {
  return callFunction("quotationService", "reviewPendingCount", {});
}

function submitCategoryReview(data) {
  return callFunction("quotationService", "reviewSubmit", data);
}

function quickRecord(data) {
  return callFunction("projectService", "quickRecord", data);
}

function getVouchers(projectId) {
  return callFunction("voucherService", "list", { projectId });
}

function getGlobalConfig(forceRefresh = true) {
  return callFunction("configService", "getGlobalConfig", { forceRefresh });
}

function queryConfigs(group, isActive = "all") {
  return callFunction("configService", "queryConfig", { group, isActive });
}

function createConfig(data) {
  return callFunction("configService", "createConfig", data);
}

function updateConfig(data) {
  return callFunction("configService", "updateConfig", data);
}

function updateConfigStatus(data) {
  return callFunction("configService", "updateConfigStatus", data);
}

function getConfigUsage(id, group) {
  return callFunction("configService", "getConfigUsage", { id, group });
}

function reorderConfig(data) {
  return callFunction("configService", "reorderConfig", data);
}

function deleteConfig(id, group) {
  return callFunction("configService", "deleteConfig", { id, group });
}

function addVoucher(data) {
  return callFunction("voucherService", "add", data);
}

function optimizeVoucherImageLossless(fileId) {
  return callFunction("voucherService", "optimizeImageLossless", { fileId });
}

function deleteVoucher(data) {
  return callFunction("voucherService", "delete", data);
}

function createExpense(data) {
  return callFunction("expenseService", "createExpense", data);
}

function checkDuplicateExpense(data) {
  return callFunction("expenseService", "checkDuplicateExpense", data);
}

function mergeExpense(data) {
  return callFunction("expenseService", "mergeExpense", data);
}

function createRecurringExpenseRule(data) {
  return callFunction("expenseService", "createRecurringRule", data);
}

function listExpenses(params = {}) {
  return callFunction("expenseService", "listExpenses", params);
}

function getExpenseAnalysis(params = {}) {
  return callFunction("expenseService", "getExpenseAnalysis", params);
}

function listRecurringExpenseRules(params = {}) {
  return callFunction("expenseService", "listRecurringRules", params);
}

function updateRecurringExpenseRule(data) {
  return callFunction("expenseService", "updateRecurringRule", data);
}

function stopRecurringExpenseRule(id) {
  return callFunction("expenseService", "stopRecurringRule", { id });
}

function deleteRecurringExpenseRule(id) {
  return callFunction("expenseService", "deleteRecurringRule", { id });
}

function updateExpense(data) {
  return callFunction("expenseService", "updateExpense", data);
}

function deleteExpense(id) {
  return callFunction("expenseService", "deleteExpense", { id });
}

module.exports = {
  addVoucher,
  optimizeVoucherImageLossless,
  cacheUserInfo,
  callFunction,
  clearSession,
  createAccount,
  createClient,
  createConfig,
  createExpense,
  checkDuplicateExpense,
  createRecurringExpenseRule,
  createProject,
  createProjectCase,
  createProjectQuotation,
  createProjectQuotationVersion,
  deleteClient,
  deleteConfig,
  deleteExpense,
  deleteProjects,
  deleteProjectQuotations,
  deleteProjectCase,
  deleteNotification,
  deleteNotifications,
  deleteCategoryReviews,
  deleteRecurringExpenseRule,
  deleteVoucher,
  ensureAuthOnShow,
  getProject,
  getCachedUserInfo,
  getCategoryReviewDetail,
  getCategoryReviewPendingCount,
  getCategoryReviewSubscriptionStatus,
  getExpenseAnalysis,
  getGlobalConfig,
  getConfigUsage,
  getNextEmployeeNo,
  getNextProjectQuotationVersion,
  getProjectOverview,
  getProjectQuotation,
  getPublicProjectQuotation,
  getProjectCase,
  getNotificationDetail,
  getNotificationUnreadCount,
  getServerDate,
  getToken,
  getUserInfo,
  updateUserInfo,
  uploadUserAvatar,
  getVouchers,
  getWechatSubscriptionStatus,
  listExpenses,
  listRecurringExpenseRules,
  listProjects,
  listAccounts,
  resetAccountPassword,
  updateAccountStatus,
  deleteAccount,
  sendPasswordChangeCode,
  changePasswordWithCode,
  sendBindEmailCode,
  bindEmailWithCode,
  isDevelopmentEnvironment,
  listCategoryReviews,
  listCategoryReviewIds,
  listManagedClients,
  listProjectIds,
  listFinancialProjects,
  listProjectCases,
  listProjectQuotationIds,
  listProjectQuotations,
  parseProjectQuotationExcel,
  prepareClientUpdate,
  prepareProjectQuotationShare,
  listNotificationIds,
  listNotifications,
  login,
  logout,
  markAllNotificationsRead,
  mergeExpense,
  saveWechatSubscription,
  saveCategoryReviewSubscription,
  setProjectCaseCover,
  stopRecurringExpenseRule,
  syncProjectToCase,
  submitCategoryReview,
  invalidateUserInfoCache,
  isUserInfoCacheFresh,
  quickRecord,
  queryClients,
  queryConfigs,
  reorderConfig,
  updateConfig,
  updateConfigStatus,
  updateExpense,
  updateRecurringExpenseRule,
  updateProject,
  updateClient,
  addProjectServiceRecord,
  listProjectServiceRecords,
  updateProjectServiceRecord,
  deleteProjectServiceRecord,
  updateAccountJobTitle,
};

