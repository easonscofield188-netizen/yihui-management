import axios from 'axios';
import { ElMessage } from 'element-plus';

// 腾讯云开发 HTTP 访问服务默认域名
const rawBaseURL = import.meta.env.VITE_TCB_BASE_URL || '';
// 确保 baseURL 不以斜杠结尾
const baseURL = rawBaseURL.replace(/\/+$/, '');
console.log('🌐 Current API BaseURL:', baseURL || '(local)');

const service = axios.create({
  baseURL,
  timeout: 60000,
  headers: {
    'Content-Type': 'application/json'
  }
});

// 请求拦截器
service.interceptors.request.use(
  config => {
    // 确保 url 以斜杠开头，axios 会自动处理 baseURL 和 url 的拼接
    if (config.url && !config.url.startsWith('/')) {
      config.url = '/' + config.url;
    }
    
    const token = localStorage.getItem('token');
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }
    // 调试信息：输出完整请求路径，方便排查 Network Error
    const logData = config.data ? (typeof config.data === 'object' ? '{...}' : config.data) : '';
    console.log(`🚀 发起请求 [${config.method.toUpperCase()}]: ${config.baseURL}${config.url}`, logData);
    return config;
  },
  error => Promise.reject(error)
);

// 响应拦截器
service.interceptors.response.use(
  response => {
    const res = response.data;
    console.log('✅ 响应成功:', res);
    if (res.code !== 0 && res.code !== 200) {
      ElMessage.error(res.message || '请求失败');
      return Promise.reject(new Error(res.message || 'Error'));
    }
    return res;
  },
  error => {
    // 详细记录错误对象，方便在控制台查看具体原因（如 CORS、Timeout 等）
    console.error('❌ 网络请求失败详情:', error.message || error);
    
    let message = '网络错误，请稍后再试';
    if (!error.response) {
      // 没有响应通常意味着跨域被拦截、域名无法访问或云函数未开启 HTTP 访问
      message = '网络连接失败：请检查腾讯云控制台是否已将当前域名加入“安全域名”白名单，并确保云函数已开启 HTTP 访问服务';
      console.warn('💡 提示：如果是在本地或预览环境运行，请确保 VITE_TCB_BASE_URL 配置正确且已开启跨域允许');
    } else if (error.response.status === 404) {
      message = '接口不存在：请检查云函数 HTTP 访问路径是否配置正确';
    } else if (error.response.status === 401) {
      message = '登录状态已过期，请重新登录';
    }
    
    ElMessage.error({
      message,
      duration: 5000,
      showClose: true
    });
    return Promise.reject(error);
  }
);

export default service;
