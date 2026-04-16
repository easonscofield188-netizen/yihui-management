import request from '../utils/request';

/**
 * 登录接口
 * 对应腾讯云函数名: login
 * HTTP 访问路径: /login
 */
export function login(data) {
  return request({
    url: '/login',
    method: 'post',
    data
  });
}

/**
 * 获取用户信息 (示例)
 */
export function getInfo() {
  return request({
    url: '/login',
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
    url: '/login',
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
    url: '/login',
    method: 'post',
    data: {
      action: 'uploadAvatar',
      data
    }
  });
}
