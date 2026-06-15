<template>
  <div class="page">
    <el-card class="page-card">
      <div class="page-header">
        <div>
          <h2>AI 工具权限</h2>
          <p class="page-desc">控制每个角色可用的 AI 工具，以及按人独立覆盖</p>
        </div>
      </div>

      <!-- 角色预设 -->
      <h3 class="section-title">角色预设</h3>
      <el-table :data="roleTableData" border stripe style="width: 100%">
        <el-table-column label="工具" fixed width="200">
          <template #default="{ row }">
            <div class="tool-cell">
              <span class="tool-name">{{ row.label }}</span>
              <span class="tool-desc">{{ row.desc }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column v-for="role in roles" :key="role.id" :label="role.label" min-width="120">
          <template #default="{ row }">
            <el-switch
              :model-value="row.roles[role.id]"
              @change="(v) => updateRoleTool(row.name, role.id, v)"
              size="small"
            />
          </template>
        </el-table-column>
      </el-table>

      <el-divider />

      <!-- 个人例外 -->
      <h3 class="section-title">个人例外</h3>
      <p class="section-desc">为特定用户单独覆盖 AI 工具权限，优先级高于角色预设</p>
      <div class="user-selector">
        <el-select v-model="selectedUserId" placeholder="选择用户" filterable style="width: 240px" @change="loadUserTools">
          <el-option v-for="u in allUsers" :key="u.id" :label="u.username" :value="u.id" />
        </el-select>
        <span v-if="selectedUserLabel" class="selected-user-label">— {{ selectedUserLabel }}</span>
      </div>

      <div v-if="selectedUserId" class="user-tools">
        <div v-for="tool in toolList" :key="tool.name" class="user-tool-item">
          <div class="user-tool-info">
            <span class="tool-name">{{ tool.label }}</span>
            <span class="tool-desc">{{ tool.desc }}</span>
          </div>
          <div class="user-tool-status">
            <span v-if="userToolInherited(tool.name)" class="inherited-badge">继承</span>
            <span v-else class="overridden-badge">已覆盖</span>
          </div>
          <el-switch
            :model-value="userToolAllowed(tool.name)"
            @change="(v) => updateUserTool(tool.name, v)"
            size="small"
          />
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { getAuthToken } from '../../utils/authSession'
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'

const rawData = ref([])
const roles = ref([])
const toolList = ref([])
const allUsers = ref([])
const selectedUserId = ref(null)
const userOverrides = ref([])
const userRoleId = ref(null)

function token() { return getAuthToken() }

const roleTableData = computed(() => {
  const map = {}
  for (const r of rawData.value) {
    if (!map[r.tool_name]) {
      const tool = toolList.value.find(t => t.name === r.tool_name)
      map[r.tool_name] = {
        name: r.tool_name,
        label: tool?.label || r.tool_name,
        desc: tool?.desc || '',
        roles: {}
      }
    }
    map[r.tool_name].roles[r.role_id] = !!r.allowed
  }
  return Object.values(map)
})

const selectedUserLabel = computed(() => {
  const u = allUsers.value.find(x => x.id === selectedUserId.value)
  return u ? `${u.username}（${u.role_label || u.role}）` : ''
})

function userToolAllowed(toolName) {
  const override = userOverrides.value.find(o => o.tool_name === toolName)
  if (override !== undefined) return !!override.allowed
  // 回退到角色预设
  const row = rawData.value.find(r => r.tool_name === toolName && r.role_id === userRoleId.value)
  return !!row?.allowed
}

function userToolInherited(toolName) {
  return !userOverrides.value.find(o => o.tool_name === toolName)
}

async function fetchAll() {
  const [tr, rRes, tl, uRes] = await Promise.all([
    fetch('/api/ai-tools/roles', { headers: { Authorization: `Bearer ${token()}` } }),
    fetch('/api/roles', { headers: { Authorization: `Bearer ${token()}` } }),
    fetch('/api/ai-tools/list', { headers: { Authorization: `Bearer ${token()}` } }),
    fetch('/api/users', { headers: { Authorization: `Bearer ${token()}` } }),
  ])
  const tj = await tr.json()
  const rj = await rRes.json()
  const lj = await tl.json()
  const uj = await uRes.json()
  if (tj.success) rawData.value = tj.data
  if (rj.success) roles.value = rj.data
  if (lj.success) toolList.value = lj.data
  if (uj.success) allUsers.value = uj.data
}

async function updateRoleTool(toolName, roleId, allowed) {
  const row = rawData.value.find(r => r.tool_name === toolName && r.role_id === roleId)
  if (!row) return
  try {
    const res = await fetch(`/api/ai-tools/roles/${row.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({ allowed })
    })
    const json = await res.json()
    if (json.success) {
      row.allowed = allowed ? 1 : 0
      ElMessage.success('权限已更新')
    } else {
      ElMessage.error(json.message || '更新失败')
    }
  } catch {
    ElMessage.error('网络错误')
  }
}

async function loadUserTools(userId) {
  const u = allUsers.value.find(x => x.id === userId)
  userRoleId.value = roles.value.find(r => r.name === u?.role)?.id || null
  try {
    const res = await fetch(`/api/ai-tools/users/${userId}`, {
      headers: { Authorization: `Bearer ${token()}` }
    })
    const json = await res.json()
    if (json.success) userOverrides.value = json.data
  } catch {}
}

async function updateUserTool(toolName, allowed) {
  if (!selectedUserId.value) return
  try {
    const res = await fetch(`/api/ai-tools/users/${selectedUserId.value}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({ tool_name: toolName, allowed })
    })
    const json = await res.json()
    if (json.success) {
      // 刷新用户覆盖
      await loadUserTools(selectedUserId.value)
      ElMessage.success(allowed ? '已允许该工具' : '已禁止该工具')
    } else {
      ElMessage.error(json.message || '更新失败')
    }
  } catch {
    ElMessage.error('网络错误')
  }
}

onMounted(fetchAll)
</script>

<style scoped>
.section-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 4px;
}
.section-desc {
  font-size: 13px;
  color: var(--text-tertiary);
  margin: 0 0 16px;
}
.tool-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.tool-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}
.tool-desc {
  font-size: 11px;
  color: var(--text-tertiary);
}
.user-selector {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}
.selected-user-label {
  font-size: 14px;
  color: var(--text-secondary);
}
.user-tools {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 600px;
}
.user-tool-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--bg-page);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-light);
}
.user-tool-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.inherited-badge, .overridden-badge {
  font-size: 11px;
  padding: 1px 8px;
  border-radius: 10px;
  font-weight: 500;
  white-space: nowrap;
}
.inherited-badge {
  background: var(--border-light);
  color: var(--text-tertiary);
}
.overridden-badge {
  background: var(--color-primary-bg);
  color: var(--color-primary);
}
</style>
