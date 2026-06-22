<template>
  <div class="page">
    <el-card class="page-card">
      <div class="page-header">
        <div>
          <h2>产品库存</h2>
          <p class="page-desc">按材料台账管理仓库物料，页面只展示仓库日常需要看的名称、规格、库存和参考价格</p>
        </div>
        <div class="header-actions">
          <el-checkbox v-model="showTestMaterials">显示测试材料</el-checkbox>
          <el-button plain :loading="stocktakingImporting" @click="openStocktakingPicker">导入盘点草稿</el-button>
          <el-button type="primary" @click="openAdd">+ 新增产品</el-button>
        </div>
      </div>
      <input ref="stocktakingInput" class="hidden-input" type="file" accept=".xlsx,.xls,.csv" @change="onStocktakingFileChange" />

      <div class="warehouse-filters">
        <el-input v-model="filters.query" clearable placeholder="搜索名称、规格、编码、别名" @keyup.enter="fetchList" />
        <el-select v-model="filters.category" clearable filterable placeholder="分类" @change="fetchList">
          <el-option v-for="c in categoryOptions" :key="c" :label="c" :value="c" />
        </el-select>
        <el-select v-model="filters.area" clearable filterable placeholder="货架区域" @change="fetchList">
          <el-option v-for="area in areaOptions" :key="area" :label="area" :value="area" />
        </el-select>
        <el-select v-model="filters.stock_status" clearable placeholder="库存状态" @change="fetchList">
          <el-option label="正常" value="normal" />
          <el-option label="库存不足" value="low" />
        </el-select>
        <el-select v-model="filters.location_status" clearable placeholder="库位状态" @change="fetchList">
          <el-option label="已填库位" value="assigned" />
          <el-option label="未填库位" value="missing" />
        </el-select>
        <el-button @click="fetchList">查询</el-button>
      </div>

      <el-table :data="filteredList" stripe v-loading="loading" style="width: 100%">
        <el-table-column label="产品库存" min-width="520">
          <template #default="{ row }">
            <div class="product-name-cell">
              <div>
                <div class="product-title-line">
                  <strong>{{ productDisplayName(row) }}</strong>
                </div>
                <p class="inventory-line">{{ inventoryLine(row) }}</p>
              </div>
              <el-tag v-if="row.is_test" size="small" type="info" effect="plain">测试</el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="仓库编码" width="150">
          <template #default="{ row }">
            <el-tag v-if="row.warehouse_code" size="small" effect="plain">{{ row.location_display || row.warehouse_code }}</el-tag>
            <span v-else class="muted-text">未填</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="stockStatusType(row)" size="small">{{ stockStatusLabel(row) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="190">
          <template #default="{ row }">
            <el-button type="primary" link size="small" @click="openMovements(row)">流水</el-button>
            <el-button type="primary" link size="small" @click="openEdit(row)">编辑</el-button>
            <el-button type="danger" link size="small" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <MaterialRequestPanel
      v-if="canHandleMaterialRequests"
      mode="warehouse"
      title="待确认材料出库"
      @updated="fetchList"
    />

    <el-dialog v-model="showProductDialog" :title="editingId ? '编辑产品' : '新增产品'" width="640px" @closed="resetProductDialog">
      <el-form :model="productForm" label-position="top">
        <div class="product-form-grid">
          <el-form-item label="产品名称">
          <el-autocomplete
            v-model="productForm.name"
            :fetch-suggestions="queryProductSuggestions"
            clearable
            style="width: 100%"
            placeholder="输入或选择曾录入的产品"
            @select="applyProductSuggestion"
          >
            <template #default="{ item }">
              <div class="product-suggestion">
                <strong>{{ item.value }}</strong>
                <span>{{ item.warehouse_code ? `${item.warehouse_code}｜` : '' }}{{ item.unit || '单位未填' }}｜库存 {{ formatQty(item.stock) }}</span>
              </div>
            </template>
          </el-autocomplete>
        </el-form-item>
        <el-form-item label="分类">
          <el-select
            v-model="productForm.category"
            filterable
            allow-create
            clearable
            default-first-option
            style="width: 100%"
            placeholder="选择或输入分类"
          >
            <el-option v-for="c in categoryOptions" :key="c" :label="c" :value="c" />
          </el-select>
        </el-form-item>
        <el-form-item label="规格说明">
          <el-input v-model="productForm.spec" placeholder="如 5L、20kg/袋；规格不是库存单位" />
        </el-form-item>
        <el-form-item label="仓库编码/存放位置">
          <el-select
            v-model="productForm.warehouse_code"
            filterable
            allow-create
            clearable
            default-first-option
            style="width: 100%"
            placeholder="如 A-1-1-1、B-2-1-1"
          >
            <el-option
              v-for="location in locationOptions"
              :key="location.code"
              :label="location.label || location.code"
              :value="location.code"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="数量和单位">
          <div class="inline-fields">
            <el-input-number v-model="productForm.stock" :min="0" style="width: 100%" />
            <el-select
              v-model="productForm.unit"
              filterable
              allow-create
              default-first-option
              style="width: 120px"
              placeholder="单位"
            >
              <el-option v-for="u in unitOptions" :key="u" :label="u" :value="u" />
            </el-select>
          </div>
          <p class="field-hint">例如 5L 是规格，库存单位填“桶”，表示 5L 一桶。</p>
        </el-form-item>
        <el-form-item label="参考单价">
          <div class="inline-fields">
            <el-input-number v-model="productForm.unit_price" :min="0" :precision="2" style="width: 100%" />
            <span class="unit-suffix">元 / {{ productForm.price_unit || productForm.unit || '单位' }}</span>
          </div>
        </el-form-item>
        <el-form-item label="库存提醒">
          <el-input-number v-model="productForm.min_stock" :min="0" style="width: 100%" />
          <p class="field-hint">低于这个数量时显示库存不足。</p>
        </el-form-item>
        </div>

        <el-collapse class="advanced-collapse">
          <el-collapse-item title="高级设置" name="advanced">
            <el-form-item label="计价单位">
          <el-select
            v-model="productForm.price_unit"
            filterable
            allow-create
            default-first-option
            style="width: 100%"
            placeholder="默认跟随库存单位"
          >
            <el-option v-for="u in unitOptions" :key="u" :label="u" :value="u" />
          </el-select>
        </el-form-item>
        <el-form-item label="测试材料">
              <el-checkbox v-model="productForm.is_test">仅用于试录、培训或演示</el-checkbox>
        </el-form-item>
          </el-collapse-item>
        </el-collapse>
      </el-form>
      <template #footer>
        <el-button @click="showProductDialog = false">取消</el-button>
        <el-button type="primary" @click="saveProduct" :loading="saving">保存</el-button>
      </template>
    </el-dialog>

    <el-drawer
      v-model="movementDrawer"
      :title="movementTitle"
      size="520px"
      destroy-on-close
    >
      <div v-loading="movementLoading" class="movement-list">
        <article v-for="item in movements" :key="item.id" class="movement-card">
          <div class="movement-main">
            <strong>{{ item.movement_label }}</strong>
            <el-tag :type="Number(item.quantity_delta) < 0 ? 'danger' : Number(item.quantity_delta) > 0 ? 'success' : 'info'" size="small">
              {{ formatSignedQty(item.quantity_delta) }} {{ item.unit || selectedProduct?.unit || '' }}
            </el-tag>
          </div>
          <p>{{ item.reason || '库存记录' }}<span v-if="item.project_name"> · {{ item.project_name }}</span></p>
          <p class="movement-stock">库存：{{ formatQty(item.quantity_before) }} → {{ formatQty(item.quantity_after) }}</p>
          <p v-if="item.note" class="movement-note">{{ item.note }}</p>
          <time>{{ item.created_at }}<span v-if="item.operator_name"> · {{ item.operator_name }}</span></time>
        </article>
        <el-empty v-if="!movementLoading && !movements.length" description="暂无库存流水" :image-size="80" />
      </div>
    </el-drawer>

    <el-drawer v-model="stocktakingDrawer" title="盘点导入草稿" size="680px" destroy-on-close>
      <div v-if="stocktakingBatch" class="stocktaking-panel">
        <div class="stocktaking-summary">
          <strong>{{ stocktakingBatch.title || stocktakingBatch.batch_no }}</strong>
          <span>共 {{ stocktakingBatch.metrics?.total || 0 }} 条，已匹配 {{ stocktakingBatch.metrics?.matched || 0 }} 条，未匹配 {{ stocktakingBatch.metrics?.unmatched || 0 }} 条</span>
        </div>
        <el-alert
          v-if="stocktakingBatch.metrics?.unmatched"
          type="warning"
          :closable="false"
          title="还有未匹配的材料，暂不能确认覆盖库存。先核对名称、规格、单位和仓库编码。"
          show-icon
        />
        <el-table :data="stocktakingBatch.items || []" size="small" max-height="430">
          <el-table-column prop="product_name" label="材料" min-width="160" />
          <el-table-column prop="spec" label="规格" width="100" />
          <el-table-column prop="warehouse_code" label="库位" width="110" />
          <el-table-column prop="unit" label="单位" width="80" />
          <el-table-column label="账面/实盘" width="130">
            <template #default="{ row }">{{ formatQty(row.book_quantity) }} / {{ formatQty(row.actual_quantity) }}</template>
          </el-table-column>
          <el-table-column label="匹配" width="90">
            <template #default="{ row }">
              <el-tag :type="row.match_status === 'matched' ? 'success' : 'warning'" size="small">
                {{ row.match_status === 'matched' ? '已匹配' : '待匹配' }}
              </el-tag>
            </template>
          </el-table-column>
        </el-table>
        <div class="drawer-actions">
          <el-button @click="stocktakingDrawer = false">先不确认</el-button>
          <el-button type="primary" :disabled="Boolean(stocktakingBatch.metrics?.unmatched)" :loading="stocktakingConfirming" @click="confirmStocktaking">确认更新库存</el-button>
        </div>
      </div>
      <el-empty v-else description="导入盘点表后会生成草稿" />
    </el-drawer>
  </div>
</template>

<script setup>
import { getAuthToken } from '../../utils/authSession'
import { computed, ref, watch, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import MaterialRequestPanel from '../../components/material/MaterialRequestPanel.vue'

const list = ref([])
const loading = ref(false)
const showProductDialog = ref(false)
const editingId = ref(0)
const saving = ref(false)
const showTestMaterials = ref(true)
const movementDrawer = ref(false)
const movementLoading = ref(false)
const selectedProduct = ref(null)
const movements = ref([])
const productForm = ref(defaultProductForm())
const warehouseOptions = ref({ categories: [], locations: [], areas: [] })
const filters = ref({ query: '', category: '', area: '', stock_status: '', location_status: '' })
const stocktakingInput = ref(null)
const stocktakingImporting = ref(false)
const stocktakingConfirming = ref(false)
const stocktakingDrawer = ref(false)
const stocktakingBatch = ref(null)
const presetCategories = ['诺瓦艺术漆', '本杰明艺术漆', '艺术漆辅料', '基层材料', '工具耗材', '施工工具', '劳保用品', '设备配件', '其他']
const presetUnits = ['kg', 'g', 'ml', 'L', '桶', '罐', '支', '把', '套', '份', '个', '颗', '箱', '卷', '米', '平方']

const userRole = computed(() => {
  try {
    const t = getAuthToken()
    return JSON.parse(atob(t.split('.')[1])).role || ''
  } catch { return '' }
})
const canHandleMaterialRequests = computed(() => ['super_admin', 'admin', 'warehouse'].includes(userRole.value))
const filteredList = computed(() => showTestMaterials.value ? list.value : list.value.filter(item => !item.is_test))
const movementTitle = computed(() => selectedProduct.value ? `${productDisplayName(selectedProduct.value)}｜库存流水` : '库存流水')

const productMemory = computed(() => {
  return list.value
    .map(item => ({
      value: productDisplayName(item),
      name: String(item.name || '').trim(),
      category: item.category || '',
      unit: item.unit || '',
      spec: item.spec || '',
      warehouse_code: item.warehouse_code || '',
      stock: item.stock || 0,
      unit_price: item.unit_price || 0,
      price_unit: item.price_unit || '',
      searchText: productSearchText(item)
    }))
    .filter(item => item.name)
})

const categoryOptions = computed(() => {
  const learned = [
    ...warehouseOptions.value.categories.map(item => item.name || item).filter(Boolean),
    ...list.value.map(item => item.category).filter(Boolean)
  ]
  return [...new Set([...presetCategories, ...learned])]
})

const locationOptions = computed(() => {
  const locations = warehouseOptions.value.locations || []
  return locations
    .filter(item => item?.code)
    .map(item => ({ code: item.code, label: item.label || item.code }))
})

const areaOptions = computed(() => {
  const learned = [
    ...(warehouseOptions.value.areas || []),
    ...locationOptions.value.map(item => String(item.code || '').split('-')[0]).filter(Boolean)
  ]
  return [...new Set(learned)].sort()
})

const unitOptions = computed(() => {
  const learned = list.value.map(item => item.unit).filter(Boolean)
  return [...new Set([...presetUnits, ...learned])]
})

function token() { return getAuthToken() }

function productDisplayName(item) {
  if (item?.display_name) return item.display_name
  const name = String(item?.name || '').trim()
  const spec = String(item?.spec || '').trim()
  if (!spec || name.includes(spec)) return name
  return `${name}${spec}`
}

function productSearchText(item) {
  if (item?.search_text) return item.search_text
  return [productDisplayName(item), item?.name, item?.spec, item?.warehouse_code, item?.category, item?.unit, item?.sku_label]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function defaultProductForm() {
  return { name: '', category: '', spec: '', warehouse_code: '', unit: '桶', unit_price: 0, price_unit: '桶', stock: 0, min_stock: 0, is_test: false }
}

function inventoryLine(row) {
  const unit = row.unit || '单位未填'
  const priceUnit = row.price_unit || unit
  const price = Number(row.unit_price || 0)
  const priceText = price ? `${price.toFixed(2).replace(/\.00$/, '')}/${priceUnit}` : '未填'
  const categoryText = row.category ? `分类：${row.category}` : '分类未填'
  return `仓库单位：${unit}｜当前${formatQty(row.stock)}${unit}/低于${formatQty(row.min_stock)}${unit}提醒｜单价：${priceText}｜${categoryText}`
}

function stockStatusType(row) {
  return Number(row.stock || 0) <= Number(row.min_stock || 0) ? 'danger' : 'success'
}

function stockStatusLabel(row) {
  return stockStatusType(row) === 'danger' ? '库存不足' : '正常'
}

function formatQty(value) {
  const n = Number(value || 0)
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

function formatSignedQty(value) {
  const n = Number(value || 0)
  if (n === 0) return '0'
  return `${n > 0 ? '+' : ''}${formatQty(n)}`
}

async function fetchList() {
  loading.value = true
  try {
    const params = new URLSearchParams()
    Object.entries(filters.value).forEach(([key, value]) => {
      if (value) params.set(key, value)
    })
    params.set('order_by', 'warehouse')
    const res = await fetch(`/api/products?${params}`, {
      headers: { Authorization: `Bearer ${token()}` }
    })
    const json = await res.json()
    if (json.success) list.value = json.data
  } finally {
    loading.value = false
  }
}

async function fetchWarehouseOptions() {
  try {
    const res = await fetch('/api/warehouse/options', {
      headers: { Authorization: `Bearer ${token()}` }
    })
    const json = await res.json()
    if (json.success) warehouseOptions.value = json.data || { categories: [], locations: [], areas: [] }
  } catch {}
}

function openAdd() {
  editingId.value = 0
  productForm.value = defaultProductForm()
  showProductDialog.value = true
}

function openEdit(row) {
  editingId.value = row.id
  productForm.value = {
    name: row.name || '',
    category: row.category || '',
    spec: row.spec || '',
    warehouse_code: row.warehouse_code || '',
    unit: row.unit || '桶',
    unit_price: Number(row.unit_price || 0),
    price_unit: row.price_unit || row.unit || '桶',
    stock: Number(row.stock || 0),
    min_stock: Number(row.min_stock || 0),
    is_test: Boolean(row.is_test)
  }
  showProductDialog.value = true
}

function resetProductDialog() {
  if (showProductDialog.value) return
  editingId.value = 0
  productForm.value = defaultProductForm()
}

async function saveProduct() {
  if (!productForm.value.name) { ElMessage.warning('请输入产品名称'); return }
  saving.value = true
  try {
    const payload = { ...productForm.value, price_unit: productForm.value.price_unit || productForm.value.unit }
    const res = await fetch(editingId.value ? `/api/products/${editingId.value}` : '/api/products', {
      method: editingId.value ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify(payload)
    })
    const json = await res.json()
    if (json.success) {
      ElMessage.success(editingId.value ? '已保存' : '新增成功')
      showProductDialog.value = false
      productForm.value = defaultProductForm()
      fetchList()
    } else {
      ElMessage.error(json.message || '保存失败')
    }
  } finally {
    saving.value = false
  }
}

async function openMovements(row) {
  selectedProduct.value = row
  movementDrawer.value = true
  movementLoading.value = true
  movements.value = []
  try {
    const res = await fetch(`/api/products/${row.id}/movements`, {
      headers: { Authorization: `Bearer ${token()}` }
    })
    const json = await res.json()
    if (json.success) movements.value = json.data || []
    else ElMessage.error(json.message || '库存流水加载失败')
  } catch {
    ElMessage.error('库存流水加载失败')
  } finally {
    movementLoading.value = false
  }
}

function queryProductSuggestions(query, cb) {
  const keyword = String(query || '').trim().toLowerCase()
  const result = productMemory.value
    .filter(item => !keyword || item.searchText.includes(keyword))
    .slice(0, 10)
  cb(result)
}

function applyProductSuggestion(item) {
  productForm.value.name = item.name || item.value
  if (item.category) productForm.value.category = item.category
  if (item.unit) productForm.value.unit = item.unit
  if (item.spec && !productForm.value.spec) productForm.value.spec = item.spec
  if (item.warehouse_code && !productForm.value.warehouse_code) productForm.value.warehouse_code = item.warehouse_code
  if (item.unit_price && !productForm.value.unit_price) productForm.value.unit_price = Number(item.unit_price)
  if (item.price_unit && !productForm.value.price_unit) productForm.value.price_unit = item.price_unit
}

function openStocktakingPicker() {
  stocktakingInput.value?.click()
}

async function onStocktakingFileChange(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
    ElMessage.warning('盘点导入暂支持 Excel 或 CSV')
    return
  }
  stocktakingImporting.value = true
  try {
    const res = await fetch('/api/stocktaking/import-draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({
        title: file.name.replace(/\.[^.]+$/, ''),
        file_name: file.name,
        file_data: await readAsDataUrl(file)
      })
    })
    const json = await res.json()
    if (!json.success) throw new Error(json.message || '盘点导入失败')
    stocktakingBatch.value = json.data
    stocktakingDrawer.value = true
    ElMessage.success('已生成盘点草稿')
  } catch (err) {
    ElMessage.error(err.message || '盘点导入失败')
  } finally {
    stocktakingImporting.value = false
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

async function confirmStocktaking() {
  if (!stocktakingBatch.value?.id) return
  stocktakingConfirming.value = true
  try {
    const res = await fetch(`/api/stocktaking/batches/${stocktakingBatch.value.id}/confirm`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token()}` }
    })
    const json = await res.json()
    if (!json.success) throw new Error(json.message || '确认盘点失败')
    stocktakingBatch.value = json.data
    ElMessage.success('库存已按盘点草稿更新')
    await fetchList()
  } catch (err) {
    ElMessage.error(err.message || '确认盘点失败')
  } finally {
    stocktakingConfirming.value = false
  }
}

watch(() => productForm.value.name, (name) => {
  const exact = productMemory.value.find(item => item.value === name || item.name === name)
  if (!exact) return
  if (exact.category && !productForm.value.category) productForm.value.category = exact.category
  if (exact.unit && !productForm.value.unit) productForm.value.unit = exact.unit
  if (exact.spec && !productForm.value.spec) productForm.value.spec = exact.spec
  if (exact.warehouse_code && !productForm.value.warehouse_code) productForm.value.warehouse_code = exact.warehouse_code
  if (exact.unit_price && !productForm.value.unit_price) productForm.value.unit_price = Number(exact.unit_price)
  if (exact.price_unit && !productForm.value.price_unit) productForm.value.price_unit = exact.price_unit
})

watch(() => productForm.value.unit, (unit, oldUnit) => {
  if (!productForm.value.price_unit || productForm.value.price_unit === oldUnit) {
    productForm.value.price_unit = unit || '桶'
  }
})

async function handleDelete(row) {
  try {
    await ElMessageBox.confirm(`确定删除「${row.name}」？`, '提示')
    await fetch(`/api/products/${row.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token()}` }
    })
    ElMessage.success('已删除')
    fetchList()
  } catch {}
}

onMounted(() => {
  fetchWarehouseOptions()
  fetchList()
})
</script>

<style scoped>
.product-suggestion {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.header-actions,
.product-name-cell,
.movement-main {
  display: flex;
  align-items: center;
  gap: 10px;
}

.header-actions {
  justify-content: flex-end;
}

.warehouse-filters {
  display: grid;
  grid-template-columns: minmax(220px, 1.4fr) repeat(4, minmax(130px, 0.8fr)) auto;
  gap: 10px;
  margin: 16px 0;
}

.product-name-cell {
  flex-wrap: wrap;
}

.product-title-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.product-name-cell strong,
.stock-cell strong {
  display: block;
  color: var(--text-primary);
  font-weight: 800;
}

.product-name-cell p,
.stock-cell span,
.field-hint {
  margin: 3px 0 0;
  color: var(--text-tertiary);
  font-size: 12px;
}

.product-name-cell .inventory-line {
  display: inline-flex;
  align-items: center;
  margin-top: 6px;
  padding: 4px 8px;
  border-radius: var(--radius-xs);
  background: color-mix(in srgb, #2563eb 7%, var(--bg-card));
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 700;
  line-height: 1.5;
}

.muted-text {
  color: var(--text-tertiary);
  font-size: 12px;
}

.stock-cell {
  display: grid;
  gap: 2px;
}

.product-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 14px;
}

.inline-fields {
  display: flex;
  width: 100%;
  gap: 8px;
  align-items: center;
}

.unit-suffix {
  flex: 0 0 auto;
  color: var(--text-secondary);
  font-size: 13px;
  white-space: nowrap;
}

.advanced-collapse {
  margin-top: 4px;
}

.hidden-input {
  display: none;
}

.stocktaking-panel {
  display: grid;
  gap: 14px;
}

.stocktaking-summary {
  display: grid;
  gap: 4px;
  color: var(--text-secondary);
}

.stocktaking-summary strong {
  color: var(--text-primary);
  font-size: 16px;
}

.drawer-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.movement-list {
  display: grid;
  gap: 10px;
}

.movement-card {
  padding: 12px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
}

.movement-main {
  justify-content: space-between;
}

.movement-card p {
  margin: 6px 0 0;
  color: var(--text-secondary);
  font-size: 13px;
}

.movement-card time {
  display: block;
  margin-top: 8px;
  color: var(--text-tertiary);
  font-size: 12px;
}

.movement-stock {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.product-suggestion strong {
  color: var(--text-primary);
  font-weight: 700;
}

.product-suggestion span {
  color: var(--text-tertiary);
  font-size: 12px;
}

@media (max-width: 760px) {
  .product-form-grid,
  .page-header,
  .header-actions,
  .warehouse-filters {
    display: grid;
    min-width: 0;
  }

  .inline-fields {
    display: grid;
  }
}
</style>
