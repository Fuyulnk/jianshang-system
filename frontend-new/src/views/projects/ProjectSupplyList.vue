<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import DecimalCellInput from '../../components/projects/DecimalCellInput.vue'
import SystemSheetTable from '../../components/projects/SystemSheetTable.vue'

const router = useRouter()

const steps = [
  { key: 'ordered', label: '销售下单' },
  { key: 'payment_confirmed', label: '财务确认收款' },
  { key: 'materials_ordered', label: '仓库订材料' },
  { key: 'shipped', label: '材料到位发货' },
  { key: 'completed', label: '完结' }
]

const itemColumns = [
  { key: 'product_name', label: '产品/材料', width: 170 },
  { key: 'category', label: '分类', width: 120 },
  { key: 'unit', label: '单位', width: 80 },
  { key: 'quantity', label: '数量', type: 'number', width: 100 },
  { key: 'unit_price', label: '单价', type: 'number', width: 100 },
  { key: 'amount', label: '金额', type: 'number', width: 110 },
  { key: 'note', label: '备注', width: 220 }
]

const list = ref([])
const products = ref([])
const loading = ref(false)
const saving = ref(false)
const showDialog = ref(false)
const editingId = ref(0)
const filters = ref({ keyword: '', status: '' })
const form = ref(emptyForm())

const board = computed(() => [
  { label: '待财务确认', count: list.value.filter(row => row.status === 'ordered').length, desc: '已下单，等收款确认' },
  { label: '待仓库订料', count: list.value.filter(row => row.status === 'payment_confirmed').length, desc: '收款后进入仓库' },
  { label: '待发货', count: list.value.filter(row => row.status === 'materials_ordered').length, desc: '材料到位后发货' },
  { label: '已完结', count: list.value.filter(row => row.status === 'completed').length, desc: '供货闭环完成' }
])

function token() {
  return localStorage.getItem('token') || ''
}

function emptyForm() {
  return {
    customer: '',
    phone: '',
    source: '',
    address: '',
    amount: 0,
    note: '',
    items: [emptyItem()]
  }
}

function emptyItem() {
  return { product_name: '', category: '', unit: '', quantity: 1, unit_price: 0, amount: 0, note: '' }
}

async function requestJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token()}`
    }
  })
  const text = await res.text()
  let json = {}
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(text.slice(0, 120) || '服务器返回异常')
  }
  if (!res.ok || !json.success) throw new Error(json.message || `请求失败（HTTP ${res.status}）`)
  return json
}

async function fetchList() {
  loading.value = true
  try {
    const params = new URLSearchParams()
    if (filters.value.keyword) params.set('keyword', filters.value.keyword)
    if (filters.value.status) params.set('status', filters.value.status)
    const json = await requestJson(`/api/supply-orders?${params}`)
    list.value = json.data || []
  } catch (err) {
    ElMessage.error(err.message || '供货单加载失败')
  } finally {
    loading.value = false
  }
}

async function fetchProducts() {
  try {
    const json = await requestJson('/api/products')
    products.value = json.data || []
  } catch {
    products.value = []
  }
}

function openCreate() {
  editingId.value = 0
  form.value = emptyForm()
  showDialog.value = true
}

async function openEdit(row) {
  try {
    const json = await requestJson(`/api/supply-orders/${row.id}`)
    const data = json.data
    editingId.value = data.id
    form.value = {
      customer: data.customer || '',
      phone: data.phone || '',
      source: data.source || '',
      address: data.address || '',
      amount: data.amount || 0,
      note: data.note || '',
      items: data.items?.length ? data.items.map(normalizeItem) : [emptyItem()]
    }
    showDialog.value = true
  } catch (err) {
    ElMessage.error(err.message || '供货单详情加载失败')
  }
}

function normalizeItem(item) {
  return {
    product_name: item.product_name || '',
    category: item.category || '',
    unit: item.unit || '',
    quantity: Number(item.quantity || 0),
    unit_price: Number(item.unit_price || 0),
    amount: Number(item.amount || 0),
    note: item.note || ''
  }
}

function addItem() {
  form.value.items.push(emptyItem())
}

function removeEmptyItems() {
  form.value.items = form.value.items.filter(item => String(item.product_name || '').trim())
  if (!form.value.items.length) form.value.items = [emptyItem()]
}

function onItemChange({ row, column }) {
  if (column.key === 'product_name') {
    const matched = products.value.find(item => String(item.name || '').trim() === String(row.product_name || '').trim())
    if (matched) {
      if (!row.category) row.category = matched.category || ''
      if (!row.unit) row.unit = matched.unit || ''
      if (!row.unit_price) row.unit_price = Number(matched.unit_price || 0)
    }
  }
  if (['quantity', 'unit_price', 'product_name'].includes(column.key)) {
    row.amount = roundMoney(Number(row.quantity || 0) * Number(row.unit_price || 0))
    refreshAmount()
  }
}

function refreshAmount() {
  form.value.amount = roundMoney(form.value.items.reduce((sum, item) => sum + Number(item.amount || 0), 0))
}

async function saveOrder() {
  if (!String(form.value.customer || '').trim()) {
    ElMessage.warning('客户/项目名称必填')
    return
  }
  saving.value = true
  try {
    removeEmptyItems()
    refreshAmount()
    const method = editingId.value ? 'PUT' : 'POST'
    const url = editingId.value ? `/api/supply-orders/${editingId.value}` : '/api/supply-orders'
    await requestJson(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form.value)
    })
    ElMessage.success(editingId.value ? '供货单已保存' : '供货单已创建')
    showDialog.value = false
    await fetchList()
  } catch (err) {
    ElMessage.error(err.message || '保存供货单失败')
  } finally {
    saving.value = false
  }
}

async function advance(row) {
  if (!row.next_status) return
  saving.value = true
  try {
    await requestJson(`/api/supply-orders/${row.id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: row.next_status })
    })
    ElMessage.success(`已推进到：${row.next_label}`)
    await fetchList()
  } catch (err) {
    ElMessage.error(err.message || '状态推进失败')
  } finally {
    saving.value = false
  }
}

function statusType(status) {
  if (status === 'completed') return 'success'
  if (status === 'ordered') return 'warning'
  return 'primary'
}

function stepActive(row, step) {
  return steps.findIndex(item => item.key === step.key) <= steps.findIndex(item => item.key === row.status)
}

function money(value) {
  const n = Number(value || 0)
  return `￥${n.toFixed(2)}`
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100
}

onMounted(() => {
  fetchList()
  fetchProducts()
})
</script>

<template>
  <div class="supply-page">
    <div class="supply-header">
      <div>
        <el-button text @click="router.push('/main/projects')">← 返回项目工单</el-button>
        <h2>项目供货单</h2>
        <p>不走施工交付的材料供货分支：销售下单、财务确认收款、仓库订材料、材料到位发货、完结。</p>
      </div>
      <el-button type="primary" @click="openCreate">新建供货单</el-button>
    </div>

    <div class="supply-board">
      <div v-for="item in board" :key="item.label" class="board-card">
        <span>{{ item.label }}</span>
        <strong>{{ item.count }}</strong>
        <p>{{ item.desc }}</p>
      </div>
    </div>

    <el-card class="page-card" shadow="never">
      <template #header>
        <div class="card-head">
          <div>
            <h3>供货单列表</h3>
            <p>这条线不进入施工资料链，后续再联动库存扣减和收款凭证。</p>
          </div>
          <div class="filters">
            <el-input v-model="filters.keyword" clearable placeholder="搜索客户/电话/地址" @keyup.enter="fetchList" />
            <el-select v-model="filters.status" clearable placeholder="状态" style="width: 150px" @change="fetchList">
              <el-option v-for="step in steps" :key="step.key" :label="step.label" :value="step.key" />
            </el-select>
            <el-button @click="fetchList">查询</el-button>
          </div>
        </div>
      </template>

      <el-table :data="list" stripe v-loading="loading">
        <el-table-column prop="order_no" label="供货单号" width="150" />
        <el-table-column prop="customer" label="客户/项目" min-width="150" />
        <el-table-column prop="phone" label="联系方式" width="130" />
        <el-table-column prop="source" label="来源" width="110" />
        <el-table-column label="金额" width="120" align="right">
          <template #default="{ row }">{{ money(row.amount) }}</template>
        </el-table-column>
        <el-table-column prop="status_label" label="当前步骤" width="140">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ row.status_label }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="流程" min-width="420">
          <template #default="{ row }">
            <div class="flow-line">
              <span v-for="step in steps" :key="step.key" :class="{ active: stepActive(row, step) }">{{ step.label }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="190" fixed="right">
          <template #default="{ row }">
            <el-button link @click="openEdit(row)">查看/编辑</el-button>
            <el-button v-if="row.next_status" link type="primary" :loading="saving" @click="advance(row)">推进</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="showDialog" :title="editingId ? '编辑供货单' : '新建供货单'" width="960px">
      <el-form :model="form" label-position="top">
        <div class="form-grid">
          <el-form-item label="客户/项目名称"><el-input v-model="form.customer" /></el-form-item>
          <el-form-item label="联系方式"><el-input v-model="form.phone" /></el-form-item>
          <el-form-item label="来源/门店"><el-input v-model="form.source" /></el-form-item>
          <el-form-item label="供货金额"><DecimalCellInput v-model="form.amount" /></el-form-item>
          <el-form-item class="wide" label="收货/施工地址"><el-input v-model="form.address" /></el-form-item>
          <el-form-item class="wide" label="备注"><el-input v-model="form.note" type="textarea" :rows="2" /></el-form-item>
        </div>
      </el-form>
      <div class="dialog-toolbar">
        <strong>供货明细</strong>
        <el-button size="small" @click="addItem">新增一行</el-button>
      </div>
      <SystemSheetTable
        :columns="itemColumns"
        :rows="form.items"
        storage-key="supply-order-items"
        empty-text="暂无供货明细"
        @cell-change="onItemChange"
      />
      <template #footer>
        <el-button @click="showDialog = false">关闭</el-button>
        <el-button type="primary" :loading="saving" @click="saveOrder">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.supply-page {
  display: grid;
  gap: 16px;
}

.supply-header,
.card-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}

.supply-header h2,
.card-head h3 {
  margin: 4px 0 6px;
}

.supply-header p,
.card-head p {
  margin: 0;
  color: var(--text-secondary);
}

.supply-board {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.board-card {
  padding: 14px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
}

.board-card span,
.board-card p {
  color: var(--text-secondary);
  font-size: 12px;
}

.board-card strong {
  display: block;
  margin: 5px 0 2px;
  font-size: 24px;
}

.board-card p {
  margin: 0;
}

.filters {
  display: flex;
  gap: 8px;
  min-width: 420px;
}

.flow-line {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.flow-line span {
  padding: 4px 7px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-xs);
  color: var(--text-tertiary);
  font-size: 12px;
}

.flow-line span.active {
  border-color: color-mix(in srgb, #10b981 35%, var(--border-light));
  background: color-mix(in srgb, #10b981 10%, var(--bg-card));
  color: #059669;
  font-weight: 800;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.form-grid .wide {
  grid-column: 1 / -1;
}

.dialog-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 4px 0 10px;
}

@media (max-width: 860px) {
  .supply-header,
  .card-head,
  .filters {
    display: grid;
    min-width: 0;
  }

  .supply-board,
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
