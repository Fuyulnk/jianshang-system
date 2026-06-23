<template>
  <div class="dashboard">
    <!-- 顶部欢迎 -->
    <div class="welcome-banner">
      <div class="welcome-text">
        <h2>欢迎回来</h2>
        <p>以下是今天的系统概况</p>
      </div>
      <div class="welcome-time">{{ currentTime }}</div>
    </div>

    <!-- 统计卡片 -->
    <el-row :gutter="20">
      <el-col :xs="12" :sm="12" :md="6" v-for="(stat, idx) in stats" :key="stat.label"
        :class="['slide-up', `slide-up-${idx + 1}`]" style="margin-bottom: 20px;">
        <el-card class="stat-card" shadow="never">
          <div class="stat-inner">
            <div :class="['stat-icon', stat.color]">
              <el-icon :size="22"><component :is="stat.icon" /></el-icon>
            </div>
            <div class="stat-info">
              <div class="stat-value">{{ stat.value }}</div>
              <div class="stat-label">{{ stat.label }}</div>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 快捷入口 -->
    <h3 class="section-title">快捷入口</h3>
    <el-row :gutter="20">
      <el-col :span="6" v-for="(item, idx) in quickActions" :key="item.title"
        :class="['slide-up', `slide-up-${idx + 5}`]" style="margin-bottom: 20px;">
        <el-card class="action-card" shadow="never" @click="$router.push(item.path)">
          <div class="action-inner">
            <div :class="['action-icon-wrap', item.color]">
              <el-icon :size="24"><component :is="item.icon" /></el-icon>
            </div>
            <div class="action-title">{{ item.title }}</div>
            <div class="action-desc">{{ item.desc }}</div>
          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { getAuthToken } from '../utils/authSession'
import { markRaw, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  Wallet, List, Goods, User,
  TrendCharts, Clock
} from '@element-plus/icons-vue'

const router = useRouter()
const currentTime = ref('')
let clockTimer = null

const stats = ref([
  { label: '账户总数', value: '-', icon: markRaw(Wallet), color: 'blue' },
  { label: '交易记录', value: '-', icon: markRaw(TrendCharts), color: 'green' },
  { label: '产品种类', value: '-', icon: markRaw(Goods), color: 'orange' },
  { label: '员工人数', value: '-', icon: markRaw(User), color: 'purple' }
])

const quickActions = [
  { title: '账户管理', desc: '查看和管理所有账户', path: '/main/accounts', icon: markRaw(Wallet), color: 'blue' },
  { title: '交易流水', desc: '查看所有交易记录', path: '/main/transactions', icon: markRaw(List), color: 'green' },
  { title: '产品库存', desc: '管理产品信息和库存', path: '/main/products', icon: markRaw(Goods), color: 'orange' },
  { title: '员工管理', desc: '管理员工信息', path: '/main/employees', icon: markRaw(User), color: 'purple' }
]

function updateTime() {
  const now = new Date()
  const opts = { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', hour: '2-digit', minute: '2-digit' }
  currentTime.value = now.toLocaleDateString('zh-CN', opts)
}

async function fetchStats() {
  const token = getAuthToken()
  if (!token) return
  try {
    const [accRes, txWindow, prodRes, empRes] = await Promise.all([
      fetch('/api/accounts', { headers: { Authorization: `Bearer ${token}` } }),
      fetchTransactionWindow(token),
      fetch('/api/products', { headers: { Authorization: `Bearer ${token}` } }),
      fetch('/api/employees', { headers: { Authorization: `Bearer ${token}` } })
    ])
    const acc = await accRes.json()
    const prod = await prodRes.json()
    const emp = await empRes.json()
    stats.value = [
      { label: '账户总数', value: acc.data?.length || 0, icon: markRaw(Wallet), color: 'blue' },
      { label: txWindow.label, value: txWindow.count, icon: markRaw(TrendCharts), color: 'green' },
      { label: '产品种类', value: prod.data?.length || 0, icon: markRaw(Goods), color: 'orange' },
      { label: '员工人数', value: emp.data?.length || 0, icon: markRaw(User), color: 'purple' }
    ]
  } catch {}
}

async function fetchTransactionWindow(token) {
  const today = new Date()
  const yesterday = addDays(today, -1)
  const sevenDaysAgo = addDays(today, -6)
  const windows = [
    { label: '今日交易', start: formatDate(today), end: formatDate(today) },
    { label: '昨日交易', start: formatDate(yesterday), end: formatDate(yesterday) },
    { label: '近7日交易', start: formatDate(sevenDaysAgo), end: formatDate(today) }
  ]

  for (const item of windows) {
    const params = new URLSearchParams({
      pageSize: '1',
      start_date: item.start,
      end_date: item.end
    })
    const res = await fetch(`/api/transactions?${params}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    const json = await res.json()
    const count = Number(json.total || 0)
    if (count > 0 || item.label === '近7日交易') {
      return {
        label: count > 0 ? item.label : '近7日无交易',
        count
      }
    }
  }
  return { label: '近7日无交易', count: 0 }
}

function addDays(date, days) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function formatDate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

onMounted(() => {
  updateTime()
  fetchStats()
  clockTimer = window.setInterval(updateTime, 60000)
})

onUnmounted(() => {
  if (clockTimer) window.clearInterval(clockTimer)
})
</script>

<style scoped>
.welcome-banner {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  margin-bottom: 28px;
  background: var(--bg-card);
  padding: 24px 28px;
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--border-light);
}

.welcome-text h2 {
  margin: 0;
  font-size: 22px;
  color: var(--text-primary);
  font-weight: 700;
  letter-spacing: -0.3px;
}

.welcome-text p {
  margin: 4px 0 0;
  color: var(--text-tertiary);
  font-size: 14px;
}

.welcome-time {
  color: var(--text-tertiary);
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}

.stat-card {
  border-radius: var(--radius-md) !important;
  transition: all 0.25s ease;
  border: 1px solid var(--border-light) !important;
}
.stat-card:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow-md) !important;
}

.stat-inner {
  display: flex;
  align-items: center;
  gap: 16px;
}

.stat-icon {
  width: 48px;
  height: 48px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.stat-icon.blue { background: var(--color-primary-bg); color: var(--color-primary); }
.stat-icon.green { background: #ecfdf5; color: var(--color-success); }
.stat-icon.orange { background: #fffbeb; color: var(--color-warning); }
.stat-icon.purple { background: #f5f0ff; color: #8b5cf6; }
:global(html.dark) .stat-icon.green { background: rgba(16,185,129,0.2); }
:global(html.dark) .stat-icon.orange { background: rgba(245,158,11,0.22); }
:global(html.dark) .stat-icon.purple { background: rgba(139,92,246,0.22); }

.stat-info { flex: 1; }
.stat-value { font-size: 28px; font-weight: 700; color: var(--text-primary); line-height: 1.2; letter-spacing: -0.5px; }
.stat-label { font-size: 13px; color: var(--text-tertiary); margin-top: 4px; }

.section-title {
  font-size: 16px;
  color: var(--text-primary);
  margin: 8px 0 16px;
  font-weight: 600;
}

.action-card {
  border-radius: var(--radius-md) !important;
  cursor: pointer;
  transition: all 0.25s ease;
  border: 1px solid var(--border-light) !important;
}
.action-card:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow-md) !important;
}

.action-inner {
  text-align: center;
  padding: 16px 8px;
}

.action-icon-wrap {
  width: 52px;
  height: 52px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto;
}
.action-icon-wrap.blue { background: var(--color-primary-bg); color: var(--color-primary); }
.action-icon-wrap.green { background: #ecfdf5; color: var(--color-success); }
.action-icon-wrap.orange { background: #fffbeb; color: var(--color-warning); }
.action-icon-wrap.purple { background: #f5f0ff; color: #8b5cf6; }
:global(html.dark) .action-icon-wrap.blue { background: rgba(79,109,245,0.22); }
:global(html.dark) .action-icon-wrap.green { background: rgba(16,185,129,0.2); }
:global(html.dark) .action-icon-wrap.orange { background: rgba(245,158,11,0.22); }
:global(html.dark) .action-icon-wrap.purple { background: rgba(139,92,246,0.22); }

.action-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin-top: 14px;
}

.action-desc {
  font-size: 13px;
  color: var(--text-tertiary);
  margin-top: 4px;
}
</style>
