<template>
  <div class="min-h-screen flex items-center justify-center bg-background text-on-surface overflow-hidden relative">
    <!-- Background Layer -->
    <div class="fixed inset-0 z-0">
      <img 
        src="https://lh3.googleusercontent.com/aida-public/AB6AXuCoEiMLO4Fy-rmtLe6WTQxdS4Wy2l4fyq8lqLNhCjbZoVqrSe7GbfokF3vWr3L1hzsF4Oz2-nUQ3W7ohKIbOtKyj0xYNsvvB-_JPdu4z99cSclb5GJM13XRfSVa5KgNUtJ4WwA6LHJuzfHZ9GYI6IlM6LbsSKXT6UCc28GtSPX7xzNWqHQYTVo8bqRD6Ey9xjbmmSDUbk61PgzFbO4Le1u-VP8QoZBQRLxt0SeMXZaE39z8Jlt7YWVC5x0kWAIL8Ljg5HHTbZ9KpP8" 
        class="w-full h-full object-cover opacity-20 grayscale contrast-125"
        referrerpolicy="no-referrer"
      >
      <div class="absolute inset-0 bg-gradient-to-tr from-background via-background/80 to-transparent" />
      <div class="absolute inset-0 shimmer-bg opacity-30" />
    </div>

    <!-- Login Container -->
    <main class="relative z-10 w-full max-w-[1200px] grid grid-cols-1 lg:grid-cols-2 gap-0 lg:h-[720px] px-6">
      <!-- Branding Section (Left Side) -->
      <div class="hidden lg:flex flex-col justify-between p-16">
        <div>
          <div class="flex items-center gap-3 mb-12">
            <div class="w-12 h-12 rounded-lg bg-primary flex items-center justify-center shadow-[0_0_20px_rgba(82,238,138,0.2)]">
              <el-icon
                size="28"
                class="text-on-primary"
              >
                <Management />
              </el-icon>
            </div>
            <div>
              <h1 class="text-2xl font-black tracking-tighter text-primary">
                杭州亿辉
              </h1>
              <p class="text-[10px] uppercase tracking-[0.4em] text-on-surface-variant/60 font-medium">
                Yihui Culture Creative
              </p>
            </div>
          </div>

          <div class="space-y-6">
            <h2 class="text-6xl font-bold leading-tight tracking-tight text-on-surface">
              艺术科技<br>
              <span class="text-primary">造就园林之美</span>
            </h2>
            <p class="text-on-surface-variant max-w-md text-lg leading-relaxed font-light">
              通过数字孪生与智慧管理系统，为传统景观注入科技灵魂。每一片绿意，皆由智能精准掌控。
            </p>
          </div>
        </div>

        <div class="flex gap-12 items-center">
          <div class="flex flex-col">
            <span class="text-primary font-bold text-2xl">2.4k+</span>
            <span class="text-[10px] text-on-surface-variant uppercase tracking-widest font-bold">维护项目</span>
          </div>
          <div class="w-px h-8 bg-white/10" />
          <div class="flex flex-col">
            <span class="text-secondary font-bold text-2xl">98.5%</span>
            <span class="text-[10px] text-on-surface-variant uppercase tracking-widest font-bold">环境达标</span>
          </div>
        </div>
      </div>

      <!-- Form Section (Right Side) -->
      <div class="flex items-center justify-center p-4 lg:p-12">
        <div class="glass-card w-full max-w-md p-10 rounded-2xl relative overflow-hidden border border-white/5 shadow-2xl">
          <!-- Subtle Top Accent -->
          <div class="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
          
          <div class="mb-10 text-center lg:text-left">
            <h3 class="text-2xl font-bold mb-2 text-on-surface">
              欢迎回来
            </h3>
            <p class="text-[10px] text-on-surface-variant/80 uppercase tracking-[0.2em] font-bold">
              企业管理控制台
            </p>
          </div>

          <form
            class="space-y-6"
            @submit.prevent="handleLogin"
          >
            <!-- Username -->
            <LoginInput 
              v-model="loginForm.username"
              label="管理员账号"
              placeholder="请输入用户名"
            >
              <template #icon>
                <el-icon size="20">
                  <User />
                </el-icon>
              </template>
            </LoginInput>

            <!-- Password -->
            <LoginInput 
              v-model="loginForm.password"
              label="访问密码"
              placeholder="••••••••"
              type="password"
            >
              <template #icon>
                <el-icon size="20">
                  <Lock />
                </el-icon>
              </template>
              <template #extra>
                <a
                  href="#"
                  class="text-[10px] text-secondary/60 hover:text-secondary transition-colors uppercase tracking-widest"
                >忘记密码?</a>
              </template>
            </LoginInput>

            <!-- Remember Me -->
            <div class="flex items-center gap-2 px-1">
              <el-checkbox
                v-model="loginForm.remember"
                class="custom-checkbox"
              >
                <span class="text-xs text-on-surface-variant">保持登录状态</span>
              </el-checkbox>
            </div>

            <!-- Submit Button -->
            <div class="pt-4">
              <button 
                type="submit"
                class="w-full group relative overflow-hidden rounded-xl py-4 bg-gradient-to-r from-primary to-primary-container text-on-primary font-bold tracking-widest uppercase text-sm transition-all active:scale-[0.98] shadow-[0_10px_20px_rgba(82,238,138,0.2)]"
                :disabled="loading"
              >
                <span class="relative z-10 flex items-center justify-center gap-2">
                  {{ loading ? '验证中...' : '立即进入控制台' }}
                  <el-icon
                    v-if="!loading"
                    class="text-lg"
                  ><Right /></el-icon>
                </span>
                <div class="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
              </button>
            </div>
          </form>

          <!-- Support Footer -->
          <div class="mt-12 pt-8 border-t border-white/5 flex justify-between items-center text-[10px] text-on-surface-variant/40 uppercase tracking-widest font-medium">
            <span>© 2024 杭州亿辉文化创意</span>
            <div class="flex gap-4">
              <a
                href="#"
                class="hover:text-primary transition-colors"
              >隐私政策</a>
              <a
                href="#"
                class="hover:text-primary transition-colors"
              >技术支持</a>
            </div>
          </div>
        </div>
      </div>
    </main>

    <!-- Decorative Elements -->
    <div class="fixed bottom-12 right-12 flex gap-4 z-20">
      <button class="w-10 h-10 rounded-full border border-white/10 flex items-center justify-center text-on-surface-variant hover:border-primary hover:text-primary transition-all bg-surface-container-high/40 backdrop-blur-md">
        <el-icon size="18">
          <Location />
        </el-icon>
      </button>
      <button class="w-10 h-10 rounded-full border border-white/10 flex items-center justify-center text-on-surface-variant hover:border-primary hover:text-primary transition-all bg-surface-container-high/40 backdrop-blur-md">
        <el-icon size="18">
          <QuestionFilled />
        </el-icon>
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { User, Lock, Management, Right, Location, QuestionFilled } from '@element-plus/icons-vue'
import LoginInput from '../components/LoginInput.vue'
import { ElMessage } from 'element-plus'
import { login } from '../api/user'
import CryptoJS from 'crypto-js'

const router = useRouter()
const loading = ref(false)

const loginForm = reactive({
  username: '',
  password: '',
  remember: false
})

const handleLogin = async () => {
  if (!loginForm.username || !loginForm.password) {
    ElMessage.warning('请输入账号和密码')
    return
  }

  loading.value = true
  
  try {
    // 使用 MD5 加密密码
    const md5Password = CryptoJS.MD5(loginForm.password).toString()
    
    const res = await login({
      username: loginForm.username,
      password: md5Password
    })
    
    // 假设后端返回 { code: 0, data: { token: '...' } }
    if (res.data && res.data.token) {
      localStorage.setItem('token', res.data.token)
      localStorage.setItem('isLoggedIn', 'true')
      ElMessage.success('登录成功，欢迎回来')
      router.push('/dashboard')
    } else {
      // 如果没有 token 但 code 是 0，也视为成功 (取决于具体后端实现)
      localStorage.setItem('isLoggedIn', 'true')
      ElMessage.success('登录成功')
      router.push('/dashboard')
    }
  } catch (error) {
    console.error('Login failed:', error)
    // 拦截器已经处理了错误提示
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.glass-card {
  background: rgba(20, 20, 21, 0.7);
  backdrop-filter: blur(40px);
}

.shimmer-bg {
  background: radial-gradient(circle at 50% 50%, rgba(82, 238, 138, 0.1) 0%, transparent 70%);
}

:deep(.custom-checkbox .el-checkbox__inner) {
  background-color: #0e0e0f;
  border-color: rgba(255, 255, 255, 0.1);
}

:deep(.custom-checkbox .el-checkbox__input.is-checked .el-checkbox__inner) {
  background-color: #52ee8a;
  border-color: #52ee8a;
}
</style>
