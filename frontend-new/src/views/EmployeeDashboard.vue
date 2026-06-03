<template>
  <div class="emp-dashboard">
    <!-- 用户信息卡片 -->
    <el-card class="welcome-card" shadow="never">
      <div class="welcome-row">
        <div class="welcome-avatar">
          <UserAvatar :username="user.username" :avatar-url="user.avatar_url" :size="56" />
        </div>
        <div class="welcome-info">
          <h2>{{ user.real_name || user.username }}</h2>
          <div class="welcome-meta">
            <span class="meta-tag">{{ user.role_label || user.role }}</span>
            <span v-if="user.department" class="meta-divider">|</span>
            <span v-if="user.department" class="meta-text">{{ user.department }}</span>
          </div>
        </div>
        <div class="emp-code-badge" v-if="employeeCode">
          <span class="badge-label">员工ID</span>
          <span class="badge-code" @click="copyCode(employeeCode)">{{ employeeCode.replace(/^(.{4}).*/, '$1···') }}</span>
        </div>
      </div>
    </el-card>

    <!-- 待办分组 -->
    <div class="task-section" v-for="g in groups" :key="g.key">
      <div class="section-head">
        <h3>{{ g.label }}</h3>
        <span class="section-count">{{ g.count }} 项</span>
      </div>

      <el-row :gutter="16" v-if="g.projects.length">
        <el-col :xs="24" :sm="12" :md="8" v-for="p in g.projects" :key="p.id" style="margin-bottom: 16px;">
          <el-card class="task-card" shadow="never" @click="goProject(p.id)">
            <div class="task-name">{{ p.name }}</div>
            <div class="task-meta">
              <span>客户：{{ p.customer }}</span>
              <el-tag size="small" type="primary" class="task-status-tag">{{ p.status_label }}</el-tag>
            </div>
            <div class="task-owner" v-if="p.assignee_name">
              施工负责人：{{ p.assignee_name }}
            </div>
          </el-card>
        </el-col>
      </el-row>
      <el-empty v-else description="暂无" :image-size="50" style="padding: 20px 0;" />
    </div>

    <!-- 快捷入口 -->
    <el-card class="quick-card" shadow="never">
      <template #header>
        <span>快捷入口</span>
      </template>
      <div class="quick-actions">
        <div class="quick-item" @click="$router.push('/main/projects')">
          <el-icon :size="22"><List /></el-icon>
          <span>项目工单</span>
        </div>
        <div class="quick-item" @click="$router.push('/main/chat')" v-if="hasChat">
          <el-icon :size="22"><ChatDotSquare /></el-icon>
          <span>聊天</span>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { List, ChatDotSquare } from '@element-plus/icons-vue'
import UserAvatar from '../components/UserAvatar.vue'

const router = useRouter()
const user = ref({})
const employeeCode = ref('')
const groups = ref([])
const hasChat = ref(true)

function token() { return localStorage.getItem('token') }

async function fetchDashboard() {
  try {
    const res = await fetch('/api/employee/dashboard', {
      headers: { Authorization: `Bearer ${token()}` }
    })
    const json = await res.json()
    if (json.success) {
      user.value = json.data.user
      groups.value = json.data.groups

      // 尝试获取员工ID
      try {
        const empRes = await fetch('/api/employees', {
          headers: { Authorization: `Bearer ${token()}` }
        })
        const empJson = await empRes.json()
        if (empJson.success) {
          const me = empJson.data.find(e => e.name === user.value.real_name || e.name === user.value.username)
          if (me) employeeCode.value = me.employee_code
        }
      } catch {}
    }
  } catch {}
}

function goProject(id) {
  router.push(`/main/projects/${id}`)
}

function copyCode(code) {
  try {
    navigator.clipboard.writeText(code)
    ElMessage.success('已复制：' + code)
  } catch {}
}

onMounted(fetchDashboard)
</script>

<style scoped>
.emp-dashboard {
  max-width: 1000px;
}

.welcome-card {
  border-radius: var(--radius-md) !important;
  border: 1px solid var(--border-light) !important;
  margin-bottom: 24px;
}

.welcome-row {
  display: flex;
  align-items: center;
  gap: 20px;
}

.welcome-info {
  flex: 1;
}

.welcome-info h2 {
  margin: 0 0 4px;
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
}

.welcome-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.meta-tag {
  color: var(--color-primary);
  font-weight: 500;
}

.meta-divider {
  color: var(--border-light);
}

.meta-text {
  color: var(--text-tertiary);
}

.emp-code-badge {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 14px;
  background: rgba(128,128,128,0.05);
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}

.emp-code-badge:hover {
  background: rgba(128,128,128,0.1);
}

.badge-label {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-bottom: 2px;
}

.badge-code {
  font-size: 13px;
  color: var(--text-tertiary);
  letter-spacing: 0.5px;
  font-family: monospace;
}

.task-section {
  margin-bottom: 24px;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.section-head h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.section-count {
  font-size: 13px;
  color: var(--text-tertiary);
}

.task-card {
  border-radius: var(--radius-md) !important;
  border: 1px solid var(--border-light) !important;
  cursor: pointer;
  transition: all 0.15s;
}

.task-card:hover {
  border-color: var(--color-primary) !important;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.08);
}

.task-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.task-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-tertiary);
}

.task-owner {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-secondary);
}

.task-status-tag {
  flex-shrink: 0;
}

.quick-card {
  border-radius: var(--radius-md) !important;
  border: 1px solid var(--border-light) !important;
}

.quick-actions {
  display: flex;
  gap: 16px;
}

.quick-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 20px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.15s;
  color: var(--text-primary);
  font-size: 14px;
}

.quick-item:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background: rgba(79,109,245,0.04);
}
</style>
