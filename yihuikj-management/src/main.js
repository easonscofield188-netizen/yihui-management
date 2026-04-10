import { createApp } from 'vue'
import App from './App.vue'
import ElementPlus from 'element-plus'
// 导入 Element Plus 的中文语言包，确保日期选择器等组件显示中文
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
// 导入 Element Plus 的暗黑模式变量
import 'element-plus/theme-chalk/dark/css-vars.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import router from './router'
import './index.css'

const app = createApp(App)

// 忽略 ResizeObserver 导致的良性报错
const debounce = (fn, delay) => {
  let timer = null;
  return function () {
    let context = this;
    let args = arguments;
    window.clearTimeout(timer);
    timer = window.setTimeout(function () {
      fn.apply(context, args);
    }, delay);
  }
}

const _ResizeObserver = window.ResizeObserver;
window.ResizeObserver = class ResizeObserver extends _ResizeObserver{
  constructor(callback) {
    callback = debounce(callback, 16);
    super(callback);
  }
}

window.addEventListener('error', (e) => {
  if (e.message === 'ResizeObserver loop completed with undelivered notifications.' || e.message === 'ResizeObserver loop limit exceeded') {
    e.stopImmediatePropagation()
  }
})

// 全局注册 Element Plus 的所有图标组件
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

// 插件安装：Element Plus（配置中文）和 路由
app.use(ElementPlus, {
  locale: zhCn,
})
app.use(router)
app.mount('#root')
