<template>
  <el-container class="main-layout">
    <!-- 左侧菜单 -->
    <el-aside :width="collapsed ? '64px' : '240px'" class="sidebar">
      <div class="sidebar-bg"></div>
      <div class="sidebar-inner">
        <div class="sidebar-logo">
          <img class="logo-symbol" src="/jianshang-logo.jpeg" alt="简尚涂装" />
          <span class="logo-text" :class="{ collapsed }">简尚系统</span>
        </div>
        <el-menu
          :default-active="route.path"
          router
          :collapse="collapsed"
        >
          <el-menu-item :index="isAdmin ? '/main/dashboard' : '/main/employee-dashboard'">
            <el-icon><HomeFilled /></el-icon>
            <span>{{ isAdmin ? '控制台' : '工作台' }}</span>
          </el-menu-item>

          <el-menu-item index="/main/chat">
            <el-icon><ChatDotSquare /></el-icon>
            <span>聊天</span>
          </el-menu-item>

          <el-menu-item index="/main/projects" v-if="hasPerm('projects')">
            <el-icon><List /></el-icon>
            <span>工程订单</span>
          </el-menu-item>

          <el-menu-item index="/main/files" v-if="hasFileCenterAccess">
            <el-icon><Document /></el-icon>
            <span>文件中心</span>
          </el-menu-item>

          <el-menu-item index="/main/accounts" v-if="hasPerm('accounts')">
            <el-icon><Wallet /></el-icon>
            <span>账户管理</span>
          </el-menu-item>
          <el-menu-item index="/main/transactions" v-if="hasPerm('transactions')">
            <el-icon><List /></el-icon>
            <span>交易流水</span>
          </el-menu-item>
          <el-menu-item index="/main/finance/overview" v-if="hasFinanceAccess">
            <el-icon><TrendCharts /></el-icon>
            <span>财务总览</span>
          </el-menu-item>
          <el-menu-item index="/main/products" v-if="hasPerm('products')">
            <el-icon><Goods /></el-icon>
            <span>产品库存</span>
          </el-menu-item>
          <el-menu-item index="/main/employees" v-if="hasPerm('employees')">
            <el-icon><User /></el-icon>
            <span>员工管理</span>
          </el-menu-item>

          <template v-if="isAdmin">
            <el-divider class="menu-divider" />
            <div v-show="!collapsed" class="menu-group-label">系统管理</div>
            <el-menu-item index="/main/roles">
              <el-icon><Operation /></el-icon>
              <span>角色权限</span>
            </el-menu-item>
            <el-menu-item index="/main/system/settings">
              <el-icon><Tools /></el-icon>
              <span>系统设置</span>
            </el-menu-item>
          </template>
        </el-menu>

        <!-- 折叠按钮 -->
        <div class="sidebar-footer">
          <el-button class="collapse-btn" @click="collapsed = !collapsed">
            <el-icon><Fold v-if="!collapsed" /><Expand v-else /></el-icon>
          </el-button>
        </div>
      </div>
    </el-aside>

    <!-- 右侧 -->
    <el-container>
      <el-header class="header">
        <div class="header-left">
          <span class="page-title">{{ route.meta?.title || route.name }}</span>
        </div>
        <div class="header-right">
          <UserAvatar :username="userInfo.username" :avatar-url="userInfo.avatar_url" :size="30" />
          <span class="user-name">{{ userInfo.username }}</span>
          <span class="user-role">{{ userInfo.role_label }}</span>
          <el-button text size="small" class="header-btn" @click="toggleTheme" :title="themeTitle">
            <el-icon><Moon v-if="isDark" /><Sunny v-else /></el-icon>
          </el-button>
          <el-button type="danger" plain size="small" @click="handleLogout">退出</el-button>
        </div>
      </el-header>
      <el-main class="content">
        <router-view v-slot="{ Component }">
          <transition name="page" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </el-main>
    </el-container>

    <!-- 入职向导 -->
    <OnboardingWizard :visible="showOnboarding" @done="onOnboardingDone" />

    <!-- AI 桌宠浮窗 -->
    <AiPetWidget />
  </el-container>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { HomeFilled, Wallet, List, Goods, User, Operation, ChatDotSquare, Fold, Expand, Tools, Sunny, Moon, TrendCharts, Document } from '@element-plus/icons-vue'
import UserAvatar from '../components/UserAvatar.vue'
import AiPetWidget from '../components/AiPetWidget.vue'
import OnboardingWizard from '../components/OnboardingWizard.vue'

const router = useRouter()
const route = useRoute()
const userInfo = ref({ username: '用户', role_label: '', role: '' })
const allowedModules = ref([])
const isAdmin = ref(false)
const collapsed = ref(window.innerWidth < 1200)
const showOnboarding = ref(false)
const isDark = ref(false)
const themeTimer = ref(null)
const hasFinanceAccess = computed(() => isAdmin.value || userInfo.value.role === 'finance' || allowedModules.value.includes('finance'))
const hasFileCenterAccess = computed(() => isAdmin.value || ['finance', 'warehouse', 'engineering'].includes(userInfo.value.role) || ['projects', 'transactions', 'products'].some(hasPerm))
const themeTitle = computed(() => {
  const mode = localStorage.getItem('theme-mode') || 'auto'
  const now = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  if (mode === 'auto') return `自动主题 ${now}，18:00 后切换夜间`
  return isDark.value ? '切换亮色模式' : '切换暗色模式'
})

function initTheme() {
  const mode = localStorage.getItem('theme-mode') || 'auto'
  const stored = localStorage.getItem('theme')
  if (mode === 'manual' && (stored === 'dark' || stored === 'light')) {
    applyTheme(stored === 'dark')
  } else {
    applyTheme(isNightTime())
  }
  themeTimer.value = window.setInterval(() => {
    if ((localStorage.getItem('theme-mode') || 'auto') === 'auto') {
      applyTheme(isNightTime())
    }
  }, 60 * 1000)
}

function isNightTime() {
  const hour = new Date().getHours()
  return hour >= 18 || hour < 7
}

function applyTheme(dark) {
  isDark.value = dark
  document.documentElement.classList.toggle('dark', dark)
}

function toggleTheme() {
  applyTheme(!isDark.value)
  localStorage.setItem('theme-mode', 'manual')
  localStorage.setItem('theme', isDark.value ? 'dark' : 'light')
}

function applyPersonalAppearance() {
  const raw = localStorage.getItem('personal-appearance')
  const root = document.documentElement
  if (!raw) return
  try {
    const value = JSON.parse(raw)
    value.primaryColor ? root.style.setProperty('--color-primary', value.primaryColor) : root.style.removeProperty('--color-primary')
    value.textColor ? root.style.setProperty('--text-primary', value.textColor) : root.style.removeProperty('--text-primary')
    value.bgColor ? root.style.setProperty('--bg-page', value.bgColor) : root.style.removeProperty('--bg-page')
  } catch {}
}

function hasPerm(module) {
  return isAdmin.value || allowedModules.value.includes(module)
}

function token() { return localStorage.getItem('token') }

async function fetchUserInfo() {
  try {
    const res = await fetch('/api/me', {
      headers: { Authorization: `Bearer ${token()}` }
    })
    if (res.status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      router.replace('/')
      return
    }
    const json = await res.json()
    if (json.success) {
      userInfo.value = json.user
      isAdmin.value = json.user.role === 'super_admin' || json.user.role === 'admin'
      const hidden = json.user.ai_pet_enabled === 0
      const aiName = json.user.ai_name || '简尚小助手'
      localStorage.setItem('ai-pet-hidden', hidden ? 'true' : 'false')
      localStorage.setItem('ai-name', aiName)
      window.dispatchEvent(new CustomEvent('ai-pet-settings', { detail: { hidden, aiName } }))
      if (!json.user.onboarding_done) {
        showOnboarding.value = true
      }
    }
  } catch {}
}

function onOnboardingDone() {
  showOnboarding.value = false
  userInfo.value.onboarding_done = 1
}

async function fetchMenu() {
  try {
    const res = await fetch('/api/user-menu', {
      headers: { Authorization: `Bearer ${token()}` }
    })
    const json = await res.json()
    if (json.success) allowedModules.value = json.data
  } catch {}
}

const handleLogout = () => {
  localStorage.removeItem('token')
  localStorage.removeItem('user')
  router.push('/')
}

onMounted(() => {
  initTheme()
  applyPersonalAppearance()
  window.addEventListener('personal-appearance-change', applyPersonalAppearance)
  fetchUserInfo()
  fetchMenu()
})

onUnmounted(() => {
  if (themeTimer.value) window.clearInterval(themeTimer.value)
  window.removeEventListener('personal-appearance-change', applyPersonalAppearance)
})
</script>

<style scoped>
.main-layout { height: 100vh; }

.sidebar {
  background-color: var(--sidebar-bg);
  overflow: hidden;
  border-right: 1px solid var(--sidebar-border);
  display: flex;
  flex-direction: column;
  transition: width 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
}

.sidebar-bg {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse at 0% 20%, rgba(79, 109, 245, 0.06) 0%, transparent 60%),
    radial-gradient(ellipse at 100% 80%, rgba(217, 119, 6, 0.04) 0%, transparent 50%);
  pointer-events: none;
}

.sidebar-inner {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.sidebar-logo {
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border-bottom: 1px solid var(--sidebar-border);
  flex-shrink: 0;
  overflow: hidden;
}

.logo-symbol {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  object-fit: contain;
  background: #fff;
  padding: 3px;
  flex-shrink: 0;
}

.sidebar-logo span {
  color: var(--sidebar-logo-text);
  font-size: 16px;
  font-weight: 600;
  white-space: nowrap;
  transition: opacity 0.15s ease, width 0.2s ease;
}
.sidebar-logo .logo-text.collapsed {
  opacity: 0;
  width: 0;
  overflow: hidden;
}

.sidebar :deep(.el-menu) {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  border-right: none !important;
  background: transparent !important;
}

.sidebar :deep(.el-menu-item) {
  color: var(--sidebar-text) !important;
}
.sidebar :deep(.el-menu-item.is-active) {
  color: var(--sidebar-text-active) !important;
  background: rgba(79, 109, 245, 0.1) !important;
}
.sidebar :deep(.el-menu-item:hover) {
  background: rgba(128, 128, 128, 0.08) !important;
}
.sidebar :deep(.el-menu-item .el-icon) {
  color: var(--sidebar-icon) !important;
}
.sidebar :deep(.el-menu-item.is-active .el-icon) {
  color: var(--sidebar-text-active) !important;
}

.menu-divider {
  margin: 12px 16px;
  border-color: var(--sidebar-border) !important;
}

.menu-group-label {
  padding: 8px 20px 4px;
  font-size: 11px;
  color: var(--sidebar-text);
  opacity: 0.5;
  text-transform: uppercase;
  letter-spacing: 1px;
  white-space: nowrap;
  overflow: hidden;
}

.sidebar-footer {
  flex-shrink: 0;
  display: flex;
  justify-content: center;
  padding: 8px;
  border-top: 1px solid var(--sidebar-border);
}

.collapse-btn {
  width: 100%;
  border: none !important;
  color: var(--sidebar-icon) !important;
  background: transparent !important;
  font-size: 16px;
}
.collapse-btn:hover {
  color: var(--sidebar-text) !important;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--bg-header);
  border-bottom: 1px solid var(--border-color);
  padding: 0 28px;
  height: var(--header-height);
  box-shadow: 0 1px 3px rgba(0,0,0,0.03);
  position: relative;
  z-index: 10;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.page-title { font-size: 16px; font-weight: 600; color: var(--text-primary); }

.header-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.user-name { font-size: 14px; color: var(--text-primary); font-weight: 500; }
.user-role {
  font-size: 12px; color: var(--text-tertiary);
  background: var(--color-primary-bg);
  padding: 2px 10px;
  border-radius: 12px;
  font-weight: 500;
}

.header-btn {
  color: var(--text-tertiary) !important;
  font-size: 16px;
  width: 32px;
  height: 32px;
  border-radius: 6px !important;
}
.header-btn:hover {
  background: var(--border-light) !important;
  color: var(--text-primary) !important;
}

.content {
  background: var(--bg-page);
  min-height: calc(100vh - var(--header-height));
  padding: 24px;
  transition: padding 0.25s ease;
  overflow-y: auto;
}

/* 路由过渡动画 */
.page-enter-active { animation: pageIn 0.25s ease; }
.page-leave-active { animation: pageOut 0.15s ease; }
@keyframes pageIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes pageOut {
  from { opacity: 1; transform: translateY(0); }
  to { opacity: 0; transform: translateY(-4px); }
}
</style>
