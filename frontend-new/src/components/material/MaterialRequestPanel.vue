<script setup>
import { getAuthToken } from '../../utils/authSession'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

const props = defineProps({
  projectId: { type: [Number, String], default: 0 },
  mode: { type: String, default: 'project' },
  title: { type: String, default: '材料出库单' },
  canRequest: { type: Boolean, default: true },
  canReturn: { type: Boolean, default: false },
  disabledReason: { type: String, default: '' }
})

const emit = defineEmits(['updated'])

const groups = [
  { key: 'material', title: '材料清单', addText: '加材料' },
  { key: 'auxiliary', title: '辅材损耗', addText: '加辅材' },
  { key: 'tool', title: '工具', addText: '加工具' }
]

const products = ref([])
const requests = ref([])
const loading = ref(false)
const saving = ref(false)
const importing = ref(false)
const importInput = ref(null)
const note = ref('')
const transportFee = ref(0)
const returnNote = ref('')
const returnRows = ref([])
const rows = reactive({
  material: [emptyRow('material')],
  auxiliary: [emptyRow('auxiliary')],
  tool: [emptyRow('tool')]
})

const userRole = computed(() => {
  try {
    const t = getAuthToken()
    return JSON.parse(atob(t.split('.')[1])).role || ''
  } catch { return '' }
})
const canCreate = computed(() => props.projectId && props.canRequest && ['super_admin', 'admin', 'engineering', 'warehouse'].includes(userRole.value))
const canSeeDisabledReason = computed(() => props.projectId && props.mode === 'project' && !props.canRequest && !props.canReturn && props.disabledReason)
const canConfirm = computed(() => ['super_admin', 'admin', 'warehouse'].includes(userRole.value))
const canHandleReturn = computed(() => props.projectId && props.canReturn && ['super_admin', 'admin', 'warehouse'].includes(userRole.value))
const visibleRequests = computed(() => requests.value)
const latestConfirmedRequest = computed(() => requests.value.find(item => item.status === 'confirmed') || null)
const flatRows = computed(() => groups.flatMap(group => rows[group.key].map(row => normalizeRow(row)).filter(row => row.product_name && row.out_quantity > 0)))
const materialTotal = computed(() => sumGroup('material'))
const auxiliaryTotal = computed(() => sumGroup('auxiliary'))
const toolTotal = computed(() => sumGroup('tool'))
const toolLossTotal = computed(() => roundMoney(toolTotal.value * 0.1))
const requestTotal = computed(() => roundMoney(materialTotal.value + auxiliaryTotal.value + toolLossTotal.value + toNumber(transportFee.value)))
const unmatchedRows = computed(() => groups.flatMap(group => rows[group.key]).filter(row => row.product_name && !Number(row.product_id || 0)))

function token() {
  return getAuthToken()
}

function emptyRow(group) {
  return {
    item_group: group,
    product_id: '',
    product_name: '',
    category: '',
    out_date: '',
    unit: '',
    location_id: 0,
    warehouse_code: '',
    location_display: '',
    out_quantity: 1,
    usage_quantity: '',
    unit_price: 0,
    amount: 0,
    remark: '',
    imported_name: '',
    match_status: '',
    match_message: ''
  }
}

function productLabel(item) {
  const sku = item?.sku_label || `${productDisplayName(item)}｜${item.unit || '单位未填'}｜${formatQty(item.stock)}`
  const location = item?.location_display || item?.warehouse_code || ''
  const testMark = item?.is_test ? ' / 测试材料' : ''
  return `${sku}${location ? ` / ${location}` : ''}${item.category ? ` / ${item.category}` : ''}${testMark}`
}

function productDisplayName(item) {
  if (item?.display_name) return item.display_name
  const name = String(item?.name || '').trim()
  const spec = String(item?.spec || '').trim()
  if (!spec || name.includes(spec)) return name
  return `${name}${spec}`
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

function money(value) {
  return `￥${Number(value || 0).toFixed(2)}`
}

function statusType(status) {
  return { requested: 'warning', confirmed: 'success', cancelled: 'info' }[status] || 'info'
}

function addRow(group) {
  rows[group].push(emptyRow(group))
}

function removeRow(group, index) {
  rows[group].splice(index, 1)
  if (!rows[group].length) rows[group].push(emptyRow(group))
}

function resetRows() {
  note.value = ''
  transportFee.value = 0
  for (const group of groups) {
    rows[group.key].splice(0, rows[group.key].length, emptyRow(group.key))
  }
}

function buildReturnRows() {
  const items = latestConfirmedRequest.value?.items || []
  returnRows.value = items.map(item => {
    const outQuantity = toNumber(item.out_quantity || item.quantity)
    const returnQuantity = toNumber(item.return_quantity)
    const usageQuantity = toNumber(item.usage_quantity) || Math.max(0, outQuantity - returnQuantity)
    return {
      id: item.id,
      product_id: item.product_id || 0,
      product_name: item.product_name || '',
      item_group: item.item_group || 'material',
      category: item.category || groupTitle(item.item_group),
      unit: item.unit || '',
      location_id: item.location_id || 0,
      warehouse_code: item.warehouse_code || item.product_warehouse_code || item.location_code || '',
      location_display: item.location_label || item.location_code || item.warehouse_code || item.product_warehouse_code || '',
      out_date: item.out_date || '',
      out_quantity: outQuantity,
      usage_quantity: usageQuantity,
      return_quantity: returnQuantity,
      unit_price: toNumber(item.unit_price),
      amount: roundMoney(usageQuantity * toNumber(item.unit_price)),
      remark: item.remark || item.note || ''
    }
  })
}

function applyProduct(row, productId) {
  const product = products.value.find(item => Number(item.id) === Number(productId))
  if (!product) return
  row.product_id = product.id
  row.product_name = productDisplayName(product)
  row.category = product.category || row.category || ''
  row.unit = product.unit || row.unit || ''
  row.location_id = product.location_id || 0
  row.warehouse_code = product.warehouse_code || ''
  row.location_display = product.location_display || product.warehouse_code || ''
  if (Number(product.unit_price || 0) > 0) row.unit_price = Number(product.unit_price)
  row.match_status = 'matched'
  row.match_message = `已匹配 ${productLabel(product)}`
  recalcRow(row)
}

function applyManualName(row) {
  const name = String(row.product_name || '').trim()
  if (!name) return
  const keyword = name.toLowerCase()
  const product = products.value.find(item => productSearchText(item) === keyword)
    || products.value.find(item => productSearchText(item).includes(keyword))
  if (product) applyProduct(row, product.id)
  else {
    row.product_id = ''
    row.match_status = 'unmatched'
    row.match_message = '未匹配库存产品，请选择具体规格'
    recalcRow(row)
  }
}

function recalcRow(row) {
  const usage = row.usage_quantity === '' || row.usage_quantity === undefined ? toNumber(row.out_quantity) : toNumber(row.usage_quantity)
  row.amount = roundMoney(usage * toNumber(row.unit_price))
}

function normalizeRow(row) {
  const usage = row.usage_quantity === '' || row.usage_quantity === undefined ? toNumber(row.out_quantity) : toNumber(row.usage_quantity)
  return {
    product_id: Number(row.product_id || 0),
    product_name: String(row.product_name || '').trim(),
    item_group: row.item_group,
    category: row.category || groupTitle(row.item_group),
    out_date: row.out_date || '',
    unit: row.unit || '',
    location_id: Number(row.location_id || 0),
    warehouse_code: row.warehouse_code || '',
    out_quantity: toNumber(row.out_quantity),
    return_quantity: 0,
    usage_quantity: usage,
    unit_price: toNumber(row.unit_price),
    amount: roundMoney(usage * toNumber(row.unit_price)),
    remark: row.remark || ''
  }
}

function recalcReturnRow(row) {
  row.amount = roundMoney(toNumber(row.usage_quantity) * toNumber(row.unit_price))
}

function returnDifference(row) {
  return roundMoney(toNumber(row.out_quantity) - toNumber(row.usage_quantity) - toNumber(row.return_quantity))
}

function groupTitle(key) {
  return groups.find(item => item.key === key)?.title || '材料清单'
}

function sumGroup(group) {
  return roundMoney(rows[group].reduce((sum, row) => {
    const normalized = normalizeRow(row)
    return sum + (normalized.product_name && normalized.out_quantity > 0 ? normalized.amount : 0)
  }, 0))
}

function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function roundMoney(value) {
  const n = Number(value || 0)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
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
    if (json.success) {
      requests.value = json.data || []
      buildReturnRows()
    }
    else ElMessage.error(json.message || '出库申请加载失败')
  } catch {
    ElMessage.error('出库申请加载失败')
  } finally {
    loading.value = false
  }
}

async function confirmReturn() {
  if (!returnRows.value.length) {
    ElMessage.warning('没有可回库的出库明细')
    return
  }
  saving.value = true
  try {
    const res = await fetch(`/api/projects/${props.projectId}/material-return/confirm`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({
        note: returnNote.value,
        items: returnRows.value.map(row => ({
          ...row,
          difference_quantity: returnDifference(row)
        }))
      })
    })
    const json = await readJson(res)
    if (!res.ok || !json.success) throw new Error(json.message || '确认回库失败')
    ElMessage.success('已确认材料回库')
    await fetchRequests()
    emit('updated')
  } catch (err) {
    ElMessage.error(err.message || '确认回库失败')
  } finally {
    saving.value = false
  }
}

async function createRequest() {
  const items = flatRows.value
  if (!items.length) {
    ElMessage.warning('请至少添加一项出库材料')
    return
  }
  if (unmatchedRows.value.length) {
    ElMessage.warning(`还有 ${unmatchedRows.value.length} 项未匹配库存产品，请先选择具体规格`)
    return
  }
  saving.value = true
  try {
    const res = await fetch(`/api/projects/${props.projectId}/material-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({
        note: note.value,
        items,
        summary: {
          material_total: materialTotal.value,
          auxiliary_total: auxiliaryTotal.value,
          tool_total: toolTotal.value,
          tool_loss_total: toolLossTotal.value,
          transport_fee: toNumber(transportFee.value),
          total_amount: requestTotal.value
        }
      })
    })
    const json = await readJson(res)
    if (!res.ok || !json.success) throw new Error(json.message || '出库申请失败')
    ElMessage.success('已提交材料出库单，等待仓库确认')
    resetRows()
    await fetchRequests()
    emit('updated')
  } catch (err) {
    ElMessage.error(err.message || '出库申请失败')
  } finally {
    saving.value = false
  }
}

function openImportDraft() {
  if (!canCreate.value) return
  importInput.value?.click()
}

async function onImportDraftFile(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  if (!/\.(csv|xls|xlsx|ppt|pptx)$/i.test(file.name)) {
    ElMessage.warning('暂只支持 CSV / XLS / XLSX / PPT / PPTX')
    return
  }
  importing.value = true
  try {
    const res = await fetch(`/api/projects/${props.projectId}/material-requests/import-draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({
        file_name: file.name,
        file_data: await readAsDataUrl(file)
      })
    })
    const json = await readJson(res)
    if (!res.ok || !json.success) throw new Error(json.message || '材料出库单导入失败')
    applyDraftRows(json.data?.grouped_items || {})
    const warnings = json.data?.warnings || []
    if (warnings.length) ElMessage.warning(warnings[0])
    else ElMessage.success('已生成出库草稿，请核对后提交')
  } catch (err) {
    ElMessage.error(err.message || '材料出库单导入失败')
  } finally {
    importing.value = false
  }
}

function applyDraftRows(grouped = {}) {
  for (const group of groups) {
    const incoming = Array.isArray(grouped[group.key]) ? grouped[group.key] : []
    rows[group.key].splice(0, rows[group.key].length, ...(incoming.length ? incoming.map(row => normalizeDraftRow(row, group.key)) : [emptyRow(group.key)]))
  }
}

function normalizeDraftRow(row, group) {
  return {
    ...emptyRow(group),
    ...row,
    item_group: group,
    product_id: Number(row.product_id || 0) || '',
    match_status: row.match_status || (row.product_id ? 'matched' : 'unmatched'),
    match_message: row.match_message || (row.product_id ? '已匹配库存产品' : '未匹配库存产品，请选择具体规格')
  }
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

async function confirmRequest(item) {
  try {
    await ElMessageBox.confirm(`确认出库申请 #${item.id}？确认后会扣减已匹配产品库存，并推进工单到已出库待进场。`, '仓库确认出库')
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
watch(latestConfirmedRequest, buildReturnRows)

onMounted(() => {
  fetchProducts()
  fetchRequests()
})
</script>

<template>
  <el-card class="material-panel" shadow="never">
    <input ref="importInput" class="hidden-input" type="file" accept=".csv,.xls,.xlsx,.ppt,.pptx" @change="onImportDraftFile" />
    <template #header>
      <div class="material-header">
        <span>{{ title }}</span>
        <el-tag v-if="mode === 'warehouse'" type="danger" size="small">{{ visibleRequests.length }} 条待出库</el-tag>
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
        <el-button type="primary" plain :loading="importing" @click="openImportDraft">导入出库单</el-button>
      </div>

      <el-alert
        v-if="unmatchedRows.length"
        class="request-guard"
        type="warning"
        :closable="false"
        :title="`有 ${unmatchedRows.length} 项未匹配库存产品，提交前必须选择到具体规格。`"
        show-icon
      />

      <section v-for="group in groups" :key="group.key" class="material-group">
        <div class="group-head">
          <strong>{{ group.title }}</strong>
          <el-button size="small" @click="addRow(group.key)">+ {{ group.addText }}</el-button>
        </div>
        <div class="warehouse-table">
          <div class="warehouse-row warehouse-head">
            <span>出库时间</span>
            <span>材料名</span>
            <span>库位</span>
            <span>单位</span>
            <span>出库数量</span>
            <span>用量</span>
            <span>单价</span>
            <span>金额</span>
            <span>备注</span>
            <span></span>
          </div>
          <div class="warehouse-row" :class="{ unmatched: row.product_name && !row.product_id }" v-for="(row, index) in rows[group.key]" :key="`${group.key}-${index}`">
            <el-input v-model="row.out_date" placeholder="2026.4.8" />
            <div class="product-cell">
              <el-select
                v-model="row.product_id"
                filterable
                clearable
                placeholder="选库存"
                @change="applyProduct(row, $event)"
              >
                <el-option v-for="product in products" :key="product.id" :label="productLabel(product)" :value="product.id">
                  <div class="product-option">
                    <span>{{ productLabel(product) }}</span>
                    <el-tag v-if="product.is_test" size="small" type="info">测试</el-tag>
                  </div>
                </el-option>
              </el-select>
              <el-input v-model="row.product_name" placeholder="也可手填材料名" @blur="applyManualName(row)" />
              <small v-if="row.match_message" class="match-message">{{ row.match_message }}</small>
            </div>
            <el-input :model-value="row.location_display || row.warehouse_code || '未填'" disabled />
            <el-input v-model="row.unit" placeholder="单位" />
            <el-input-number v-model="row.out_quantity" :min="0" :precision="2" controls-position="right" @change="recalcRow(row)" />
            <el-input-number v-model="row.usage_quantity" :min="0" :precision="2" controls-position="right" placeholder="默认同出库" @change="recalcRow(row)" />
            <el-input-number v-model="row.unit_price" :min="0" :precision="2" controls-position="right" @change="recalcRow(row)" />
            <el-input :model-value="money(normalizeRow(row).amount)" disabled />
            <el-input v-model="row.remark" placeholder="备注" />
            <el-button link type="danger" @click="removeRow(group.key, index)">删</el-button>
          </div>
        </div>
      </section>

      <div class="summary-grid">
        <span>材料合计 <b>{{ money(materialTotal) }}</b></span>
        <span>辅材损耗 <b>{{ money(auxiliaryTotal) }}</b></span>
        <span>工具原值 <b>{{ money(toolTotal) }}</b></span>
        <span>工具损耗10% <b>{{ money(toolLossTotal) }}</b></span>
        <label>运输费 <el-input-number v-model="transportFee" :min="0" :precision="2" controls-position="right" /></label>
        <span class="total">总计 <b>{{ money(requestTotal) }}</b></span>
      </div>

      <el-button type="primary" :loading="saving" @click="createRequest">提交材料出库单</el-button>
    </div>

    <div v-loading="loading" class="request-list">
      <section v-if="canHandleReturn" class="return-workbench">
        <div class="group-head">
          <strong>材料回库单</strong>
          <el-tag type="warning" size="small">验收后处理</el-tag>
        </div>
        <el-alert
          v-if="!latestConfirmedRequest"
          type="warning"
          :closable="false"
          title="未找到已确认的材料出库单，暂不能回库。"
          show-icon
        />
        <template v-else>
          <el-input v-model="returnNote" class="return-note" placeholder="回库备注，如无余料、部分回库、差异原因" />
          <div class="warehouse-table">
            <div class="warehouse-row return-row warehouse-head">
              <span>材料名</span>
              <span>库位</span>
              <span>单位</span>
              <span>出库数量</span>
              <span>实际用量</span>
              <span>回库数量</span>
              <span>差异</span>
              <span>备注</span>
            </div>
            <div class="warehouse-row return-row" v-for="row in returnRows" :key="row.id || row.product_name">
              <el-input v-model="row.product_name" disabled />
              <el-input :model-value="row.location_display || row.warehouse_code || '未填'" disabled />
              <el-input v-model="row.unit" disabled />
              <el-input-number v-model="row.out_quantity" :min="0" :precision="2" controls-position="right" disabled />
              <el-input-number v-model="row.usage_quantity" :min="0" :precision="2" controls-position="right" @change="recalcReturnRow(row)" />
              <el-input-number v-model="row.return_quantity" :min="0" :precision="2" controls-position="right" />
              <el-input :model-value="formatQty(returnDifference(row))" disabled />
              <el-input v-model="row.remark" placeholder="差异/回库说明" />
            </div>
          </div>
          <el-button type="primary" :loading="saving" @click="confirmReturn">确认材料回库</el-button>
        </template>
      </section>

      <article v-for="item in visibleRequests" :key="item.id" class="request-card">
        <header>
          <div>
            <strong>#{{ item.id }} {{ item.project_name || '项目工单' }}</strong>
            <span>{{ item.project_customer || '' }} · {{ item.requester_name || '未知申请人' }} · {{ item.created_at }}</span>
          </div>
          <el-tag :type="statusType(item.status)" size="small">{{ item.status_label }}</el-tag>
        </header>
        <p v-if="item.note" class="request-note-text">{{ item.note }}</p>
        <div class="request-summary">
          <span>材料 {{ money(item.material_total) }}</span>
          <span>辅材 {{ money(item.auxiliary_total) }}</span>
          <span>工具损耗 {{ money(item.tool_loss_total) }}</span>
          <span>运输 {{ money(item.transport_fee) }}</span>
          <b>总计 {{ money(item.total_amount) }}</b>
        </div>
        <div class="item-lines">
          <div v-for="line in item.items" :key="line.id">
            <em>{{ groupTitle(line.item_group) }}</em>
            {{ line.product_name }}
            <span v-if="line.location_label || line.location_code || line.warehouse_code || line.product_warehouse_code">
              · {{ line.location_label || line.location_code || line.warehouse_code || line.product_warehouse_code }}
            </span>
            <b>{{ formatQty(line.out_quantity || line.quantity) }} {{ line.unit }}</b>
            <span>· {{ money(line.amount) }}</span>
            <span v-if="line.remark || line.note">· {{ line.remark || line.note }}</span>
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
.request-card header,
.request-card footer,
.group-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.material-header,
.group-head {
  justify-content: space-between;
  font-weight: 700;
}
.request-form {
  display: grid;
  gap: 14px;
  margin-bottom: 14px;
}
.request-guard {
  margin-bottom: 12px;
}
.request-note .el-input {
  flex: 1;
}
.hidden-input {
  display: none;
}
.material-group {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--bg-card) 94%, var(--bg-page));
}
.return-workbench {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid color-mix(in srgb, #f59e0b 45%, var(--border-light));
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, #f59e0b 8%, var(--bg-card));
}
.return-note {
  max-width: 680px;
}
.warehouse-table {
  overflow-x: auto;
  padding-bottom: 4px;
}
.warehouse-row {
  display: grid;
  grid-template-columns: 118px 260px 120px 78px 112px 112px 112px 112px 180px 44px;
  gap: 8px;
  align-items: center;
  min-width: 1260px;
  margin-bottom: 8px;
}
.warehouse-row.unmatched {
  padding: 8px;
  margin: 0 0 8px;
  border: 1px solid color-mix(in srgb, #f59e0b 52%, var(--border-light));
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, #f59e0b 8%, var(--bg-card));
}
.warehouse-row.return-row {
  grid-template-columns: 220px 120px 78px 112px 112px 112px 90px 220px;
  min-width: 1080px;
}
.warehouse-head {
  margin-bottom: 6px;
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 700;
}
.product-cell {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.product-cell .match-message {
  grid-column: 1 / -1;
  color: #b45309;
  font-size: 12px;
}
.product-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.summary-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(160px, 1fr));
  gap: 10px;
  align-items: center;
  padding: 12px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--color-primary) 8%, var(--bg-card));
}
.summary-grid span,
.summary-grid label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 13px;
  color: var(--text-secondary);
}
.summary-grid b {
  color: var(--text-primary);
}
.summary-grid .total {
  color: var(--color-primary);
  font-weight: 700;
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
.request-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 8px 0;
  font-size: 12px;
  color: var(--text-secondary);
}
.request-summary span,
.request-summary b {
  padding: 4px 8px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--bg-page) 82%, var(--bg-card));
}
.item-lines {
  display: grid;
  gap: 5px;
  font-size: 13px;
}
.item-lines em {
  display: inline-block;
  min-width: 64px;
  font-style: normal;
  color: var(--color-primary);
}
.request-card footer {
  justify-content: flex-end;
  margin-top: 10px;
}
@media (max-width: 760px) {
  .summary-grid {
    grid-template-columns: 1fr;
  }
}
</style>
