<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

const props = defineProps({
  projectId: { type: [Number, String], default: 0 },
  mode: { type: String, default: 'project' },
  title: { type: String, default: '材料出库申请' },
  canRequest: { type: Boolean, default: true },
  disabledReason: { type: String, default: '' }
})

const emit = defineEmits(['updated'])

const products = ref([])
const requests = ref([])
const loading = ref(false)
const saving = ref(false)
const note = ref('')
const rows = ref([emptyRow()])

const userRole = computed(() => {
  try {
    const t = localStorage.getItem('token')
    return JSON.parse(atob(t.split('.')[1])).role || ''
  } catch { return '' }
})
const canCreate = computed(() => props.projectId && props.canRequest && ['super_admin', 'admin', 'engineering'].includes(userRole.value))
const canSeeDisabledReason = computed(() => props.projectId && props.mode === 'project' && !props.canRequest && props.disabledReason)
const canConfirm = computed(() => ['super_admin', 'admin', 'warehouse'].includes(userRole.value))
const visibleRequests = computed(() => requests.value)

function token() {
  return localStorage.getItem('token')
}

function emptyRow() {
  return { product_id: '', quantity: 1, note: '' }
}

function productLabel(item) {
  return `${item.name}${item.category ? ` / ${item.category}` : ''}（库存 ${formatQty(item.stock)} ${item.unit || ''}）`
}

function formatQty(value) {
  const n = Number(value || 0)
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

function statusType(status) {
  return { requested: 'warning', confirmed: 'success', cancelled: 'info' }[status] || 'info'
}

function addRow() {
  rows.value.push(emptyRow())
}

function removeRow(index) {
  rows.value.splice(index, 1)
  if (!rows.value.length) rows.value.push(emptyRow())
}

async function fetchProducts() {
  try {
    const res = await fetch('/api/products', { headers: { Authorization: `Bearer ${token()}` } })
    const json = await res.json()
    if (json.success) products.value = json.data || []
  } catch {}
}

async function fetchRequests() {
  loading.value = true
  try {
    const params = new URLSearchParams()
    if (props.projectId) params.set('project_id', String(props.projectId))
    if (props.mode === 'warehouse') params.set('status', 'requested')
    const res = await fetch(`/api/material-requests?${params}`, { headers: { Authorization: `Bearer ${token()}` } })
    const json = await res.json()
    if (json.success) requests.value = json.data || []
    else ElMessage.error(json.message || '出库申请加载失败')
  } catch {
    ElMessage.error('出库申请加载失败')
  } finally {
    loading.value = false
  }
}

async function createRequest() {
  const items = rows.value
    .map(row => ({ product_id: Number(row.product_id), quantity: Number(row.quantity), note: row.note }))
    .filter(row => row.product_id && row.quantity > 0)
  if (!items.length) {
    ElMessage.warning('请至少添加一项材料')
    return
  }
  saving.value = true
  try {
    const res = await fetch(`/api/projects/${props.projectId}/material-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({ note: note.value, items })
    })
    const json = await readJson(res)
    if (!res.ok || !json.success) throw new Error(json.message || '出库申请失败')
    ElMessage.success('已发起出库申请')
    note.value = ''
    rows.value = [emptyRow()]
    await fetchRequests()
    emit('updated')
  } catch (err) {
    ElMessage.error(err.message || '出库申请失败')
  } finally {
    saving.value = false
  }
}

async function confirmRequest(item) {
  try {
    await ElMessageBox.confirm(`确认出库申请 #${item.id}？确认后会扣减库存，并同步工单材料状态。`, '仓库确认出库')
    const res = await fetch(`/api/material-requests/${item.id}/confirm`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({ note: '仓库确认出库' })
    })
    const json = await readJson(res)
    if (!res.ok || !json.success) throw new Error(json.message || '确认出库失败')
    ElMessage.success('已确认出库')
    await fetchRequests()
    emit('updated')
  } catch (err) {
    if (err !== 'cancel') ElMessage.error(err.message || '确认出库失败')
  }
}

async function cancelRequest(item) {
  try {
    await ElMessageBox.confirm(`确定取消出库申请 #${item.id}？`, '取消申请')
    const res = await fetch(`/api/material-requests/${item.id}/cancel`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token()}` }
    })
    const json = await readJson(res)
    if (!res.ok || !json.success) throw new Error(json.message || '取消失败')
    ElMessage.success('已取消')
    await fetchRequests()
    emit('updated')
  } catch (err) {
    if (err !== 'cancel') ElMessage.error(err.message || '取消失败')
  }
}

async function readJson(res) {
  const text = await res.text()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return { success: false, message: text.slice(0, 120) || '服务器返回异常' }
  }
}

watch(() => props.projectId, fetchRequests)

onMounted(() => {
  fetchProducts()
  fetchRequests()
})
</script>

<template>
  <el-card class="material-panel" shadow="never">
    <template #header>
      <div class="material-header">
        <span>{{ title }}</span>
        <el-tag v-if="mode === 'warehouse'" type="warning" size="small">{{ visibleRequests.length }} 条待处理</el-tag>
      </div>
    </template>

    <el-alert
      v-if="canSeeDisabledReason"
      class="request-guard"
      type="info"
      :closable="false"
      :title="disabledReason"
      show-icon
    />

    <div v-if="canCreate && mode === 'project'" class="request-form">
      <div class="request-note">
        <el-input v-model="note" placeholder="出库说明，如施工面积、工艺、特殊材料要求" />
        <el-button @click="addRow">添加材料</el-button>
      </div>
      <div class="request-row" v-for="(row, index) in rows" :key="index">
        <el-select v-model="row.product_id" filterable placeholder="选择库存产品">
          <el-option v-for="product in products" :key="product.id" :label="productLabel(product)" :value="product.id" />
        </el-select>
        <el-input-number v-model="row.quantity" :min="0.01" :precision="2" />
        <el-input v-model="row.note" placeholder="备注" />
        <el-button link type="danger" @click="removeRow(index)">移除</el-button>
      </div>
      <el-button type="primary" :loading="saving" @click="createRequest">发起出库申请</el-button>
    </div>

    <div v-loading="loading" class="request-list">
      <article v-for="item in visibleRequests" :key="item.id" class="request-card">
        <header>
          <div>
            <strong>#{{ item.id }} {{ item.project_name || '项目工单' }}</strong>
            <span>{{ item.project_customer || '' }} · {{ item.requester_name || '未知申请人' }} · {{ item.created_at }}</span>
          </div>
          <el-tag :type="statusType(item.status)" size="small">{{ item.status_label }}</el-tag>
        </header>
        <p v-if="item.note" class="request-note-text">{{ item.note }}</p>
        <div class="item-lines">
          <div v-for="line in item.items" :key="line.id">
            {{ line.product_name }} <b>{{ formatQty(line.quantity) }} {{ line.unit }}</b>
            <span v-if="line.note">· {{ line.note }}</span>
          </div>
        </div>
        <footer v-if="item.status === 'requested'">
          <el-button v-if="canConfirm" size="small" type="primary" @click="confirmRequest(item)">仓库确认出库</el-button>
          <el-button v-if="mode === 'project'" size="small" plain @click="cancelRequest(item)">取消申请</el-button>
        </footer>
      </article>
      <el-empty v-if="!loading && !visibleRequests.length" description="暂无出库申请" :image-size="72" />
    </div>
  </el-card>
</template>

<style scoped>
.material-panel {
  margin-bottom: 20px;
  border: 1px solid var(--border-light);
}
.material-header,
.request-note,
.request-row,
.request-card header,
.request-card footer {
  display: flex;
  align-items: center;
  gap: 10px;
}
.material-header {
  justify-content: space-between;
  font-weight: 700;
}
.request-form {
  display: grid;
  gap: 10px;
  margin-bottom: 14px;
}
.request-guard {
  margin-bottom: 12px;
}
.request-note .el-input {
  flex: 1;
}
.request-row {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) 140px minmax(140px, 0.8fr) 52px;
}
.request-list {
  display: grid;
  gap: 10px;
}
.request-card {
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  padding: 12px;
  background: color-mix(in srgb, var(--bg-card) 92%, var(--bg-page));
}
.request-card header {
  justify-content: space-between;
  align-items: flex-start;
}
.request-card header span,
.request-note-text,
.item-lines span {
  color: var(--text-secondary);
  font-size: 12px;
}
.request-card header strong,
.request-card header span {
  display: block;
}
.request-note-text {
  margin: 8px 0;
}
.item-lines {
  display: grid;
  gap: 5px;
  font-size: 13px;
}
.request-card footer {
  justify-content: flex-end;
  margin-top: 10px;
}
@media (max-width: 760px) {
  .request-note,
  .request-row {
    display: grid;
    grid-template-columns: 1fr;
  }
}
</style>
