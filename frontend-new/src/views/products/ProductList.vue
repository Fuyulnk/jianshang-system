<template>
  <div class="page">
    <el-card class="page-card">
      <div class="page-header">
        <div>
          <h2>产品库存</h2>
          <p class="page-desc">按“产品｜规格/包装｜库存单位｜当前库存”管理仓库物料</p>
        </div>
        <div class="header-actions">
          <el-checkbox v-model="showTestMaterials">显示测试材料</el-checkbox>
          <el-button type="primary" @click="showAdd = true">+ 新增产品</el-button>
        </div>
      </div>

      <el-table :data="filteredList" stripe v-loading="loading" style="width: 100%">
        <el-table-column prop="id" label="ID" width="60" />
        <el-table-column label="产品名称" min-width="180">
          <template #default="{ row }">
            <div class="product-name-cell">
              <span>{{ productDisplayName(row) }}</span>
              <el-tag v-if="row.is_test" size="small" type="info">测试材料</el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="category" label="分类" width="120" />
        <el-table-column prop="spec" label="规格/包装" width="120" />
        <el-table-column prop="unit" label="库存单位" width="90" />
        <el-table-column label="单价" width="110">
          <template #default="{ row }">￥{{ Number(row.unit_price || 0).toFixed(2) }}</template>
        </el-table-column>
        <el-table-column prop="price_unit" label="计价单位" width="90" />
        <el-table-column label="当前库存" width="120">
          <template #default="{ row }">{{ formatQty(row.stock) }} {{ row.unit || '' }}</template>
        </el-table-column>
        <el-table-column label="最低库存" width="120">
          <template #default="{ row }">{{ formatQty(row.min_stock) }} {{ row.unit || '' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag v-if="row.stock <= row.min_stock" type="danger" size="small">库存不足</el-tag>
            <el-tag v-else type="success" size="small">正常</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150">
          <template #default="{ row }">
            <el-button type="primary" link size="small" @click="openMovements(row)">流水</el-button>
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

    <el-dialog v-model="showAdd" title="新增产品" width="460px">
      <el-form :model="addForm" label-width="96px">
        <el-form-item label="产品名称">
          <el-autocomplete
            v-model="addForm.name"
            :fetch-suggestions="queryProductSuggestions"
            clearable
            style="width: 100%"
            placeholder="输入或选择曾录入的产品"
            @select="applyProductSuggestion"
          >
            <template #default="{ item }">
              <div class="product-suggestion">
                <strong>{{ item.value }}</strong>
                <span>{{ item.unit || '单位未填' }}｜库存 {{ formatQty(item.stock) }}</span>
              </div>
            </template>
          </el-autocomplete>
        </el-form-item>
        <el-form-item label="分类">
          <el-select
            v-model="addForm.category"
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
        <el-form-item label="库存单位">
          <el-select
            v-model="addForm.unit"
            filterable
            allow-create
            default-first-option
            style="width: 100%"
            placeholder="如 桶、箱、支"
          >
            <el-option v-for="u in unitOptions" :key="u" :label="u" :value="u" />
          </el-select>
        </el-form-item>
        <el-form-item label="规格/包装">
          <el-input v-model="addForm.spec" placeholder="如 5L、20kg/袋、1kg/桶" />
        </el-form-item>
        <el-form-item label="单价">
          <el-input-number v-model="addForm.unit_price" :min="0" :precision="2" style="width: 100%" />
        </el-form-item>
        <el-form-item label="计价单位">
          <el-select
            v-model="addForm.price_unit"
            filterable
            allow-create
            default-first-option
            style="width: 100%"
            placeholder="如 桶、L、kg"
          >
            <el-option v-for="u in unitOptions" :key="u" :label="u" :value="u" />
          </el-select>
        </el-form-item>
        <el-form-item label="当前库存">
          <el-input-number v-model="addForm.stock" :min="0" style="width: 100%" />
        </el-form-item>
        <el-form-item label="最低库存">
          <el-input-number v-model="addForm.min_stock" :min="0" style="width: 100%" />
        </el-form-item>
        <el-form-item label="测试材料">
          <el-checkbox v-model="addForm.is_test">仅用于试录、培训或演示</el-checkbox>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAdd = false">取消</el-button>
        <el-button type="primary" @click="handleAdd" :loading="saving">确定</el-button>
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
  </div>
</template>

<script setup>
import { getAuthToken } from '../../utils/authSession'
import { computed, ref, watch, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import MaterialRequestPanel from '../../components/material/MaterialRequestPanel.vue'

const list = ref([])
const loading = ref(false)
const showAdd = ref(false)
const saving = ref(false)
const showTestMaterials = ref(true)
const movementDrawer = ref(false)
const movementLoading = ref(false)
const selectedProduct = ref(null)
const movements = ref([])
const addForm = ref(defaultProductForm())
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
      stock: item.stock || 0,
      unit_price: item.unit_price || 0,
      price_unit: item.price_unit || '',
      searchText: productSearchText(item)
    }))
    .filter(item => item.name)
})

const categoryOptions = computed(() => {
  const learned = list.value.map(item => item.category).filter(Boolean)
  return [...new Set([...presetCategories, ...learned])]
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
  return [productDisplayName(item), item?.name, item?.spec, item?.category, item?.unit, item?.sku_label]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function defaultProductForm() {
  return { name: '', category: '', spec: '', unit: '桶', unit_price: 0, price_unit: '桶', stock: 0, min_stock: 0, is_test: false }
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
    const res = await fetch('/api/products', {
      headers: { Authorization: `Bearer ${token()}` }
    })
    const json = await res.json()
    if (json.success) list.value = json.data
  } finally {
    loading.value = false
  }
}

async function handleAdd() {
  if (!addForm.value.name) { ElMessage.warning('请输入产品名称'); return }
  saving.value = true
  try {
    const res = await fetch('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify(addForm.value)
    })
    const json = await res.json()
    if (json.success) {
      ElMessage.success('新增成功')
      showAdd.value = false
      addForm.value = defaultProductForm()
      fetchList()
    } else {
      ElMessage.error(json.message || '新增失败')
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
  addForm.value.name = item.name || item.value
  if (item.category) addForm.value.category = item.category
  if (item.unit) addForm.value.unit = item.unit
  if (item.spec && !addForm.value.spec) addForm.value.spec = item.spec
  if (item.unit_price && !addForm.value.unit_price) addForm.value.unit_price = Number(item.unit_price)
  if (item.price_unit && !addForm.value.price_unit) addForm.value.price_unit = item.price_unit
}

watch(() => addForm.value.name, (name) => {
  const exact = productMemory.value.find(item => item.value === name || item.name === name)
  if (!exact) return
  if (exact.category && !addForm.value.category) addForm.value.category = exact.category
  if (exact.unit && !addForm.value.unit) addForm.value.unit = exact.unit
  if (exact.spec && !addForm.value.spec) addForm.value.spec = exact.spec
  if (exact.unit_price && !addForm.value.unit_price) addForm.value.unit_price = Number(exact.unit_price)
  if (exact.price_unit && !addForm.value.price_unit) addForm.value.price_unit = exact.price_unit
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

onMounted(fetchList)
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

.product-name-cell {
  flex-wrap: wrap;
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
</style>
