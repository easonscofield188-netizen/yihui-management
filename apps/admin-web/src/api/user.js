import request from '../utils/request';

/**
 * 登录接口
 * 对应腾讯云函数名: loginService
 * HTTP 访问路径: /loginService
 */
export function loginService(data) {
  return request({
    url: '/loginService',
    method: 'post',
    data
  });
}

/**
 * 忘记密码接口
 * 对应腾讯云函数名: forgetPasswordService
 * HTTP 访问路径: /forgetPasswordService
 * @param {Object} data - { action, account, code, resetToken, newPassword }
 */
export function forgetPasswordService(data) {
  return request({
    url: '/forgetPasswordService',
    method: 'post',
    data
  });
}

/**
 * 获取用户信息 (示例)
 */
export function getInfo() {
  return request({
    url: '/loginService',
    method: 'post',
    data: {
      action: 'getUserInfo',
      data: {}
    }
  });
}

/**
 * 更新当前登录用户信息
 * @param {Object} data - 用户信息
 */
export function updateInfo(data) {
  return request({
    url: '/loginService',
    method: 'post',
    data: {
      action: 'updateUserInfo',
      data
    }
  });
}

/**
 * 上传用户头像
 * @param {Object} data - { file, fileName, fileType }
 */
export function uploadAvatar(data) {
  return request({
    url: '/loginService',
    method: 'post',
    data: {
      action: 'uploadAvatar',
      data
    }
  });
}

/**
 * 超级系统管理员创建登录账号
 * @param {Object} data - { username, passwordPlain, nickname, email, role }
 */
export function createAccount(data) {
  return request({
    url: '/loginService',
    method: 'post',
    data: {
      action: 'createAccount',
      data
    }
  });
}

export function getNextEmployeeNo(role) {
  return request({
    url: '/loginService',
    method: 'post',
    data: {
      action: 'getNextEmployeeNo',
      data: { role }
    }
  });
}
