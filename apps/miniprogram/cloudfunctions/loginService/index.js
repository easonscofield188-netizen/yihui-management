/**
 * 腾讯云函数: loginService
 * 运行环境: Node.js 16+
 * 适配: 微信云开发环境 + Web端 Axios 请求
 */
'use strict';

const cloud = require("wx-server-sdk");
const crypto = require('crypto');

// 初始化云开发环境
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV, // 自动使用当前云环境
});

const db = cloud.database();
const OPERATION_LOG_COLLECTION = 'operation_logs';
const SESSION_COLLECTION = 'auth_sessions';
// 24 小时无操作自动失效（有操作则滑动续期）
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const COMMON_IP_LOGIN_THRESHOLD = 2;
const MAX_LOGIN_IP_STATS = 20;

const nodemailer = require('nodemailer');

const ROOT_SUPER_ADMIN_NO = 'YH-ADMIN_SUPER-000';
const PROD_ENV_ID = 'yihui-management-d0ecax6657aaed0';

function isRootSuperAdmin(user) {
  if (!user) return false;
  const role = String(user.role || '').trim();
  const empNo = String(user.employeeNo || '').trim();
  return role === 'ADMIN_SUPER' && empNo === ROOT_SUPER_ADMIN_NO;
}

function isProductionEnvironment(event, data = {}) {
  const wxContext = cloud.getWXContext ? cloud.getWXContext() : {};
  const currentEnv = wxContext.ENV || process.env.TCB_ENV || process.env.SCF_NAMESPACE || '';
  if (currentEnv === PROD_ENV_ID) return true;

  const state = String(data._miniProgramState || event._miniProgramState || '').toLowerCase();
  if (state === 'formal') return true;

  return false;
}

exports.main = async (event, context) => {
  // --- 兼容性处理：解析请求体 ---
  // 如果是 Axios (HTTP 触发器) 调用，数据在 event.body 中
  // 如果是小程序内部调用，数据直接在 event 中
  let body = {};
  try {
    if (event.body) {
      body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    } else {
      body = event;
    }
  } catch (e) {
    return { code: 400, message: '请求格式错误' };
  }
  if (body.action) {
    const data = body.data || {};
    try {
      switch (body.action) {
        case 'getUserInfo':
          return await getUserInfo(data, event);
        case 'updateUserInfo':
          return await updateUserInfo(data, event);
        case 'uploadAvatar':
          return await uploadAvatar(data, event);
        case 'createAccount':
          return await createAccount(data, event);
        case 'getNextEmployeeNo':
          return await getNextEmployeeNo(data, event);
        case 'listAccounts':
          return await listAccounts(data, event);
        case 'resetAccountPassword':
          return await resetAccountPassword(data, event);
        case 'updateAccountStatus':
          return await updateAccountStatus(data, event);
        case 'deleteAccount':
          return await deleteAccount(data, event);
        case 'sendPasswordChangeCode':
          return await sendPasswordChangeCode(data, event);
        case 'changePasswordWithCode':
          return await changePasswordWithCode(data, event);
        case 'sendBindEmailCode':
          return await sendBindEmailCode(data, event);
        case 'bindEmailWithCode':
          return await bindEmailWithCode(data, event);
        case 'logout':
          return await logout(data, event);
        default:
          return { code: 400, message: '未知操作' };
      }
    } catch (err) {
      console.error('用户服务操作失败:', err);
      return { code: 500, message: '操作失败', error: err.message };
    }
  }

  const { username, passwordPlain, legacyPassword } = body;
  const password = body.password
    || (passwordPlain ? crypto.createHash('sha256').update(String(passwordPlain)).digest('hex') : '');
  const compatibleLegacyPassword = legacyPassword
    || (passwordPlain ? crypto.createHash('md5').update(String(passwordPlain)).digest('hex') : '');

  if (!username || !password) {
    return { code: 400, message: '账号或密码不能为空' };
  }

  try {
    // 在 users 集合中查询匹配的账号密码
    // 注意：前端已对密码进行 MD5 加密，因此数据库中存储的也应是 MD5 加密后的字符串
    const res = await db.collection('users').where({
      username: username
    }).get();
    const matchedUsers = res.data || [];
    const userWithPassword = matchedUsers.find(item => {
      if (item.passwordHash && item.passwordHash === password) return true;
      if (item.password && item.password === password) return true;
      if (compatibleLegacyPassword && item.password && item.password === compatibleLegacyPassword) return true;
      return false;
    });

    if (userWithPassword && userWithPassword.status && userWithPassword.status === 'disabled') {
      return { code: 403, message: '该账号已被停用，请联系超级系统管理员' };
    }

    const user = userWithPassword && (!userWithPassword.status || userWithPassword.status === 'active')
      ? userWithPassword
      : null;

    if (user) {
      const loginTime = new Date().toISOString();
      const clientIp = getClientIp(event);
      const ipResult = buildLoginIpStats(user.login_ip_stats, clientIp, loginTime);
      await db.collection('users').doc(user._id).update({
        data: {
          lastLoginTime: loginTime,
          last_login_ip: clientIp,
          login_ip_stats: ipResult.loginIpStats,
          common_login_ips: ipResult.commonLoginIps,
          updateTime: db.serverDate()
        }
      });

      if (ipResult.isUnusual) {
        await recordUnusualLoginLog(user, clientIp, event);
      }
      
      let finalAvatarUrl = user.avatarUrl || '';
      const finalAvatarFileId = user.avatarFileId || user.avatar_file_id || '';
      if (finalAvatarFileId && String(finalAvatarFileId).startsWith('cloud://') && (!finalAvatarUrl || finalAvatarUrl.startsWith('cloud://') || finalAvatarUrl.startsWith('http://tmp') || finalAvatarUrl.startsWith('wxfile://'))) {
        try {
          const urlRes = await cloud.getTempFileURL({ fileList: [finalAvatarFileId] });
          if (urlRes.fileList && urlRes.fileList[0] && urlRes.fileList[0].tempFileURL) {
            finalAvatarUrl = urlRes.fileList[0].tempFileURL;
          }
        } catch (e) {}
      }

      const session = await createSession(user._id, event);
      return {
        code: 0,
        message: '登录成功',
        data: {
          token: session.token,
          expiresAt: session.expiresAt,
          abnormalLoginWarning: ipResult.isUnusual,
          loginIp: clientIp,
          userInfo: {
            id: user._id,
            username: user.username,
            role: user.role || 'user',
            roleName: user.roleName || getRoleName(user.role),
            employeeNo: user.employeeNo || '',
            email: user.email || '',
            nickname: user.nickname || user.username,
            avatarUrl: finalAvatarUrl,
            avatarFileId: finalAvatarFileId,
            needPasswordChange: Boolean(user.needPasswordChange),
            lastLoginTime: loginTime
          }
        }
      };
    } else {
      return {
        code: 401,
        message: '账号或密码错误'
      };
    }
  } catch (err) {
    console.error('数据库查询错误:', err);
    return {
      code: 500,
      message: '服务器内部错误',
      error: err.message
    };
  }
};

function getAuthToken(data, event) {
  const headers = event.headers || {};
  const authorization = headers.authorization || headers.Authorization || '';
  return String(
    data.authToken
    || event.authToken
    || authorization.replace(/^Bearer\s+/i, '')
    || ''
  ).trim();
}

async function createSession(userId, event) {
  const now = Date.now();
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = now + SESSION_TTL_MS;
  const sessionData = {
    tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
    userId,
    expiresAt,
    lastActiveAt: now,
    clientIp: getClientIp(event),
    createTime: db.serverDate()
  };
  try {
    await db.collection(SESSION_COLLECTION).add({ data: sessionData });
  } catch (error) {
    if (!/collection|集合/i.test(error.message || '')) throw error;
    try {
      await db.createCollection(SESSION_COLLECTION);
    } catch (createError) {
      if (!/exist|已存在/i.test(createError.message || '')) throw createError;
    }
    await db.collection(SESSION_COLLECTION).add({ data: sessionData });
  }
  return { token, expiresAt };
}

async function touchSession(session) {
  if (!session || !session._id) return Number(session && session.expiresAt) || 0;
  const now = Date.now();
  const lastActiveAt = Number(session.lastActiveAt || 0);
  if (lastActiveAt && now - lastActiveAt < SESSION_TOUCH_INTERVAL_MS) {
    return Number(session.expiresAt || 0);
  }
  const expiresAt = now + SESSION_TTL_MS;
  try {
    await db.collection(SESSION_COLLECTION).doc(session._id).update({
      data: {
        lastActiveAt: now,
        expiresAt,
        updateTime: db.serverDate()
      }
    });
  } catch (error) {
    console.warn('会话续期失败:', error.message || error);
  }
  return expiresAt;
}

async function getSessionUserId(data, event) {
  const token = getAuthToken(data, event);
  if (!token) return '';
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const result = await db.collection(SESSION_COLLECTION).where({ tokenHash }).limit(1).get();
  const session = (result.data || [])[0];
  if (!session || Number(session.expiresAt || 0) <= Date.now()) {
    if (session && session._id) {
      db.collection(SESSION_COLLECTION).doc(session._id).remove().catch(() => {});
    }
    return '';
  }
  await touchSession(session);
  return session.userId || '';
}

function isSafeInput(str) {
  if (!str) return true;
  const unsafePattern = /[<>{}[\]\\^%`|]/;
  return !unsafePattern.test(str);
}

function getRoleName(role) {
  const roleMap = {
    ADMIN_SUPER: '超级系统管理员',
    ADMIN_COM: '系统管理员',
    ADMIN: '系统管理员',
    PROJECT_MANAGER: '项目经理',
    FINANCE_MANAGER: '项目主管',
    VISITOR: '普通访客',
    user: '普通用户'
  };
  return roleMap[role] || role || '系统管理员';
}

function getClientIp(event) {
  const headers = event.headers || {};
  const rawIp = headers['x-forwarded-for']
    || headers['X-Forwarded-For']
    || headers['x-real-ip']
    || headers['X-Real-IP']
    || headers['x-client-ip']
    || headers['X-Client-IP']
    || headers['x-original-forwarded-for']
    || headers['X-Original-Forwarded-For']
    || event.requestContext?.identity?.sourceIp
    || event.requestContext?.http?.sourceIp
    || '';
  return String(rawIp || '').split(',')[0].trim() || 'unknown';
}

function getUserAgent(event) {
  const headers = event.headers || {};
  return String(headers['user-agent'] || headers['User-Agent'] || '').slice(0, 240);
}

function buildLoginIpStats(rawStats, clientIp, loginTime) {
  const stats = Array.isArray(rawStats) ? rawStats : [];
  const hasClientIp = clientIp && clientIp !== 'unknown';
  const hasCommonIp = stats.some(item => Number(item.login_count || 0) >= COMMON_IP_LOGIN_THRESHOLD);
  const currentStat = hasClientIp ? stats.find(item => item.ip === clientIp) : null;
  const isUnusual = Boolean(hasClientIp && hasCommonIp && (!currentStat || Number(currentStat.login_count || 0) < COMMON_IP_LOGIN_THRESHOLD));
  const nextStats = stats
    .filter(item => item && item.ip && item.ip !== clientIp)
    .map(item => ({
      ip: item.ip,
      login_count: Number(item.login_count || 0),
      first_login_time: item.first_login_time || loginTime,
      last_login_time: item.last_login_time || loginTime
    }));

  if (hasClientIp) {
    nextStats.unshift({
      ip: clientIp,
      login_count: Number(currentStat?.login_count || 0) + 1,
      first_login_time: currentStat?.first_login_time || loginTime,
      last_login_time: loginTime
    });
  }

  const loginIpStats = nextStats
    .sort((a, b) => new Date(b.last_login_time).getTime() - new Date(a.last_login_time).getTime())
    .slice(0, MAX_LOGIN_IP_STATS);
  const commonLoginIps = loginIpStats
    .filter(item => Number(item.login_count || 0) >= COMMON_IP_LOGIN_THRESHOLD)
    .map(item => item.ip);

  return {
    isUnusual,
    loginIpStats,
    commonLoginIps
  };
}

async function recordUnusualLoginLog(user, clientIp, event) {
  try {
    const now = Date.now();
    await db.collection(OPERATION_LOG_COLLECTION).add({
      data: {
        uid: user._id,
        un: String(user.nickname || user.username || '').slice(0, 20),
        username: user.username || '',
        m: '安全登录',
        a: 'login',
        c: `账号 ${user.username || user._id} 使用非常用 IP ${clientIp} 登录`,
        s: '警告',
        ip: clientIp,
        user_agent: getUserAgent(event),
        ts: now,
        create_time: new Date(now).toISOString(),
        create_timestamp: now,
        createdAt: new Date(now).toISOString()
      }
    });
  } catch (error) {
    console.warn('非常用 IP 登录日志写入失败，已忽略', error.message || error);
  }
}

async function getCurrentUserDoc(data, event) {
  const token = getAuthToken(data, event);
  if (!token) {
    return { error: { code: 401, message: '请先登录' } };
  }
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const result = await db.collection(SESSION_COLLECTION).where({ tokenHash }).limit(1).get();
  const session = (result.data || [])[0];

  if (session && session.revoked) {
    if (session._id) {
      db.collection(SESSION_COLLECTION).doc(session._id).remove().catch(() => {});
    }
    return { error: { code: 401, message: session.revokeMessage || '您的账号已被强制下线，请重新登录' } };
  }

  if (!session || Number(session.expiresAt || 0) <= Date.now()) {
    if (session && session._id) {
      db.collection(SESSION_COLLECTION).doc(session._id).remove().catch(() => {});
    }
    return { error: { code: 401, message: '登录状态已失效，请重新登录' } };
  }

  const res = await db.collection('users').doc(session.userId).get();
  if (!res.data) {
    return { error: { code: 404, message: '用户不存在' } };
  }
  if (res.data.status && res.data.status !== 'active') {
    return { error: { code: 403, message: res.data.sessionRevokeMessage || '该账号已被超级系统管理员停用，所有权限已回收' } };
  }

  await touchSession(session);
  return { userId: session.userId, user: res.data };
}

function formatUser(user, userId) {
  return {
    id: userId || user._id || user.id,
    username: user.username,
    role: user.role || 'user',
    roleName: user.roleName || getRoleName(user.role),
    employeeNo: user.employeeNo || '',
    email: user.email || '',
    nickname: user.nickname || user.username,
    avatarUrl: user.avatarUrl || '',
    avatarFileId: user.avatarFileId || '',
    needPasswordChange: Boolean(user.needPasswordChange),
    lastLoginTime: user.lastLoginTime || user.updateTime || null
  };
}

async function getUserInfo(data, event) {
  const result = await getCurrentUserDoc(data, event);
  if (result.error) return result.error;

  const user = result.user;
  let avatarUrl = user.avatarUrl || '';
  const avatarFileId = user.avatarFileId || user.avatar_file_id || '';

  if (avatarFileId && avatarFileId.startsWith('cloud://') && (!avatarUrl || avatarUrl.startsWith('cloud://') || avatarUrl.startsWith('http://tmp') || avatarUrl.startsWith('wxfile://'))) {
    try {
      const urlRes = await cloud.getTempFileURL({ fileList: [avatarFileId] });
      if (urlRes.fileList && urlRes.fileList[0] && urlRes.fileList[0].tempFileURL) {
        avatarUrl = urlRes.fileList[0].tempFileURL;
      }
    } catch (e) {
      console.warn('解析用户头像直链失败:', e.message || e);
    }
  }

  const formatted = formatUser(user, result.userId);
  if (avatarUrl) formatted.avatarUrl = avatarUrl;
  if (avatarFileId) formatted.avatarFileId = avatarFileId;

  return {
    code: 0,
    message: '查询成功',
    data: formatted
  };
}

async function updateUserInfo(data, event) {
  const result = await getCurrentUserDoc(data, event);
  if (result.error) return result.error;

  const user = result.user;

  // 1. 强制当前登录密码鉴权
  const currentPassword = String(data.currentPassword || data.password || '').trim();
  if (!currentPassword) {
    return { code: 400, message: '请输入当前登录密码进行安全验证' };
  }

  const inputHash = crypto.createHash('sha256').update(currentPassword).digest('hex');
  const storedHash = user.passwordHash || '';
  const storedPlain = user.password || '';

  const isPasswordValid = (storedHash && inputHash === storedHash) || (storedPlain && currentPassword === storedPlain);
  if (!isPasswordValid) {
    return { code: 401, message: '当前登录密码验证错误，请重新输入' };
  }

  const updateData = {
    updatedAt: Date.now(),
    updateTime: db.serverDate()
  };

  const changedFields = [];

  // 2. 登录账号（username）修改与唯一性排重
  if (data.username !== undefined) {
    const nextUsername = String(data.username).trim();
    if (nextUsername && nextUsername !== user.username) {
      if (!/^[a-zA-Z0-9_]{3,32}$/.test(nextUsername)) {
        return { code: 400, message: '登录账号须为 3-32 位字母、数字或下划线' };
      }
      const duplicateRes = await db.collection('users').where({ username: nextUsername }).limit(1).get();
      const duplicate = (duplicateRes.data || [])[0];
      if (duplicate && String(duplicate._id || duplicate.id) !== String(result.userId)) {
        return { code: 409, message: '该登录账号已被他人使用，请更换其他账号名' };
      }
      updateData.username = nextUsername;
      changedFields.push(`账号: ${user.username} -> ${nextUsername}`);
    }
  }

  // 3. 用户昵称修改
  if (data.nickname !== undefined) {
    const nextNickname = String(data.nickname).trim();
    if (!nextNickname) {
      return { code: 400, message: '昵称不能为空' };
    }
    if (nextNickname.length > 30) {
      return { code: 400, message: '昵称长度不能超过 30 个字符' };
    }
    if (nextNickname !== user.nickname) {
      updateData.nickname = nextNickname;
      changedFields.push(`昵称: ${user.nickname || '-'} -> ${nextNickname}`);
    }
  }

  // 4. 头像修改
  if (data.avatarFileId && String(data.avatarFileId).trim().startsWith('cloud://')) {
    const fid = String(data.avatarFileId).trim();
    updateData.avatarFileId = fid;
    try {
      const urlRes = await cloud.getTempFileURL({ fileList: [fid] });
      if (urlRes.fileList && urlRes.fileList[0] && urlRes.fileList[0].tempFileURL) {
        updateData.avatarUrl = urlRes.fileList[0].tempFileURL;
      } else {
        updateData.avatarUrl = fid;
      }
    } catch (e) {
      updateData.avatarUrl = fid;
    }
    changedFields.push('头像图片');
  } else if (data.avatarUrl && !data.avatarUrl.startsWith('http://tmp') && !data.avatarUrl.startsWith('wxfile://')) {
    updateData.avatarUrl = String(data.avatarUrl).trim();
    changedFields.push('头像图片');
  }

  if (changedFields.length === 0) {
    return {
      code: 0,
      message: '资料无任何改动',
      data: formatUser(user, result.userId)
    };
  }

  // 5. 执行更新
  await db.collection('users').doc(result.userId).update({
    data: updateData
  });

  // 6. 记录审计日志
  const now = Date.now();
  await db.collection(OPERATION_LOG_COLLECTION).add({
    data: {
      uid: result.userId,
      un: String(updateData.nickname || user.nickname || user.username || '').slice(0, 20),
      username: updateData.username || user.username || '',
      m: '个人中心',
      a: 'update_profile',
      c: `用户安全更新个人资料：${changedFields.join('；')}`,
      s: '成功',
      ip: getClientIp(event),
      user_agent: getUserAgent(event),
      ts: now,
      create_time: new Date(now).toISOString(),
      create_timestamp: now,
      createdAt: new Date(now).toISOString()
    }
  }).catch(() => {});

  const latest = await db.collection('users').doc(result.userId).get();
  const formattedLatest = formatUser(latest.data, result.userId);
  if (updateData.avatarUrl) formattedLatest.avatarUrl = updateData.avatarUrl;
  if (updateData.avatarFileId) formattedLatest.avatarFileId = updateData.avatarFileId;

  return {
    code: 0,
    message: '个人资料修改成功',
    data: formattedLatest
  };
}

async function uploadAvatar(data, event) {
  const result = await getCurrentUserDoc(data, event);
  if (result.error) return result.error;

  const { file, fileName = 'avatar.png', fileType = 'image/png' } = data;
  if (!file) {
    return { code: 400, message: '缺少头像文件' };
  }

  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowedTypes.includes(fileType)) {
    return { code: 400, message: '头像仅支持 JPG、PNG、WebP' };
  }

  let base64Data = file;
  if (base64Data.startsWith('data:image/')) {
    base64Data = base64Data.split(',')[1];
  }

  const buffer = Buffer.from(base64Data, 'base64');
  if (buffer.length > 2 * 1024 * 1024) {
    return { code: 400, message: '头像大小不能超过 2MB' };
  }

  const extension = fileName.includes('.') ? fileName.substring(fileName.lastIndexOf('.')).toLowerCase() : '.png';
  const cloudPath = `admin/avatars/${result.userId}/${Date.now()}${extension}`;
  const uploadRes = await cloud.uploadFile({
    cloudPath,
    fileContent: buffer
  });
  const urlRes = await cloud.getTempFileURL({
    fileList: [uploadRes.fileID]
  });
  const avatarUrl = urlRes.fileList[0].tempFileURL;

  return {
    code: 0,
    message: '上传成功',
    data: {
      avatarUrl,
      avatarFileId: uploadRes.fileID
    }
  };
}

async function generateEmployeeNo(role) {
  const prefix = `YH-${role}-`;
  const result = await db.collection('users')
    .where({
      employeeNo: db.RegExp({
        regexp: `^${prefix}\\d+$`,
        options: ''
      })
    })
    .field({ employeeNo: true })
    .limit(1000)
    .get();

  const usedNumbers = new Set(
    (result.data || [])
      .map(u => {
        const m = String(u.employeeNo || '').match(/-(\d+)$/);
        return m ? parseInt(m[1], 10) : null;
      })
      .filter(n => n !== null && !isNaN(n))
  );

  // 从 001 开始分配最小未被占用的编号，确保被删除账号的工号能被自动释放复用
  let seq = 1;
  while (usedNumbers.has(seq)) {
    seq += 1;
  }
  return `${prefix}${String(seq).padStart(3, '0')}`;
}

async function createAccount(data, event) {
  const current = await getCurrentUserDoc(data, event);
  if (current.error) return current.error;
  if (current.user.role !== 'ADMIN_SUPER') {
    return { code: 403, message: '仅超级系统管理员可以创建账号' };
  }

  const username = String(data.username || '').trim();
  const nickname = String(data.nickname || '').trim();
  const email = String(data.email || '').trim().toLowerCase();
  const role = String(data.role || '').trim();
  const allowedRoles = new Set([
    'ADMIN_SUPER',
    'ADMIN_COM',
    'PROJECT_MANAGER',
    'FINANCE_MANAGER',
    'VISITOR'
  ]);

  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username)) {
    return { code: 400, message: '登录账号须为 3-32 位字母、数字、点、下划线或短横线' };
  }
  if (!nickname || nickname.length > 30 || !isSafeInput(nickname)) {
    return { code: 400, message: '请输入 1-30 位有效账户昵称' };
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { code: 400, message: '邮箱格式不正确' };
  }
  if (!allowedRoles.has(role)) {
    return { code: 400, message: '账号角色无效' };
  }

  const duplicateUsername = await db.collection('users').where({ username }).limit(1).get();
  if ((duplicateUsername.data || []).length) {
    return { code: 409, message: '登录账号已存在' };
  }
  if (email) {
    const duplicateEmail = await db.collection('users').where({ email }).limit(1).get();
    if ((duplicateEmail.data || []).length) {
      return { code: 409, message: '邮箱已被其他账号使用' };
    }
  }

  const defaultPassword = 'yh8888';
  const passwordHash = crypto.createHash('sha256').update(defaultPassword).digest('hex');

  const now = Date.now();
  const createdAt = new Date(now).toISOString();
  const roleName = getRoleName(role);
  const employeeNo = await generateEmployeeNo(role);
  const createResult = await db.collection('users').add({
    data: {
      username,
      email,
      password: '',
      passwordHash,
      needPasswordChange: true,
      passwordChangedAt: null,
      status: 'active',
      role,
      roleName,
      employeeNo,
      nickname,
      avatarUrl: '',
      avatarFileId: '',
      lastLoginTime: '',
      last_login_ip: '',
      common_login_ips: [],
      login_ip_stats: [],
      created_at: createdAt,
      createdAt: db.serverDate(),
      updateTime: db.serverDate(),
      updatedAt: now
    }
  });

  try {
    await db.collection(OPERATION_LOG_COLLECTION).add({
      data: {
        uid: current.userId,
        un: String(current.user.nickname || current.user.username || '').slice(0, 20),
        username: current.user.username || '',
        m: '账号管理',
        a: 'create',
        c: `创建账号 ${username}（${roleName}），初始密码默认为 yh8888`,
        s: '成功',
        ip: getClientIp(event),
        user_agent: getUserAgent(event),
        ts: now,
        create_time: createdAt,
        create_timestamp: now,
        createdAt
      }
    });
  } catch (error) {
    console.warn('创建账号操作日志写入失败，已忽略', error.message || error);
  }

  return {
    code: 0,
    message: `账号 ${username} 创建成功，初始密码默认为：${defaultPassword}`,
    data: {
      id: createResult._id,
      username,
      nickname,
      email,
      employeeNo,
      role,
      roleName,
      status: 'active',
      defaultPassword
    }
  };
}

async function getNextEmployeeNo(data, event) {
  const current = await getCurrentUserDoc(data, event);
  if (current.error) return current.error;
  if (current.user.role !== 'ADMIN_SUPER') {
    return { code: 403, message: '仅超级系统管理员可以查看待分配工号' };
  }
  const role = String(data.role || '').trim();
  const allowedRoles = new Set([
    'ADMIN_SUPER',
    'ADMIN_COM',
    'PROJECT_MANAGER',
    'FINANCE_MANAGER',
    'VISITOR'
  ]);
  if (!allowedRoles.has(role)) {
    return { code: 400, message: '账号角色无效' };
  }
  return {
    code: 0,
    message: '查询成功',
    data: { employeeNo: await generateEmployeeNo(role) }
  };
}

async function logout(data, event) {
  const token = getAuthToken(data, event);
  if (token) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await db.collection(SESSION_COLLECTION).where({ tokenHash }).remove();
  }
  return { code: 0, message: '已退出登录' };
}

async function listAccounts(data, event) {
  const current = await getCurrentUserDoc(data, event);
  if (current.error) return current.error;
  if (!isRootSuperAdmin(current.user)) {
    return { code: 403, message: '仅工号 000 的超级系统管理员拥有账号管理权限' };
  }

  const keyword = String(data.keyword || '').trim().toLowerCase();
  const status = String(data.status || 'ALL').trim().toUpperCase();
  const role = String(data.role || 'ALL').trim();

  const res = await db.collection('users').limit(1000).get();
  const allUsers = res.data || [];

  const filtered = allUsers.filter(item => {
    if (status !== 'ALL') {
      const userStatus = (item.status || 'active').toLowerCase();
      if (status === 'ACTIVE' && userStatus !== 'active') return false;
      if (status === 'DISABLED' && userStatus !== 'disabled') return false;
    }
    if (role !== 'ALL' && item.role !== role) {
      return false;
    }
    if (keyword) {
      const username = String(item.username || '').toLowerCase();
      const nickname = String(item.nickname || '').toLowerCase();
      const employeeNo = String(item.employeeNo || '').toLowerCase();
      const email = String(item.email || '').toLowerCase();
      const roleName = String(item.roleName || getRoleName(item.role)).toLowerCase();
      if (!username.includes(keyword) && !nickname.includes(keyword) && !employeeNo.includes(keyword) && !email.includes(keyword) && !roleName.includes(keyword)) {
        return false;
      }
    }
    return true;
  });

  // 排序：000 根管理员永远排在第一位，其他账号按创建时间降序
  filtered.sort((a, b) => {
    if (a.employeeNo === ROOT_SUPER_ADMIN_NO) return -1;
    if (b.employeeNo === ROOT_SUPER_ADMIN_NO) return 1;
    const timeA = new Date(a.createdAt || a.created_at || 0).getTime();
    const timeB = new Date(b.createdAt || b.created_at || 0).getTime();
    return timeB - timeA;
  });

  // 批量获取云存储头像的 HTTPS 真实临时访问 URL，确保跨端和各个界面 100% 正常显示
  const fileIdsToResolve = [];
  filtered.forEach(u => {
    const fid = u.avatarFileId || u.avatar_file_id || (u.avatarUrl && String(u.avatarUrl).startsWith('cloud://') ? u.avatarUrl : '');
    if (fid && String(fid).startsWith('cloud://')) {
      fileIdsToResolve.push(fid);
    }
  });

  let fileUrlMap = {};
  if (fileIdsToResolve.length > 0) {
    try {
      const urlRes = await cloud.getTempFileURL({
        fileList: Array.from(new Set(fileIdsToResolve))
      });
      (urlRes.fileList || []).forEach(f => {
        if (f.fileID && f.tempFileURL) {
          fileUrlMap[f.fileID] = f.tempFileURL;
        }
      });
    } catch (e) {
      console.warn('获取用户头像临时直链失败:', e.message || e);
    }
  }

  const list = filtered.map(item => {
    const fid = item.avatarFileId || item.avatar_file_id || (item.avatarUrl && String(item.avatarUrl).startsWith('cloud://') ? item.avatarUrl : '') || '';
    const resolvedUrl = fileUrlMap[fid] || '';
    const rawUrl = String(item.avatarUrl || '').trim();
    const finalAvatarUrl = resolvedUrl || (!rawUrl.startsWith('http://tmp') && !rawUrl.startsWith('wxfile://') ? rawUrl : '') || fid;

    return {
      id: item._id,
      _id: item._id,
      username: item.username,
      nickname: item.nickname || item.username,
      avatarUrl: finalAvatarUrl,
      avatarFileId: fid,
      role: item.role,
      roleName: item.roleName || getRoleName(item.role),
      employeeNo: item.employeeNo || '',
      email: item.email || '',
      status: item.status || 'active',
      statusLabel: item.status === 'disabled' ? '已停用' : '正常',
      isRootAdmin: item.employeeNo === ROOT_SUPER_ADMIN_NO,
      lastLoginTime: item.lastLoginTime || null,
      createdAt: item.createdAt || item.created_at || null
    };
  });

  return {
    code: 0,
    message: '查询成功',
    data: {
      list,
      total: list.length,
      activeCount: allUsers.filter(u => (u.status || 'active') === 'active').length,
      disabledCount: allUsers.filter(u => u.status === 'disabled').length
    }
  };
}

async function resetAccountPassword(data, event) {
  const current = await getCurrentUserDoc(data, event);
  if (current.error) return current.error;
  if (!isRootSuperAdmin(current.user)) {
    return { code: 403, message: '仅工号 000 的超级系统管理员拥有重置密码权限' };
  }

  const targetId = String(data.userId || data.id || '').trim();
  if (!targetId) {
    return { code: 400, message: '缺少目标账号 ID' };
  }

  let targetUser;
  try {
    const res = await db.collection('users').doc(targetId).get();
    targetUser = res.data;
  } catch (e) {
    return { code: 404, message: '目标账号不存在' };
  }

  if (!targetUser) {
    return { code: 404, message: '目标账号不存在' };
  }

  const defaultPassword = 'yh8888';
  const newHash = crypto.createHash('sha256').update(defaultPassword).digest('hex');
  const revokeMessage = `您的账号密码已被超级系统管理员重置为默认密码（${defaultPassword}），已被强制下线，请使用新密码重新登录。`;

  await db.collection('users').doc(targetId).update({
    data: {
      password: '',
      passwordHash: newHash,
      needPasswordChange: true,
      sessionRevokeReason: 'PASSWORD_RESET',
      sessionRevokeMessage: revokeMessage,
      updatedAt: Date.now(),
      updateTime: db.serverDate()
    }
  });

  // 标记该账号所有活跃会话为已注销并携带下线原因
  await db.collection(SESSION_COLLECTION).where({
    userId: targetId
  }).update({
    data: {
      revoked: true,
      revokeReason: 'PASSWORD_RESET',
      revokeMessage: revokeMessage,
      expiresAt: 0
    }
  }).catch(() => {});

  // 记录审计日志
  const now = Date.now();
  const createdAt = new Date(now).toISOString();
  await db.collection(OPERATION_LOG_COLLECTION).add({
    data: {
      uid: current.userId,
      un: String(current.user.nickname || current.user.username || '').slice(0, 20),
      username: current.user.username || '',
      m: '账号管理',
      a: 'reset_password',
      c: `重置账号 ${targetUser.username}（${targetUser.employeeNo || targetUser.nickname}）的登录密码为默认密码 yh8888`,
      s: '成功',
      ip: getClientIp(event),
      user_agent: getUserAgent(event),
      ts: now,
      create_time: createdAt,
      create_timestamp: now,
      createdAt
    }
  }).catch(err => console.warn('记录重置密码日志失败:', err));

  return {
    code: 0,
    message: `账号 ${targetUser.username} 的密码已重置为：yh8888`,
    data: {
      userId: targetId,
      username: targetUser.username,
      defaultPassword
    }
  };
}

async function updateAccountStatus(data, event) {
  const current = await getCurrentUserDoc(data, event);
  if (current.error) return current.error;
  if (!isRootSuperAdmin(current.user)) {
    return { code: 403, message: '仅工号 000 的超级系统管理员拥有停用/启用账号权限' };
  }

  const targetId = String(data.userId || data.id || '').trim();
  const nextStatus = String(data.status || '').trim().toLowerCase();

  if (!targetId || !['active', 'disabled'].includes(nextStatus)) {
    return { code: 400, message: '参数无效' };
  }

  let targetUser;
  try {
    const res = await db.collection('users').doc(targetId).get();
    targetUser = res.data;
  } catch (e) {
    return { code: 404, message: '目标账号不存在' };
  }

  if (!targetUser) {
    return { code: 404, message: '目标账号不存在' };
  }

  // 核心安全保护：YH-ADMIN_SUPER-000 绝对不允许被停用！
  if (targetUser.employeeNo === ROOT_SUPER_ADMIN_NO && nextStatus === 'disabled') {
    return { code: 400, message: '系统主管理员账号（YH-ADMIN_SUPER-000）不可停用' };
  }

  const revokeMessage = `您的账号已被超级系统管理员停用，已回收全部系统访问权限。如有疑问请联系管理员。`;
  const updateData = {
    status: nextStatus,
    updatedAt: Date.now(),
    updateTime: db.serverDate()
  };
  if (nextStatus === 'disabled') {
    updateData.sessionRevokeReason = 'DISABLED';
    updateData.sessionRevokeMessage = revokeMessage;
  } else {
    updateData.sessionRevokeReason = '';
    updateData.sessionRevokeMessage = '';
  }

  await db.collection('users').doc(targetId).update({
    data: updateData
  });

  // 如果是停用，标记该账号所有活跃会话为已注销并携带原因
  if (nextStatus === 'disabled') {
    await db.collection(SESSION_COLLECTION).where({
      userId: targetId
    }).update({
      data: {
        revoked: true,
        revokeReason: 'DISABLED',
        revokeMessage: revokeMessage,
        expiresAt: 0
      }
    }).catch(() => {});
  }

  // 记录审计日志
  const now = Date.now();
  const createdAt = new Date(now).toISOString();
  const actionLabel = nextStatus === 'disabled' ? '停用账号' : '启用账号';
  await db.collection(OPERATION_LOG_COLLECTION).add({
    data: {
      uid: current.userId,
      un: String(current.user.nickname || current.user.username || '').slice(0, 20),
      username: current.user.username || '',
      m: '账号管理',
      a: nextStatus === 'disabled' ? 'disable_account' : 'enable_account',
      c: `${actionLabel} ${targetUser.username}（工号：${targetUser.employeeNo || '-'}，角色：${targetUser.roleName || targetUser.role}）`,
      s: '成功',
      ip: getClientIp(event),
      user_agent: getUserAgent(event),
      ts: now,
      create_time: createdAt,
      create_timestamp: now,
      createdAt
    }
  }).catch(err => console.warn('记录停用/启用日志失败:', err));

  return {
    code: 0,
    message: nextStatus === 'disabled' ? `账号 ${targetUser.username} 已停用并强制下线` : `账号 ${targetUser.username} 已成功启用`,
    data: {
      userId: targetId,
      username: targetUser.username,
      status: nextStatus
    }
  };
}

async function deleteAccount(data, event) {
  const current = await getCurrentUserDoc(data, event);
  if (current.error) return current.error;
  if (!isRootSuperAdmin(current.user)) {
    return { code: 403, message: '仅工号 000 的超级系统管理员拥有删除账号权限' };
  }

  // 生产环境严禁删除账号
  if (isProductionEnvironment(event, data)) {
    return { code: 403, message: '生产环境严禁删除账号' };
  }

  const targetId = String(data.userId || data.id || '').trim();
  if (!targetId) {
    return { code: 400, message: '缺少目标账号 ID' };
  }

  let targetUser;
  try {
    const res = await db.collection('users').doc(targetId).get();
    targetUser = res.data;
  } catch (e) {
    return { code: 404, message: '目标账号不存在' };
  }

  if (!targetUser) {
    return { code: 404, message: '目标账号不存在' };
  }

  // 核心安全保护：系统主管理员账号绝对不允许被删除
  if (targetUser.employeeNo === ROOT_SUPER_ADMIN_NO) {
    return { code: 400, message: '系统主管理员账号（YH-ADMIN_SUPER-000）不可删除' };
  }

  // 1. 从 users 集合中彻底删除
  await db.collection('users').doc(targetId).remove();

  // 2. 清理该账号的所有活跃会话
  await db.collection(SESSION_COLLECTION).where({
    userId: targetId
  }).remove().catch(() => {});

  // 3. 记录审计日志
  const now = Date.now();
  const createdAt = new Date(now).toISOString();
  await db.collection(OPERATION_LOG_COLLECTION).add({
    data: {
      uid: current.userId,
      un: String(current.user.nickname || current.user.username || '').slice(0, 20),
      username: current.user.username || '',
      m: '账号管理',
      a: 'delete_account',
      c: `【开发环境】删除账号 ${targetUser.username}（工号：${targetUser.employeeNo || '-'}，角色：${targetUser.roleName || targetUser.role}），员工工号已释放`,
      s: '成功',
      ip: getClientIp(event),
      user_agent: getUserAgent(event),
      ts: now,
      create_time: createdAt,
      create_timestamp: now,
      createdAt
    }
  }).catch(err => console.warn('记录删除账号日志失败:', err));

  return {
    code: 0,
    message: `账号 ${targetUser.username} 已删除，工号【${targetUser.employeeNo || '-'}】已成功释放`,
    data: {
      userId: targetId,
      username: targetUser.username,
      releasedEmployeeNo: targetUser.employeeNo || ''
    }
  };
}

const RESET_CODE_COLLECTION = 'password_reset_codes';

async function getSmtpConfig() {
  let host = process.env.SMTP_HOST || '';
  let port = Number(process.env.SMTP_PORT || 0);
  let user = process.env.SMTP_USER || '';
  let pass = process.env.SMTP_PASS || '';
  let from = process.env.SMTP_FROM || '';
  let timeout = Number(process.env.SMTP_TIMEOUT_MS || 15000);

  // 若云函数环境变量未配置完整，尝试从 system_configs 集合中自动查询
  if (!host || !user || !pass) {
    try {
      const configRes = await db.collection('system_configs')
        .where({ group: 'SMTP_CONFIG' })
        .limit(1)
        .get()
        .catch(() => ({ data: [] }));

      let configItem = (configRes.data || [])[0];
      if (!configItem) {
        const fallbackRes = await db.collection('system_configs')
          .where({ key: 'smtp_config' })
          .limit(1)
          .get()
          .catch(() => ({ data: [] }));
        configItem = (fallbackRes.data || [])[0];
      }

      if (configItem) {
        const val = typeof configItem.value === 'object' && configItem.value !== null
          ? configItem.value
          : (typeof configItem.value === 'string' && configItem.value.startsWith('{') ? JSON.parse(configItem.value) : {});
        host = host || configItem.host || val.host || 'smtp.163.com';
        port = port || Number(configItem.port || val.port || 465);
        user = user || configItem.user || val.user || '';
        pass = pass || configItem.pass || val.pass || '';
        from = from || configItem.from || val.from || user;
      }
    } catch (dbErr) {
      console.warn('从 system_configs 尝试读取 SMTP 失败:', dbErr);
    }
  }

  host = host || 'smtp.163.com';
  port = port || 465;
  from = from || user;

  if (!user || !pass) {
    throw new Error('SMTP 邮件服务配置缺失：未配置发件人账号或授权码（请在微信云开发控制台 loginService 云函数环境变量中配置 SMTP_HOST / SMTP_USER / SMTP_PASS，或在 system_configs 数据表中添加配置项）');
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

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function maskEmail(email) {
  const value = String(email || '').trim();
  const [name, domain] = value.split('@');
  if (!name || !domain) return value ? '***' : '';
  return `${name.slice(0, 2)}***@${domain}`;
}

function buildChangePasswordCodeHtml(code, username) {
  return `
    <div style="margin:0;padding:28px 16px;background:#f4f6fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a273a;">
      <div style="max-width:540px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px 28px;border:1px solid #e2e8f2;box-shadow:0 8px 24px rgba(0,32,69,0.06);">
        <div style="display:flex;align-items:center;margin-bottom:20px;">
          <h2 style="margin:0;font-size:20px;color:#002045;font-weight:700;">亿辉艺术 · 密码修改安全验证</h2>
        </div>
        <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#4a5568;">尊敬的 <strong>${escapeHtml(username)}</strong>，您好：</p>
        <p style="margin:0 0 20px;font-size:14px;line-height:1.7;color:#4a5568;">您正在通过微信小程序进行登录密码修改操作，本次身份验证码为：</p>
        <div style="margin:24px 0;padding:18px;background:#002045;color:#ffffff;border-radius:12px;text-align:center;font-size:32px;font-weight:700;letter-spacing:8px;">
          ${code}
        </div>
        <p style="margin:0 0 10px;font-size:13px;color:#718096;">• 验证码有效期为 <strong>5 分钟</strong>，请勿将验证码泄露给他人。</p>
        <p style="margin:0 0 24px;font-size:13px;color:#e53e3e;">• 如非本人操作，请忽略此邮件并联系管理员检查账号安全。</p>
        <div style="border-top:1px solid #edf2f7;padding-top:16px;font-size:12px;color:#a0aec0;text-align:center;">
          杭州亿辉文化创意有限公司 · 项目管理系统
        </div>
      </div>
    </div>
  `;
}

function buildCodeHash(code, userId, email) {
  const secret = process.env.RESET_CODE_SECRET || process.env.SMTP_PASS || 'yihui-pwd-salt';
  return crypto.createHash('sha256').update(`${code}:${userId}:${email}:${secret}`).digest('hex');
}

async function sendPasswordChangeCode(data, event) {
  const current = await getCurrentUserDoc(data, event);
  if (current.error) return current.error;

  const email = String(current.user.email || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { code: 400, message: '当前账号尚未绑定有效邮箱，请联系超级管理员配置邮箱' };
  }

  // 校验发送频次（60 秒冷却）
  const now = Date.now();
  const recentCodes = await db.collection(RESET_CODE_COLLECTION)
    .where({
      userId: current.userId,
      scene: 'change_password',
      createdAt: db.command ? db.command.gte(now - 60 * 1000) : (now - 60 * 1000)
    })
    .limit(1)
    .get().catch(() => ({ data: [] }));

  if ((recentCodes.data || []).length > 0) {
    return { code: 429, message: '验证码发送太频繁，请 60 秒后再试' };
  }

  // 生成 6 位纯数字验证码
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const codeHash = buildCodeHash(code, current.userId, email);
  const expiresAt = now + 5 * 60 * 1000; // 5分钟有效

  // 写入验证码记录
  try {
    await db.collection(RESET_CODE_COLLECTION).add({
      data: {
        userId: current.userId,
        username: current.user.username,
        email,
        codeHash,
        scene: 'change_password',
        expiresAt,
        used: false,
        createdAt: now
      }
    });
  } catch (dbErr) {
    try {
      await db.createCollection(RESET_CODE_COLLECTION);
      await db.collection(RESET_CODE_COLLECTION).add({
        data: {
          userId: current.userId,
          username: current.user.username,
          email,
          codeHash,
          scene: 'change_password',
          expiresAt,
          used: false,
          createdAt: now
        }
      });
    } catch (createErr) {
      console.error('写入验证码集合失败:', createErr);
    }
  }

  // 发送邮件
  try {
    const smtpConfig = await getSmtpConfig();
    const transporter = nodemailer.createTransport({
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: smtpConfig.secure,
      connectionTimeout: smtpConfig.timeout,
      auth: {
        user: smtpConfig.user,
        pass: smtpConfig.pass
      }
    });

    await transporter.sendMail({
      from: smtpConfig.from,
      to: email,
      subject: '【亿辉管理】修改密码安全验证码',
      html: buildChangePasswordCodeHtml(code, current.user.nickname || current.user.username)
    });
  } catch (mailErr) {
    console.error('发送验证码邮件失败:', mailErr);
    return { code: 500, message: `邮件发送失败：${mailErr.message || '请检查系统 SMTP 邮箱配置'}` };
  }

  return {
    code: 0,
    message: `验证码已发送至邮箱 ${maskEmail(email)}`,
    data: {
      maskedEmail: maskEmail(email)
    }
  };
}

async function changePasswordWithCode(data, event) {
  const current = await getCurrentUserDoc(data, event);
  if (current.error) return current.error;

  const code = String(data.code || '').trim();
  const newPassword = String(data.newPassword || '').trim();

  if (!code || code.length !== 6) {
    return { code: 400, message: '请输入 6 位邮箱验证码' };
  }
  if (!newPassword || newPassword.length < 6 || newPassword.length > 64) {
    return { code: 400, message: '新密码长度须为 6-64 位' };
  }

  const email = String(current.user.email || '').trim().toLowerCase();
  const expectedHash = buildCodeHash(code, current.userId, email);
  const now = Date.now();

  const codeRes = await db.collection(RESET_CODE_COLLECTION)
    .where({
      userId: current.userId,
      scene: 'change_password',
      codeHash: expectedHash,
      used: false
    })
    .limit(1)
    .get();

  const record = (codeRes.data || [])[0];
  if (!record || Number(record.expiresAt || 0) < now) {
    return { code: 400, message: '验证码错误或已过期，请重新获取' };
  }

  // 标记验证码已使用
  await db.collection(RESET_CODE_COLLECTION).doc(record._id).update({
    data: { used: true, usedAt: now }
  }).catch(() => {});

  // 更新用户密码
  const newHash = crypto.createHash('sha256').update(newPassword).digest('hex');
  await db.collection('users').doc(current.userId).update({
    data: {
      password: '',
      passwordHash: newHash,
      needPasswordChange: false,
      passwordChangedAt: now,
      sessionRevokeReason: '',
      sessionRevokeMessage: '',
      updatedAt: now,
      updateTime: db.serverDate()
    }
  });

  // 记录审计日志
  await db.collection(OPERATION_LOG_COLLECTION).add({
    data: {
      uid: current.userId,
      un: String(current.user.nickname || current.user.username || '').slice(0, 20),
      username: current.user.username || '',
      m: '账号安全',
      a: 'change_password',
      c: `用户 ${current.user.username} 通过邮箱验证码修改登录密码成功`,
      s: '成功',
      ip: getClientIp(event),
      user_agent: getUserAgent(event),
      ts: now,
      create_time: new Date(now).toISOString(),
      create_timestamp: now,
      createdAt: new Date(now).toISOString()
    }
  }).catch(() => {});

  return {
    code: 0,
    message: '密码修改成功'
  };
}

function buildBindEmailCodeHtml(code, username) {
  return `
    <div style="margin:0;padding:28px 16px;background:#f4f6fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a273a;">
      <div style="max-width:540px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px 28px;border:1px solid #e2e8f2;box-shadow:0 8px 24px rgba(0,32,69,0.06);">
        <div style="display:flex;align-items:center;margin-bottom:20px;">
          <h2 style="margin:0;font-size:20px;color:#002045;font-weight:700;">亿辉艺术 · 安全邮箱绑定验证</h2>
        </div>
        <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#4a5568;">尊敬的 <strong>${escapeHtml(username)}</strong>，您好：</p>
        <p style="margin:0 0 20px;font-size:14px;line-height:1.7;color:#4a5568;">您正在通过微信小程序进行安全邮箱绑定操作，本次身份验证码为：</p>
        <div style="margin:24px 0;padding:18px;background:#002045;color:#ffffff;border-radius:12px;text-align:center;font-size:32px;font-weight:700;letter-spacing:8px;">
          ${code}
        </div>
        <p style="margin:0 0 10px;font-size:13px;color:#718096;">• 验证码有效期为 <strong>5 分钟</strong>，请勿将验证码泄露给他人。</p>
        <p style="margin:0 0 24px;font-size:13px;color:#e53e3e;">• 如非本人操作，请忽略此邮件并联系管理员检查账号安全。</p>
        <div style="border-top:1px solid #edf2f7;padding-top:16px;font-size:12px;color:#a0aec0;text-align:center;">
          杭州亿辉文化创意有限公司 · 项目管理系统
        </div>
      </div>
    </div>
  `;
}

async function sendBindEmailCode(data, event) {
  const current = await getCurrentUserDoc(data, event);
  if (current.error) return current.error;

  const email = String(data.email || '').trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { code: 400, message: '请输入有效的邮箱地址' };
  }

  // 检查该邮箱是否已被其他用户绑定
  const duplicate = await db.collection('users').where({ email }).limit(1).get();
  const existingUser = (duplicate.data || [])[0];
  if (existingUser && String(existingUser._id || existingUser.id) !== String(current.userId)) {
    return { code: 409, message: '该邮箱已被其他账号绑定，请更换其他邮箱' };
  }

  // 校验发送频次（60 秒冷却）
  const now = Date.now();
  const recentCodes = await db.collection(RESET_CODE_COLLECTION)
    .where({
      userId: current.userId,
      scene: 'bind_email',
      createdAt: db.command ? db.command.gte(now - 60 * 1000) : (now - 60 * 1000)
    })
    .limit(1)
    .get().catch(() => ({ data: [] }));

  if ((recentCodes.data || []).length > 0) {
    return { code: 429, message: '验证码发送太频繁，请 60 秒后再试' };
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const codeHash = buildCodeHash(code, current.userId, email);
  const expiresAt = now + 5 * 60 * 1000;

  try {
    await db.collection(RESET_CODE_COLLECTION).add({
      data: {
        userId: current.userId,
        username: current.user.username,
        email,
        codeHash,
        scene: 'bind_email',
        expiresAt,
        used: false,
        createdAt: now
      }
    });
  } catch (dbErr) {
    try {
      await db.createCollection(RESET_CODE_COLLECTION);
      await db.collection(RESET_CODE_COLLECTION).add({
        data: {
          userId: current.userId,
          username: current.user.username,
          email,
          codeHash,
          scene: 'bind_email',
          expiresAt,
          used: false,
          createdAt: now
        }
      });
    } catch (createErr) {
      console.error('写入验证码集合失败:', createErr);
    }
  }

  try {
    const smtpConfig = await getSmtpConfig();
    const transporter = nodemailer.createTransport({
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: smtpConfig.secure,
      connectionTimeout: smtpConfig.timeout,
      auth: {
        user: smtpConfig.user,
        pass: smtpConfig.pass
      }
    });

    await transporter.sendMail({
      from: smtpConfig.from,
      to: email,
      subject: '【亿辉管理】安全邮箱绑定验证码',
      html: buildBindEmailCodeHtml(code, current.user.nickname || current.user.username)
    });
  } catch (mailErr) {
    console.error('发送绑定邮箱验证码失败:', mailErr);
    return { code: 500, message: `邮件发送失败：${mailErr.message || '请检查系统 SMTP 邮箱配置'}` };
  }

  return {
    code: 0,
    message: `验证码已发送至邮箱 ${maskEmail(email)}`,
    data: {
      email,
      maskedEmail: maskEmail(email)
    }
  };
}

async function bindEmailWithCode(data, event) {
  const current = await getCurrentUserDoc(data, event);
  if (current.error) return current.error;

  const email = String(data.email || '').trim().toLowerCase();
  const code = String(data.code || '').trim();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { code: 400, message: '请输入有效的邮箱地址' };
  }
  if (!code || code.length !== 6) {
    return { code: 400, message: '请输入 6 位邮箱验证码' };
  }

  // 二次检查是否被其他用户抢先绑定
  const duplicate = await db.collection('users').where({ email }).limit(1).get();
  const existingUser = (duplicate.data || [])[0];
  if (existingUser && String(existingUser._id || existingUser.id) !== String(current.userId)) {
    return { code: 409, message: '该邮箱已被其他账号绑定，请更换其他邮箱' };
  }

  const expectedHash = buildCodeHash(code, current.userId, email);
  const now = Date.now();

  const codeRes = await db.collection(RESET_CODE_COLLECTION)
    .where({
      userId: current.userId,
      scene: 'bind_email',
      codeHash: expectedHash,
      used: false
    })
    .limit(1)
    .get();

  const record = (codeRes.data || [])[0];
  if (!record || Number(record.expiresAt || 0) < now) {
    return { code: 400, message: '验证码错误或已过期，请重新获取' };
  }

  // 标记验证码已使用
  await db.collection(RESET_CODE_COLLECTION).doc(record._id).update({
    data: { used: true, usedAt: now }
  }).catch(() => {});

  // 更新用户绑定邮箱
  await db.collection('users').doc(current.userId).update({
    data: {
      email,
      updatedAt: now,
      updateTime: db.serverDate()
    }
  });

  // 记录审计日志
  await db.collection(OPERATION_LOG_COLLECTION).add({
    data: {
      uid: current.userId,
      un: String(current.user.nickname || current.user.username || '').slice(0, 20),
      username: current.user.username || '',
      m: '账号安全',
      a: 'bind_email',
      c: `用户 ${current.user.username} 成功绑定安全邮箱：${email}`,
      s: '成功',
      ip: getClientIp(event),
      user_agent: getUserAgent(event),
      ts: now,
      create_time: new Date(now).toISOString(),
      create_timestamp: now,
      createdAt: new Date(now).toISOString()
    }
  }).catch(() => {});

  return {
    code: 0,
    message: '安全邮箱绑定成功',
    data: {
      email,
      maskedEmail: maskEmail(email)
    }
  };
}


