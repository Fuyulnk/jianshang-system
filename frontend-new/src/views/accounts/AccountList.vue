<template>
  <div class="accounts-page">
    <el-card class="page-card">
      <div class="page-header">
        <div>
          <h2>账户管理</h2>
          <p class="page-desc">管理所有个人和公司账户</p>
        </div>
        <el-button type="primary" @click="showAdd = true">+ 新增账户</el-button>
      </div>

      <!-- 骨架屏 -->
      <el-skeleton v-if="loading" :rows="6" animated class="table-skeleton" />

      <!-- 表格 -->
      <el-table v-show="!loading" :data="list" stripe style="width: 100%">
        <el-table-column prop="id" label="ID" width="60" />
        <el-table-column prop="name" label="账户名称" min-width="160" />
        <el-table-column prop="type" label="类型" width="100">
          <template #default="{ row }">
            <el-tag :type="row.type === 'company' ? 'primary' : 'success'" size="small">
              {{ row.type === 'company' ? '公司' : '个人' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="initial_balance" label="初始余额" width="120" />
        <el-table-column prop="current_balance" label="当前余额" width="120" />
        <el-table-column label="操作" width="120">
          <template #default="{ row }">
            <el-button type="danger" link size="small" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 新增弹窗 -->
    <el-dialog v-model="showAdd" title="新增账户" width="400px">
      <el-form :model="addForm" label-width="80px">
        <el-form-item label="账户名称">
          <el-input v-model="addForm.name" placeholder="请输入" />
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="addForm.type" style="width: 100%">
            <el-option label="个人" value="personal" />
            <el-option label="公司" value="company" />
          </el-select>
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
import { getAuthToken } from '../../utils/authSession'
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

const list = ref([])
const loading = ref(false)
const showAdd = ref(false)
const saving = ref(false)
const addForm = ref({ name: '', type: 'personal' })

function token() { return getAuthToken() }

async function fetchList() {
  loading.value = true
  try {
    const res = await fetch('/api/accounts', {
      headers: { Authorization: `Bearer ${token()}` }
    })
    const json = await res.json()
    if (json.success) list.value = json.data
  } finally {
    loading.value = false
  }
}

async function handleAdd() {
  if (!addForm.value.name) {
    ElMessage.warning('请输入账户名称')
    return
  }
  saving.value = true
  try {
    const res = await fetch('/api/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify(addForm.value)
    })
    const json = await res.json()
    if (json.success) {
      ElMessage.success('新增成功')
      showAdd.value = false
      addForm.value = { name: '', type: 'personal' }
      fetchList()
    }
  } finally {
    saving.value = false
  }
}

async function handleDelete(row) {
  try {
    await ElMessageBox.confirm(`确定删除「${row.name}」？`, '提示')
    const res = await fetch(`/api/accounts/${row.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token()}` }
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      ElMessage.error(err.message || '删除失败')
      return
    }
    ElMessage.success('已删除')
    fetchList()
  } catch {} // 取消删除
}

onMounted(fetchList)
</script>

<style scoped>
.table-skeleton {
  padding: 16px 0;
}
</style>
