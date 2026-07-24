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
    const user = (res.data || []).find(item => {
      if (item.status && item.status !== 'active') return false;
      if (item.passwordHash && item.passwordHash === password) return true;
      if (item.password && item.password === password) return true;
      if (compatibleLegacyPassword && item.password && item.password === compatibleLegacyPassword) return true;
      return false;
    });

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
            nickname: user.nickname || user.username,
            avatarUrl: user.avatarUrl || '',
            avatarFileId: user.avatarFileId || '',
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
  const userId = await getSessionUserId(data, event);
  if (!userId) {
    return { error: { code: 401, message: '登录状态已失效，请重新登录' } };
  }

  const res = await db.collection('users').doc(userId).get();
  if (!res.data) {
    return { error: { code: 404, message: '用户不存在' } };
  }
  if (res.data.status && res.data.status !== 'active') {
    return { error: { code: 403, message: '账号已停用' } };
  }

  return { userId, user: res.data };
}

function formatUser(user, userId) {
  return {
    id: userId || user._id || user.id,
    username: user.username,
    role: user.role || 'user',
    roleName: user.roleName || getRoleName(user.role),
    employeeNo: user.employeeNo || '',
    nickname: user.nickname || user.username,
    avatarUrl: user.avatarUrl || '',
    avatarFileId: user.avatarFileId || '',
    lastLoginTime: user.lastLoginTime || user.updateTime || null
  };
}

async function getUserInfo(data, event) {
  const result = await getCurrentUserDoc(data, event);
  if (result.error) return result.error;

  return {
    code: 0,
    message: '查询成功',
    data: formatUser(result.user, result.userId)
  };
}

async function updateUserInfo(data, event) {
  const result = await getCurrentUserDoc(data, event);
  if (result.error) return result.error;

  const { nickname, avatarUrl, avatarFileId } = data;
  if (!isSafeInput(nickname) || !isSafeInput(avatarUrl)) {
    return { code: 400, message: '输入包含非法字符' };
  }

  const updateData = {
    updateTime: db.serverDate()
  };

  if (nickname !== undefined) updateData.nickname = String(nickname).trim();
  if (avatarUrl !== undefined) updateData.avatarUrl = String(avatarUrl).trim();
  if (avatarFileId !== undefined) updateData.avatarFileId = String(avatarFileId).trim();

  await db.collection('users').doc(result.userId).update({
    data: updateData
  });

  const latest = await db.collection('users').doc(result.userId).get();
  return {
    code: 0,
    message: '更新成功',
    data: formatUser(latest.data, result.userId)
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
  const maxSequence = (result.data || []).reduce((max, user) => {
    const matched = String(user.employeeNo || '').match(/-(\d+)$/);
    const sequence = matched ? Number(matched[1]) : 0;
    return Number.isFinite(sequence) ? Math.max(max, sequence) : max;
  }, 0);
  return `${prefix}${String(maxSequence + 1).padStart(3, '0')}`;
}

async function createAccount(data, event) {
  const current = await getCurrentUserDoc(data, event);
  if (current.error) return current.error;
  if (current.user.role !== 'ADMIN_SUPER') {
    return { code: 403, message: '仅超级系统管理员可以创建账号' };
  }

  const username = String(data.username || '').trim();
  const passwordPlain = String(data.passwordPlain || '');
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
  if (passwordPlain.length < 6 || passwordPlain.length > 64) {
    return { code: 400, message: '初始密码长度须为 6-64 位' };
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
  const now = Date.now();
  const createdAt = new Date(now).toISOString();
  const roleName = getRoleName(role);
  const employeeNo = await generateEmployeeNo(role);
  const createResult = await db.collection('users').add({
    data: {
      username,
      email,
      password: '',
      passwordHash: crypto.createHash('sha256').update(passwordPlain).digest('hex'),
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
        c: `创建账号 ${username}（${roleName}）`,
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
    message: '账号创建成功',
    data: {
      id: createResult._id,
      username,
      nickname,
      email,
      employeeNo,
      role,
      roleName,
      status: 'active'
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
