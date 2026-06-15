<template>
  <div class="page">
    <el-card class="page-card">
      <div class="page-header">
        <div>
          <h2>员工管理</h2>
          <p class="page-desc">管理员工档案、员工ID和在职状态；权限角色仍在系统设置的用户管理里发放。</p>
        </div>
        <el-button type="primary" @click="showAdd = true">+ 新增员工档案</el-button>
      </div>

      <div v-if="pendingUsers.length" class="pending-panel">
        <div class="pending-head">
          <div>
            <h3>待建档账号</h3>
            <p>这些账号已经注册成功，但还没有员工ID。生成档案后，才能在项目归属和权限分配里稳定识别。</p>
          </div>
          <el-tag type="warning">{{ pendingUsers.length }} 个待处理</el-tag>
        </div>
        <el-table :data="pendingUsers" size="small" border class="pending-table">
          <el-table-column prop="username" label="登录账号" min-width="120" />
          <el-table-column label="姓名" min-width="120">
            <template #default="{ row }">{{ row.real_name || '未填写' }}</template>
          </el-table-column>
          <el-table-column label="角色" width="110">
            <template #default="{ row }">{{ row.role_label || row.role }}</template>
          </el-table-column>
          <el-table-column label="部门" min-width="120">
            <template #default="{ row }">{{ row.department || '未填写' }}</template>
          </el-table-column>
          <el-table-column label="职位" min-width="120">
            <template #default="{ row }">{{ row.position || '未填写' }}</template>
          </el-table-column>
          <el-table-column label="手机号" min-width="130">
            <template #default="{ row }">{{ row.phone || '未填写' }}</template>
          </el-table-column>
          <el-table-column label="注册时间" width="160">
            <template #default="{ row }">{{ formatDate(row.created_at) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="130" fixed="right">
            <template #default="{ row }">
              <el-button
                type="primary"
                link
                size="small"
                :loading="bindingId === row.id"
                @click="createEmployeeFromUser(row)"
              >
                生成员工档案
              </el-button>
            </template>
          </el-table-column>
        </el-table>
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
        <el-table-column label="绑定账号" min-width="120">
          <template #default="{ row }">
            <el-tag v-if="row.bound_username" size="small" type="success">{{ row.bound_username }}</el-tag>
            <span v-else class="muted">未绑定</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small">
              {{ row.status === 'active' ? '在职' : '离职' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120">
          <template #default="{ row }">
            <el-button v-if="canManage" type="primary" link size="small" @click="openEdit(row)">编辑</el-button>
            <el-button v-if="canManage" type="danger" link size="small" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="showAdd" title="新增员工档案" width="420px">
      <p class="dialog-tip">这里创建的是员工档案，不是登录账号。已有注册账号请在上方“待建档账号”里生成档案。</p>
      <el-form :model="addForm" label-width="70px">
        <el-form-item label="姓名">
          <el-input v-model="addForm.name" />
        </el-form-item>
        <el-form-item label="部门职位">
          <el-cascader
            v-model="addForm.departmentPosition"
            class="employee-cascader"
            :options="orgOptions"
            :props="cascaderProps"
            placeholder="选择部门 / 职位"
            clearable
          />
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

    <el-dialog v-model="showEdit" title="编辑员工档案" width="420px">
      <el-form :model="editForm" label-width="70px">
        <el-form-item label="姓名">
          <el-input v-model="editForm.name" />
        </el-form-item>
        <el-form-item label="部门职位">
          <el-cascader
            v-model="editForm.departmentPosition"
            class="employee-cascader"
            :options="orgOptions"
            :props="cascaderProps"
            placeholder="选择部门 / 职位"
            clearable
          />
        </el-form-item>
        <el-form-item label="手机号">
          <el-input v-model="editForm.phone" />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="editForm.status" style="width: 100%">
            <el-option label="在职" value="active" />
            <el-option label="离职" value="inactive" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEdit = false">取消</el-button>
        <el-button type="primary" @click="handleEdit" :loading="saving">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { getAuthToken } from '../../utils/authSession'
import { toDepartmentCascaderOptions } from '../../utils/orgOptions'
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { CopyDocument } from '@element-plus/icons-vue'

const list = ref([])
const pendingUsers = ref([])
const loading = ref(false)
const showAdd = ref(false)
const showEdit = ref(false)
const saving = ref(false)
const bindingId = ref(0)
const addForm = ref({ name: '', departmentPosition: [], phone: '' })
const editForm = ref({ id: 0, name: '', departmentPosition: [], phone: '', status: 'active' })
const orgOptions = ref(toDepartmentCascaderOptions())
const cascaderProps = { value: 'value', label: 'label', children: 'children', expandTrigger: 'hover' }

const currentRole = computed(() => {
  try {
    const token = getAuthToken() || ''
    const payload = JSON.parse(atob(token.split('.')[1]))
    return payload.role || ''
  } catch { return '' }
})
const canManage = computed(() => ['super_admin', 'admin'].includes(currentRole.value))

function token() { return getAuthToken() }

async function fetchList() {
  loading.value = true
  try {
    const [employeeJson, pendingJson, orgJson] = await Promise.all([
      requestJson('/api/employees'),
      requestJson('/api/employees/pending-users'),
      requestJson('/api/employees/org-options')
    ])
    if (employeeJson.success) list.value = employeeJson.data || []
    if (pendingJson.success) pendingUsers.value = pendingJson.data || []
    if (orgJson.success) orgOptions.value = toDepartmentCascaderOptions(orgJson.data)
    if (!employeeJson.success) ElMessage.error(employeeJson.message || '员工列表加载失败')
  } finally {
    loading.value = false
  }
}

async function requestJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token()}`
    }
  })
  return res.json()
}

async function handleAdd() {
  if (!addForm.value.name) { ElMessage.warning('请输入员工姓名'); return }
  const payload = employeePayload(addForm.value)
  if (!payload) return
  saving.value = true
  try {
    const res = await fetch('/api/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify(payload)
    })
    const json = await res.json()
    if (json.success) {
      ElMessage.success('新增成功')
      showAdd.value = false
      addForm.value = { name: '', departmentPosition: [], phone: '' }
      fetchList()
    } else {
      ElMessage.error(json.message || '新增失败')
    }
  } finally {
    saving.value = false
  }
}

function openEdit(row) {
  editForm.value = {
    id: row.id,
    name: row.name || '',
    departmentPosition: row.department && row.position ? [row.department, row.position] : [],
    phone: row.phone || '',
    status: row.status || 'active'
  }
  showEdit.value = true
}

async function handleEdit() {
  const payload = employeePayload(editForm.value)
  if (!payload) return
  saving.value = true
  try {
    const res = await fetch(`/api/employees/${editForm.value.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({ ...payload, status: editForm.value.status || 'active' })
    })
    const json = await res.json()
    if (json.success) {
      ElMessage.success('员工档案已更新')
      showEdit.value = false
      fetchList()
    } else {
      ElMessage.error(json.message || '保存失败')
    }
  } finally {
    saving.value = false
  }
}

function employeePayload(form) {
  const [department, position] = form.departmentPosition || []
  if (!form.name) {
    ElMessage.warning('请输入员工姓名')
    return null
  }
  if (!department || !position) {
    ElMessage.warning('请选择部门和职位')
    return null
  }
  return {
    name: form.name,
    department,
    position,
    phone: form.phone || ''
  }
}

async function createEmployeeFromUser(row) {
  bindingId.value = row.id
  try {
    const json = await requestJson(`/api/employees/from-user/${row.id}`, { method: 'POST' })
    if (json.success) {
      ElMessage.success(`已生成员工档案：${json.employee_code}`)
      fetchList()
    } else {
      ElMessage.error(json.message || '生成员工档案失败')
    }
  } finally {
    bindingId.value = 0
  }
}

async function handleDelete(row) {
  try {
    await ElMessageBox.confirm(`确定删除「${row.name}」？`, '提示')
    const res = await fetch(`/api/employees/${row.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token()}` }
    })
    const json = await res.json()
    if (json.success) {
      ElMessage.success('已删除')
      fetchList()
    } else {
      ElMessage.error(json.message || '删除失败')
    }
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

function formatDate(value) {
  if (!value) return '未记录'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
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
.pending-panel {
  margin: 14px 0 18px;
  padding: 14px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-page);
}
.pending-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}
.pending-head h3 {
  margin: 0 0 4px;
  font-size: 15px;
}
.pending-head p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
}
.pending-table {
  width: 100%;
}
.muted {
  color: var(--text-tertiary);
  font-size: 13px;
}
.dialog-tip {
  margin: -4px 0 16px;
  padding: 10px 12px;
  border-radius: 6px;
  color: var(--text-secondary);
  background: var(--bg-page);
  font-size: 13px;
  line-height: 1.6;
}

.employee-cascader {
  width: 100%;
}
</style>
