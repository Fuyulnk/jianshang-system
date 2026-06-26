<template>
  <div class="arap-page">
    <el-card class="page-card" shadow="never">
      <div class="page-header">
        <div>
          <div class="eyebrow">财务工作台</div>
          <h2>应收应付</h2>
          <p class="page-desc">跟踪待收款、待付款和跨月未结事项；这里是台账，不会自动改交易流水。</p>
        </div>
        <div class="header-actions">
          <el-button :icon="Refresh" :loading="loading" @click="fetchItems">刷新</el-button>
          <el-button type="primary" @click="openEditor()">新增事项</el-button>
        </div>
      </div>

      <div class="summary-grid">
        <div class="summary-card income">
          <span>待收金额</span>
          <strong>{{ formatMoney(totals.receivable_pending) }}</strong>
        </div>
        <div class="summary-card expense">
          <span>待付金额</span>
          <strong>{{ formatMoney(totals.payable_pending) }}</strong>
        </div>
        <div class="summary-card warning">
          <span>已逾期</span>
          <strong>{{ totals.overdue_count }}</strong>
        </div>
        <div class="summary-card neutral">
          <span>事项数</span>
          <strong>{{ totals.total_count }}</strong>
        </div>
      </div>

      <el-form class="filter-bar" :model="filters" @keyup.enter="fetchItems">
        <el-input v-model="filters.q" clearable placeholder="搜索客户、项目、分类、备注" class="keyword-input" @clear="fetchItems" />
        <el-select v-model="filters.type" clearable placeholder="类型" @change="fetchItems">
          <el-option label="应收" value="receivable" />
          <el-option label="应付" value="payable" />
        </el-select>
        <el-select v-model="filters.status" clearable placeholder="状态" @change="fetchItems">
          <el-option label="待处理" value="pending" />
          <el-option label="部分完成" value="partial" />
          <el-option label="已完成" value="done" />
        </el-select>
        <el-date-picker
          v-model="filters.month"
          type="month"
          value-format="YYYY-MM"
          placeholder="到期月份"
          @change="fetchItems"
        />
        <el-button @click="resetFilters">重置</el-button>
      </el-form>

      <el-table :data="items" stripe v-loading="loading" class="arap-table">
        <el-table-column label="类型" width="86">
          <template #default="{ row }">
            <el-tag :type="row.type === 'receivable' ? 'success' : 'danger'" size="small">
              {{ row.type === 'receivable' ? '应收' : '应付' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="title" label="事项" min-width="170" show-overflow-tooltip />
        <el-table-column prop="counterparty" label="对方" min-width="130" show-overflow-tooltip />
        <el-table-column prop="project_name" label="项目" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">{{ row.project_name || '-' }}</template>
        </el-table-column>
        <el-table-column label="金额" width="130" align="right">
          <template #default="{ row }">{{ formatMoney(row.amount) }}</template>
        </el-table-column>
        <el-table-column label="未结" width="130" align="right">
          <template #default="{ row }">
            <span :class="row.remaining_amount > 0 ? 'amount-pending' : 'amount-done'">{{ formatMoney(row.remaining_amount) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="due_date" label="到期日" width="120">
          <template #default="{ row }">
            <span :class="{ overdue: row.is_overdue }">{{ row.due_date || '-' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="category" label="分类" width="120" show-overflow-tooltip />
        <el-table-column prop="note" label="备注" min-width="180" show-overflow-tooltip />
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button link size="small" type="primary" @click="openEditor(row)">编辑</el-button>
            <el-button link size="small" type="success" v-if="row.status !== 'done'" @click="markDone(row)">完成</el-button>
            <el-button link size="small" type="danger" @click="deleteItem(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="editorVisible" :title="editingId ? '编辑应收应付事项' : '新增应收应付事项'" width="560px">
      <el-form label-width="82px" :model="form" class="arap-form">
        <el-form-item label="类型" required>
          <el-radio-group v-model="form.type">
            <el-radio-button value="receivable">应收</el-radio-button>
            <el-radio-button value="payable">应付</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="事项" required>
          <el-input v-model="form.title" maxlength="120" placeholder="例如：某项目 90% 进场款" />
        </el-form-item>
        <el-form-item label="对方">
          <el-input v-model="form.counterparty" maxlength="120" placeholder="客户、门店、总部、供应商等" />
        </el-form-item>
        <el-form-item label="金额" required>
          <el-input-number v-model="form.amount" :min="0" :precision="2" :step="100" controls-position="right" />
        </el-form-item>
        <el-form-item label="已结金额">
          <el-input-number v-model="form.settled_amount" :min="0" :precision="2" :step="100" controls-position="right" />
        </el-form-item>
        <el-form-item label="到期日">
          <el-date-picker v-model="form.due_date" type="date" value-format="YYYY-MM-DD" placeholder="选择到期日" />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="form.status">
            <el-option label="待处理" value="pending" />
            <el-option label="部分完成" value="partial" />
            <el-option label="已完成" value="done" />
          </el-select>
        </el-form-item>
        <el-form-item label="分类">
          <el-input v-model="form.category" maxlength="80" placeholder="工程款、供货款、总部货款、返点等" />
        </el-form-item>
        <el-form-item label="项目ID">
          <el-input-number v-model="form.project_id" :min="0" controls-position="right" />
          <span class="form-hint">后续会改成项目下拉，当前可先留空或填项目编号。</span>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.note" type="textarea" :rows="3" maxlength="500" show-word-limit />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editorVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveItem">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh } from '@element-plus/icons-vue'
import { getAuthToken } from '../../utils/authSession'

const loading = ref(false)
const saving = ref(false)
const editorVisible = ref(false)
const editingId = ref(0)
const items = ref([])
const totals = reactive({
  receivable_pending: 0,
  payable_pending: 0,
  overdue_count: 0,
  total_count: 0
})
const filters = reactive({
  q: '',
  type: '',
  status: '',
  month: ''
})
const form = reactive(emptyForm())

const queryString = computed(() => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value)
  }
  return params.toString()
})

function token() {
  return getAuthToken()
}

function emptyForm() {
  return {
    type: 'receivable',
    title: '',
    counterparty: '',
    amount: 0,
    settled_amount: 0,
    due_date: '',
    status: 'pending',
    category: '',
    project_id: 0,
    note: ''
  }
}

function assignForm(payload = {}) {
  Object.assign(form, emptyForm(), payload, {
    amount: Number(payload.amount || 0),
    settled_amount: Number(payload.settled_amount || 0),
    project_id: Number(payload.project_id || 0)
  })
}

async function fetchItems() {
  loading.value = true
  try {
    const suffix = queryString.value ? `?${queryString.value}` : ''
    const res = await fetch(`/api/finance/receivables-payables${suffix}`, {
      headers: { Authorization: `Bearer ${token()}` }
    })
    const json = await res.json()
    if (!json.success) throw new Error(json.message || '应收应付加载失败')
    items.value = json.data?.rows || []
    Object.assign(totals, json.data?.totals || {})
  } catch (error) {
    ElMessage.error(error.message || '应收应付加载失败')
  } finally {
    loading.value = false
  }
}

function resetFilters() {
  Object.assign(filters, { q: '', type: '', status: '', month: '' })
  fetchItems()
}

function openEditor(row = null) {
  editingId.value = row?.id || 0
  assignForm(row || {})
  editorVisible.value = true
}

async function saveItem() {
  if (!form.title?.trim()) {
    ElMessage.warning('请填写事项名称')
    return
  }
  if (!Number(form.amount)) {
    ElMessage.warning('请填写金额')
    return
  }
  saving.value = true
  try {
    const url = editingId.value
      ? `/api/finance/receivables-payables/${editingId.value}`
      : '/api/finance/receivables-payables'
    const res = await fetch(url, {
      method: editingId.value ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify(form)
    })
    const json = await res.json()
    if (!json.success) throw new Error(json.message || '保存失败')
    ElMessage.success(json.message || '已保存')
    editorVisible.value = false
    await fetchItems()
  } catch (error) {
    ElMessage.error(error.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function markDone(row) {
  try {
    const res = await fetch(`/api/finance/receivables-payables/${row.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({ ...row, status: 'done', settled_amount: row.amount })
    })
    const json = await res.json()
    if (!json.success) throw new Error(json.message || '更新失败')
    ElMessage.success('已标记完成')
    await fetchItems()
  } catch (error) {
    ElMessage.error(error.message || '更新失败')
  }
}

async function deleteItem(row) {
  try {
    await ElMessageBox.confirm(`确定删除「${row.title}」？`, '删除应收应付事项', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger'
    })
    const res = await fetch(`/api/finance/receivables-payables/${row.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token()}` }
    })
    const json = await res.json()
    if (!json.success) throw new Error(json.message || '删除失败')
    ElMessage.success('已删除')
    await fetchItems()
  } catch (error) {
    if (error !== 'cancel') ElMessage.error(error.message || '删除失败')
  }
}

function statusLabel(status) {
  return { pending: '待处理', partial: '部分完成', done: '已完成' }[status] || '待处理'
}

function statusType(status) {
  return { pending: 'warning', partial: 'primary', done: 'success' }[status] || 'warning'
}

function formatMoney(value) {
  return `¥${Number(value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

onMounted(fetchItems)
</script>

<style scoped>
.arap-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-card {
  border-radius: 14px;
}

.page-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

.eyebrow {
  color: var(--color-primary);
  font-size: 13px;
  font-weight: 700;
}

.page-header h2 {
  margin: 4px 0 6px;
  color: var(--text-primary);
}

.page-desc {
  margin: 0;
  color: var(--text-tertiary);
}

.header-actions {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.summary-card {
  padding: 14px 16px;
  border: 1px solid var(--border-light);
  border-radius: 10px;
  background: color-mix(in srgb, var(--bg-card) 86%, var(--bg-page));
}

.summary-card span {
  display: block;
  margin-bottom: 8px;
  color: var(--text-tertiary);
  font-size: 13px;
}

.summary-card strong {
  color: var(--text-primary);
  font-size: 22px;
}

.summary-card.income strong,
.amount-done {
  color: #059669;
}

.summary-card.expense strong {
  color: #dc2626;
}

.summary-card.warning strong,
.amount-pending,
.overdue {
  color: #d97706;
}

.filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 14px;
}

.keyword-input {
  width: 260px;
}

.filter-bar :deep(.el-select),
.filter-bar :deep(.el-date-editor) {
  width: 150px;
}

.arap-table {
  width: 100%;
}

.arap-form :deep(.el-input-number) {
  width: 180px;
}

.form-hint {
  margin-left: 10px;
  color: var(--text-tertiary);
  font-size: 12px;
}

@media (max-width: 960px) {
  .page-header {
    flex-direction: column;
  }

  .summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
