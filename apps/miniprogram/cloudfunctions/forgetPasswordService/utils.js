/**
 * 功能：忘记密码云函数通用工具方法
 * 作者：Codex
 * 时间：2026-04-19
 */
'use strict';

const crypto = require('crypto');

/**
 * 功能：生成 sha256 哈希
 * @param {string} str 待哈希字符串
 * @returns {string} sha256 十六进制字符串
 * @throws {Error} 参数转换异常
 */
function sha256(str) {
  return crypto.createHash('sha256').update(String(str || '')).digest('hex');
}

/**
 * 功能：生成 6 位数字验证码
 * @returns {string} 6 位验证码
 * @throws {Error} 随机数生成异常
 */
function genCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

/**
 * 功能：生成安全随机 token
 * @returns {string} 随机 token
 * @throws {Error} 随机字节生成异常
 */
function genToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * 功能：基础邮箱格式校验
 * @param {string} email 邮箱地址
 * @returns {boolean} 是否合法
 * @throws {Error} 无
 */
function isEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

module.exports = {
  sha256,
  genCode,
  genToken,
  isEmail
};
