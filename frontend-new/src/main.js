import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import App from './App.vue'
import router from './router'
import { purgeLegacySharedAuth } from './utils/authSession'
import { installWhiteScreenRecovery, resetBrowserState, showRecoveryScreen } from './utils/browserRecovery'

installWhiteScreenRecovery()

purgeLegacySharedAuth()

if (new URLSearchParams(window.location.search).get('resetLocal') === '1') {
  resetBrowserState()
  window.history.replaceState(null, '', '/')
}

try {
  const app = createApp(App)

  app.config.errorHandler = err => {
    showRecoveryScreen(err?.message || '页面渲染异常')
  }

  app.use(ElementPlus, { locale: zhCn })
  app.use(router)

  app.mount('#app')
} catch (err) {
  showRecoveryScreen(err?.message || '页面启动异常')
}
