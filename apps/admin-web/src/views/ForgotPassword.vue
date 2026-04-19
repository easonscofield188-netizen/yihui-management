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
          size="large"
          @keyup.enter="handleSendCode"
        />
        </el-form-item>
        <el-button
          type="primary"
          class="submit-button"
          size="large"
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
            size="large"
            @keyup.enter="handleVerifyCode"
          />
        </el-form-item>
        <div class="button-row">
          <el-button size="large" @click="step = 1">上一步</el-button>
          <el-button
            type="primary"
            size="large"
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
            size="large"
            @keyup.enter="handleResetPassword"
          />
        </el-form-item>
        <el-form-item label="确认新密码">
          <el-input
            v-model="form.confirmPassword"
            type="password"
            placeholder="请再次输入新密码"
            show-password
            size="large"
            @keyup.enter="handleResetPassword"
          />
        </el-form-item>
        <div class="button-row">
          <el-button size="large" @click="step = 2">上一步</el-button>
          <el-button
            type="primary"
            size="large"
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
  background:
    radial-gradient(circle at 20% 10%, rgba(82, 238, 138, 0.14), transparent 28%),
    radial-gradient(circle at 80% 0%, rgba(82, 180, 238, 0.12), transparent 30%),
    linear-gradient(135deg, #0c0f10 0%, #141719 48%, #0d1112 100%);
}

.reset-panel {
  width: min(100%, 480px);
  position: relative;
  overflow: hidden;
  padding: 34px;
  border: 1px solid rgba(82, 238, 138, 0.16);
  border-radius: 8px;
  background: rgba(18, 21, 22, 0.86);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(22px);
}

.reset-panel::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(90deg, transparent, rgba(82, 238, 138, 0.16), transparent) top / 100% 1px no-repeat,
    linear-gradient(rgba(255, 255, 255, 0.025) 1px, transparent 1px) 0 0 / 100% 24px;
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
  margin: 0 0 30px;
  padding: 2px 4px 0;
}

.reset-steps :deep(.el-step) {
  flex-basis: 33.3333% !important;
  min-width: 0;
}

.reset-steps :deep(.el-step__head) {
  display: flex;
  justify-content: center;
  width: 100%;
}

.reset-steps :deep(.el-step__main) {
  width: 100%;
  padding-top: 10px;
  text-align: center;
}

.reset-steps :deep(.el-step__icon) {
  width: 28px;
  height: 28px;
  border: 2px solid rgba(229, 233, 239, 0.72);
  background: #15191b;
  color: rgba(235, 241, 247, 0.86);
  box-shadow: 0 0 0 4px rgba(21, 25, 27, 0.95), 0 0 18px rgba(82, 238, 138, 0.08);
  transition: all 0.2s ease;
}

.reset-steps :deep(.el-step__icon-inner) {
  font-weight: 800;
  line-height: 1;
}

.reset-steps :deep(.el-step__title) {
  width: 100%;
  padding-right: 0;
  color: rgba(235, 241, 247, 0.72);
  font-size: 15px;
  font-weight: 600;
  line-height: 22px;
  text-align: center;
  letter-spacing: 0;
}

.reset-steps :deep(.el-step__line) {
  top: 13px;
  left: calc(50% + 20px);
  right: calc(-50% + 20px);
  height: 2px;
  background: linear-gradient(90deg, rgba(229, 233, 239, 0.26), rgba(82, 238, 138, 0.45), rgba(229, 233, 239, 0.26));
}

.reset-steps :deep(.el-step:last-child .el-step__line) {
  display: none;
}

.reset-steps :deep(.el-step__head.is-process .el-step__icon),
.reset-steps :deep(.el-step__head.is-success .el-step__icon) {
  border-color: #52ee8a;
  color: #101112;
  background: #52ee8a;
  box-shadow: 0 0 0 4px rgba(82, 238, 138, 0.1), 0 0 24px rgba(82, 238, 138, 0.52);
}

.reset-steps :deep(.el-step__title.is-process),
.reset-steps :deep(.el-step__title.is-success) {
  color: #f4fff8;
  text-shadow: 0 0 16px rgba(82, 238, 138, 0.38);
}

.reset-steps :deep(.el-step__head.is-success .el-step__line-inner) {
  border-color: #52ee8a;
}

.step-tip {
  margin-bottom: 16px;
}

.submit-button {
  width: 100%;
}

:deep(.el-input__wrapper) {
  border-radius: 8px;
  background: rgba(9, 12, 13, 0.82);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08) inset;
}

:deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 1px rgba(82, 238, 138, 0.72) inset, 0 0 20px rgba(82, 238, 138, 0.1);
}

:deep(.el-form-item__label) {
  color: rgba(235, 241, 247, 0.78);
  font-weight: 700;
}

:deep(.el-button--primary) {
  border-color: #52ee8a;
  background: linear-gradient(135deg, #52ee8a, #5fd6ff);
  color: #071011;
  font-weight: 800;
  box-shadow: 0 10px 26px rgba(82, 238, 138, 0.18);
}

:deep(.el-button--primary:hover) {
  border-color: #8af4b0;
  filter: brightness(1.06);
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
