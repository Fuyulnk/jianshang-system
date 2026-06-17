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

    <SurveyReportGenerator v-if="showEngineeringTools" />

    <el-card v-if="showEngineeringTools" class="sop-card" shadow="never">
      <template #header>
        <span>现场勘察 SOP</span>
      </template>
      <div class="sop-grid">
        <div v-for="item in surveySop" :key="item.title" class="sop-item">
          <strong>{{ item.title }}</strong>
          <span>{{ item.desc }}</span>
        </div>
      </div>
    </el-card>

    <!-- 待办分组 -->
    <div class="task-section" v-for="g in groups" :key="g.key">
      <div class="section-head" :class="{ urgent: isUrgentGroup(g) }">
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
            <div class="task-owner" v-if="p.hint">
              {{ p.hint }}
            </div>
          </el-card>
        </el-col>
      </el-row>
      <el-row :gutter="16" v-else-if="g.items?.length">
        <el-col :xs="24" :sm="12" :md="8" v-for="item in g.items" :key="item.id" style="margin-bottom: 16px;">
          <el-card class="task-card stock-card" shadow="never" @click="goProducts">
            <div class="task-name">{{ item.name }}</div>
            <div class="task-meta">
              <span>{{ item.meta }}</span>
              <el-tag size="small" type="warning" class="task-status-tag">低库存</el-tag>
            </div>
          </el-card>
        </el-col>
      </el-row>
      <el-empty v-else description="暂无" :image-size="50" style="padding: 20px 0;" />
    </div>

    <!-- 快捷入口 -->
    <el-card v-if="!isPendingAssignment" class="quick-card" shadow="never">
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
import { getAuthToken } from '../utils/authSession'
import { computed, ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { List, ChatDotSquare } from '@element-plus/icons-vue'
import UserAvatar from '../components/UserAvatar.vue'
import SurveyReportGenerator from '../components/projects/SurveyReportGenerator.vue'

const router = useRouter()
const user = ref({})
const employeeCode = ref('')
const groups = ref([])
const hasChat = ref(true)
const isPendingAssignment = computed(() => user.value.assignment_status === 'pending' || groups.value.some(group => group.key === 'pending_assignment'))
const showEngineeringTools = computed(() => !isPendingAssignment.value && ['engineering', 'employee', 'admin', 'super_admin'].includes(user.value.role))
const surveySop = [
  { title: '1. 先拍全局', desc: '入户、客餐厅、卧室、阳台、卫生间先拍完整环境，确认作业面和保护。' },
  { title: '2. 再拍问题', desc: '墙面沙眼、点补未打磨、乳胶漆滴流、磕碰污染、柜体门窗和踢脚线未完成要单独拍。' },
  { title: '3. 标注整改', desc: '每张问题图写清区域、问题、责任方和进场前必须处理的条件。' },
  { title: '4. 判断进场', desc: '按可进场、有条件进场、暂不建议进场三档输出，不要只把照片丢给总监判断。' }
]

function token() { return getAuthToken() }

async function fetchDashboard() {
  try {
    const res = await fetch('/api/employee/dashboard', {
      headers: { Authorization: `Bearer ${token()}` }
    })
    const json = await res.json()
    if (json.success) {
      user.value = json.data.user
      groups.value = json.data.groups
      hasChat.value = user.value.assignment_status !== 'pending'

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

function goProducts() {
  router.push('/main/products')
}

function copyCode(code) {
  try {
    navigator.clipboard.writeText(code)
    ElMessage.success('已复制：' + code)
  } catch {}
}

function isUrgentGroup(group) {
  if (!group?.count) return false
  if (user.value.role === 'warehouse') return ['out', 'return', 'stock_alerts'].includes(group.key)
  if (['engineering', 'employee'].includes(user.value.role)) return ['onsite', 'prepare', 'active'].includes(group.key)
  if (['admin', 'super_admin'].includes(user.value.role)) return ['missing', 'overdue', 'stuck'].includes(group.key)
  return false
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
.section-head.urgent .section-count {
  color: #fff;
  background: #f56c6c;
  border-radius: 999px;
  padding: 3px 9px;
  font-weight: 700;
}
.section-head.urgent h3::before {
  content: "";
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 6px;
  border-radius: 50%;
  background: #f56c6c;
  vertical-align: 1px;
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

.sop-card {
  margin-bottom: 24px;
  border-radius: var(--radius-md) !important;
  border: 1px solid var(--border-light) !important;
}

.sop-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.sop-item {
  min-width: 0;
  padding: 14px;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--color-primary) 6%, var(--bg-page));
  border: 1px solid color-mix(in srgb, var(--color-primary) 18%, var(--border-light));
}

.sop-item strong {
  display: block;
  margin-bottom: 6px;
  color: var(--text-primary);
  font-size: 14px;
}

.sop-item span {
  display: block;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.6;
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

@media (max-width: 900px) {
  .sop-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 560px) {
  .sop-grid {
    grid-template-columns: 1fr;
  }
}
</style>
