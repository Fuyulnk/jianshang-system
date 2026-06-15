<script setup>
import {
  getAuthToken,
  setAuthToken,
  rememberAuthToken,
  clearRememberedAuth,
  clearAuthSession
} from '../utils/authSession'
import { toDepartmentCascaderOptions } from '../utils/orgOptions'
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  User,
  Lock,
  Check,
  ArrowRight,
  Monitor,
  Grid,
  Briefcase,
  Goods,
  Box,
  Coin,
  Wallet,
  UserFilled,
  Cpu,
  DataAnalysis,
  Setting
} from '@element-plus/icons-vue'

const router = useRouter()

const form = reactive({ username: '', password: '' })
const regForm = reactive({
  username: '',
  password: '',
  confirmPassword: '',
  name: '',
  phone: '',
  department: '',
  position: '',
  departmentPosition: [],
  ai_pet_enabled: true,
  ai_auto_query: true,
  ai_name: '简尚小助手'
})

const mode = ref('login')
const registerStep = ref(0)
const submittedUser = ref(null)
const rememberAccount = ref(true)
const rememberMe = ref(false)
const accountHistory = ref([])
const loading = ref(false)
const regLoading = ref(false)
const errorMsg = ref('')
const isDark = ref(false)
const authTransitionName = ref('auth-slide-forward')
const orgOptions = ref(toDepartmentCascaderOptions())

const stepItems = [
  { title: '个人信息', desc: '填写账号与联系信息' },
  { title: 'AI 助手', desc: '选择新人默认 AI 偏好' },
  { title: '进入系统', desc: '先用普通员工入口' }
]
const cascaderProps = {
  value: 'value',
  label: 'label',
  children: 'children',
  expandTrigger: 'hover'
}
const mockMenu = [
  { label: '工作台', icon: Grid },
  { label: '项目交付', icon: Briefcase },
  { label: '订单供货', icon: Goods },
  { label: '材料库存', icon: Box },
  { label: '回库工费', icon: Coin },
  { label: '财务结算', icon: Wallet },
  { label: '员工档案', icon: UserFilled },
  { label: 'AI 助手', icon: Cpu },
  { label: '报表中心', icon: DataAnalysis },
  { label: '系统设置', icon: Setting }
]
const mockStats = [
  { label: '在施工项目', value: '12', meta: '3 单待勘察' },
  { label: '待出库材料', value: '8', meta: '仓库今日处理' }
]
const mockSummary = [
  { label: '待班组交底', value: '4' },
  { label: '待回库', value: '3' },
  { label: '待工费', value: '5' },
  { label: '待分配', value: '1' }
]
const mockProgress = [
  { name: '保利 · 天汇｜待回库', width: '86%' },
  { name: '霞光沙 5L｜待出库', width: '74%' },
  { name: '微水泥系列｜施工中', width: '58%' },
  { name: '中海 · 云麓｜待财务', width: '48%' }
]

const activeStepLabel = computed(() => stepItems[registerStep.value]?.title || '等待分配')
const pendingName = computed(() => submittedUser.value?.real_name || submittedUser.value?.username || regForm.name || regForm.username || '新账号')
const ghostDate = computed(() => {
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long'
  })
  return formatter.format(new Date())
})

onMounted(async () => {
  initTheme()
  restoreLoginPreference()
  await loadOrgOptions()
  if (await hasValidToken()) router.replace('/main/dashboard')
})

function initTheme() {
  const modeValue = localStorage.getItem('theme-mode') || 'auto'
  const stored = localStorage.getItem('theme')
  if (modeValue === 'manual' && (stored === 'dark' || stored === 'light')) {
    applyTheme(stored === 'dark')
  } else {
    const hour = new Date().getHours()
    applyTheme(hour >= 18 || hour < 7)
  }
}

function applyTheme(dark) {
  isDark.value = dark
  document.documentElement.classList.toggle('dark', dark)
}

function restoreLoginPreference() {
  const savedRememberAccount = localStorage.getItem('remember-account')
  rememberAccount.value = savedRememberAccount !== 'false'
  rememberMe.value = localStorage.getItem('remember-login') === 'true'
  accountHistory.value = loadAccountHistory()
  if (rememberAccount.value) {
    form.username = localStorage.getItem('saved-username') || accountHistory.value[0] || ''
  }
}

async function hasValidToken() {
  const token = getAuthToken()
  if (!token) return false
  try {
    const res = await fetch('/api/me', {
      headers: { Authorization: `Bearer ${token}` }
    })
    const json = await res.json().catch(() => ({}))
    if (res.ok && json.success) return true
    clearAuthSession({ clearRemembered: true })
    return false
  } catch {
    clearAuthSession({ clearRemembered: true })
    return false
  }
}

async function loadOrgOptions() {
  try {
    const res = await fetch('/api/org-options')
    const json = await res.json()
    if (json.success) orgOptions.value = toDepartmentCascaderOptions(json.data)
  } catch {}
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
  form.username = item.value
  form.password = ''
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
  if (form.username === target) {
    form.username = accountHistory.value[0] || ''
    form.password = ''
  }
}

function switchMode(nextMode) {
  if (mode.value === nextMode) return
  authTransitionName.value = nextMode === 'register' ? 'auth-slide-forward' : 'auth-slide-back'
  mode.value = nextMode
  errorMsg.value = ''
}

function nextRegisterStep() {
  errorMsg.value = ''
  if (!regForm.username || !regForm.password || !regForm.name) {
    errorMsg.value = '请填写账号、密码和姓名'
    return
  }
  if (!regForm.phone) {
    errorMsg.value = '请填写手机号'
    return
  }
  const [department, position] = regForm.departmentPosition || []
  if (!department || !position) {
    errorMsg.value = '请选择部门和职位'
    return
  }
  if (regForm.password.length < 6) {
    errorMsg.value = '密码至少6位'
    return
  }
  if (regForm.password !== regForm.confirmPassword) {
    errorMsg.value = '两次输入的密码不一致'
    return
  }
  registerStep.value = 1
}

async function handleLogin() {
  if (!form.username || !form.password) {
    errorMsg.value = '请输入账号和密码'
    return
  }
  loading.value = true
  errorMsg.value = ''
  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, remember_me: rememberMe.value })
    })
    const result = await response.json()
    if (result.success) {
      setAuthToken(result.token)
      if (rememberMe.value) {
        rememberAuthToken(result.token, form.username)
      } else {
        clearRememberedAuth()
      }
      saveLoginPreference(form.username)
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

async function handleRegister() {
  regLoading.value = true
  errorMsg.value = ''
  try {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: regForm.username,
        password: regForm.password,
        name: regForm.name,
        phone: regForm.phone,
        department: regForm.departmentPosition[0],
        position: regForm.departmentPosition[1],
        ai_pet_enabled: regForm.ai_pet_enabled,
        ai_auto_query: regForm.ai_auto_query,
        ai_name: regForm.ai_name
      })
    })
    const json = await res.json()
    if (json.success) {
      submittedUser.value = json.user || { username: regForm.username, real_name: regForm.name }
      if (json.token) setAuthToken(json.token)
      saveLoginPreference(regForm.username)
      registerStep.value = 2
      authTransitionName.value = 'auth-slide-forward'
      mode.value = 'submitted'
    } else {
      errorMsg.value = json.message || '注册失败'
    }
  } catch {
    errorMsg.value = '网络错误，请检查服务器连接'
  } finally {
    regLoading.value = false
  }
}

function enterEmployeeWorkspace() {
  router.replace('/main/employee-dashboard')
}

function backToLogin() {
  clearAuthSession()
  authTransitionName.value = 'auth-slide-back'
  mode.value = 'login'
  registerStep.value = 0
  submittedUser.value = null
  form.username = regForm.username || form.username
  form.password = ''
  errorMsg.value = ''
}
</script>

<template>
  <main class="login-shell">
    <div class="paint-texture"></div>
    <div class="workspace-ghost" aria-hidden="true" inert>
      <div class="ghost-sidebar">
        <div class="ghost-logo-line">
          <img src="/jianshang-logo.jpeg" alt="" />
          <strong>简尚系统</strong>
        </div>
        <div class="ghost-nav-list">
          <div v-for="(item, index) in mockMenu" :key="item.label" :class="['ghost-nav', { active: index === 0 }]">
            <el-icon class="nav-icon"><component :is="item.icon" /></el-icon>
            <span>{{ item.label }}</span>
          </div>
        </div>
        <div class="ghost-summary">
          <strong>今日待办</strong>
          <p v-for="item in mockSummary" :key="item.label"><span>{{ item.label }}</span><b>{{ item.value }}</b></p>
        </div>
      </div>
      <div class="ghost-content">
        <div class="ghost-header">
          <h3>交付工作台</h3>
          <span>{{ ghostDate }}</span>
        </div>
        <div class="ghost-welcome">
          <strong>今日项目流转</strong>
          <span>门店交底、仓库、财务在同一条单据链里协作</span>
        </div>
        <div class="ghost-stat-row">
          <div v-for="item in mockStats" :key="item.label" class="ghost-stat">
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
            <small>{{ item.meta }}</small>
          </div>
        </div>
        <div class="ghost-chart">
          <h4>工单推进</h4>
          <div class="chart-grid"></div>
          <span class="chart-line"></span>
        </div>
        <div class="ghost-progress">
          <h4>关键节点</h4>
          <div v-for="item in mockProgress" :key="item.name" class="progress-row">
            <span>{{ item.name }}</span>
            <i><b :style="{ width: item.width }"></b></i>
          </div>
        </div>
      </div>
    </div>

    <section class="auth-stage">
      <aside class="brand-panel">
        <div class="brand-mark">
          <img class="brand-logo" src="/jianshang-logo.jpeg" alt="简尚涂装" />
        </div>
        <div class="brand-copy">
          <h1>简尚系统</h1>
          <p class="subtitle">艺术涂料 · 施工交付管理平台</p>
          <div class="mode-switch brand-mode-switch" v-if="mode !== 'submitted'">
            <button type="button" :class="{ active: mode === 'login' }" @click="switchMode('login')">登录</button>
            <button type="button" :class="{ active: mode === 'register' }" @click="switchMode('register')">申请账号</button>
          </div>
        </div>

        <div class="brand-features">
          <div class="feature-item">
            <el-icon><Monitor /></el-icon>
            <div>
              <strong>轻科技办公</strong>
              <span>项目、订单、配送全流程协同</span>
            </div>
          </div>
          <div class="feature-item">
            <el-icon><Check /></el-icon>
            <div>
              <strong>先分配再启用</strong>
              <span>企业级安全与权限管理</span>
            </div>
          </div>
        </div>
      </aside>

      <section :class="['auth-panel', { 'register-panel': mode === 'register' }]">
        <Transition :name="authTransitionName">
          <div v-if="mode === 'login'" key="login" class="auth-form">
            <div class="form-head">
              <p>简尚办公入口</p>
              <h2>欢迎回来</h2>
            </div>

            <el-form class="login-form">
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
              <div class="login-options">
                <el-checkbox v-model="rememberAccount" size="small">记住账号</el-checkbox>
                <el-checkbox v-model="rememberMe" size="small">保存密码</el-checkbox>
              </div>
              <el-button type="primary" size="large" :loading="loading" class="primary-action" @click="handleLogin">
                {{ loading ? '登录中...' : '进入系统' }}
                <el-icon v-if="!loading"><ArrowRight /></el-icon>
              </el-button>
            </el-form>
          </div>

          <div v-else-if="mode === 'register'" key="register" class="auth-form register-form">
            <div class="form-head">
              <p>新员工账号申请</p>
              <h2>{{ activeStepLabel }}</h2>
            </div>

            <div class="step-track">
              <div
                v-for="(item, index) in stepItems"
                :key="item.title"
                :class="['step-dot', { active: registerStep === index, done: registerStep > index }]"
              >
                <span>{{ index + 1 }}</span>
                <div>
                  <strong>{{ item.title }}</strong>
                  <small>{{ item.desc }}</small>
                </div>
              </div>
            </div>

            <Transition name="step-fade" mode="out-in">
              <el-form v-if="registerStep === 0" key="info" class="register-fields">
                <el-form-item>
                  <el-input v-model="regForm.username" size="large" placeholder="登录账号" :prefix-icon="User" />
                </el-form-item>
                <el-form-item>
                  <el-input v-model="regForm.name" size="large" placeholder="真实姓名" />
                </el-form-item>
                <el-form-item>
                  <el-input v-model="regForm.phone" size="large" placeholder="手机号" />
                </el-form-item>
                <el-form-item>
                  <el-cascader
                    v-model="regForm.departmentPosition"
                    class="department-cascader"
                    :options="orgOptions"
                    :props="cascaderProps"
                    size="large"
                    placeholder="选择部门 / 职位"
                    clearable
                  />
                </el-form-item>
                <el-form-item>
                  <el-input v-model="regForm.password" type="password" size="large" show-password placeholder="密码（至少6位）" :prefix-icon="Lock" />
                </el-form-item>
                <el-form-item>
                  <el-input v-model="regForm.confirmPassword" type="password" size="large" show-password placeholder="再次输入密码" :prefix-icon="Lock" />
                </el-form-item>
                <el-button type="primary" size="large" class="primary-action" @click="nextRegisterStep">
                  下一步
                  <el-icon><ArrowRight /></el-icon>
                </el-button>
              </el-form>

              <div v-else key="ai" class="ai-preferences">
                <label class="preference-row">
                  <span>
                    <strong>启用 AI 助手</strong>
                    <small>进入系统后可看到你的简尚 AI。</small>
                  </span>
                  <el-switch v-model="regForm.ai_pet_enabled" />
                </label>
                <label class="preference-row">
                  <span>
                    <strong>允许 AI 自动查数据</strong>
                    <small>仅在你有权限的数据范围内辅助查询。</small>
                  </span>
                  <el-switch v-model="regForm.ai_auto_query" />
                </label>
                <el-input v-model="regForm.ai_name" size="large" placeholder="AI 名称" />
                <div class="ai-preview">
                  <span class="ai-pulse"></span>
                  <div>
                    <strong>{{ regForm.ai_name || '简尚小助手' }}</strong>
                    <p>激活后会跟随你的账号偏好进入系统。</p>
                  </div>
                </div>
                <div class="register-actions">
                  <el-button size="large" @click="registerStep = 0">上一步</el-button>
                  <el-button type="primary" size="large" :loading="regLoading" @click="handleRegister">
                    {{ regLoading ? '提交中...' : '提交申请' }}
                  </el-button>
                </div>
              </div>
            </Transition>
          </div>

          <div v-else key="submitted" class="submitted-state">
            <div class="loading-ring">
              <span></span>
              <el-icon><Check /></el-icon>
            </div>
            <p class="submitted-kicker">注册信息已提交</p>
            <h2>{{ pendingName }}，普通员工入口已开通</h2>
            <p class="submitted-desc">你的账号已经进入后台待建档列表。现在可以先进入普通员工界面；管理员建档并分配岗位后，系统会提示你重新登录刷新权限。</p>
            <div class="pending-steps">
              <span class="done">资料提交</span>
              <span class="done">普通员工入口</span>
              <span class="active">等待岗位分配</span>
            </div>
            <el-button type="primary" size="large" class="primary-action" @click="enterEmployeeWorkspace">进入普通员工界面</el-button>
            <el-button size="large" class="secondary-action" @click="backToLogin">返回登录</el-button>
          </div>
        </Transition>

        <Transition name="fade">
          <p v-if="errorMsg" class="error-msg">{{ errorMsg }}</p>
        </Transition>
      </section>
    </section>
    <p class="login-copyright">◎ 2026 简尚系统 · 艺术涂料施工交付管理平台</p>
  </main>
</template>

<style scoped>
.login-shell {
  position: relative;
  min-height: 100vh;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 48px clamp(34px, 12vw, 180px) 48px 40px;
  color: var(--text-primary);
  background:
    linear-gradient(112deg, rgba(255,255,255,0.05), rgba(255,255,255,0.18)),
    url('/login-paint-bg.png') center / cover no-repeat,
    #eef3f7;
}

.paint-texture {
  position: absolute;
  inset: 0;
  opacity: 0.82;
  background:
    linear-gradient(112deg, rgba(255,255,255,0.02) 0 63%, rgba(255,255,255,0.62) 63% 78%, rgba(255,255,255,0.18) 78%),
    radial-gradient(ellipse at 78% 22%, rgba(255,255,255,0.6), transparent 30%);
}

.paint-texture::after {
  content: '';
  position: absolute;
  inset: -8%;
  background:
    radial-gradient(ellipse at 18% 92%, rgba(217,119,6,0.14), transparent 22%),
    radial-gradient(ellipse at 82% 72%, rgba(79,109,245,0.12), transparent 26%);
  filter: blur(18px);
}

.workspace-ghost {
  position: absolute;
  left: clamp(20px, 1.8vw, 28px);
  top: clamp(56px, 5.8vh, 64px);
  width: min(65vw, 966px);
  height: min(76vh, 804px);
  max-height: calc(100vh - 108px);
  display: grid;
  grid-template-columns: minmax(128px, 18%) 1fr;
  gap: 12px;
  padding: 10px;
  border: 0;
  border-radius: 22px;
  background: transparent;
  box-shadow: none;
  isolation: isolate;
  transform: perspective(1150px) rotateY(8.5deg) rotateX(1.5deg) translateX(-4px);
  transform-origin: left center;
  animation: ghostFloat 11s ease-in-out infinite;
  pointer-events: none;
}

.workspace-ghost::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: inherit;
  border: 1px solid rgba(255,255,255,0.62);
  background:
    linear-gradient(112deg, rgba(255,255,255,0.72), rgba(239,245,255,0.5) 56%, rgba(255,255,255,0.36)),
    radial-gradient(ellipse at 8% 8%, rgba(255,255,255,0.7), transparent 34%),
    radial-gradient(ellipse at 84% 92%, rgba(79,109,245,0.1), transparent 34%);
  box-shadow:
    0 22px 78px rgba(74,92,132,0.1),
    inset 0 1px 0 rgba(255,255,255,0.7);
  backdrop-filter: blur(14px) saturate(1.05);
}

.ghost-sidebar,
.ghost-content,
.auth-panel,
.brand-panel {
  background: rgba(255,255,255,0.43);
  border: 1px solid rgba(255,255,255,0.5);
  box-shadow: 0 18px 54px rgba(54,71,108,0.055);
  backdrop-filter: blur(16px);
}

.ghost-sidebar {
  border-radius: 18px;
  padding: clamp(18px, 1.9vw, 24px) clamp(12px, 1.4vw, 16px) 16px;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: rgba(255,255,255,0.5);
  border-color: rgba(255,255,255,0.58);
}

.ghost-logo-line {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-bottom: clamp(18px, 2.4vh, 26px);
  color: rgba(46,60,86,0.78);
  font-size: clamp(12px, 1vw, 15px);
}

.ghost-logo-line img {
  width: 23px;
  height: 18px;
  object-fit: contain;
  opacity: 0.72;
  mix-blend-mode: multiply;
}

.ghost-nav-list {
  display: grid;
  gap: clamp(6px, 1vh, 9px);
}

.ghost-nav {
  height: clamp(25px, 3.2vh, 32px);
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 9px;
  border-radius: 8px;
  color: rgba(68,82,111,0.75);
  font-size: clamp(10px, 0.82vw, 12px);
  font-weight: 600;
}

.ghost-nav.active {
  color: #4f6df5;
  background: rgba(79,109,245,0.12);
}

.nav-icon {
  width: 18px;
  height: 18px;
  flex: 0 0 18px;
  display: inline-grid;
  place-items: center;
  border-radius: 6px;
  color: rgba(74,91,122,0.72);
  font-size: 14px;
}

.ghost-nav.active .nav-icon {
  color: #4f6df5;
  background: rgba(79,109,245,0.12);
  box-shadow: inset 0 0 0 1px rgba(79,109,245,0.08);
}

.ghost-summary {
  margin-top: auto;
  padding: 12px;
  border: 1px solid rgba(90,111,150,0.08);
  border-radius: 10px;
  background: rgba(255,255,255,0.48);
  color: rgba(68,82,111,0.78);
  font-size: 11px;
}

.ghost-summary strong {
  display: block;
  margin-bottom: 10px;
}

.ghost-summary p {
  display: flex;
  justify-content: space-between;
  margin: 8px 0;
}

.ghost-summary b {
  color: rgba(46,60,86,0.9);
}

.ghost-content {
  border-radius: 18px;
  padding: clamp(18px, 1.9vw, 24px);
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: rgba(255,255,255,0.48);
  border-color: rgba(255,255,255,0.56);
}

.ghost-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 16px;
}

.ghost-header h3 {
  margin: 0;
  color: rgba(46,60,86,0.86);
  font-size: 17px;
}

.ghost-header span {
  color: rgba(91,104,132,0.5);
  font-size: 11px;
}

.ghost-welcome {
  display: flex;
  justify-content: space-between;
  align-items: end;
  padding: 18px 20px;
  margin-bottom: 14px;
  border: 1px solid rgba(90,111,150,0.08);
  border-radius: 14px;
  background: rgba(255,255,255,0.48);
}

.ghost-welcome strong {
  color: rgba(46,60,86,0.86);
  font-size: 19px;
}

.ghost-welcome span {
  color: rgba(91,104,132,0.58);
  font-size: 12px;
}

.ghost-stat-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.ghost-stat {
  height: clamp(66px, 8vh, 88px);
  padding: clamp(10px, 1.2vw, 13px);
  border-radius: 10px;
  background: rgba(255,255,255,0.46);
  border: 1px solid rgba(90,111,150,0.08);
}

.ghost-stat span,
.ghost-stat small {
  display: block;
  color: rgba(91,104,132,0.65);
  font-size: 11px;
}

.ghost-stat strong {
  display: block;
  margin: 6px 0 4px;
  color: rgba(46,60,86,0.86);
  font-size: clamp(18px, 1.7vw, 24px);
  line-height: 1;
}

.ghost-stat small {
  color: rgba(27,153,119,0.72);
}

.ghost-chart {
  position: relative;
  height: clamp(138px, 20vh, 190px);
  margin: clamp(16px, 2.4vh, 26px) 0;
  border-radius: 12px;
  overflow: hidden;
  background: rgba(255,255,255,0.32);
  border: 1px solid rgba(90,111,150,0.08);
}

.ghost-chart h4 {
  position: absolute;
  top: 16px;
  left: 18px;
  margin: 0;
  z-index: 1;
  color: rgba(46,60,86,0.78);
  font-size: 13px;
}

.chart-grid {
  position: absolute;
  inset: 18px;
  background-image:
    linear-gradient(rgba(90,111,150,0.08) 1px, transparent 1px),
    linear-gradient(90deg, rgba(90,111,150,0.08) 1px, transparent 1px);
  background-size: 72px 46px;
}

.chart-line {
  position: absolute;
  left: 26px;
  right: 22px;
  bottom: 52px;
  height: 118px;
  border-bottom: 4px solid #5b7cff;
  border-radius: 50% 50% 0 0 / 70% 70% 0 0;
  transform: skewX(-16deg) rotate(-3deg);
  opacity: 0.86;
}

.ghost-progress {
  margin-top: auto;
  color: rgba(68,82,111,0.72);
}

.ghost-progress h4 {
  margin: 0 0 14px;
  font-size: 14px;
  color: rgba(46,60,86,0.82);
}

.progress-row {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 12px;
  align-items: center;
  margin: 12px 0;
  font-size: 12px;
}

.progress-row i {
  height: 7px;
  border-radius: 999px;
  background: rgba(90,111,150,0.12);
  overflow: hidden;
}

.progress-row b {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #4f6df5, #7aa1ff);
}

.auth-stage {
  position: relative;
  z-index: 2;
  width: min(55.7vw, 828px);
  height: min(76vh, 728px);
  min-height: 540px;
  display: grid;
  grid-template-columns: 41% 59%;
  border-radius: 24px;
  overflow: hidden;
  border: 1px solid rgba(255,255,255,0.78);
  background: rgba(255,255,255,0.72);
  box-shadow: 0 28px 76px rgba(54,71,108,0.145);
  backdrop-filter: blur(24px);
}

.login-copyright {
  position: absolute;
  left: 50%;
  bottom: clamp(18px, 2.6vh, 28px);
  z-index: 3;
  margin: 0;
  transform: translateX(-50%);
  color: rgba(93, 108, 134, 0.36);
  font-size: 12px;
  line-height: 1.4;
  letter-spacing: 0;
  white-space: nowrap;
  text-shadow: 0 1px 0 rgba(255,255,255,0.58);
  pointer-events: none;
}

.auth-stage::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(90deg, rgba(255,255,255,0.44), rgba(255,255,255,0.26) 39%, rgba(255,255,255,0.86) 39%),
    linear-gradient(150deg, rgba(79,109,245,0.05), transparent 44%);
}

.brand-panel {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: clamp(28px, 2.8vw, 38px);
  border-radius: 24px 0 0 24px;
  overflow: hidden;
  background:
    linear-gradient(180deg, rgba(255,255,255,0.5), rgba(232,240,255,0.38)),
    radial-gradient(ellipse at 12% 100%, rgba(79,109,245,0.12), transparent 46%);
  box-shadow: none;
  border: 0;
  opacity: 1;
}

.brand-panel::before,
.brand-panel::after {
  content: '';
  position: absolute;
  z-index: 0;
  pointer-events: none;
}

.brand-panel::before {
  inset: auto -18% -8% -18%;
  height: 46%;
  background: url('/login-paint-bg.png') 18% 100% / 150% auto no-repeat;
  opacity: 0.72;
  mix-blend-mode: multiply;
  filter: saturate(1.18) contrast(1.08);
  -webkit-mask-image: linear-gradient(to top, #000 0 72%, transparent 100%);
  mask-image: linear-gradient(to top, #000 0 72%, transparent 100%);
}

.brand-panel::after {
  left: -16%;
  right: 20%;
  bottom: -6%;
  height: 28%;
  background: url('/login-paint-bg.png') 6% 96% / 210% auto no-repeat;
  opacity: 0.62;
  filter: saturate(1.25) contrast(1.08);
  -webkit-mask-image: radial-gradient(ellipse at 28% 88%, #000 0 56%, transparent 78%);
  mask-image: radial-gradient(ellipse at 28% 88%, #000 0 56%, transparent 78%);
}

.brand-mark {
  display: flex;
  justify-content: center;
}

.brand-mark,
.brand-copy,
.brand-features {
  position: relative;
  z-index: 1;
}

.brand-logo {
  width: clamp(100px, 8.4vw, 128px);
  height: auto;
  object-fit: contain;
  mix-blend-mode: multiply;
}

.brand-copy { margin-top: clamp(52px, 7vh, 74px); }
.eyebrow {
  margin: 0 0 10px;
  font-size: 13px;
  color: var(--color-primary);
  font-weight: 700;
}

.brand-copy h1 {
  margin: 0;
  font-size: clamp(23px, 2vw, 28px);
  line-height: 1.18;
  letter-spacing: 0;
}

.subtitle {
  margin: 12px 0 0;
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.8;
}

.brand-mode-switch {
  width: min(100%, 258px);
  margin: 28px 0 0;
  background: rgba(241,243,247,0.82);
  border: 1px solid rgba(255,255,255,0.72);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.62),
    0 10px 24px rgba(54,71,108,0.06);
}

.brand-features {
  display: grid;
  gap: 14px;
  margin-top: clamp(38px, 6vh, 64px);
}

.feature-item {
  display: grid;
  grid-template-columns: 34px 1fr;
  gap: 12px;
  align-items: start;
  color: var(--text-secondary);
}

.feature-item .el-icon {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: var(--color-primary-bg);
  color: var(--color-primary);
}

.feature-item strong {
  display: block;
  color: var(--text-primary);
  font-size: 14px;
}

.feature-item span {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  line-height: 1.7;
}

.auth-panel {
  position: relative;
  z-index: 1;
  min-height: 0;
  display: grid;
  overflow: hidden;
  padding: clamp(30px, 3.7vh, 40px) clamp(40px, 3.7vw, 54px);
  border-left: 1px solid rgba(79,109,245,0.08);
  border-radius: 0 24px 24px 0;
  background: rgba(255,255,255,0.62);
  box-shadow: none;
  backdrop-filter: blur(18px);
}

.auth-panel.register-panel {
  padding-top: clamp(20px, 2.6vh, 28px);
  padding-bottom: clamp(18px, 2.6vh, 26px);
  overflow-y: auto;
}

.mode-switch {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 5px;
  padding: 5px;
  border-radius: 11px;
  background: rgba(79,109,245,0.08);
}

.mode-switch button {
  height: 37px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: rgba(45,57,82,0.82);
  cursor: pointer;
  font-weight: 600;
  letter-spacing: 0;
  transition: color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
}

.mode-switch button.active {
  background: #fff;
  color: var(--color-primary);
  box-shadow: 0 9px 24px rgba(54,71,108,0.12);
}

.auth-form {
  grid-area: 1 / 1;
  justify-self: center;
  width: min(100%, 356px);
  margin: clamp(84px, 12vh, 112px) auto 0;
}

.register-form {
  margin-top: 0;
}

.form-head p,
.submitted-kicker {
  margin: 0 0 8px;
  color: var(--color-primary);
  font-size: 13px;
  font-weight: 700;
}

.form-head h2,
.submitted-state h2 {
  margin: 0 0 26px;
  font-size: 27px;
  line-height: 1.25;
  letter-spacing: 0;
}

.register-form .form-head h2 {
  margin-bottom: 16px;
}

.login-form,
.register-fields {
  display: grid;
  gap: 4px;
}

.login-form :deep(.el-form-item) {
  margin-bottom: 14px;
}

.register-fields :deep(.el-form-item) {
  margin-bottom: 6px;
}

.register-fields :deep(.el-input__wrapper) {
  min-height: 38px;
}

.account-input,
.department-cascader,
.primary-action,
.secondary-action {
  width: 100%;
}

.login-options {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 2px 0 18px;
}

.primary-action {
  height: 46px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.secondary-action {
  height: 42px;
  margin: 12px 0 0;
}

.account-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 12px;
}

.account-option button {
  border: 0;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
}

.step-track {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 24px;
}

.register-form .step-track {
  gap: 8px;
  margin-bottom: 14px;
}

.step-dot {
  display: grid;
  grid-template-columns: 24px 1fr;
  gap: 8px;
  align-items: start;
  color: var(--text-tertiary);
}

.step-dot > span {
  display: inline-grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 999px;
  background: var(--border-light);
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 700;
}

.step-dot strong {
  display: block;
  font-size: 12px;
  line-height: 1.2;
}

.step-dot small {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  line-height: 1.4;
}

.step-dot.active,
.step-dot.done {
  color: var(--color-primary);
}

.step-dot.active > span,
.step-dot.done > span {
  background: var(--color-primary);
  color: #fff;
}

.ai-preferences {
  display: grid;
  gap: 16px;
}

.preference-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  padding: 16px;
  border: 1px solid var(--border-light);
  border-radius: 12px;
  background: rgba(247,249,252,0.72);
}

.preference-row strong {
  display: block;
  font-size: 14px;
}

.preference-row small {
  display: block;
  margin-top: 4px;
  color: var(--text-tertiary);
  font-size: 12px;
}

.ai-preview {
  display: grid;
  grid-template-columns: 38px 1fr;
  gap: 12px;
  align-items: center;
  padding: 16px;
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(79,109,245,0.1), rgba(217,119,6,0.08));
}

.ai-pulse {
  width: 38px;
  height: 38px;
  border-radius: 14px;
  background: var(--color-primary);
  box-shadow: 0 0 0 0 rgba(79,109,245,0.32);
  animation: pulse 2.2s ease-out infinite;
}

.ai-preview strong { display: block; }
.ai-preview p {
  margin: 2px 0 0;
  color: var(--text-secondary);
  font-size: 12px;
}

.register-actions {
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 12px;
  margin-top: 4px;
}

.submitted-state {
  min-height: 520px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
}

.loading-ring {
  position: relative;
  width: 86px;
  height: 86px;
  display: grid;
  place-items: center;
  margin-bottom: 26px;
}

.loading-ring span {
  position: absolute;
  inset: 0;
  border-radius: 999px;
  border: 2px solid rgba(79,109,245,0.12);
  border-top-color: var(--color-primary);
  animation: spin 1.4s linear infinite;
}

.loading-ring .el-icon {
  width: 48px;
  height: 48px;
  border-radius: 999px;
  color: #fff;
  background: var(--color-primary);
}

.submitted-state h2 {
  max-width: 420px;
  margin-bottom: 12px;
}

.submitted-desc {
  max-width: 430px;
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.8;
}

.pending-steps {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin: 30px 0;
  flex-wrap: wrap;
}

.pending-steps span {
  padding: 6px 12px;
  border-radius: 999px;
  background: var(--border-light);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.pending-steps span.done {
  color: var(--color-success);
  background: #ecfdf5;
}

.pending-steps span.active {
  color: var(--color-danger);
  background: #fef2f2;
}

.error-msg {
  position: absolute;
  left: 56px;
  right: 56px;
  bottom: 24px;
  margin: 0;
  padding: 12px 14px;
  border-radius: 10px;
  background: #fef2f2;
  color: var(--color-danger);
  font-size: 13px;
}

.fade-enter-active,
.fade-leave-active,
.step-fade-enter-active,
.step-fade-leave-active {
  transition: all 0.24s ease;
}

.auth-slide-forward-enter-active,
.auth-slide-forward-leave-active,
.auth-slide-back-enter-active,
.auth-slide-back-leave-active {
  transition:
    opacity 1s cubic-bezier(0.22, 1, 0.36, 1),
    transform 1s cubic-bezier(0.22, 1, 0.36, 1),
    filter 1s cubic-bezier(0.22, 1, 0.36, 1);
  transform-origin: center 42%;
  will-change: opacity, transform, filter;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.step-fade-enter-from,
.step-fade-leave-to {
  opacity: 0;
  transform: translateY(14px);
}

.auth-slide-forward-enter-from {
  opacity: 0;
  transform: translate(74px, 18px) rotate(2.2deg) scale(0.982);
  filter: blur(5px);
}

.auth-slide-forward-leave-to {
  opacity: 0;
  transform: translate(-74px, -16px) rotate(-2deg) scale(0.988);
  filter: blur(5px);
}

.auth-slide-back-enter-from {
  opacity: 0;
  transform: translate(-74px, 18px) rotate(-2.2deg) scale(0.982);
  filter: blur(5px);
}

.auth-slide-back-leave-to {
  opacity: 0;
  transform: translate(74px, -16px) rotate(2deg) scale(0.988);
  filter: blur(5px);
}

@keyframes ghostFloat {
  0%, 100% { transform: perspective(1150px) rotateY(8.5deg) rotateX(1.5deg) translateX(-4px) translateY(0); }
  50% { transform: perspective(1150px) rotateY(7.4deg) rotateX(1.5deg) translateX(-4px) translateY(-6px); }
}

@keyframes pulse {
  0% { box-shadow: 0 0 0 0 rgba(79,109,245,0.32); }
  80%, 100% { box-shadow: 0 0 0 18px rgba(79,109,245,0); }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

:global(html.dark) .login-shell {
  background:
    linear-gradient(120deg, rgba(12,12,15,0.76), rgba(20,24,38,0.5)),
    url('/login-paint-bg.png') center / cover no-repeat,
    #0c0c0f;
}

:global(html.dark) .paint-texture {
  opacity: 0.44;
}

:global(html.dark) .ghost-sidebar,
:global(html.dark) .ghost-content,
:global(html.dark) .auth-panel,
:global(html.dark) .brand-panel {
  background: rgba(24,24,27,0.72);
  border-color: rgba(255,255,255,0.08);
}

:global(html.dark) .auth-panel {
  background: rgba(24,24,27,0.9);
}

:global(html.dark) .mode-switch button.active {
  background: rgba(255,255,255,0.08);
}

:global(html.dark) .brand-logo {
  mix-blend-mode: screen;
  filter: brightness(1.8) contrast(0.82);
}

:global(html.dark) .preference-row {
  background: rgba(255,255,255,0.03);
}

@media (max-width: 980px) {
  .login-shell {
    padding: 92px 18px 26px;
    align-items: flex-start;
  }
  .workspace-ghost {
    width: 92vw;
    height: 500px;
    left: -70px;
    top: 90px;
    opacity: 0.42;
  }
  .auth-stage {
    grid-template-columns: 1fr;
    min-height: auto;
  }
  .brand-panel {
    border-radius: 24px 24px 0 0;
    padding: 28px;
  }
  .brand-features {
    display: none;
  }
  .auth-panel {
    min-height: 580px;
    border-radius: 0 0 24px 24px;
    padding: 28px;
  }
  .mode-switch {
    width: 100%;
  }
  .auth-form {
    margin-top: 34px;
  }
  .step-track {
    grid-template-columns: 1fr;
  }
  .error-msg {
    left: 28px;
    right: 28px;
  }
  .login-copyright {
    position: relative;
    left: auto;
    bottom: auto;
    width: 100%;
    margin: 18px 0 0;
    transform: none;
    text-align: center;
    white-space: normal;
  }
}

@media (max-width: 560px) {
  .brand-logo {
    width: 148px;
  }
  .brand-copy h1,
  .form-head h2,
  .submitted-state h2 {
    font-size: 24px;
  }
  .register-actions {
    grid-template-columns: 1fr;
  }
}

</style>
