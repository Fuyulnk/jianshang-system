<script setup>
import { getAuthToken } from '../../utils/authSession'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { UploadFilled, WarningFilled } from '@element-plus/icons-vue'
import DecimalCellInput from '../../components/projects/DecimalCellInput.vue'

const router = useRouter()

const flowSteps = {
  warehouse: [
    { key: 'ordered', label: '销售下单' },
    { key: 'payment_confirmed', label: '财务确认收款' },
    { key: 'stock_out', label: '仓管出库' },
    { key: 'shipped', label: '发货' },
    { key: 'completed', label: '完结' }
  ],
  purchase: [
    { key: 'ordered', label: '销售下单' },
    { key: 'payment_confirmed', label: '财务确认收款' },
    { key: 'shipped', label: '总部直发' },
    { key: 'completed', label: '完结' }
  ]
}
const defaultSteps = flowSteps.warehouse

function stepsFor(row) {
  return flowSteps[row?.fulfillment_type] || defaultSteps
}

const list = ref([])
const products = ref([])
const loading = ref(false)
const saving = ref(false)
const showDialog = ref(false)
const showImportDialog = ref(false)
const editingId = ref(0)
const filters = ref({ keyword: '', status: '' })
const form = ref(emptyForm())
const importFile = ref(null)
const importFileInput = ref(null)
const importParsing = ref(false)
const importConfirming = ref(false)
const importParsed = ref(null)
const importForm = ref(emptyForm())

const board = computed(() => [
  { label: '待财务确认', count: list.value.filter(row => row.status === 'ordered').length, desc: '导入或新建后，财务先核对收款' },
  { label: '待处理', count: list.value.filter(row => row.status === 'payment_confirmed').length, desc: '自有库存待出库，总部直发待确认发货' },
  { label: '待发货', count: list.value.filter(row => row.status === 'stock_out').length, desc: '自有库存已出库，待发货' },
  { label: '已完结', count: list.value.filter(row => row.status === 'completed').length, desc: '供货闭环完成' }
])

function token() {
  return getAuthToken() || ''
}

function emptyForm(type = 'warehouse') {
  return {
    customer: '',
    phone: '',
    source: '',
    address: '',
    amount: 0,
    note: '',
    fulfillment_type: normalizeFulfillmentType(type),
    items: [emptyItem()],
    meta: {}
  }
}

function emptyItem() {
  return { product_id: 0, product_name: '', category: '', unit: '', location_id: 0, warehouse_code: '', location_display: '', quantity: 1, unit_price: 0, amount: 0, note: '' }
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

function openCreate(type) {
  editingId.value = 0
  form.value = emptyForm(type)
  showDialog.value = true
}

function openImport(type) {
  resetImport(type)
  showImportDialog.value = true
}

function resetImport(type = 'warehouse') {
  importFile.value = null
  importParsed.value = null
  importForm.value = emptyForm(type)
  if (importFileInput.value) importFileInput.value.value = ''
}

function openImportPicker() {
  importFileInput.value?.click()
}

function onImportFileChange(event) {
  const file = event.target.files?.[0]
  if (!file) return
  if (!/\.(csv|xls|xlsx)$/i.test(file.name)) {
    ElMessage.warning('项目供货单暂只支持 CSV / XLS / XLSX')
    event.target.value = ''
    return
  }
  if (file.size > 10 * 1024 * 1024) {
    ElMessage.warning('单个文件不能超过 10MB')
    event.target.value = ''
    return
  }
  importFile.value = file
  importParsed.value = null
  importForm.value = emptyForm(importForm.value.fulfillment_type)
}

async function parseImport() {
  if (!importFile.value) {
    ElMessage.warning('请先选择供货销售单或材料预算单')
    return
  }
  importParsing.value = true
  try {
    const json = await requestJson('/api/supply-orders/imports/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_name: importFile.value.name,
        file_data: await readAsDataUrl(importFile.value)
      })
    })
    importParsed.value = json.data
    importForm.value = normalizeParsedOrder(json.data?.form_data || {}, importForm.value.fulfillment_type)
    ElMessage.success('供货单已解析，请核对后创建')
  } catch (err) {
    ElMessage.error(err.message || '供货单解析失败')
  } finally {
    importParsing.value = false
  }
}

async function confirmImportCreate() {
  if (!importParsed.value) {
    ElMessage.warning('请先解析供货单')
    return
  }
  if (!String(importForm.value.customer || '').trim()) {
    ElMessage.warning('客户/项目名称必填')
    return
  }
  const warehouseMessage = validateWarehouseProductLinks(importForm.value)
  if (warehouseMessage) {
    ElMessage.warning(warehouseMessage)
    return
  }
  importConfirming.value = true
  try {
    refreshImportAmount()
    const json = await requestJson('/api/supply-orders/imports/confirm-create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parsed_data: importParsed.value,
        confirmed_data: importForm.value,
        warnings: importParsed.value.warnings || [],
        source_file: importFile.value?.name || importParsed.value.source_file || ''
      })
    })
    ElMessage.success(`供货单已创建：${json.order_no || ''}，已进入财务确认收款`)
    showImportDialog.value = false
    await fetchList()
  } catch (err) {
    ElMessage.error(err.message || '创建供货单失败')
  } finally {
    importConfirming.value = false
  }
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
      fulfillment_type: data.fulfillment_type || 'warehouse',
      items: data.items?.length ? data.items.map(normalizeItem) : [emptyItem()]
    }
    showDialog.value = true
  } catch (err) {
    ElMessage.error(err.message || '供货单详情加载失败')
  }
}

function normalizeItem(item) {
  return {
    product_id: Number(item.product_id || 0),
    product_name: item.product_name || '',
    category: item.category || '',
    unit: item.unit || '',
    location_id: Number(item.location_id || 0),
    warehouse_code: item.warehouse_code || item.product_warehouse_code || item.location_code || '',
    location_display: item.location_label || item.location_code || item.warehouse_code || item.product_warehouse_code || '',
    quantity: Number(item.quantity || 0),
    unit_price: Number(item.unit_price || 0),
    amount: Number(item.amount || 0),
    note: item.note || ''
  }
}

function normalizeParsedOrder(input, selectedType = 'warehouse') {
  return {
    customer: input.customer || '',
    phone: input.phone || '',
    source: input.source || '',
    address: input.address || '',
    amount: Number(input.amount || 0),
    note: input.note || '',
    fulfillment_type: normalizeFulfillmentType(selectedType),
    items: Array.isArray(input.items) && input.items.length ? input.items.map(normalizeItem) : [emptyItem()],
    meta: input.meta || {}
  }
}

function addItem() {
  form.value.items.push(emptyItem())
}

function addImportItem() {
  importForm.value.items.push(emptyItem())
}

function removeEmptyItems() {
  form.value.items = form.value.items.filter(item => String(item.product_name || '').trim())
  if (!form.value.items.length) form.value.items = [emptyItem()]
}

function applyProduct(row, productId, target = 'form') {
  const product = products.value.find(item => Number(item.id) === Number(productId))
  if (!product) {
    row.product_id = 0
    recalcRow(row, target)
    return
  }
  row.product_id = product.id
  row.product_name = productDisplayName(product)
  row.category = product.category || row.category || ''
  row.unit = product.unit || row.unit || ''
  row.location_id = product.location_id || 0
  row.warehouse_code = product.warehouse_code || ''
  row.location_display = product.location_display || product.warehouse_code || ''
  if (Number(product.unit_price || 0) > 0) row.unit_price = Number(product.unit_price)
  recalcRow(row, target)
}

function applyManualProductName(row, target = 'form') {
  const matched = matchProduct(row.product_name)
  if (matched) applyProduct(row, matched.id, target)
  else {
    row.product_id = 0
    recalcRow(row, target)
  }
}

function recalcRow(row, target = 'form') {
  row.amount = roundMoney(Number(row.quantity || 0) * Number(row.unit_price || 0))
  if (target === 'import') refreshImportAmount()
  else refreshAmount()
}

function matchProduct(value) {
  const keyword = compactSku(value)
  if (!keyword) return null
  const exactSku = products.value.find(item => compactSku(productDisplayName(item)) === keyword || compactSku(item.sku_label) === keyword)
  if (exactSku) return exactSku
  const sameName = products.value.filter(item => compactSku(item.name) === keyword)
  return sameName.length === 1 ? sameName[0] : null
}

function productDisplayName(item) {
  if (item?.display_name) return item.display_name
  const name = String(item?.name || '').trim()
  const spec = String(item?.spec || '').trim()
  if (!spec || name.includes(spec)) return name
  return `${name}${spec}`
}

function productLabel(item) {
  const sku = item?.sku_label || `${productDisplayName(item)}｜${item.unit || '单位未填'}｜库存${formatQty(item.stock)}`
  const location = item?.location_display || item?.warehouse_code || ''
  const testMark = item?.is_test ? ' / 测试材料' : ''
  return `${sku}${location ? ` / ${location}` : ''}${item.category ? ` / ${item.category}` : ''}${testMark}`
}

function productSearchText(item) {
  if (item?.search_text) return item.search_text
  return [productDisplayName(item), item?.name, item?.spec, item?.category, item?.unit, item?.sku_label, item?.warehouse_code, item?.location_display]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function formatQty(value) {
  const n = Number(value || 0)
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

function fulfillmentLabel(type) {
  return normalizeFulfillmentType(type) === 'purchase' ? '总部采购直发' : '自有库存发货'
}

function fulfillmentShortLabel(type) {
  return normalizeFulfillmentType(type) === 'purchase' ? '总部直发' : '自有库存'
}

function fulfillmentTagType(type) {
  return normalizeFulfillmentType(type) === 'purchase' ? 'warning' : 'primary'
}

function fulfillmentHint(type) {
  return normalizeFulfillmentType(type) === 'purchase'
    ? '总部直发允许手填材料明细，不扣简尚库存。'
    : '自有库存必须选择库存产品，后续出库会按规格扣减库存。'
}

function normalizeFulfillmentType(type) {
  const raw = String(type || '').trim()
  const compacted = compactSku(raw)
  if (['purchase', 'hq', 'headquarters', 'direct'].includes(compacted)) return 'purchase'
  if (raw.includes('总部') || raw.includes('采购') || raw.includes('直发')) return 'purchase'
  return 'warehouse'
}

function compactSku(value) {
  return String(value || '')
    .replace(/[｜|\s　/／·,，-]/g, '')
    .toLowerCase()
}

function validateWarehouseProductLinks(draft) {
  if (normalizeFulfillmentType(draft.fulfillment_type) !== 'warehouse') return ''
  const rows = Array.isArray(draft.items) ? draft.items.filter(item => String(item.product_name || '').trim()) : []
  const missing = rows.findIndex(item => !Number(item.product_id || 0))
  return missing >= 0 ? `自有库存供货第 ${missing + 1} 条必须选择库存产品，不能只手填名称` : ''
}

function refreshAmount() {
  form.value.amount = roundMoney(form.value.items.reduce((sum, item) => sum + Number(item.amount || 0), 0))
}

function refreshImportAmount() {
  importForm.value.amount = roundMoney(importForm.value.items.reduce((sum, item) => sum + Number(item.amount || 0), 0))
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

async function saveOrder() {
  if (!String(form.value.customer || '').trim()) {
    ElMessage.warning('客户/项目名称必填')
    return
  }
  const warehouseMessage = validateWarehouseProductLinks(form.value)
  if (warehouseMessage) {
    ElMessage.warning(warehouseMessage)
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

async function deleteOrder(row) {
  try {
    await ElMessageBox.confirm(`确定删除供货单「${row.order_no || row.customer}」？删除后明细和流程记录也会一起移除。`, '确认删除', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning'
    })
    saving.value = true
    await requestJson(`/api/supply-orders/${row.id}`, { method: 'DELETE' })
    ElMessage.success('供货单已删除')
    await fetchList()
  } catch (err) {
    if (err === 'cancel' || err === 'close') return
    ElMessage.error(err.message || '删除供货单失败')
  } finally {
    saving.value = false
  }
}

function statusType(status) {
  if (status === 'completed') return 'success'
  if (status === 'ordered') return 'warning'
  return 'primary'
}

function displayStatus(row) {
  return row.todo_label || row.status_label || '-'
}

function stepActive(row, step) {
  const ss = stepsFor(row)
  return ss.findIndex(item => item.key === step.key) <= ss.findIndex(item => item.key === row.status)
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
        <p>供货单分两类：自有库存直接卖给门店并扣库存；总部直发由简尚代采转售，先不强制卡总部付款。</p>
      </div>
      <div class="header-actions">
        <el-button @click="openImport('warehouse')">导入自有库存供货单</el-button>
        <el-button @click="openImport('purchase')">导入总部直发供货单</el-button>
        <el-button type="primary" @click="openCreate('warehouse')">新建自有库存供货单</el-button>
        <el-button type="warning" @click="openCreate('purchase')">新建总部直发供货单</el-button>
      </div>
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
            <p>导入或新建后先由财务确认门店收款，再按供货方式进入自有库存出库或总部直发确认。</p>
          </div>
          <div class="filters">
            <el-input v-model="filters.keyword" clearable placeholder="搜索客户/电话/地址" @keyup.enter="fetchList" />
            <el-select v-model="filters.status" clearable placeholder="状态" style="width: 150px" @change="fetchList">
              <el-option label="全部状态" value="" />
              <el-option label="待财务确认" value="ordered" />
              <el-option label="财务已收款" value="payment_confirmed" />
              <el-option label="待出库" value="stock_out" />
              <el-option label="已发货" value="shipped" />
              <el-option label="已完结" value="completed" />
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
        <el-table-column label="供货方式" width="100">
          <template #default="{ row }">
            <el-tag :type="row.fulfillment_type === 'purchase' ? 'warning' : 'primary'" size="small" effect="plain">
              {{ row.fulfillment_type === 'purchase' ? '总部直发' : '自有库存' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="金额" width="120" align="right">
          <template #default="{ row }">{{ money(row.amount) }}</template>
        </el-table-column>
        <el-table-column prop="status_label" label="当前步骤" width="140">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ displayStatus(row) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="流程" min-width="420">
          <template #default="{ row }">
            <div class="flow-line">
              <span v-for="step in stepsFor(row)" :key="step.key" :class="{ active: stepActive(row, step) }">{{ step.label }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="230" fixed="right">
          <template #default="{ row }">
            <el-button link @click="openEdit(row)">查看/编辑</el-button>
            <el-button v-if="row.next_status" link type="primary" :loading="saving" @click="advance(row)">
              {{ row.action_label || '推进' }}
            </el-button>
            <el-button link type="danger" :loading="saving" @click="deleteOrder(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="showDialog" :title="editingId ? '编辑供货单' : `新建${fulfillmentShortLabel(form.fulfillment_type)}供货单`" width="1080px">
      <div class="route-banner" :class="form.fulfillment_type">
        <el-tag :type="fulfillmentTagType(form.fulfillment_type)" effect="plain">{{ fulfillmentLabel(form.fulfillment_type) }}</el-tag>
        <span>{{ fulfillmentHint(form.fulfillment_type) }}</span>
      </div>
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
      <div class="supply-items-table">
        <div class="supply-items-head">
          <span>库存产品</span>
          <span>材料名称</span>
          <span>库位</span>
          <span>分类</span>
          <span>单位</span>
          <span>数量</span>
          <span>单价</span>
          <span>金额</span>
          <span>备注</span>
        </div>
        <div v-for="(row, index) in form.items" :key="`form-${index}`" class="supply-item-row" :class="{ unmatched: form.fulfillment_type === 'warehouse' && row.product_name && !row.product_id }">
          <el-select
            v-model="row.product_id"
            filterable
            clearable
            placeholder="选库存"
            @change="applyProduct(row, $event, 'form')"
          >
            <el-option v-for="product in products" :key="product.id" :label="productLabel(product)" :value="product.id">
              <div class="product-option">
                <span>{{ productLabel(product) }}</span>
                <el-tag v-if="product.is_test" size="small" type="info">测试</el-tag>
              </div>
            </el-option>
          </el-select>
          <el-input v-model="row.product_name" placeholder="材料名称" @blur="applyManualProductName(row, 'form')" />
          <el-input :model-value="row.location_display || row.warehouse_code || '未填'" disabled />
          <el-input v-model="row.category" placeholder="分类" />
          <el-input v-model="row.unit" placeholder="单位" />
          <DecimalCellInput v-model="row.quantity" @update:model-value="recalcRow(row, 'form')" />
          <DecimalCellInput v-model="row.unit_price" @update:model-value="recalcRow(row, 'form')" />
          <DecimalCellInput v-model="row.amount" @update:model-value="refreshAmount" />
          <el-input v-model="row.note" placeholder="备注" />
          <el-button class="row-delete" link type="danger" @click="form.items.splice(index, 1)">删除</el-button>
        </div>
        <div v-if="!form.items.length" class="empty-items">暂无供货明细</div>
      </div>
      <template #footer>
        <el-button @click="showDialog = false">关闭</el-button>
        <el-button type="primary" :loading="saving" @click="saveOrder">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showImportDialog" :title="`导入${fulfillmentShortLabel(importForm.fulfillment_type)}供货单`" width="1080px" class="supply-import-dialog" @closed="resetImport">
      <div class="import-layout">
        <section class="import-source">
          <div class="route-banner compact" :class="importForm.fulfillment_type">
            <el-tag :type="fulfillmentTagType(importForm.fulfillment_type)" effect="plain">{{ fulfillmentLabel(importForm.fulfillment_type) }}</el-tag>
            <span>{{ fulfillmentHint(importForm.fulfillment_type) }}</span>
          </div>
          <div class="section-title">供货单来源</div>
          <div class="upload-box" @click="openImportPicker">
            <input ref="importFileInput" class="hidden-input" type="file" accept=".csv,.xls,.xlsx" @change="onImportFileChange" />
            <el-icon :size="28"><UploadFilled /></el-icon>
            <div>
              <strong>{{ importFile?.name || '选择供货销售单 / 材料预算单' }}</strong>
              <span>支持别人向简尚下单的 .xls / .xlsx / .csv，AI分析后生成可编辑草稿。</span>
            </div>
          </div>
          <el-button class="parse-button" type="primary" :loading="importParsing" @click="parseImport">AI分析供货单</el-button>

          <div class="analysis-card">
            <span>识别类型</span>
            <strong>{{ importParsed?.analysis?.order_type_label || '待分析' }}</strong>
            <p>{{ importParsed?.analysis?.summary?.join(' · ') || '上传后会识别客户、地址、联系人、供货明细和金额异常。' }}</p>
          </div>

          <div v-if="importParsed?.warnings?.length" class="warning-list">
            <div v-for="warning in importParsed.warnings" :key="warning">
              <el-icon><WarningFilled /></el-icon>
              <span>{{ warning }}</span>
            </div>
          </div>
        </section>

        <section class="import-form">
          <div class="result-header">
            <div>
              <div class="section-title">系统版项目供货单</div>
              <p>AI只负责拆字段和提示异常，创建前请人工核对金额、电话和送货地址。</p>
            </div>
            <el-button type="primary" :disabled="!importParsed" :loading="importConfirming" @click="confirmImportCreate">确认创建供货单</el-button>
          </div>

          <el-form :model="importForm" label-position="top">
            <div class="form-grid">
              <el-form-item label="客户/项目名称"><el-input v-model="importForm.customer" /></el-form-item>
              <el-form-item label="联系方式"><el-input v-model="importForm.phone" /></el-form-item>
              <el-form-item label="来源/顾问"><el-input v-model="importForm.source" /></el-form-item>
              <el-form-item label="供货金额"><DecimalCellInput v-model="importForm.amount" /></el-form-item>
              <el-form-item class="wide" label="收货/项目地址"><el-input v-model="importForm.address" /></el-form-item>
              <div v-if="importParsed" class="wide parsed-meta">
                <div class="meta-item">
                  <span>下单日期</span>
                  <strong>{{ importForm.meta?.order_date || '表内未提供' }}</strong>
                </div>
                <div class="meta-item">
                  <span>订单顾问</span>
                  <strong>{{ importForm.meta?.consultant || '表内未提供' }}</strong>
                </div>
                <div class="meta-item wide">
                  <span>联系地址</span>
                  <strong>{{ importForm.meta?.address_duplicated ? '与收货/项目地址一致' : (importForm.meta?.contact_address || '表内未提供') }}</strong>
                </div>
                <div class="meta-item wide">
                  <span>付款/转账信息</span>
                  <strong>{{ importForm.meta?.payment_note || '表内未提供' }}</strong>
                </div>
              </div>
              <el-form-item class="wide" label="表内备注"><el-input v-model="importForm.note" type="textarea" :rows="2" /></el-form-item>
            </div>
          </el-form>

          <div class="dialog-toolbar">
            <strong>供货明细</strong>
            <el-button size="small" @click="addImportItem">新增一行</el-button>
          </div>
          <div class="supply-items-table">
            <div class="supply-items-head">
              <span>库存产品</span>
              <span>材料名称</span>
              <span>库位</span>
              <span>分类</span>
              <span>单位</span>
              <span>数量</span>
              <span>单价</span>
              <span>金额</span>
              <span>备注</span>
            </div>
            <div v-for="(row, index) in importForm.items" :key="`import-${index}`" class="supply-item-row" :class="{ unmatched: importForm.fulfillment_type === 'warehouse' && row.product_name && !row.product_id }">
              <el-select
                v-model="row.product_id"
                filterable
                clearable
                placeholder="选库存"
                @change="applyProduct(row, $event, 'import')"
              >
                <el-option v-for="product in products" :key="product.id" :label="productLabel(product)" :value="product.id">
                  <div class="product-option">
                    <span>{{ productLabel(product) }}</span>
                    <el-tag v-if="product.is_test" size="small" type="info">测试</el-tag>
                  </div>
                </el-option>
              </el-select>
              <el-input v-model="row.product_name" placeholder="材料名称" @blur="applyManualProductName(row, 'import')" />
              <el-input :model-value="row.location_display || row.warehouse_code || '未填'" disabled />
              <el-input v-model="row.category" placeholder="分类" />
              <el-input v-model="row.unit" placeholder="单位" />
              <DecimalCellInput v-model="row.quantity" @update:model-value="recalcRow(row, 'import')" />
              <DecimalCellInput v-model="row.unit_price" @update:model-value="recalcRow(row, 'import')" />
              <DecimalCellInput v-model="row.amount" @update:model-value="refreshImportAmount" />
              <el-input v-model="row.note" placeholder="备注" />
              <el-button class="row-delete" link type="danger" @click="importForm.items.splice(index, 1)">删除</el-button>
            </div>
            <div v-if="!importForm.items.length" class="empty-items">解析后会显示供货明细</div>
          </div>
        </section>
      </div>
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

.header-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  justify-content: flex-end;
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

.parsed-meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: var(--bg-page);
}

.meta-item {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.meta-item.wide {
  grid-column: 1 / -1;
}

.meta-item span {
  color: var(--text-secondary);
  font-size: 12px;
}

.meta-item strong {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 700;
  word-break: break-word;
}

.dialog-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 4px 0 10px;
}

.route-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, #3b82f6 22%, var(--border-light));
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, #3b82f6 7%, var(--bg-card));
  color: var(--text-secondary);
  font-size: 13px;
}

.route-banner.purchase {
  border-color: color-mix(in srgb, #f59e0b 28%, var(--border-light));
  background: color-mix(in srgb, #f59e0b 8%, var(--bg-card));
}

.route-banner.compact {
  align-items: flex-start;
  margin-bottom: 12px;
}

.supply-items-table {
  width: 100%;
  overflow-x: auto;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
}

.supply-items-head,
.supply-item-row {
  display: grid;
  grid-template-columns: 210px 170px 120px 120px 90px 92px 100px 100px 150px 54px;
  gap: 8px;
  align-items: center;
  min-width: 1240px;
  padding: 8px;
}

.supply-items-head {
  padding-right: 70px;
  background: var(--bg-page);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 800;
}

.supply-item-row {
  position: relative;
  border-top: 1px solid var(--border-light);
  background: var(--bg-card);
}

.supply-item-row.unmatched {
  background: color-mix(in srgb, #ef4444 7%, var(--bg-card));
}

.supply-item-row.unmatched::before {
  position: absolute;
  left: 8px;
  bottom: 2px;
  content: "自有库存需选择具体库存产品";
  color: #dc2626;
  font-size: 11px;
}

.row-delete {
  justify-self: end;
}

.empty-items {
  padding: 18px;
  color: var(--text-tertiary);
  text-align: center;
}

.product-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.import-layout {
  display: grid;
  grid-template-columns: 310px minmax(0, 1fr);
  gap: 18px;
  min-height: 560px;
}

.section-title {
  font-weight: 800;
  margin-bottom: 10px;
}

.upload-box {
  min-height: 96px;
  padding: 14px;
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-page);
  display: flex;
  gap: 12px;
  align-items: center;
  cursor: pointer;
  color: var(--text-secondary);
}

.upload-box strong,
.upload-box span {
  display: block;
}

.upload-box strong {
  color: var(--text-primary);
  margin-bottom: 4px;
}

.hidden-input {
  display: none;
}

.parse-button {
  width: 100%;
  margin: 12px 0;
}

.analysis-card {
  padding: 12px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
}

.analysis-card span {
  display: block;
  color: var(--text-secondary);
  font-size: 12px;
}

.analysis-card strong {
  display: block;
  margin: 4px 0;
  font-size: 18px;
}

.analysis-card p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 13px;
}

.warning-list {
  display: grid;
  gap: 8px;
  margin-top: 12px;
}

.warning-list div {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  padding: 8px 10px;
  border-radius: var(--radius-xs);
  background: color-mix(in srgb, #f59e0b 12%, var(--bg-card));
  color: var(--color-warning);
  font-size: 13px;
}

.result-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
  margin-bottom: 12px;
}

.result-header p {
  margin: 0;
  color: var(--text-secondary);
}

@media (max-width: 860px) {
  .supply-header,
  .card-head,
  .header-actions,
  .filters,
  .result-header {
    display: grid;
    min-width: 0;
  }

  .supply-board,
  .form-grid,
  .import-layout {
    grid-template-columns: 1fr;
  }
}
</style>
