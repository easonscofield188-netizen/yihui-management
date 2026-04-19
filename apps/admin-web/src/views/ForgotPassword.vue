<template>
  <div class="forgot-password-page">
    <div class="reset-panel">
      <div class="page-head">
        <h1>找回密码</h1>
        <p>通过绑定邮箱验证码重置后台登录密码</p>
      </div>

      <el-steps
        :active="step - 1"
        finish-status="success"
        class="reset-steps"
      >
        <el-step title="填写账号" />
        <el-step title="验证邮箱" />
        <el-step title="重置密码" />
      </el-steps>

      <el-form
        v-if="step === 1"
        label-position="top"
        @submit.prevent="handleSendCode"
      >
        <el-form-item label="账号或邮箱">
          <el-input
            v-model.trim="form.account"
            placeholder="请输入 username 或 email"
            clearable
            @keyup.enter="handleSendCode"
          />
        </el-form-item>
        <el-button
          type="primary"
          class="submit-button"
          :loading="loading"
          @click="handleSendCode"
        >
          发送验证码
        </el-button>
      </el-form>

      <el-form
        v-else-if="step === 2"
        label-position="top"
        @submit.prevent="handleVerifyCode"
      >
        <el-alert
          type="info"
          :closable="false"
          show-icon
          class="step-tip"
          title="如果账号存在，验证码已发送到绑定邮箱。"
        />
        <el-form-item label="验证码">
          <el-input
            v-model.trim="form.code"
            maxlength="6"
            placeholder="请输入 6 位邮箱验证码"
            clearable
            @keyup.enter="handleVerifyCode"
          />
        </el-form-item>
        <div class="button-row">
          <el-button @click="step = 1">上一步</el-button>
          <el-button
            type="primary"
            :loading="loading"
            @click="handleVerifyCode"
          >
            校验验证码
          </el-button>
        </div>
      </el-form>

      <el-form
        v-else
        label-position="top"
        @submit.prevent="handleResetPassword"
      >
        <el-form-item label="新密码">
          <el-input
            v-model="form.newPassword"
            type="password"
            placeholder="至少 8 位"
            show-password
            @keyup.enter="handleResetPassword"
          />
        </el-form-item>
        <el-form-item label="确认新密码">
          <el-input
            v-model="form.confirmPassword"
            type="password"
            placeholder="请再次输入新密码"
            show-password
            @keyup.enter="handleResetPassword"
          />
        </el-form-item>
        <div class="button-row">
          <el-button @click="step = 2">上一步</el-button>
          <el-button
            type="primary"
            :loading="loading"
            @click="handleResetPassword"
          >
            修改密码
          </el-button>
        </div>
      </el-form>

      <router-link
        class="back-login"
        to="/login"
      >
        返回登录
      </router-link>
    </div>
  </div>
</template>

<script setup>
// 1. 引入
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { forgetPasswordService } from '../api/user';

// 2. 响应式数据
const router = useRouter();
const step = ref(1);
const loading = ref(false);
const form = reactive({
  account: '',
  code: '',
  newPassword: '',
  confirmPassword: '',
  resetToken: ''
});

// 3. 函数
/**
 * 功能：发送邮箱验证码
 * @returns {Promise<void>} 无返回值
 * @throws {Error} 接口异常由拦截器和本地提示处理
 */
const handleSendCode = async () => {
  if (!form.account) {
    ElMessage.warning('请输入账号或邮箱');
    return;
  }

  loading.value = true;
  try {
    const res = await forgetPasswordService({
      action: 'sendResetCode',
      account: form.account
    });
    ElMessage.success(res.message || '如果账号存在，验证码已发送到绑定邮箱');
    step.value = 2;
  } catch (error) {
    console.error('Send reset code failed:', error);
  } finally {
    loading.value = false;
  }
};

/**
 * 功能：校验邮箱验证码
 * @returns {Promise<void>} 无返回值
 * @throws {Error} 接口异常由拦截器和本地提示处理
 */
const handleVerifyCode = async () => {
  if (!form.account) {
    ElMessage.warning('请输入账号或邮箱');
    step.value = 1;
    return;
  }
  if (!form.code) {
    ElMessage.warning('请输入验证码');
    return;
  }
  if (!/^\d{6}$/.test(form.code)) {
    ElMessage.warning('验证码必须为 6 位数字');
    return;
  }

  loading.value = true;
  try {
    const res = await forgetPasswordService({
      action: 'verifyResetCode',
      account: form.account,
      code: form.code
    });
    form.resetToken = res.resetToken || '';
    ElMessage.success('验证成功，请设置新密码');
    step.value = 3;
  } catch (error) {
    console.error('Verify reset code failed:', error);
  } finally {
    loading.value = false;
  }
};

/**
 * 功能：提交新密码
 * @returns {Promise<void>} 无返回值
 * @throws {Error} 接口异常由拦截器和本地提示处理
 */
const handleResetPassword = async () => {
  if (!form.resetToken) {
    ElMessage.warning('重置凭证已失效，请重新验证');
    step.value = 2;
    return;
  }
  if (form.newPassword.length < 8) {
    ElMessage.warning('新密码至少需要 8 位');
    return;
  }
  if (form.newPassword !== form.confirmPassword) {
    ElMessage.warning('两次输入的密码不一致');
    return;
  }

  loading.value = true;
  try {
    await forgetPasswordService({
      action: 'resetPassword',
      resetToken: form.resetToken,
      newPassword: form.newPassword
    });
    ElMessage.success('密码修改成功，请重新登录');
    router.push('/login');
  } catch (error) {
    console.error('Reset password failed:', error);
  } finally {
    loading.value = false;
  }
};

// 4. 生命周期
</script>

<style scoped>
.forgot-password-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: #101112;
}

.reset-panel {
  width: min(100%, 480px);
  padding: 32px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: #191a1b;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
}

.page-head {
  margin-bottom: 26px;
  text-align: center;
}

.page-head h1 {
  margin: 0 0 8px;
  color: #f7f7f7;
  font-size: 26px;
}

.page-head p {
  margin: 0;
  color: rgba(255, 255, 255, 0.55);
  font-size: 13px;
}

.reset-steps {
  margin-bottom: 28px;
}

.step-tip {
  margin-bottom: 16px;
}

.submit-button {
  width: 100%;
}

.button-row {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.back-login {
  display: block;
  margin-top: 24px;
  color: #52ee8a;
  text-align: center;
  font-size: 13px;
  text-decoration: none;
}
</style>
