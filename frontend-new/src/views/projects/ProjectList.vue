<template>
  <div class="project-page">
    <!-- 统计卡片 -->
    <div class="stat-cards">
      <div v-for="s in stats" :key="s.key" :class="['stat-card clickable', s.active ? 'active' : '']" @click="filterPhase(s.key)">
        <div class="stat-info" style="text-align:center">
          <div class="stat-num">{{ s.count }}</div>
          <div class="stat-label">{{ s.label }}</div>
        </div>
      </div>
    </div>

    <el-card class="page-card" shadow="never">
      <div class="page-header workorder-header">
        <div>
          <el-button class="back-branch" text @click="router.push('/main/projects')">← 项目工单分支</el-button>
          <h2>施工项目工单</h2>
          <p class="page-desc">门店/渠道签单后，由简尚承接施工交付；重点看资料是否齐、下一步卡在哪里。</p>
        </div>
        <div class="header-actions">
          <el-button v-if="canCreateProjects" @click="showImport = true">导入交底单</el-button>
          <el-button v-if="canCreateProjects" type="primary" @click="openCreateForm">新建工单</el-button>
        </div>
      </div>

      <div class="workorder-board">
        <div v-for="item in boardStats" :key="item.key" class="board-card" :class="item.tone">
          <div class="board-label">{{ item.label }}</div>
          <div class="board-value">{{ item.count }}</div>
          <div class="board-desc">{{ item.desc }}</div>
        </div>
      </div>

      <div class="toolbar">
        <el-input v-model="keyword" placeholder="搜索工单/业主/联系方式/门店/单号" clearable style="width:300px" @input="fetchList" />
        <el-select v-model="phaseFilter" placeholder="按阶段筛选" clearable style="width:140px" @change="fetchList">
          <el-option v-for="p in phaseOptions" :key="p.value" :label="p.label" :value="p.value" />
        </el-select>
      </div>

      <el-table :data="list" v-loading="loading" stripe style="width:100%" @row-dblclick="goDetail">
      <el-table-column prop="name" label="工单名称" min-width="160">
        <template #default="{ row }">
          <el-link class="project-name-link" type="primary" @click="goDetail(row)">{{ row.name }}</el-link>
        </template>
      </el-table-column>
      <el-table-column prop="customer" label="业主/客户" width="120" />
      <el-table-column label="门店交接" min-width="190" show-overflow-tooltip>
        <template #default="{ row }">
          <div class="handover-cell">
            <strong>{{ row.source || '未填来源' }}</strong>
            <span>{{ row.order_taker || '未填接单人' }} · {{ row.external_order_no || '未填单号' }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="资料" width="120">
        <template #default="{ row }">
          <el-tag v-if="isClosedProject(row)" type="success" size="small">已归档</el-tag>
          <el-tag v-else-if="requiredMissingFields(row).length" type="danger" size="small">缺核心 {{ requiredMissingFields(row).length }}</el-tag>
          <el-tag v-else-if="suggestedMissingFields(row).length" type="warning" size="small">待完善</el-tag>
          <el-tag v-else type="success" size="small">资料齐</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="施工地址" min-width="170" show-overflow-tooltip>
        <template #default="{ row }">{{ addressText(row) }}</template>
      </el-table-column>
      <el-table-column label="负责人" width="120">
        <template #default="{ row }">{{ displayUser(row.manager_real_name, row.manager_username) }}</template>
      </el-table-column>
      <el-table-column label="施工负责人" width="130">
        <template #default="{ row }">{{ displayUser(row.assignee_real_name, row.assignee_username) }}</template>
      </el-table-column>
      <el-table-column prop="phone" label="联系方式" width="130" show-overflow-tooltip />
      <el-table-column label="阶段" width="140">
        <template #default="{ row }">
          <el-tag :type="phaseTagType(row.phase)" size="small">
            {{ row.phase_label }}-{{ row.status_label }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="进度" width="180">
        <template #default="{ row }">
          <el-progress :percentage="Math.min((row.phase / 6) * 100, 100)" :stroke-width="8" style="max-width:150px" />
        </template>
      </el-table-column>
      <el-table-column prop="total_amount" label="金额(元)" width="120" align="right">
        <template #default="{ row }">{{ row.total_amount?.toFixed(2) || '0.00' }}</template>
      </el-table-column>
      <el-table-column prop="created_at" label="创建时间" width="160">
        <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="{ row }">
          <el-button size="small" @click="goDetail(row)">详情</el-button>
          <el-button v-if="canDeleteProjects" size="small" type="danger" plain @click="handleDelete(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    </el-card>

    <!-- 新建/编辑弹窗 -->
    <el-dialog v-model="showForm" :title="formMode === 'create' ? '新建项目工单' : '编辑项目工单'" width="720px">
      <el-form ref="formRef" :model="form" label-width="100px">
        <div class="form-section-title">门店交接</div>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="工单名称" required>
              <el-input v-model="form.name" placeholder="如：金地环湾城 T8-1102 涂装施工" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="业主/客户" required>
              <el-input v-model="form.customer" placeholder="业主/施工对象" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="联系方式">
              <el-input v-model="form.phone" placeholder="手机号、微信联系、现场联系等" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="来源门店/渠道">
              <el-select v-model="form.source" filterable allow-create default-first-option placeholder="选择或输入来源" style="width:100%">
                <el-option label="门店" value="门店" />
                <el-option label="微信交接" value="微信交接" />
                <el-option label="电话交接" value="电话交接" />
                <el-option label="直接客户" value="直接客户" />
                <el-option label="其他渠道" value="其他渠道" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="8">
            <el-form-item label="门店接单人">
              <el-input v-model="form.order_taker" placeholder="门店/渠道对接人" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="接单日期">
              <el-input v-model="form.order_date" placeholder="2026-01-01" />
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="门店单号">
              <el-input v-model="form.external_order_no" placeholder="合同号/门店单号" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="交接备注">
          <el-input v-model="form.handover_note" type="textarea" :rows="2" placeholder="门店交接的特殊要求、承诺事项、注意点" />
        </el-form-item>
        <div class="form-section-title">施工承接</div>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="项目负责人">
              <el-select v-model="form.manager_user_id" placeholder="选择负责人" clearable filterable style="width:100%">
                <el-option v-for="u in assignees" :key="u.id" :label="userOptionLabel(u)" :value="u.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="施工负责人">
              <el-select v-model="form.assignee_user_id" placeholder="选择施工负责人" clearable filterable style="width:100%">
                <el-option v-for="u in assignees" :key="u.id" :label="userOptionLabel(u)" :value="u.id" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="施工地址">
          <div class="address-fields">
            <el-cascader
              v-model="form.addressRegion"
              :options="chinaRegionOptions"
              :props="addressCascaderProps"
              clearable
              filterable
              placeholder="省 / 市"
            />
            <el-input v-model="form.address_detail" placeholder="小区、楼栋、门牌号等详细地址" />
          </div>
        </el-form-item>
        <div class="form-section-title">金额信息</div>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="合同金额">
              <el-input v-model="form.total_amount" placeholder="0" type="number">
                <template #append>元</template>
              </el-input>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="定金">
              <el-input v-model="form.deposit_amount" placeholder="0" type="number">
                <template #append>元</template>
              </el-input>
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="showForm = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>

    <ProjectImportDialog v-model="showImport" @created="fetchList" />
  </div>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import ProjectImportDialog from '../../components/projects/ProjectImportDialog.vue'
import {
  addressCascaderProps,
  buildAddressPayload,
  chinaRegionOptions,
  defaultAddressRegion
} from '../../utils/chinaRegions'

const router = useRouter()
const list = ref([])
const loading = ref(true)
const keyword = ref('')
const phaseFilter = ref('')
const assignees = ref([])

const showForm = ref(false)
const showImport = ref(false)
const formMode = ref('create')
const saving = ref(false)
const formRef = ref(null)
const form = ref(emptyForm())

function emptyForm() {
  return {
    name: '',
    customer: '',
    phone: '',
    address: '',
    addressRegion: [...defaultAddressRegion],
    address_detail: '',
    source: '',
    order_taker: '',
    order_date: '',
    external_order_no: '',
    handover_note: '',
    manager_user_id: null,
    assignee_user_id: null,
    total_amount: '',
    deposit_amount: ''
  }
}

const userRole = computed(() => {
  try {
    const t = localStorage.getItem('token')
    return JSON.parse(atob(t.split('.')[1])).role || ''
  } catch { return '' }
})
const canCreateProjects = computed(() => ['super_admin', 'admin'].includes(userRole.value))
const canDeleteProjects = computed(() => ['super_admin', 'admin'].includes(userRole.value))

const phaseOptions = [
  { value: '1', label: '交接勘察' },
  { value: '2', label: '复尺出库' },
  { value: '3', label: '施工验收' },
  { value: '4', label: '回库核算' },
  { value: '5', label: '财务归档' },
  { value: '6', label: '售后处理' },
]

const stats = ref([])

const boardStats = computed(() => [
  {
    key: 'missing',
    label: '核心资料待补',
    count: list.value.filter(row => requiredMissingFields(row).length).length,
    desc: '来源、接单人、联系方式、地址',
    tone: 'warning'
  },
  {
    key: 'survey',
    label: '待勘察/复尺',
    count: list.value.filter(row => ['handover_received', 'survey_pending', 'survey_done'].includes(row.status)).length,
    desc: '交接核对到现场复核',
    tone: 'info'
  },
  {
    key: 'prepare',
    label: '待交底/出库',
    count: list.value.filter(row => ['recheck_done', 'briefing_done', 'material_requested'].includes(row.status)).length,
    desc: '交底完成后才能申请出库',
    tone: 'primary'
  },
  {
    key: 'active',
    label: '施工/回库',
    count: list.value.filter(row => ['material_out', 'in_progress', 'inspection_done'].includes(row.status)).length,
    desc: '进场施工、验收、回库前',
    tone: 'success'
  }
])

function token() { return localStorage.getItem('token') }
function formatTime(t) { return t ? new Date(t).toLocaleString('zh-CN') : '' }

function phaseTagType(phase) {
  return ['', 'info', 'warning', 'primary', 'success', 'danger'][phase] || 'info'
}

function displayUser(realName, username) {
  return realName || username || '未分配'
}

function addressText(row) {
  return row.address || [row.address_province, row.address_city, row.address_detail].filter(Boolean).join(' ') || '未填写'
}

function requiredMissingFields(row) {
  const checks = [
    ['source', '来源'],
    ['order_taker', '接单人'],
    ['phone', '联系方式'],
    ['address_detail', '详细地址']
  ]
  return checks.filter(([field]) => !String(row[field] || '').trim()).map(([, label]) => label)
}

function suggestedMissingFields(row) {
  if (isClosedProject(row)) return []
  const checks = [
    ['order_date', '接单日期'],
    ['external_order_no', '门店单号'],
    ['handover_note', '交接备注']
  ]
  return checks.filter(([field]) => !String(row[field] || '').trim()).map(([, label]) => label)
}

function isClosedProject(row) {
  return ['finance_settled', 'archived', 'repair_done'].includes(row.status)
}

function userOptionLabel(user) {
  const name = user.real_name || user.username
  const role = user.role_label || user.role
  return `${name}${role ? `（${role}）` : ''}`
}

async function fetchList() {
  loading.value = true
  try {
    const params = new URLSearchParams()
    if (keyword.value) params.set('keyword', keyword.value)
    if (phaseFilter.value) params.set('phase', phaseFilter.value)
    const res = await fetch(`/api/projects?${params}`, { headers: { Authorization: `Bearer ${token()}` } })
    const json = await res.json()
    if (json.success) {
      list.value = json.data
      computeStats(json.data)
    }
  } finally { loading.value = false }
}

async function fetchAssignees() {
  try {
    const res = await fetch('/api/projects/assignees', { headers: { Authorization: `Bearer ${token()}` } })
    const json = await res.json()
    if (json.success) assignees.value = json.data
  } catch {}
}

function computeStats(data) {
  const counts = { all: data.length, '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0 }
  for (const p of data) {
    if (p.phase && counts[p.phase] !== undefined) counts[p.phase]++
  }
  stats.value = [
    { key: 'all', label: '全部工单', count: counts.all, active: !phaseFilter.value },
    { key: '1', label: '交接勘察', count: counts['1'], active: phaseFilter.value === '1' },
    { key: '2', label: '复尺出库', count: counts['2'], active: phaseFilter.value === '2' },
    { key: '3', label: '施工验收', count: counts['3'], active: phaseFilter.value === '3' },
    { key: '4', label: '回库核算', count: counts['4'], active: phaseFilter.value === '4' },
    { key: '5', label: '财务归档', count: counts['5'], active: phaseFilter.value === '5' },
    { key: '6', label: '售后处理', count: counts['6'], active: phaseFilter.value === '6' },
  ]
}

function filterPhase(key) {
  phaseFilter.value = key === 'all' ? '' : key
  fetchList()
}

function goDetail(row) {
  router.push(`/main/projects/${row.id}`)
}

function openCreateForm() {
  formMode.value = 'create'
  form.value = emptyForm()
  showForm.value = true
}

async function handleSave() {
  if (!form.value.name || !form.value.customer) {
    ElMessage.warning('请填写工单名称和业主/客户')
    return
  }
  saving.value = true
  try {
    const body = { ...form.value, ...buildAddressPayload(form.value) }
    delete body.addressRegion
    body.total_amount = parseFloat(body.total_amount) || 0
    body.deposit_amount = parseFloat(body.deposit_amount) || 0
    body.manager_user_id = body.manager_user_id || 0
    body.assignee_user_id = body.assignee_user_id || 0
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify(body)
    })
    const json = await readJson(res)
    if (!res.ok || !json.success) {
      throw new Error(json.message || '创建失败，请检查权限或服务器日志')
    }
    if (json.success) {
      ElMessage.success('创建成功')
      showForm.value = false
      form.value = emptyForm()
      fetchList()
    }
  } catch (err) {
    ElMessage.error(err.message || '创建失败，请稍后重试')
  } finally { saving.value = false }
}

async function readJson(res) {
  const text = await res.text()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return { success: false, message: text.slice(0, 120) || '服务器返回异常' }
  }
}

async function handleDelete(row) {
  try {
    await ElMessageBox.confirm(`确定删除项目「${row.name}」？`, '确认')
    const res = await fetch(`/api/projects/${row.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token()}` } })
    const json = await res.json()
    if (json.success) {
      ElMessage.success('已删除')
      fetchList()
    }
  } catch (err) {
    ElMessage.error('删除失败：' + (err.message || '未知错误'))
  }
}

onMounted(() => {
  fetchList()
  fetchAssignees()
})
</script>

<style scoped>
.project-page { padding: 0; }
.back-branch {
  margin: 0 0 4px -8px;
}
.workorder-header {
  align-items: flex-start;
  margin-bottom: 14px;
}
.header-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.workorder-board {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
.board-card {
  min-height: 92px;
  padding: 14px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--bg-card) 88%, var(--bg-page));
}
.board-card.warning {
  border-color: color-mix(in srgb, #f59e0b 35%, var(--border-light));
}
.board-card.primary {
  border-color: color-mix(in srgb, var(--color-primary) 35%, var(--border-light));
}
.board-card.success {
  border-color: color-mix(in srgb, #22c55e 35%, var(--border-light));
}
.board-label,
.board-desc {
  color: var(--text-secondary);
  font-size: 12px;
}
.board-value {
  margin: 6px 0 4px;
  font-size: 26px;
  font-weight: 800;
}
.handover-cell {
  display: grid;
  gap: 3px;
  min-width: 0;
}
.handover-cell strong,
.handover-cell span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.handover-cell span {
  color: var(--text-secondary);
  font-size: 12px;
}
.project-name-link {
  display: inline-flex;
  max-width: 150px;
  line-height: 1.35;
}
.project-page :deep(.el-table .cell) {
  word-break: keep-all;
}
.address-fields {
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr);
  gap: 10px;
  width: 100%;
}
.address-fields :deep(.el-cascader) {
  width: 100%;
}
.form-section-title {
  margin: 4px 0 14px;
  padding-left: 10px;
  border-left: 3px solid var(--color-primary);
  color: var(--text-primary);
  font-weight: 700;
}
.form-section-title:not(:first-child) {
  margin-top: 18px;
}
@media (max-width: 720px) {
  .workorder-board {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .address-fields {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 520px) {
  .workorder-board {
    grid-template-columns: 1fr;
  }
}
</style>
