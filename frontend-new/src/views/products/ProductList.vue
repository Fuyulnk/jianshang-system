<template>
  <div class="page">
    <el-card class="page-card">
      <div class="page-header">
        <div>
          <h2>产品库存</h2>
          <p class="page-desc">管理产品信息和库存数量</p>
        </div>
        <el-button type="primary" @click="showAdd = true">+ 新增产品</el-button>
      </div>

      <el-table :data="list" stripe v-loading="loading" style="width: 100%">
        <el-table-column prop="id" label="ID" width="60" />
        <el-table-column prop="name" label="产品名称" min-width="140" />
        <el-table-column prop="category" label="分类" width="120" />
        <el-table-column prop="spec" label="规格" width="110" />
        <el-table-column prop="unit" label="单位" width="80" />
        <el-table-column label="单价" width="110">
          <template #default="{ row }">￥{{ Number(row.unit_price || 0).toFixed(2) }}</template>
        </el-table-column>
        <el-table-column prop="price_unit" label="计价单位" width="90" />
        <el-table-column prop="stock" label="库存" width="100" />
        <el-table-column prop="min_stock" label="最低库存" width="100" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag v-if="row.stock <= row.min_stock" type="danger" size="small">库存不足</el-tag>
            <el-tag v-else type="success" size="small">正常</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120">
          <template #default="{ row }">
            <el-button type="danger" link size="small" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <MaterialRequestPanel
      v-if="canHandleMaterialRequests"
      mode="warehouse"
      title="待处理出库申请"
      @updated="fetchList"
    />

    <el-dialog v-model="showAdd" title="新增产品" width="400px">
      <el-form :model="addForm" label-width="80px">
        <el-form-item label="产品名称">
          <el-autocomplete
            v-model="addForm.name"
            :fetch-suggestions="queryProductSuggestions"
            clearable
            style="width: 100%"
            placeholder="输入或选择曾录入的产品"
            @select="applyProductSuggestion"
          />
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
        <el-form-item label="单位">
          <el-select
            v-model="addForm.unit"
            filterable
            allow-create
            default-first-option
            style="width: 100%"
            placeholder="选择或输入单位"
          >
            <el-option v-for="u in unitOptions" :key="u" :label="u" :value="u" />
          </el-select>
        </el-form-item>
        <el-form-item label="规格">
          <el-input v-model="addForm.spec" placeholder="如 1kg/桶、500ml" />
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
            placeholder="如 kg、L、个"
          >
            <el-option v-for="u in unitOptions" :key="u" :label="u" :value="u" />
          </el-select>
        </el-form-item>
        <el-form-item label="库存">
          <el-input-number v-model="addForm.stock" :min="0" style="width: 100%" />
        </el-form-item>
        <el-form-item label="最低库存">
          <el-input-number v-model="addForm.min_stock" :min="0" style="width: 100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAdd = false">取消</el-button>
        <el-button type="primary" @click="handleAdd" :loading="saving">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, ref, watch, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import MaterialRequestPanel from '../../components/material/MaterialRequestPanel.vue'

const list = ref([])
const loading = ref(false)
const showAdd = ref(false)
const saving = ref(false)
const addForm = ref({ name: '', category: '', spec: '', unit: 'kg', unit_price: 0, price_unit: 'kg', stock: 0, min_stock: 0 })
const presetCategories = ['诺瓦艺术漆', '本杰明艺术漆', '艺术漆辅料', '基层材料', '工具耗材', '施工工具', '劳保用品', '设备配件', '其他']
const presetUnits = ['kg', 'g', 'ml', 'L', '桶', '罐', '支', '把', '套', '份', '个', '颗', '箱', '卷', '米', '平方']

const userRole = computed(() => {
  try {
    const t = localStorage.getItem('token')
    return JSON.parse(atob(t.split('.')[1])).role || ''
  } catch { return '' }
})
const canHandleMaterialRequests = computed(() => ['super_admin', 'admin', 'warehouse'].includes(userRole.value))

const productMemory = computed(() => {
  const map = new Map()
  for (const item of list.value) {
    const name = String(item.name || '').trim()
    if (!name) continue
    if (!map.has(name)) map.set(name, { value: name, categories: new Set(), units: new Set() })
    const memory = map.get(name)
    if (item.category) memory.categories.add(item.category)
    if (item.unit) memory.units.add(item.unit)
    if (item.spec) memory.spec = item.spec
    if (item.unit_price) memory.unit_price = item.unit_price
    if (item.price_unit) memory.price_unit = item.price_unit
  }
  return [...map.values()].map(item => ({
    value: item.value,
    categories: [...item.categories],
    units: [...item.units],
    categoryText: [...item.categories].join(' / '),
  }))
})

const categoryOptions = computed(() => {
  const learned = list.value.map(item => item.category).filter(Boolean)
  return [...new Set([...presetCategories, ...learned])]
})

const unitOptions = computed(() => {
  const learned = list.value.map(item => item.unit).filter(Boolean)
  return [...new Set([...presetUnits, ...learned])]
})

function token() { return localStorage.getItem('token') }

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
      addForm.value = { name: '', category: '', spec: '', unit: 'kg', unit_price: 0, price_unit: 'kg', stock: 0, min_stock: 0 }
      fetchList()
    }
  } finally {
    saving.value = false
  }
}

function queryProductSuggestions(query, cb) {
  const keyword = String(query || '').trim().toLowerCase()
  const result = productMemory.value
    .filter(item => !keyword || item.value.toLowerCase().includes(keyword))
    .slice(0, 10)
  cb(result)
}

function applyProductSuggestion(item) {
  addForm.value.name = item.value
  if (item.categories.length === 1) addForm.value.category = item.categories[0]
  if (item.units.length === 1) addForm.value.unit = item.units[0]
  if (item.spec && !addForm.value.spec) addForm.value.spec = item.spec
  if (item.unit_price && !addForm.value.unit_price) addForm.value.unit_price = Number(item.unit_price)
  if (item.price_unit && !addForm.value.price_unit) addForm.value.price_unit = item.price_unit
}

watch(() => addForm.value.name, (name) => {
  const exact = productMemory.value.find(item => item.value === name)
  if (!exact) return
  if (exact.categories.length === 1 && !addForm.value.category) addForm.value.category = exact.categories[0]
  if (exact.units.length === 1 && !addForm.value.unit) addForm.value.unit = exact.units[0]
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
</style>
