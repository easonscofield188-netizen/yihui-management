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
    url: '/getUserInfo',
    method: 'get'
  });
}
