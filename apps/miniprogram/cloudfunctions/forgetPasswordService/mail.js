/**
 * 功能：SMTP 邮件发送工具
 * 作者：Codex
 * 时间：2026-04-19
 */
'use strict';

const nodemailer = require('nodemailer');

/**
 * 功能：读取 SMTP 配置
 * @returns {Object} SMTP 配置
 * @throws {Error} 配置缺失时抛出异常
 */
function getSmtpConfig() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 465);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user;
  const timeout = Number(process.env.SMTP_TIMEOUT_MS || 15000);

  if (!host || !port || !user || !pass) {
    throw new Error('SMTP 配置缺失');
  }

  return {
    host,
    port,
    user,
    pass,
    from,
    secure: port === 465,
    timeout
  };
}

/**
 * 功能：隐藏邮箱敏感信息，用于日志排查
 * @param {string} email 邮箱
 * @returns {string} 脱敏邮箱
 * @throws {Error} 无
 */
function maskEmail(email) {
  const value = String(email || '');
  const [name, domain] = value.split('@');
  if (!name || !domain) return value ? '***' : '';
  return `${name.slice(0, 2)}***@${domain}`;
}

/**
 * 功能：构建找回密码验证码邮件 HTML
 * @param {string} code 6 位验证码
 * @returns {string} HTML 内容
 * @throws {Error} 无
 */
function buildResetCodeHtml(code) {
  return `
    <div style="margin:0;padding:24px;background:#f6f8fb;font-family:Arial,'Microsoft YaHei',sans-serif;color:#1f2937;">
      <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:8px;padding:28px;border:1px solid #e5e7eb;">
        <h2 style="margin:0 0 16px;font-size:22px;color:#111827;">找回密码验证码</h2>
        <p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#4b5563;">您正在进行后台管理系统密码重置操作，请在页面中输入以下验证码：</p>
        <div style="margin:22px 0;padding:18px;background:#111827;color:#ffffff;border-radius:8px;text-align:center;font-size:32px;font-weight:700;letter-spacing:8px;">
          ${code}
        </div>
        <p style="margin:0 0 10px;font-size:14px;color:#4b5563;">验证码 5 分钟内有效。</p>
        <p style="margin:0;font-size:13px;color:#ef4444;">安全提示：请勿将验证码泄露给他人。如非本人操作，请忽略本邮件。</p>
      </div>
    </div>
  `;
}

/**
 * 功能：发送找回密码验证码邮件
 * @param {string} to 收件邮箱
 * @param {string} code 6 位验证码
 * @returns {Promise<Object>} 邮件发送结果
 * @throws {Error} SMTP 发送异常
 */
async function sendMail(to, code) {
  const config = getSmtpConfig();
  console.log('[forgetPasswordService] SMTP send start', {
    host: config.host,
    port: config.port,
    secure: config.secure,
    user: maskEmail(config.user),
    from: maskEmail(config.from),
    to: maskEmail(to)
  });

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    connectionTimeout: config.timeout,
    greetingTimeout: config.timeout,
    socketTimeout: config.timeout,
    auth: {
      user: config.user,
      pass: config.pass
    }
  });

  const result = await transporter.sendMail({
    from: config.from,
    to,
    subject: '找回密码验证码',
    html: buildResetCodeHtml(code)
  });

  console.log('[forgetPasswordService] SMTP send success', {
    accepted: result.accepted,
    rejected: result.rejected,
    response: result.response
  });

  return result;
}

module.exports = {
  sendMail
};
