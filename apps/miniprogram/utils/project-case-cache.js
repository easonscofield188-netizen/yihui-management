const LIST_TTL_MS = 10 * 60 * 1000;
const DETAIL_TTL_MS = 30 * 60 * 1000;

let listCache = Object.create(null);
let detailCache = Object.create(null);
let imagePathCache = Object.create(null);
let listDirty = false;

function fresh(entry, ttl) {
  return Boolean(entry && Date.now() - entry.cachedAt < ttl);
}

function listKey(params = {}) {
  return [
    String(params.cacheScope || "anonymous"),
    String(params.categoryCode || ""),
    Math.max(1, Number(params.page) || 1),
    Math.max(1, Number(params.pageSize) || 10),
  ].join(":");
}

function getList(params) {
  const entry = listCache[listKey(params)];
  return fresh(entry, LIST_TTL_MS) ? entry.data : null;
}

function setList(params, data) {
  listCache[listKey(params)] = { data, cachedAt: Date.now() };
}

function invalidateList() {
  listCache = Object.create(null);
  listDirty = true;
}

function isListDirty() {
  return listDirty;
}

function markListFresh() {
  listDirty = false;
}

function getDetail(id) {
  const entry = detailCache[String(id || "")];
  return fresh(entry, DETAIL_TTL_MS) ? entry.data : null;
}

function setDetail(id, data) {
  if (!id || !data) return;
  detailCache[String(id)] = { data, cachedAt: Date.now() };
}

function invalidateDetail(id) {
  if (id) delete detailCache[String(id)];
}

function getImagePath(key) {
  return key ? imagePathCache[String(key)] || "" : "";
}

function setImagePath(key, path) {
  if (key && path) imagePathCache[String(key)] = path;
}

function removeImagePath(key) {
  if (key) delete imagePathCache[String(key)];
}

module.exports = {
  getDetail,
  getImagePath,
  getList,
  invalidateDetail,
  invalidateList,
  isListDirty,
  markListFresh,
  removeImagePath,
  setDetail,
  setImagePath,
  setList,
};
