<template>
  <div class="project-detail" v-loading="loading">
    <template v-if="project">
      <!-- 顶部导航 -->
      <div class="detail-header">
        <el-button @click="$router.push('/main/projects')">← 返回列表</el-button>
        <div class="header-info">
          <h2>{{ project.name }}</h2>
          <span class="header-meta">客户：{{ project.customer }} | 电话：{{ project.phone || '无' }} | 状态：{{ project.status_label }}</span>
          <div class="assignment-line">
            <el-tag size="small" type="info">负责人：{{ displayUser(project.manager_real_name, project.manager_username) }}</el-tag>
            <el-tag size="small" type="success">施工负责人：{{ displayUser(project.assignee_real_name, project.assignee_username) }}</el-tag>
          </div>
        </div>
        <el-button type="primary" @click="showEdit = true" v-if="canEditProject">
          {{ canManageProject ? '编辑项目' : '更新施工记录' }}
        </el-button>
      </div>

      <!-- 阶段进度 -->
      <div class="phase-steps">
        <div v-for="(p, i) in phases" :key="i"
          :class="['phase-step', { active: project.phase >= p.phase, current: project.phase === p.phase }]">
          <div class="step-dot">{{ p.phase }}</div>
          <div class="step-label">{{ p.label }}</div>
        </div>
      </div>

      <!-- 阶段详情 -->
      <div class="phase-panels">
        <!-- 阶段1: 项目前期 -->
        <el-card class="phase-card">
          <template #header>
            <div class="card-header">
              <span><el-icon><Document /></el-icon> 项目前期</span>
              <el-tag size="small" :type="project.phase >= 1 ? 'success' : 'info'">{{ project.phase >= 1 ? '已完成' : '待进行' }}</el-tag>
            </div>
          </template>
          <el-descriptions :column="2" border size="small">
            <el-descriptions-item label="项目来源">{{ project.source || '未填写' }}</el-descriptions-item>
            <el-descriptions-item label="施工地址">{{ project.address || '未填写' }}</el-descriptions-item>
            <el-descriptions-item label="工勘报告">{{ project.survey_report || '未填写' }}</el-descriptions-item>
            <el-descriptions-item label="工勘日期">{{ project.survey_date || '未填写' }}</el-descriptions-item>
          </el-descriptions>
        </el-card>

        <!-- 阶段2: 准备阶段 -->
        <el-card class="phase-card">
          <template #header>
            <div class="card-header">
              <span><el-icon><Tools /></el-icon> 准备阶段</span>
              <el-tag size="small" :type="project.phase >= 2 ? 'success' : 'info'">{{ project.phase >= 2 ? '已完成' : '待进行' }}</el-tag>
            </div>
          </template>
          <el-descriptions :column="2" border size="small">
            <el-descriptions-item label="开工条件备注">{{ project.condition_note || '未填写' }}</el-descriptions-item>
            <el-descriptions-item label="班组长">{{ project.team_leader || '未填写' }}</el-descriptions-item>
            <el-descriptions-item label="开工交底日期">{{ project.briefing_date || '未填写' }}</el-descriptions-item>
          </el-descriptions>
        </el-card>

        <!-- 阶段3: 施工过程 -->
        <el-card class="phase-card">
          <template #header>
            <div class="card-header">
              <span><el-icon><House /></el-icon> 施工过程</span>
              <el-tag size="small" :type="project.phase >= 3 ? 'success' : 'info'">{{ project.phase >= 3 ? '已完成' : '待进行' }}</el-tag>
            </div>
          </template>
          <el-descriptions :column="2" border size="small">
            <el-descriptions-item label="开工日期">{{ project.start_date || '未填写' }}</el-descriptions-item>
            <el-descriptions-item label="预计完工">{{ project.expected_end_date || '未填写' }}</el-descriptions-item>
            <el-descriptions-item label="施工备注" :span="2">{{ project.construction_note || '未填写' }}</el-descriptions-item>
          </el-descriptions>
        </el-card>

        <!-- 阶段4: 完工验收 -->
        <el-card class="phase-card">
          <template #header>
            <div class="card-header">
              <span><el-icon><Select /></el-icon> 完工验收</span>
              <el-tag size="small" :type="project.phase >= 4 ? 'success' : 'info'">{{ project.phase >= 4 ? '已完成' : '待进行' }}</el-tag>
            </div>
          </template>
          <el-descriptions :column="2" border size="small">
            <el-descriptions-item label="完工日期">{{ project.end_date || '未填写' }}</el-descriptions-item>
            <el-descriptions-item label="验收日期">{{ project.acceptance_date || '未填写' }}</el-descriptions-item>
            <el-descriptions-item label="合同金额">{{ project.total_amount?.toFixed(2) }} 元</el-descriptions-item>
            <el-descriptions-item label="定金">{{ project.deposit_amount?.toFixed(2) }} 元</el-descriptions-item>
            <el-descriptions-item label="结算金额">{{ project.settlement_amount?.toFixed(2) }} 元</el-descriptions-item>
          </el-descriptions>
        </el-card>

        <!-- 阶段5: 售后服务 -->
        <el-card class="phase-card">
          <template #header>
            <div class="card-header">
              <span><el-icon><Service /></el-icon> 售后服务</span>
              <el-tag size="small" :type="project.phase >= 5 ? 'warning' : 'info'">{{ project.phase >= 5 ? '进行中' : '待进行' }}</el-tag>
            </div>
          </template>
          <el-empty description="暂无售后记录" v-if="project.phase < 5" style="padding:20px" />
          <div v-else>
            <el-descriptions :column="2" border size="small">
              <el-descriptions-item label="售后状态">{{ project.status_label }}</el-descriptions-item>
            </el-descriptions>
          </div>
        </el-card>

        <!-- 状态推进 -->
        <el-card class="phase-card">
          <template #header>
            <div class="card-header">
              <span><el-icon><Right /></el-icon> 状态推进</span>
              <span class="header-meta">当前：{{ project.status_label }}</span>
            </div>
          </template>
          <div class="status-actions">
            <el-button v-for="s in nextStatuses" :key="s.key"
              :type="s.type" :disabled="s.disabled" @click="advanceStatus(s.key)">
              <el-icon v-if="s.icon && statusIconMap[s.icon]"><component :is="statusIconMap[s.icon]" /></el-icon>
              {{ s.label }}
            </el-button>
          </div>
        </el-card>
      </div>

      <!-- 操作日志 -->
      <el-card class="log-card">
        <template #header><span><el-icon><Edit /></el-icon> 操作日志</span></template>
        <div v-if="project.logs?.length" class="log-list">
          <div v-for="log in project.logs" :key="log.id" class="log-item">
            <el-tag size="small">{{ log.action }}</el-tag>
            <span class="log-operator">{{ log.operator }}</span>
            <span class="log-content">{{ log.content }}</span>
            <span class="log-time">{{ formatTime(log.created_at) }}</span>
          </div>
        </div>
        <el-empty description="暂无日志" v-else style="padding:20px" />
      </el-card>
    </template>

    <!-- 编辑弹窗 -->
    <el-dialog v-model="showEdit" title="编辑项目" width="700px">
      <el-form :model="editForm" label-width="100px">
        <el-tabs>
          <el-tab-pane v-if="canManageProject" label="基本信息">
            <el-row :gutter="16">
              <el-col :span="12">
                <el-form-item label="项目名称"><el-input v-model="editForm.name" /></el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="客户名称"><el-input v-model="editForm.customer" /></el-form-item>
              </el-col>
            </el-row>
            <el-row :gutter="16">
              <el-col :span="12">
                <el-form-item label="联系电话"><el-input v-model="editForm.phone" /></el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="项目来源">
                  <el-select v-model="editForm.source" placeholder="来源" style="width:100%">
                    <el-option label="销售" value="销售" /><el-option label="转介绍" value="转介绍" />
                    <el-option label="门店" value="门店" /><el-option label="其他" value="其他" />
                  </el-select>
                </el-form-item>
              </el-col>
            </el-row>
            <el-form-item label="施工地址"><el-input v-model="editForm.address" /></el-form-item>
            <el-row :gutter="16" v-if="canManageProject">
              <el-col :span="12">
                <el-form-item label="项目负责人">
                  <el-select v-model="editForm.manager_user_id" placeholder="选择负责人" clearable filterable style="width:100%">
                    <el-option v-for="u in assignees" :key="u.id" :label="userOptionLabel(u)" :value="u.id" />
                  </el-select>
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="施工负责人">
                  <el-select v-model="editForm.assignee_user_id" placeholder="选择施工负责人" clearable filterable style="width:100%">
                    <el-option v-for="u in assignees" :key="u.id" :label="userOptionLabel(u)" :value="u.id" />
                  </el-select>
                </el-form-item>
              </el-col>
            </el-row>
          </el-tab-pane>
          <el-tab-pane v-if="canManageProject" label="前期准备">
            <el-form-item label="工勘报告"><el-input v-model="editForm.survey_report" type="textarea" :rows="2" /></el-form-item>
            <el-row :gutter="16">
              <el-col :span="12">
                <el-form-item label="工勘日期"><el-input v-model="editForm.survey_date" placeholder="2026-01-01" /></el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="开工条件备注"><el-input v-model="editForm.condition_note" /></el-form-item>
              </el-col>
            </el-row>
            <el-row :gutter="16">
              <el-col :span="12">
                <el-form-item label="班组长"><el-input v-model="editForm.team_leader" /></el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="交底日期"><el-input v-model="editForm.briefing_date" placeholder="2026-01-01" /></el-form-item>
              </el-col>
            </el-row>
          </el-tab-pane>
          <el-tab-pane label="施工与结算">
            <el-row :gutter="16">
              <el-col :span="12">
                <el-form-item label="开工日期"><el-input v-model="editForm.start_date" placeholder="2026-01-01" /></el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="预计完工"><el-input v-model="editForm.expected_end_date" placeholder="2026-01-01" /></el-form-item>
              </el-col>
            </el-row>
            <el-form-item label="施工备注"><el-input v-model="editForm.construction_note" type="textarea" :rows="2" /></el-form-item>
            <el-row :gutter="16">
              <el-col :span="12">
                <el-form-item label="完工日期"><el-input v-model="editForm.end_date" placeholder="2026-01-01" /></el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="验收日期"><el-input v-model="editForm.acceptance_date" placeholder="2026-01-01" /></el-form-item>
              </el-col>
            </el-row>
            <el-row :gutter="16" v-if="canManageProject">
              <el-col :span="8"><el-form-item label="合同金额"><el-input v-model="editForm.total_amount" type="number"><template #append>元</template></el-input></el-form-item></el-col>
              <el-col :span="8"><el-form-item label="定金"><el-input v-model="editForm.deposit_amount" type="number"><template #append>元</template></el-input></el-form-item></el-col>
              <el-col :span="8"><el-form-item label="结算金额"><el-input v-model="editForm.settlement_amount" type="number"><template #append>元</template></el-input></el-form-item></el-col>
            </el-row>
          </el-tab-pane>
        </el-tabs>
      </el-form>
      <template #footer>
        <el-button @click="showEdit = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Check, Document, Tools, House, Select, Edit, Service, Right } from '@element-plus/icons-vue'

const route = useRoute()
const project = ref(null)
const loading = ref(true)
const showEdit = ref(false)
const saving = ref(false)
const editForm = ref({})
const assignees = ref([])

const phases = [
  { phase: 1, label: '项目前期' },
  { phase: 2, label: '准备阶段' },
  { phase: 3, label: '施工过程' },
  { phase: 4, label: '完工验收' },
  { phase: 5, label: '售后服务' },
]

// 当前用户角色
const userRole = (() => {
  try {
    const t = localStorage.getItem('token')
    return JSON.parse(atob(t.split('.')[1])).role || ''
  } catch { return '' }
})()
const userId = (() => {
  try {
    const t = localStorage.getItem('token')
    return JSON.parse(atob(t.split('.')[1])).userId || 0
  } catch { return 0 }
})()
const canManageProject = computed(() => ['super_admin', 'admin'].includes(userRole))
const isAssignedEmployee = computed(() => project.value?.assignee_user_id === userId)
const canEditProject = computed(() => canManageProject.value || (userRole === 'employee' && isAssignedEmployee.value))

const STATUS_TRANSITIONS = {
  info_confirmed:  { next: 'survey_done', label: '工勘完成', type: 'primary', icon: 'Check', roles: ['super_admin','admin'] },
  survey_done:     { next: 'condition_met', label: '确认开工条件', type: 'primary', icon: 'Check', roles: ['super_admin','admin','finance'] },
  condition_met:   { next: 'team_assigned', label: '安排施工班组', type: 'primary', icon: 'Check', roles: ['super_admin','admin'] },
  team_assigned:   { next: 'briefing_done', label: '开工交底完成', type: 'primary', icon: 'Check', roles: ['super_admin','admin'] },
  briefing_done:   { next: 'material_out', label: '材料出库', type: 'primary', icon: 'Check', roles: ['super_admin','admin','warehouse'] },
  material_out:    { next: 'in_progress', label: '开始施工', type: 'primary', icon: 'Check', roles: ['super_admin','admin'] },
  in_progress:     { next: 'inspection_done', label: '过程检查完成', type: 'primary', icon: 'Check', roles: ['super_admin','admin'] },
  inspection_done: { next: 'completed', label: '申请完工验收', type: 'primary', icon: 'Check', roles: ['super_admin','admin'] },
  completed:       { next: 'material_returned', label: '材料回库', type: 'primary', icon: 'Check', roles: ['super_admin','admin','warehouse'] },
  material_returned: { next: 'settled', label: '结算完成', type: 'success', icon: 'Check', roles: ['super_admin','admin','finance'] },
  settled:         { next: null, label: '已完结', type: 'success', icon: 'Check' },
}

// 售后流程（从结算后可进入售后）
const AFTER_SALES = {
  repair_requested: { next: 'repair_assigned', label: '安排维修', type: 'warning', icon: 'Tools', roles: ['super_admin','admin'] },
  repair_assigned:  { next: 'repair_done', label: '维修完成', type: 'success', icon: 'Check', roles: ['super_admin','admin'] },
  repair_done:      { next: null, label: '已完结', type: 'success', icon: 'Check' },
}

const statusIconMap = { Check, Tools }

const nextStatuses = computed(() => {
  if (!project.value) return []
  const s = project.value.status

  function canAct(roles) {
    if (!roles || userRole === 'super_admin') return true
    if (!roles.includes(userRole)) return false
    return userRole !== 'employee' || isAssignedEmployee.value
  }

  // 售后状态走售后流程
  if (s.startsWith('repair_')) {
    const t = AFTER_SALES[s]
    return t && canAct(t.roles)
      ? [{ key: t.next, label: t.label, type: t.type, icon: t.icon, disabled: !t.next }]
      : []
  }
  // 正常流转
  if (STATUS_TRANSITIONS[s]) {
    const t = STATUS_TRANSITIONS[s]
    const actions = t.next && canAct(t.roles)
      ? [{ key: t.next, label: t.label, type: t.type, icon: t.icon, disabled: false }]
      : []
    // 结算后管理员可进入售后
    if (s === 'settled' && canAct(['admin'])) {
      actions.push({ key: 'repair_requested', label: '收到售后报修', type: 'warning', icon: 'Tools', disabled: false })
    }
    return actions
  }
  return []
})

function token() { return localStorage.getItem('token') }
function formatTime(t) { return t ? new Date(t).toLocaleString('zh-CN') : '' }
function displayUser(realName, username) { return realName || username || '未分配' }
function userOptionLabel(user) {
  const name = user.real_name || user.username
  const role = user.role_label || user.role
  return `${name}${role ? `（${role}）` : ''}`
}

async function fetchDetail() {
  loading.value = true
  try {
    const res = await fetch(`/api/projects/${route.params.id}`, {
      headers: { Authorization: `Bearer ${token()}` }
    })
    const json = await res.json()
    if (json.success) {
      project.value = json.data
      editForm.value = { ...json.data }
    }
  } finally { loading.value = false }
}

async function fetchAssignees() {
  try {
    const res = await fetch('/api/projects/assignees', {
      headers: { Authorization: `Bearer ${token()}` }
    })
    const json = await res.json()
    if (json.success) assignees.value = json.data
  } catch {}
}

async function advanceStatus(statusKey) {
  const res = await fetch(`/api/projects/${route.params.id}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
    body: JSON.stringify({ status: statusKey })
  })
  const json = await res.json()
  if (json.success) {
    ElMessage.success('状态已更新')
    fetchDetail()
  } else {
    ElMessage.warning(json.message || '状态更新失败')
  }
}

async function handleSave() {
  saving.value = true
  try {
    const body = {}
    const fields = ['name', 'customer', 'phone', 'address', 'source', 'survey_report', 'survey_date',
      'team_leader', 'briefing_date', 'condition_note', 'start_date', 'expected_end_date', 'construction_note',
      'end_date', 'acceptance_date', 'total_amount', 'deposit_amount', 'settlement_amount',
      'manager_user_id', 'assignee_user_id']
    for (const f of fields) {
      if (editForm.value[f] !== undefined) {
        body[f] = typeof editForm.value[f] === 'string' ? editForm.value[f].trim() : editForm.value[f]
      }
    }
    body.total_amount = parseFloat(body.total_amount) || 0
    body.deposit_amount = parseFloat(body.deposit_amount) || 0
    body.settlement_amount = parseFloat(body.settlement_amount) || 0
    body.manager_user_id = body.manager_user_id || 0
    body.assignee_user_id = body.assignee_user_id || 0

    const res = await fetch(`/api/projects/${route.params.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify(body)
    })
    const json = await res.json()
    if (json.success) {
      ElMessage.success('保存成功')
      showEdit.value = false
      fetchDetail()
    }
  } finally { saving.value = false }
}

onMounted(() => {
  fetchDetail()
  fetchAssignees()
})
</script>

<style scoped>
.project-detail { padding: 0; }
.detail-header {
  display: flex; align-items: center; gap: 16px; margin-bottom: 20px;
  background: var(--bg-card); padding: 16px 20px; border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
}
.header-info { flex: 1; }
.header-info h2 { margin: 0; font-size: 18px; color: var(--text-primary); }
.header-meta { font-size: 13px; color: var(--text-tertiary); }
.assignment-line { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.phase-steps {
  display: flex; gap: 0; margin-bottom: 20px;
  background: var(--bg-card); border-radius: var(--radius-lg);
  padding: 20px 24px; box-shadow: var(--shadow-sm);
}
.phase-step {
  flex: 1; text-align: center; position: relative;
}
.phase-step:not(:last-child)::after {
  content: ''; position: absolute; top: 16px; left: 60%; right: -40%;
  height: 2px; background: var(--border-light);
}
.phase-step.active:not(:last-child)::after { background: var(--color-primary); }
.step-dot {
  width: 32px; height: 32px; line-height: 32px; border-radius: 50%;
  background: #f0f0f0; color: var(--text-tertiary); font-weight: bold; margin: 0 auto 8px;
  font-size: 13px;
}
.phase-step.active .step-dot { background: var(--color-primary); color: #fff; }
.phase-step.current .step-dot { box-shadow: 0 0 0 4px rgba(79,109,245,0.25); }
.step-label { font-size: 13px; color: var(--text-tertiary); }
.phase-step.active .step-label { color: var(--color-primary); font-weight: 500; }
.phase-panels { display: flex; flex-direction: column; gap: 16px; margin-bottom: 20px; }
.card-header { display: flex; justify-content: space-between; align-items: center; }
.status-actions { display: flex; gap: 12px; flex-wrap: wrap; }
.log-item { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border-light); font-size: 13px; }
.log-item:last-child { border-bottom: none; }
.log-operator { color: var(--color-primary); font-weight: 500; }
.log-content { color: var(--text-primary); flex: 1; }
.log-time { color: var(--text-placeholder); font-size: 12px; }
</style>
