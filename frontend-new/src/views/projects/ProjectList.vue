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
      <div class="toolbar">
        <el-input v-model="keyword" placeholder="搜索项目名称/客户/电话" clearable style="width:260px" @input="fetchList" />
        <el-select v-model="phaseFilter" placeholder="按阶段筛选" clearable style="width:140px" @change="fetchList">
          <el-option v-for="p in phaseOptions" :key="p.value" :label="p.label" :value="p.value" />
        </el-select>
        <el-button v-if="canCreateProjects" type="primary" @click="openCreateForm">新建项目</el-button>
      </div>

      <el-table :data="list" v-loading="loading" stripe style="width:100%" @row-dblclick="goDetail">
      <el-table-column prop="name" label="项目名称" min-width="160">
        <template #default="{ row }">
          <el-link class="project-name-link" type="primary" @click="goDetail(row)">{{ row.name }}</el-link>
        </template>
      </el-table-column>
      <el-table-column prop="customer" label="客户" width="120" />
      <el-table-column label="负责人" width="120">
        <template #default="{ row }">{{ displayUser(row.manager_real_name, row.manager_username) }}</template>
      </el-table-column>
      <el-table-column label="施工负责人" width="130">
        <template #default="{ row }">{{ displayUser(row.assignee_real_name, row.assignee_username) }}</template>
      </el-table-column>
      <el-table-column prop="phone" label="电话" width="130" show-overflow-tooltip />
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
    <el-dialog v-model="showForm" :title="formMode === 'create' ? '新建项目' : '编辑项目'" width="600px">
      <el-form ref="formRef" :model="form" label-width="100px">
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="项目名称" required>
              <el-input v-model="form.name" placeholder="如：某某小区涂装工程" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="客户名称" required>
              <el-input v-model="form.customer" placeholder="客户/业主" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="联系电话">
              <el-input v-model="form.phone" placeholder="客户电话" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="项目来源">
              <el-select v-model="form.source" placeholder="来源" style="width:100%">
                <el-option label="销售" value="销售" />
                <el-option label="转介绍" value="转介绍" />
                <el-option label="门店" value="门店" />
                <el-option label="其他" value="其他" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
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
  </div>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
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
  { value: '1', label: '项目前期' },
  { value: '2', label: '准备阶段' },
  { value: '3', label: '施工过程' },
  { value: '4', label: '完工验收' },
  { value: '5', label: '项目完结' },
  { value: '6', label: '售后服务' },
]

const stats = ref([])

function token() { return localStorage.getItem('token') }
function formatTime(t) { return t ? new Date(t).toLocaleString('zh-CN') : '' }

function phaseTagType(phase) {
  return ['', 'info', 'warning', 'primary', 'success', 'danger'][phase] || 'info'
}

function displayUser(realName, username) {
  return realName || username || '未分配'
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
    { key: 'all', label: '全部项目', count: counts.all, active: !phaseFilter.value },
    { key: '1', label: '项目前期', count: counts['1'], active: phaseFilter.value === '1' },
    { key: '2', label: '准备阶段', count: counts['2'], active: phaseFilter.value === '2' },
    { key: '3', label: '施工过程', count: counts['3'], active: phaseFilter.value === '3' },
    { key: '4', label: '完工验收', count: counts['4'], active: phaseFilter.value === '4' },
    { key: '5', label: '项目完结', count: counts['5'], active: phaseFilter.value === '5' },
    { key: '6', label: '售后服务', count: counts['6'], active: phaseFilter.value === '6' },
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
    ElMessage.warning('请填写项目名称和客户名称')
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
@media (max-width: 720px) {
  .address-fields {
    grid-template-columns: 1fr;
  }
}
</style>
