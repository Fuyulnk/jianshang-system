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
        <el-table-column prop="unit" label="单位" width="80" />
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

const list = ref([])
const loading = ref(false)
const showAdd = ref(false)
const saving = ref(false)
const addForm = ref({ name: '', category: '', unit: 'kg', stock: 0, min_stock: 0 })
const presetCategories = ['诺瓦艺术漆', '本杰明艺术漆', '艺术漆辅料', '基层材料', '工具耗材', '施工工具', '劳保用品', '设备配件', '其他']
const presetUnits = ['kg', 'g', 'ml', 'L', '桶', '罐', '支', '把', '套', '份', '个', '颗', '箱', '卷', '米', '平方']

const productMemory = computed(() => {
  const map = new Map()
  for (const item of list.value) {
    const name = String(item.name || '').trim()
    if (!name) continue
    if (!map.has(name)) map.set(name, { value: name, categories: new Set(), units: new Set() })
    const memory = map.get(name)
    if (item.category) memory.categories.add(item.category)
    if (item.unit) memory.units.add(item.unit)
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
      addForm.value = { name: '', category: '', unit: 'kg', stock: 0, min_stock: 0 }
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
}

watch(() => addForm.value.name, (name) => {
  const exact = productMemory.value.find(item => item.value === name)
  if (!exact) return
  if (exact.categories.length === 1 && !addForm.value.category) addForm.value.category = exact.categories[0]
  if (exact.units.length === 1 && !addForm.value.unit) addForm.value.unit = exact.units[0]
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
