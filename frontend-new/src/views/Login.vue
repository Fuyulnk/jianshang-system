<template>
  <div class="login-container">
    <!-- 背景图案 -->
    <div class="login-bg">
      <div class="bg-grid"></div>
      <div class="bg-glow g1"></div>
      <div class="bg-glow g2"></div>
    </div>

    <div class="login-card">
      <div class="login-header">
        <img class="logo-icon" src="/jianshang-logo.jpeg" alt="简尚涂装" />
        <h2>简尚系统</h2>
        <p class="subtitle">一体化业务管理平台</p>
      </div>
      <el-form :model="form" class="login-form">
        <el-form-item>
          <el-autocomplete
            v-model="form.username"
            class="account-input"
            :fetch-suggestions="queryAccountHistory"
            placeholder="请输入账号"
            :prefix-icon="User"
            size="large"
            clearable
            :trigger-on-focus="true"
            @select="selectAccount"
            @keydown.enter="handleLogin"
          >
            <template #default="{ item }">
              <div class="account-option">
                <span>{{ item.value }}</span>
                <button type="button" @mousedown.prevent.stop @click.stop="removeSavedAccount(item.value)">移除</button>
              </div>
            </template>
          </el-autocomplete>
        </el-form-item>
        <el-form-item>
          <el-input
            v-model="form.password"
            type="password"
            placeholder="请输入密码"
            :prefix-icon="Lock"
            size="large"
            show-password
            @keydown.enter="handleLogin"
          />
        </el-form-item>
        <el-form-item>
          <div class="login-options">
            <el-checkbox v-model="rememberAccount" size="small" class="remember-checkbox">
              记住账号
            </el-checkbox>
            <el-checkbox v-model="rememberMe" size="small" class="remember-checkbox">
              7天自动登录
            </el-checkbox>
          </div>
        </el-form-item>
        <el-form-item>
          <el-button
            type="primary"
            size="large"
            :loading="loading"
            style="width: 100%"
            @click="handleLogin"
          >
            {{ loading ? '登录中...' : '登 录' }}
          </el-button>
        </el-form-item>
        <el-form-item>
          <el-button size="large" style="width: 100%" @click="showRegister = true">注册账号</el-button>
        </el-form-item>
      </el-form>

      <!-- 注册弹窗 -->
      <el-dialog v-model="showRegister" title="注册账号" width="380px" append-to-body>
        <el-form :model="regForm" label-width="0">
          <el-form-item>
            <el-input v-model="regForm.username" placeholder="账号" :prefix-icon="User" />
          </el-form-item>
          <el-form-item>
            <el-input v-model="regForm.password" type="password" placeholder="密码（至少6位）" :prefix-icon="Lock" show-password />
          </el-form-item>
          <el-form-item>
            <el-input v-model="regForm.name" placeholder="真实姓名（选填）" />
          </el-form-item>
          <el-form-item>
            <el-input v-model="regForm.phone" placeholder="手机号（选填）" />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="showRegister = false">取消</el-button>
          <el-button type="primary" :loading="regLoading" @click="handleRegister">注册</el-button>
        </template>
      </el-dialog>
      <transition name="fade">
        <p v-if="errorMsg" class="error-msg">{{ errorMsg }}</p>
      </transition>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { User, Lock } from '@element-plus/icons-vue'

const router = useRouter()
const form = ref({ username: '', password: '' })
const rememberAccount = ref(true)
const rememberMe = ref(false)
const accountHistory = ref([])
const loading = ref(false)
const errorMsg = ref('')
const showRegister = ref(false)
const regLoading = ref(false)
const regForm = ref({ username: '', password: '', name: '', phone: '' })

onMounted(async () => {
  restoreLoginPreference()
  if (await hasValidToken()) {
    router.replace('/main/dashboard')
  }
})

function restoreLoginPreference() {
  const savedRememberAccount = localStorage.getItem('remember-account')
  rememberAccount.value = savedRememberAccount !== 'false'
  rememberMe.value = localStorage.getItem('remember-login') === 'true'
  accountHistory.value = loadAccountHistory()
  if (rememberAccount.value) {
    form.value.username = localStorage.getItem('saved-username') || accountHistory.value[0] || ''
  }
}

async function hasValidToken() {
  const token = localStorage.getItem('token')
  if (!token) return false
  try {
    const res = await fetch('/api/me', {
      headers: { Authorization: `Bearer ${token}` }
    })
    const json = await res.json().catch(() => ({}))
    if (res.ok && json.success) return true
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    return false
  } catch {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    return false
  }
}

function saveLoginPreference(username) {
  const cleanUsername = String(username || '').trim()
  localStorage.setItem('remember-account', rememberAccount.value ? 'true' : 'false')
  localStorage.setItem('remember-login', rememberMe.value ? 'true' : 'false')
  if (rememberAccount.value && cleanUsername) {
    const next = [cleanUsername, ...accountHistory.value.filter(item => item !== cleanUsername)].slice(0, 8)
    accountHistory.value = next
    localStorage.setItem('saved-username', cleanUsername)
    localStorage.setItem('saved-accounts', JSON.stringify(next))
  } else {
    localStorage.removeItem('saved-username')
  }
}

function loadAccountHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem('saved-accounts') || '[]')
    const legacy = localStorage.getItem('saved-username') || ''
    return [...new Set([legacy, ...parsed].map(item => String(item || '').trim()).filter(Boolean))].slice(0, 8)
  } catch {
    const legacy = localStorage.getItem('saved-username') || ''
    return legacy ? [legacy] : []
  }
}

function queryAccountHistory(query, callback) {
  const keyword = String(query || '').trim().toLowerCase()
  const list = accountHistory.value
    .filter(account => !keyword || account.toLowerCase().includes(keyword))
    .map(account => ({ value: account }))
  callback(list)
}

function selectAccount(item) {
  form.value.username = item.value
  form.value.password = ''
}

function removeSavedAccount(username) {
  const target = String(username || '').trim()
  accountHistory.value = accountHistory.value.filter(item => item !== target)
  localStorage.setItem('saved-accounts', JSON.stringify(accountHistory.value))
  if (localStorage.getItem('saved-username') === target) {
    const next = accountHistory.value[0] || ''
    if (next) localStorage.setItem('saved-username', next)
    else localStorage.removeItem('saved-username')
  }
  if (form.value.username === target) {
    form.value.username = accountHistory.value[0] || ''
    form.value.password = ''
  }
}

const handleLogin = async () => {
  if (!form.value.username || !form.value.password) {
    errorMsg.value = '请输入账号和密码'
    return
  }
  loading.value = true
  errorMsg.value = ''
  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form.value, remember_me: rememberMe.value })
    })
    const result = await response.json()
    if (result.success) {
      localStorage.setItem('token', result.token)
      localStorage.removeItem('user')
      saveLoginPreference(form.value.username)
      router.push('/main/dashboard')
    } else {
      errorMsg.value = result.message || '登录失败'
    }
  } catch {
    errorMsg.value = '网络错误，请检查服务器连接'
  } finally {
    loading.value = false
  }
}

const handleRegister = async () => {
  if (!regForm.value.username || !regForm.value.password) {
    errorMsg.value = '请填写账号和密码'
    return
  }
  if (regForm.value.password.length < 6) {
    errorMsg.value = '密码至少6位'
    return
  }
  regLoading.value = true
  errorMsg.value = ''
  try {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(regForm.value)
    })
    const json = await res.json()
    if (json.success) {
      localStorage.setItem('token', json.token)
      localStorage.removeItem('user')
      rememberAccount.value = true
      saveLoginPreference(regForm.value.username)
      showRegister.value = false
      router.push('/main/dashboard')
    } else {
      errorMsg.value = json.message || '注册失败'
    }
  } catch {
    errorMsg.value = '网络错误，请检查服务器连接'
  } finally {
    regLoading.value = false
  }
}
</script>

<style scoped>
.login-container {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
  background: #0c0c0f;
  position: relative;
  overflow: hidden;
}

.login-bg {
  position: absolute;
  width: 100%;
  height: 100%;
}

.bg-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px);
  background-size: 48px 48px;
}

.bg-glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(100px);
  opacity: 0.15;
}

.g1 {
  width: 500px;
  height: 500px;
  background: var(--color-primary);
  top: -150px;
  left: -100px;
  animation: float 8s ease-in-out infinite;
}

.g2 {
  width: 400px;
  height: 400px;
  background: var(--color-accent);
  bottom: -100px;
  right: -80px;
  animation: float 10s ease-in-out infinite reverse;
}

@keyframes float {
  0%, 100% { transform: translateY(0) scale(1); }
  50% { transform: translateY(-30px) scale(1.05); }
}

.login-card {
  width: 400px;
  padding: 44px 36px 36px;
  background: rgba(24, 24, 27, 0.9);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: var(--radius-xl);
  box-shadow: 0 25px 60px rgba(0, 0, 0, 0.5);
  position: relative;
  z-index: 1;
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
}

.login-header {
  text-align: center;
  margin-bottom: 32px;
}

.logo-icon {
  width: 60px;
  height: 60px;
  border-radius: 16px;
  object-fit: contain;
  background: #fff;
  padding: 6px;
  margin: 0 auto 16px;
}

.login-header h2 {
  font-size: 22px;
  color: #e4e4e7;
  margin: 0 0 6px;
  font-weight: 700;
  letter-spacing: -0.3px;
}

.subtitle {
  font-size: 14px;
  color: #6b6d75;
  margin: 0;
}

.login-form {
  margin-top: 24px;
}

.login-form :deep(.el-input__wrapper) {
  background: rgba(255,255,255,0.04) !important;
  box-shadow: 0 0 0 1px rgba(255,255,255,0.06) inset !important;
}
.login-form :deep(.el-input__wrapper:hover) {
  box-shadow: 0 0 0 1px rgba(79, 109, 245, 0.3) inset !important;
}
.login-form :deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 2px rgba(79, 109, 245, 0.2) inset !important;
}
.login-form :deep(.el-input__inner) {
  color: #e4e4e7;
}
.login-form :deep(.el-input__inner::placeholder) {
  color: #6b6d75;
}
.login-form :deep(.el-input__prefix) {
  color: #6b6d75;
}

.account-input {
  width: 100%;
}

.account-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}

.account-option span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.account-option button {
  border: none;
  background: transparent;
  color: #8b8d97;
  cursor: pointer;
  font-size: 12px;
}

.account-option button:hover {
  color: var(--color-danger);
}

.login-form :deep(.el-button--primary) {
  height: 44px;
  font-size: 15px;
  letter-spacing: 2px;
}

.login-options {
  display: flex;
  justify-content: space-between;
  width: 100%;
  gap: 12px;
}

.remember-checkbox {
  color: #a1a3ab;
}
.remember-checkbox :deep(.el-checkbox__label) {
  color: #a1a3ab;
  font-size: 13px;
}

.error-msg {
  color: #ef4444;
  font-size: 13px;
  text-align: center;
  margin: 0;
}
</style>
