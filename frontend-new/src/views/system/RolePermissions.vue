<template>
  <div class="page">
    <el-card class="page-card">
      <div class="page-header">
        <div>
          <h2>角色权限</h2>
          <p class="page-desc">可视化配置每个角色的操作权限，勾选后自动生效</p>
        </div>
      </div>

      <el-table :data="tableData" border stripe style="width: 100%">
        <el-table-column label="模块" fixed width="140">
          <template #default="{ row }">{{ moduleLabels[row.module] || row.module }}</template>
        </el-table-column>
        <el-table-column v-for="role in roleNames" :key="role.name" :label="role.label" min-width="180">
          <template #default="{ row }">
            <div class="perm-checkboxes" v-if="row[role.name]">
              <label v-for="p in permTypes" :key="p.key" class="perm-item">
                <el-checkbox
                  :model-value="row[role.name][p.key]"
                  @change="(v) => updatePerm(row.module, role.name, p.key, v)"
                  size="small"
                />
                <span>{{ p.label }}</span>
              </label>
              <el-select
                :model-value="row[role.name].data_scope"
                size="small"
                class="scope-select"
                @change="(v) => updateScope(row.module, role.name, v)"
              >
                <el-option
                  v-for="scope in scopeOptions"
                  :key="scope.value"
                  :label="scope.label"
                  :value="scope.value"
                />
              </el-select>
            </div>
            <span v-else class="no-perm">—</span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<script setup>
import { getAuthToken } from '../../utils/authSession'
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'

const rawData = ref([])
const roles = ref([])

const moduleLabels = {
  dashboard: '控制台', accounts: '账户管理', transactions: '交易流水',
  products: '产品库存', employees: '员工管理', users: '用户管理', roles: '角色权限',
  projects: '项目工单', chat: '聊天', finance: '财务总览'
}

const permTypes = [
  { key: 'can_view', label: '查看' },
  { key: 'can_create', label: '新增' },
  { key: 'can_edit', label: '编辑' },
  { key: 'can_delete', label: '删除' }
]

const scopeOptions = [
  { value: 'all', label: '全部数据' },
  { value: 'department', label: '本部门' },
  { value: 'project_related', label: '项目相关' },
  { value: 'self', label: '仅本人' },
  { value: 'private_grant', label: '私有授权' },
  { value: 'none', label: '无数据' }
]

const roleNames = computed(() => roles.value)
const modules = computed(() => [...new Set(rawData.value.map(r => r.module))])

const tableData = computed(() => {
  const map = {}
  for (const r of rawData.value) {
    if (!map[r.module]) map[r.module] = { module: r.module }
    map[r.module][r.role_name] = {
      id: r.id,
      can_view: !!r.can_view,
      can_create: !!r.can_create,
      can_edit: !!r.can_edit,
      can_delete: !!r.can_delete,
      data_scope: r.data_scope || 'all'
    }
  }
  return Object.values(map)
})

function token() { return getAuthToken() }

async function fetchData() {
  const [pRes, rRes] = await Promise.all([
    fetch('/api/role-permissions', { headers: { Authorization: `Bearer ${token()}` } }),
    fetch('/api/roles', { headers: { Authorization: `Bearer ${token()}` } })
  ])
  const pj = await pRes.json()
  const rj = await rRes.json()
  if (pj.success) rawData.value = pj.data
  if (rj.success) roles.value = rj.data
}

async function updatePerm(module, roleName, permKey, value) {
  const row = rawData.value.find(r => r.module === module && r.role_name === roleName)
  if (!row) return
  try {
    const body = {
      can_view: row.can_view,
      can_create: row.can_create,
      can_edit: row.can_edit,
      can_delete: row.can_delete,
      data_scope: row.data_scope || 'all'
    }
    body[permKey] = value ? 1 : 0
    await fetch(`/api/role-permissions/${row.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify(body)
    })
    row[permKey] = body[permKey]
    ElMessage.success('权限已更新')
  } catch {
    ElMessage.error('更新失败')
  }
}

async function updateScope(module, roleName, value) {
  const row = rawData.value.find(r => r.module === module && r.role_name === roleName)
  if (!row) return
  try {
    const body = {
      can_view: row.can_view,
      can_create: row.can_create,
      can_edit: row.can_edit,
      can_delete: row.can_delete,
      data_scope: value
    }
    await fetch(`/api/role-permissions/${row.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify(body)
    })
    row.data_scope = value
    ElMessage.success('数据范围已更新')
  } catch {
    ElMessage.error('更新失败')
  }
}

onMounted(fetchData)
</script>

<style scoped>
.perm-checkboxes {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  align-items: center;
}
.perm-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--text-secondary);
}
.no-perm { color: var(--text-placeholder); font-size: 13px; }
.scope-select {
  width: 110px;
}
</style>
