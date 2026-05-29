<template>
  <div class="page">
    <el-card class="page-card">
      <div class="page-header">
        <div>
          <h2>员工管理</h2>
          <p class="page-desc">管理员工信息和在职状态</p>
        </div>
        <el-button type="primary" @click="showAdd = true">+ 新增员工</el-button>
      </div>

      <!-- 骨架屏 -->
      <el-skeleton v-if="loading" :rows="5" animated class="table-skeleton" />

      <el-table v-show="!loading" :data="list" stripe style="width: 100%">
        <el-table-column label="员工ID" width="90">
          <template #default="{ row }">
            <span class="emp-code" @click="copyCode(row.employee_code)" title="点击复制员工ID">
              <span class="emp-code-text">{{ row.employee_code?.replace(/^(.{4}).*/, '$1···') }}</span>
              <el-icon class="copy-icon"><CopyDocument /></el-icon>
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="name" label="姓名" min-width="100" />
        <el-table-column prop="department" label="部门" min-width="120" />
        <el-table-column prop="position" label="职位" min-width="120" />
        <el-table-column prop="phone" label="手机号" width="130" />
        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small">
              {{ row.status === 'active' ? '在职' : '离职' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="80">
          <template #default="{ row }">
            <el-button type="danger" link size="small" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="showAdd" title="新增员工" width="400px">
      <el-form :model="addForm" label-width="70px">
        <el-form-item label="姓名">
          <el-input v-model="addForm.name" />
        </el-form-item>
        <el-form-item label="部门">
          <el-input v-model="addForm.department" />
        </el-form-item>
        <el-form-item label="职位">
          <el-input v-model="addForm.position" />
        </el-form-item>
        <el-form-item label="手机号">
          <el-input v-model="addForm.phone" />
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
import { CopyDocument } from '@element-plus/icons-vue'

const list = ref([])
const loading = ref(false)
const showAdd = ref(false)
const saving = ref(false)
const addForm = ref({ name: '', department: '', position: '', phone: '' })

function token() { return localStorage.getItem('token') }

async function fetchList() {
  loading.value = true
  try {
    const res = await fetch('/api/employees', {
      headers: { Authorization: `Bearer ${token()}` }
    })
    const json = await res.json()
    if (json.success) list.value = json.data
  } finally {
    loading.value = false
  }
}

async function handleAdd() {
  if (!addForm.value.name) { ElMessage.warning('请输入员工姓名'); return }
  saving.value = true
  try {
    const res = await fetch('/api/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify(addForm.value)
    })
    const json = await res.json()
    if (json.success) {
      ElMessage.success('新增成功')
      showAdd.value = false
      addForm.value = { name: '', department: '', position: '', phone: '' }
      fetchList()
    }
  } finally {
    saving.value = false
  }
}

async function handleDelete(row) {
  try {
    await ElMessageBox.confirm(`确定删除「${row.name}」？`, '提示')
    await fetch(`/api/employees/${row.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token()}` }
    })
    ElMessage.success('已删除')
    fetchList()
  } catch {}
}

function copyCode(code) {
  try {
    navigator.clipboard.writeText(code)
    ElMessage.success('已复制：' + code)
  } catch {
    ElMessage.warning('复制失败，请手动复制')
  }
}

onMounted(fetchList)
</script>

<style scoped>
.emp-code {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: background 0.15s;
  user-select: none;
}
.emp-code:hover {
  background: rgba(128,128,128,0.08);
}
.emp-code-text {
  font-size: 12px;
  color: var(--text-tertiary);
  letter-spacing: 0.5px;
}
.copy-icon {
  font-size: 12px;
  color: var(--text-tertiary);
  opacity: 0;
  transition: opacity 0.15s;
}
.emp-code:hover .copy-icon {
  opacity: 1;
}
.table-skeleton {
  padding: 16px 0;
}
</style>
