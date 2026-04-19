/**
 * 功能：忘记密码邮箱验证码重置云函数
 * 作者：Codex
 * 时间：2026-04-19
 */
'use strict';

const cloud = require('wx-server-sdk');
const { sha256, genCode, genToken, isEmail } = require('./utils');
const { sendMail } = require('./mail');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const RESET_CODE_COLLECTION = 'password_reset_codes';
const USER_COLLECTION = 'users';
const SCENE_FORGOT_PASSWORD = 'forgot_password';
const RESET_CODE_TTL_MS = 5 * 60 * 1000;
const SEND_INTERVAL_MS = 60 * 1000;
const DAILY_SEND_LIMIT = 10;
const GENERIC_SEND_MESSAGE = '如果账号存在，验证码已发送到绑定邮箱';
const VERIFY_ERROR_MESSAGE = '验证码错误或已失效';

/**
 * 功能：解析 HTTP 或云调用请求体
 * @param {Object} event 云函数事件
 * @returns {Object} 请求体
 * @throws {Error} JSON 解析异常
 */
function parseBody(event) {
  if (event.body) {
    return typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  }
  return event || {};
}

/**
 * 功能：安全裁剪字符串
 * @param {*} value 原始值
 * @param {number} maxLength 最大长度
 * @returns {string} 裁剪后字符串
 * @throws {Error} 无
 */
function trimText(value, maxLength = 120) {
  return String(value || '').trim().slice(0, maxLength);
}

/**
 * 功能：构造验证码哈希，避免数据库存明文验证码
 * @param {string} code 验证码
 * @param {string} userId 用户 ID
 * @param {string} email 邮箱
 * @returns {string} 验证码哈希
 * @throws {Error} 无
 */
function buildCodeHash(code, userId, email) {
  const secret = process.env.RESET_CODE_SECRET || process.env.SMTP_PASS || '';
  return sha256(`${code}:${userId}:${email}:${secret}`);
}

/**
 * 功能：根据 username 或 email 查询用户
 * @param {string} account 账号或邮箱
 * @returns {Promise<Object|null>} 用户记录
 * @throws {Error} 数据库异常
 */
async function findUserByAccount(account) {
  const safeAccount = trimText(account);
  if (!safeAccount) return null;

  const usernameRes = await db.collection(USER_COLLECTION)
    .where({ username: safeAccount })
    .limit(1)
    .get();
  if (usernameRes.data && usernameRes.data.length) return usernameRes.data[0];

  const emailRes = await db.collection(USER_COLLECTION)
    .where({ email: safeAccount })
    .limit(1)
    .get();
  return emailRes.data && emailRes.data.length ? emailRes.data[0] : null;
}

/**
 * 功能：获取当天开始时间戳
 * @returns {number} 当天 00:00 时间戳
 * @throws {Error} 无
 */
function getTodayStartTime() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.getTime();
}

/**
 * 功能：检查账号发送频率
 * @param {string} userId 用户 ID
 * @returns {Promise<Object>} 限流结果
 * @throws {Error} 数据库异常
 */
async function checkSendLimit(userId) {
  const now = Date.now();
  const latestRes = await db.collection(RESET_CODE_COLLECTION)
    .where({
      userId,
      scene: SCENE_FORGOT_PASSWORD
    })
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();
  const latest = latestRes.data && latestRes.data[0];
  if (latest && now - Number(latest.createdAt || 0) < SEND_INTERVAL_MS) {
    return { limited: true };
  }

  const todayRes = await db.collection(RESET_CODE_COLLECTION)
    .where({
      userId,
      scene: SCENE_FORGOT_PASSWORD,
      createdAt: db.command.gte(getTodayStartTime())
    })
    .limit(DAILY_SEND_LIMIT + 1)
    .get();
  if ((todayRes.data || []).length >= DAILY_SEND_LIMIT) {
    return { limited: true };
  }

  // 预留：腾讯云函数 HTTP 场景可从 x-forwarded-for / x-real-ip 读取 IP，
  // 后续可新增同一 IP 每分钟、每日发送次数限制，避免撞库和邮件轰炸。
  return { limited: false };
}

/**
 * 功能：发送重置密码验证码
 * @param {Object} data 请求参数
 * @returns {Promise<Object>} 统一成功响应
 * @throws {Error} 内部捕获，避免泄露账号状态
 */
async function handleSendResetCode(data) {
  const account = trimText(data.account);
  if (!account) {
    return { code: 400, message: '账号不能为空' };
  }

  try {
    const user = await findUserByAccount(account);
    if (!user || !isEmail(user.email) || user.status === 'disabled') {
      console.log('[forgetPasswordService] skip send reset code: user missing, email missing, or disabled');
      return { code: 0, message: GENERIC_SEND_MESSAGE };
    }

    const limit = await checkSendLimit(user._id);
    if (limit.limited) {
      console.log('[forgetPasswordService] skip send reset code: rate limited', { userId: user._id });
      return { code: 0, message: GENERIC_SEND_MESSAGE };
    }

    const code = genCode();
    const now = Date.now();
    const expireAt = now + RESET_CODE_TTL_MS;

    const addRes = await db.collection(RESET_CODE_COLLECTION).add({
      data: {
        userId: user._id,
        email: user.email,
        codeHash: buildCodeHash(code, user._id, user.email),
        scene: SCENE_FORGOT_PASSWORD,
        expireAt,
        used: false,
        verified: false,
        verifyToken: '',
        createdAt: now,
        verifiedAt: null,
        usedAt: null,
        accountSnapshot: account
      }
    });

    try {
      await sendMail(user.email, code);
    } catch (mailError) {
      if (addRes && addRes._id) {
        await db.collection(RESET_CODE_COLLECTION).doc(addRes._id).update({
          data: {
            used: true,
            usedAt: Date.now(),
            failReason: 'mail_send_failed'
          }
        });
      }
      throw mailError;
    }
  } catch (error) {
    console.warn('发送找回密码验证码失败，已返回统一提示', error.message || error);
  }

  return { code: 0, message: GENERIC_SEND_MESSAGE };
}

/**
 * 功能：读取账号最新一条未使用验证码记录
 * @param {Object} user 用户记录
 * @returns {Promise<Object|null>} 验证码记录
 * @throws {Error} 数据库异常
 */
async function getLatestUnusedCode(user) {
  const res = await db.collection(RESET_CODE_COLLECTION)
    .where({
      userId: user._id,
      scene: SCENE_FORGOT_PASSWORD,
      used: false
    })
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();
  return res.data && res.data.length ? res.data[0] : null;
}

/**
 * 功能：校验邮箱验证码并返回 resetToken
 * @param {Object} data 请求参数
 * @returns {Promise<Object>} 验证结果
 * @throws {Error} 内部捕获并返回统一错误
 */
async function handleVerifyResetCode(data) {
  const account = trimText(data.account);
  const code = trimText(data.code, 6);
  if (!account || !/^\d{6}$/.test(code)) {
    return { code: 401, message: VERIFY_ERROR_MESSAGE };
  }

  try {
    const user = await findUserByAccount(account);
    if (!user || !isEmail(user.email)) {
      return { code: 401, message: VERIFY_ERROR_MESSAGE };
    }

    const record = await getLatestUnusedCode(user);
    if (!record || record.verified || Date.now() > Number(record.expireAt || 0)) {
      return { code: 401, message: VERIFY_ERROR_MESSAGE };
    }

    const codeHash = buildCodeHash(code, user._id, user.email);
    if (codeHash !== record.codeHash) {
      return { code: 401, message: VERIFY_ERROR_MESSAGE };
    }

    const resetToken = genToken();
    await db.collection(RESET_CODE_COLLECTION).doc(record._id).update({
      data: {
        verified: true,
        verifyToken: resetToken,
        verifiedAt: Date.now()
      }
    });

    return {
      code: 0,
      message: '验证成功',
      resetToken
    };
  } catch (error) {
    console.warn('校验找回密码验证码失败', error.message || error);
    return { code: 401, message: VERIFY_ERROR_MESSAGE };
  }
}

/**
 * 功能：根据 resetToken 重置密码
 * @param {Object} data 请求参数
 * @returns {Promise<Object>} 重置结果
 * @throws {Error} 内部捕获并返回统一错误
 */
async function handleResetPassword(data) {
  const resetToken = trimText(data.resetToken, 128);
  const newPassword = String(data.newPassword || '');

  if (!resetToken) {
    return { code: 401, message: '重置凭证错误或已失效' };
  }
  if (newPassword.length < 8) {
    return { code: 400, message: '新密码至少需要 8 位' };
  }

  try {
    const codeRes = await db.collection(RESET_CODE_COLLECTION)
      .where({
        verifyToken: resetToken,
        scene: SCENE_FORGOT_PASSWORD,
        verified: true,
        used: false
      })
      .limit(1)
      .get();
    const record = codeRes.data && codeRes.data[0];
    if (!record || Date.now() > Number(record.expireAt || 0)) {
      return { code: 401, message: '重置凭证错误或已失效' };
    }

    await db.collection(USER_COLLECTION).doc(record.userId).update({
      data: {
        passwordHash: sha256(newPassword),
        updatedAt: Date.now(),
        updateTime: db.serverDate()
      }
    });

    await db.collection(RESET_CODE_COLLECTION).doc(record._id).update({
      data: {
        used: true,
        usedAt: Date.now()
      }
    });

    return { code: 0, message: '密码修改成功' };
  } catch (error) {
    console.warn('重置密码失败', error.message || error);
    return { code: 500, message: '密码修改失败，请稍后再试' };
  }
}

exports.main = async (event, context) => {
  let body = {};
  try {
    body = parseBody(event);
  } catch (error) {
    return { code: 400, message: '请求格式错误' };
  }

  try {
    switch (body.action) {
      case 'sendResetCode':
        return await handleSendResetCode(body);
      case 'verifyResetCode':
        return await handleVerifyResetCode(body);
      case 'resetPassword':
        return await handleResetPassword(body);
      default:
        return { code: 400, message: '无效的操作类型' };
    }
  } catch (error) {
    console.warn('忘记密码服务异常', error.message || error);
    return { code: 500, message: '服务异常，请稍后再试' };
  }
};
