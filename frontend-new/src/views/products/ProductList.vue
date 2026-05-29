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
          <el-input v-model="addForm.name" />
        </el-form-item>
        <el-form-item label="分类">
          <el-input v-model="addForm.category" />
        </el-form-item>
        <el-form-item label="单位">
          <el-input v-model="addForm.unit" placeholder="如：kg、个、箱" />
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
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

const list = ref([])
const loading = ref(false)
const showAdd = ref(false)
const saving = ref(false)
const addForm = ref({ name: '', category: '', unit: 'kg', stock: 0, min_stock: 0 })

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
