<template>
  <div class="page">
    <el-card class="page-card">
      <div class="page-header">
        <div>
          <h2>用户管理</h2>
          <p class="page-desc">管理系统用户和角色分配</p>
        </div>
        <el-button type="primary" @click="showAdd = true">+ 新增用户</el-button>
      </div>

      <el-table :data="list" stripe v-loading="loading" style="width: 100%">
        <el-table-column prop="id" label="ID" width="60" />
        <el-table-column prop="username" label="账号" min-width="140" />
        <el-table-column label="角色" width="160">
          <template #default="{ row }">
            <el-tag :type="row.role === 'super_admin' ? 'danger' : row.role === 'finance' ? 'warning' : row.role === 'warehouse' ? 'primary' : 'info'" size="small">
              {{ row.role_label || row.role }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="创建时间" width="160" />
        <el-table-column label="操作" width="200">
          <template #default="{ row }">
            <el-button v-if="row.username !== 'fuyulnk'" link size="small" @click="editRole(row)">分配角色</el-button>
            <el-button v-if="row.username !== 'fuyulnk'" type="danger" link size="small" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 新增用户 -->
    <el-dialog v-model="showAdd" title="新增用户" width="380px">
      <el-form :model="addForm" label-width="60px">
        <el-form-item label="账号">
          <el-input v-model="addForm.username" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="addForm.password" type="password" show-password />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="addForm.role" style="width: 100%">
            <el-option v-for="r in roles" :key="r.id" :label="r.label" :value="r.name" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAdd = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleAdd">确定</el-button>
      </template>
    </el-dialog>

    <!-- 分配角色 -->
    <el-dialog v-model="showRole" title="分配角色" width="380px">
      <p>用户：<strong>{{ editingUser?.username }}</strong></p>
      <el-select v-model="selectedRole" style="width: 100%">
        <el-option v-for="r in roles" :key="r.id" :label="r.label" :value="r.name" />
      </el-select>
      <template #footer>
        <el-button @click="showRole = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleAssignRole">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

const list = ref([])
const roles = ref([])
const loading = ref(false)
const showAdd = ref(false)
const showRole = ref(false)
const saving = ref(false)
const editingUser = ref(null)
const selectedRole = ref('')
const addForm = ref({ username: '', password: '', role: 'employee' })

function token() { return localStorage.getItem('token') }

async function fetchList() {
  loading.value = true
  try {
    const [uRes, rRes] = await Promise.all([
      fetch('/api/users', { headers: { Authorization: `Bearer ${token()}` } }),
      fetch('/api/roles', { headers: { Authorization: `Bearer ${token()}` } })
    ])
    const uj = await uRes.json()
    const rj = await rRes.json()
    if (uj.success) list.value = uj.data
    if (rj.success) roles.value = rj.data
  } finally {
    loading.value = false
  }
}

async function handleAdd() {
  if (!addForm.value.username || !addForm.value.password) {
    ElMessage.warning('请填写账号和密码')
    return
  }
  saving.value = true
  try {
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify(addForm.value)
    })
    const json = await res.json()
    if (json.success) {
      ElMessage.success('新增成功')
      showAdd.value = false
      addForm.value = { username: '', password: '', role: 'employee' }
      fetchList()
    } else {
      ElMessage.error(json.message)
    }
  } finally {
    saving.value = false
  }
}

function editRole(row) {
  editingUser.value = row
  selectedRole.value = row.role
  showRole.value = true
}

async function handleAssignRole() {
  saving.value = true
  try {
    const res = await fetch(`/api/users/${editingUser.value.id}/role`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({ role: selectedRole.value })
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      ElMessage.error(err.message || '操作失败')
      return
    }
    ElMessage.success('角色已更新')
    showRole.value = false
    fetchList()
  } finally {
    saving.value = false
  }
}

async function handleDelete(row) {
  try {
    await ElMessageBox.confirm(`确定删除用户「${row.username}」？`, '提示')
    await fetch(`/api/users/${row.id}`, {
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
