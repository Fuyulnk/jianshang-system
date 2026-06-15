import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import App from './App.vue'
import router from './router'
import { purgeLegacySharedAuth } from './utils/authSession'

const app = createApp(App)

purgeLegacySharedAuth()

app.use(ElementPlus)
app.use(router)

app.mount('#app')
