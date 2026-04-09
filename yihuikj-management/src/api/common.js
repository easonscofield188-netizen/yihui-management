import request from '../utils/request';

/**
 * 客户查询接口
 * 对应腾讯云函数名: queryClients
 * HTTP 访问路径: /queryClients
 * @param {Object} data - { keyword: string }
 */
export function queryClients(data) {
  return request({
    url: '/queryClients',
    method: 'post',
    data
  });
}

/**
 * 配置数据查询接口
 * 对应腾讯云函数名: configService
 * HTTP 访问路径: /configService
 * @param {Object} data - { group: string, isActive: boolean }
 */
export function queryConfig(data) {
  return request({
    url: '/configService',
    method: 'post',
    data: {
      action: 'queryConfig',
      data
    }
  });
}

/**
 * 获取全局聚合配置（带服务器缓存）
 * 对应腾讯云函数名: configService
 * HTTP 访问路径: /configService
 * @param {Boolean} forceRefresh - 是否强制刷新数据库（跳过缓存）
 * 返回格式：{ CLIENT_ROLE: [...], CLIENT_SOURCE: [...], PROJECT_STATUS: [...] }
 */
export function getGlobalConfig(forceRefresh = false) {
  return request({
    url: '/configService',
    method: 'post',
    data: {
      action: 'getGlobalConfig',
      data: { forceRefresh } // 显式传递参数
    }
  });
}

/**
 * 记录凭证上传信息 (整合到 voucherService)
 * @param {Object} data - { projectId, fileName, fileId, fileUrl, fileSize, mimeType }
 */
export function addVoucher(data) {
  return request({
    url: '/voucherService',
    method: 'post',
    data: {
      action: 'add',
      data
    }
  });
}

/**
 * 获取项目凭证列表 (整合到 voucherService)
 * @param {Object} params - { projectId }
 */
export function getVouchers(params) {
  return request({
    url: '/voucherService',
    method: 'post',
    data: {
      action: 'list',
      data: params
    }
  });
}

/**
 * 删除项目凭证 (整合到 voucherService)
 * @param {Object} params - { id, fileId }
 */
export function deleteVoucher(params) {
  return request({
    url: '/voucherService',
    method: 'post',
    data: {
      action: 'delete',
      data: params
    }
  });
}

/**
 * 批量更新凭证所属项目 ID
 * @param {Object} params - { voucherIds: string[], projectId: string }
 */
export function updateVouchersProject(params) {
  return request({
    url: '/voucherService',
    method: 'post',
    data: {
      action: 'updateBatch',
      data: params
    }
  });
}

/**
 * 当项目名称修改时，同步修改云存储中的路径
 * @param {Object} params - { projectId: string, oldName: string, newName: string }
 */
export function renameProjectVouchers(params) {
  return request({
    url: '/voucherService',
    method: 'post',
    data: {
      action: 'renameProjectVouchers',
      data: params
    }
  });
}

/**
 * 创建新项目
 * @param {Object} data - 项目表单数据
 */
export function createProject(data) {
  return request({
    url: '/projectService',
    method: 'post',
    data: {
      action: 'create',
      data
    }
  });
}

/**
 * 获取项目列表
 */
export function listProjects() {
  return request({
    url: '/projectService',
    method: 'post',
    data: {
      action: 'list'
    }
  });
}

/**
 * 更新项目信息
 * @param {Object} data - 项目更新数据，需包含 id
 */
export function updateProject(data) {
  return request({
    url: '/projectService',
    method: 'post',
    data: {
      action: 'update',
      data
    }
  });
}

/**
 * 删除项目
 * @param {Object} params - { id }
 */
export function deleteProject(params) {
  return request({
    url: '/projectService',
    method: 'post',
    data: {
      action: 'delete',
      data: params
    }
  });
}

/**
 * 删除项目关联的所有凭证
 * @param {Object} params - { projectId }
 */
export function deleteVouchersByProject(params) {
  return request({
    url: '/voucherService',
    method: 'post',
    data: {
      action: 'deleteByProject',
      data: params
    }
  });
}
