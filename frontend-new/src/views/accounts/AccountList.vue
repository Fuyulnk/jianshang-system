<template>
  <div class="accounts-page">
    <el-card class="page-card">
      <div class="page-header">
        <div>
          <h2>账户管理</h2>
          <p class="page-desc">管理所有个人和公司账户，按月份查看收入、支出和跨月余额变化</p>
        </div>
        <div class="header-actions">
          <input ref="importInput" class="hidden-input" type="file" accept=".xls,.xlsx,.csv" @change="onImportSummaryFile" />
          <el-button :loading="importing" @click="openImportSummary">导入账户余额</el-button>
          <el-button type="primary" @click="showAdd = true">+ 新增账户</el-button>
        </div>
      </div>

      <div class="summary-toolbar">
        <el-radio-group v-model="summaryMode" size="small">
          <el-radio-button label="month">月份视图</el-radio-button>
          <el-radio-button label="all">总览</el-radio-button>
        </el-radio-group>
        <el-date-picker
          v-model="selectedMonth"
          type="month"
          size="small"
          format="YYYY年MM月"
          value-format="YYYY-MM"
          :clearable="false"
          :disabled="summaryMode === 'all'"
          placeholder="选择月份"
        />
        <el-button size="small" plain :disabled="summaryMode === 'month' && selectedMonth === currentMonth" @click="backToCurrentMonth">
          回到本月
        </el-button>
        <span class="summary-hint">
          {{ summaryMode === 'all' ? '显示全部流水累计' : `显示 ${formatMonthLabel(selectedMonth)} 的月度账户快照和流水` }}
        </span>
      </div>

      <!-- 骨架屏 -->
      <el-skeleton v-if="loading" :rows="6" animated class="table-skeleton" />

      <!-- 表格 -->
      <el-table v-show="!loading" :data="displayList" stripe style="width: 100%" v-loading="summaryLoading">
        <el-table-column prop="id" label="ID" width="82" align="center" header-align="center" />
        <el-table-column prop="name" label="账户名称" min-width="160" />
        <el-table-column prop="type" label="类型" width="100">
          <template #default="{ row }">
            <el-tag :type="row.type === 'company' ? 'primary' : 'success'" size="small">
              {{ row.type === 'company' ? '公司' : '个人' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="summaryMode === 'all' ? '初始余额' : '月初余额'" width="120" align="right">
          <template #default="{ row }">{{ formatMoney(summaryMode === 'all' ? row.initial_balance : row.opening_balance) }}</template>
        </el-table-column>
        <el-table-column v-if="summaryMode === 'all'" prop="current_balance" label="当前余额" width="120" align="right">
          <template #default="{ row }">{{ formatMoney(row.current_balance) }}</template>
        </el-table-column>
        <el-table-column :label="summaryMode === 'all' ? '累计收入' : '本月收入'" width="120" align="right">
          <template #default="{ row }">
            <span class="income">{{ formatMoney(row.income_total) }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="summaryMode === 'all' ? '累计支出' : '本月支出'" width="120" align="right">
          <template #default="{ row }">
            <span class="expense">{{ formatMoney(row.expense_total) }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="summaryMode === 'all' ? '累计净变化' : '本月净变化'" width="130" align="right">
          <template #default="{ row }">
            <span :class="row.net_change >= 0 ? 'income' : 'expense'">{{ formatMoney(row.net_change) }}</span>
          </template>
        </el-table-column>
        <el-table-column :label="summaryMode === 'all' ? '当前余额' : '月末余额'" width="140" align="right">
          <template #default="{ row }">{{ formatMoney(row.period_balance) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="150">
          <template #default="{ row }">
            <el-button type="primary" link size="small" @click="openEdit(row)">编辑</el-button>
            <el-button type="danger" link size="small" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 新增弹窗 -->
    <el-dialog v-model="showAdd" title="新增账户" width="400px">
      <el-form :model="addForm" label-width="80px">
        <el-form-item label="账户名称">
          <el-input v-model="addForm.name" placeholder="请输入" />
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="addForm.type" style="width: 100%">
            <el-option label="个人" value="personal" />
            <el-option label="公司" value="company" />
          </el-select>
        </el-form-item>
        <el-form-item label="初始余额">
          <el-input-number v-model="addForm.initial_balance" :precision="2" :step="100" :controls="false" style="width: 100%" />
        </el-form-item>
        <el-form-item label="当前余额">
          <el-input-number v-model="addForm.current_balance" :precision="2" :step="100" :controls="false" style="width: 100%" />
        </el-form-item>
        <p class="form-tip">首月建账时可以先填真实账面余额；后续交易流水会在当前余额基础上自动增减。</p>
      </el-form>
      <template #footer>
        <el-button @click="showAdd = false">取消</el-button>
        <el-button type="primary" @click="handleAdd" :loading="saving">确定</el-button>
      </template>
    </el-dialog>

    <!-- 编辑弹窗 -->
    <el-dialog v-model="showEdit" title="编辑账户" width="440px">
      <el-form :model="editForm" label-width="90px">
        <el-form-item label="账户名称">
          <el-input v-model="editForm.name" placeholder="请输入" />
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="editForm.type" style="width: 100%">
            <el-option label="个人" value="personal" />
            <el-option label="公司" value="company" />
          </el-select>
        </el-form-item>
        <el-form-item label="初始余额">
          <el-input-number v-model="editForm.initial_balance" :precision="2" :step="100" :controls="false" style="width: 100%" />
        </el-form-item>
        <el-form-item label="当前余额">
          <el-input-number v-model="editForm.current_balance" :precision="2" :step="100" :controls="false" style="width: 100%" />
        </el-form-item>
        <p class="form-tip">初始余额用于月度估算；当前余额是账户现在的账面余额，保存后会作为后续流水增减的基础。</p>
      </el-form>
      <template #footer>
        <el-button @click="showEdit = false">取消</el-button>
        <el-button type="primary" @click="handleEdit" :loading="saving">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { getAuthToken, safeLocalStorageGet, safeLocalStorageSet } from '../../utils/authSession'
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

const STORAGE_MODE_KEY = 'account-summary-mode'
const STORAGE_MONTH_KEY = 'account-summary-month'

const list = ref([])
const summaryMap = ref({})
const loading = ref(false)
const summaryLoading = ref(false)
const showAdd = ref(false)
const showEdit = ref(false)
const saving = ref(false)
const importing = ref(false)
const importInput = ref(null)
const addForm = ref({ name: '', type: 'personal', initial_balance: 0, current_balance: 0 })
const editForm = ref({ id: null, name: '', type: 'personal', initial_balance: 0, current_balance: 0 })
const currentMonth = getCurrentMonth()
const summaryMode = ref(safeLocalStorageGet(STORAGE_MODE_KEY, 'month') || 'month')
const selectedMonth = ref(safeLocalStorageGet(STORAGE_MONTH_KEY, currentMonth) || currentMonth)

const displayList = computed(() => list.value.map(account => ({
  ...account,
  ...(summaryMap.value[account.id] || {
    income_total: 0,
    expense_total: 0,
    net_change: 0,
    opening_balance: Number(account.initial_balance || 0),
    period_balance: Number(account.current_balance || 0)
  })
})))

function token() { return getAuthToken() }

async function fetchList() {
  loading.value = true
  try {
    const res = await fetch('/api/accounts', {
      headers: { Authorization: `Bearer ${token()}` }
    })
    const json = await res.json()
    if (json.success) list.value = json.data
    await fetchSummary()
  } finally {
    loading.value = false
  }
}

async function fetchSummary() {
  summaryLoading.value = true
  try {
    const params = new URLSearchParams()
    params.set('mode', summaryMode.value)
    if (summaryMode.value === 'month') params.set('month', selectedMonth.value)
    const res = await fetch(`/api/accounts/summary?${params}`, {
      headers: { Authorization: `Bearer ${token()}` }
    })
    const json = await res.json()
    if (json.success) {
      summaryMap.value = Object.fromEntries((json.data || []).map(item => [item.account_id, item]))
    }
  } finally {
    summaryLoading.value = false
  }
}

async function handleAdd() {
  if (!addForm.value.name) {
    ElMessage.warning('请输入账户名称')
    return
  }
  saving.value = true
  try {
    const res = await fetch('/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify(addForm.value)
    })
    const json = await res.json()
    if (json.success) {
      ElMessage.success('新增成功')
      showAdd.value = false
      addForm.value = { name: '', type: 'personal', initial_balance: 0, current_balance: 0 }
      await fetchList()
    }
  } finally {
    saving.value = false
  }
}

function openEdit(row) {
  editForm.value = {
    id: row.id,
    name: row.name,
    type: row.type || 'personal',
    initial_balance: Number(row.initial_balance || 0),
    current_balance: Number(row.current_balance || 0)
  }
  showEdit.value = true
}

async function handleEdit() {
  if (!editForm.value.name) {
    ElMessage.warning('请输入账户名称')
    return
  }
  saving.value = true
  try {
    const res = await fetch(`/api/accounts/${editForm.value.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify(editForm.value)
    })
    const json = await res.json()
    if (json.success) {
      ElMessage.success('保存成功')
      showEdit.value = false
      await fetchList()
    } else {
      ElMessage.error(json.message || '保存失败')
    }
  } finally {
    saving.value = false
  }
}

function openImportSummary() {
  summaryMode.value = 'month'
  importInput.value?.click()
}

async function onImportSummaryFile(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  if (file.size > 12 * 1024 * 1024) {
    ElMessage.warning('导入文件不能超过 12MB')
    return
  }
  importing.value = true
  try {
    const fileData = await readAsDataUrl(file)
    const res = await fetch('/api/accounts/monthly-summary/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({
        file_name: file.name,
        file_data: fileData,
        month: selectedMonth.value
      })
    })
    const json = await parseImportResponse(res)
    if (!res.ok || !json.success) {
      ElMessage.error(json.message || '导入账户余额失败')
      return
    }
    if (json.data?.month) selectedMonth.value = json.data.month
    ElMessage.success(json.message || '导入完成')
    if (json.data?.warnings?.length) {
      await ElMessageBox.alert(json.data.warnings.join('\n'), '导入提示', { confirmButtonText: '知道了' })
    }
    await fetchList()
  } catch (error) {
    ElMessage.error(error.message || '导入账户余额失败')
  } finally {
    importing.value = false
  }
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = event => resolve(event.target.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

async function parseImportResponse(res) {
  const text = await res.text()
  if (res.status === 404) {
    return { success: false, message: '账户余额导入接口不存在（404）：后端没有更新或服务没有重启。' }
  }
  if (!text) return { success: false, message: `账户余额导入接口没有返回内容（${res.status}）` }
  try {
    return JSON.parse(text)
  } catch {
    return {
      success: false,
      message: res.ok
        ? '账户余额导入接口返回格式异常，请刷新后重试'
        : `账户余额导入接口异常（${res.status}）：${text.replace(/\s+/g, ' ').slice(0, 120)}`
    }
  }
}

async function handleDelete(row) {
  try {
    await ElMessageBox.confirm(`确定删除「${row.name}」？`, '提示')
    const res = await fetch(`/api/accounts/${row.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token()}` }
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      ElMessage.error(err.message || '删除失败')
      return
    }
    ElMessage.success('已删除')
    await fetchList()
  } catch {} // 取消删除
}

function backToCurrentMonth() {
  summaryMode.value = 'month'
  selectedMonth.value = currentMonth
}

function formatMoney(value) {
  const n = Number(value || 0)
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatMonthLabel(value) {
  const text = String(value || '')
  const match = text.match(/^(\d{4})-(\d{2})$/)
  return match ? `${match[1]}年${Number(match[2])}月` : text
}

function getCurrentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

watch([summaryMode, selectedMonth], () => {
  if (!['month', 'all'].includes(summaryMode.value)) summaryMode.value = 'month'
  safeLocalStorageSet(STORAGE_MODE_KEY, summaryMode.value)
  safeLocalStorageSet(STORAGE_MONTH_KEY, selectedMonth.value)
  fetchSummary()
}, { immediate: true })

fetchList()
</script>

<style scoped>
.table-skeleton {
  padding: 16px 0;
}

.summary-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin: 14px 0 16px;
}

.header-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.hidden-input {
  display: none;
}

.summary-hint {
  color: #8b95a7;
  font-size: 13px;
}

.income {
  color: #16a36a;
}

.expense {
  color: #e5484d;
}

.form-tip {
  margin: -2px 0 0 90px;
  color: #8b95a7;
  font-size: 12px;
  line-height: 1.6;
}
</style>
