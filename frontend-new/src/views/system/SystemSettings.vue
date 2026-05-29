<template>
  <div class="settings-page">
    <div class="settings-layout">
      <!-- 左侧导航 -->
      <div class="settings-sidebar">
        <div class="settings-nav-header">
          <h3>系统设置</h3>
        </div>
        <div class="settings-nav">
          <div v-for="item in navItems" :key="item.key"
            :class="['nav-item', { active: activeTab === item.key }]"
            @click="activeTab = item.key">
            <el-icon :size="18"><component :is="item.icon" /></el-icon>
            <span>{{ item.label }}</span>
          </div>
        </div>
      </div>

      <!-- 右侧内容 -->
      <div class="settings-content">
        <!-- 个人资料 -->
        <div v-show="activeTab === 'profile'" class="settings-section">
          <div class="section-header">
            <h3>个人资料</h3>
            <p class="section-desc">修改头像和登录密码</p>
          </div>

          <!-- 头像 -->
          <el-form label-width="100px" class="settings-form">
            <el-form-item label="头像">
              <div class="avatar-upload">
                <div class="avatar-preview-wrap">
                  <UserAvatar :username="userName" :avatar-url="previewUrl || userAvatar" :size="72" />
                </div>
                <div class="avatar-actions">
                  <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp" style="display:none" @change="onFileSelect" />
                  <el-button @click="$refs.fileInput.click()" :disabled="uploading">选择图片</el-button>
                  <el-button v-if="previewUrl" type="primary" :loading="uploading" @click="uploadAvatar">{{ uploading ? '上传中...' : '保存头像' }}</el-button>
                  <div class="form-tip">支持 PNG、JPG、WebP，建议 200x200 以上</div>
                </div>
              </div>
            </el-form-item>
            <el-divider />
            <el-form-item label="旧密码">
              <el-input v-model="pwdForm.old_password" type="password" show-password placeholder="输入当前密码" style="width: 260px" />
            </el-form-item>
            <el-form-item label="新密码">
              <el-input v-model="pwdForm.new_password" type="password" show-password placeholder="至少 6 位" style="width: 260px" />
            </el-form-item>
            <el-form-item label="确认新密码">
              <el-input v-model="pwdForm.confirm_password" type="password" show-password placeholder="再次输入新密码" style="width: 260px" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="savingPwd" @click="changePassword">修改密码</el-button>
            </el-form-item>
          </el-form>
        </div>

        <!-- 基本设置 -->
        <div v-show="activeTab === 'basic'" class="settings-section">
          <div class="section-header">
            <h3>基本设置</h3>
            <p class="section-desc">管理系统名称、标题等基本信息</p>
          </div>
          <el-form :model="form" label-width="120px" class="settings-form">
            <el-form-item label="公司名称">
              <el-input v-model="form.company_name" placeholder="简尚" />
            </el-form-item>
            <el-form-item label="系统标题">
              <el-input v-model="form.system_title" placeholder="简尚装饰工程管理系统" />
            </el-form-item>
            <el-divider />
            <el-form-item>
              <el-button type="primary" :loading="saving" @click="saveSettings">保存设置</el-button>
              <span v-if="saved" class="save-hint">已保存</span>
            </el-form-item>
          </el-form>
        </div>

        <!-- AI 配置 -->
        <div v-show="activeTab === 'ai'" class="settings-section">
          <div class="section-header">
            <h3>AI 配置</h3>
            <p class="section-desc">配置 AI 模型参数，需要在 .env 中配置 AI_API_KEY</p>
          </div>
          <el-form :model="form" label-width="140px" class="settings-form">
            <el-form-item label="AI 模型">
              <el-select v-model="form.ai_model" style="width: 300px">
                <el-option label="DeepSeek Chat" value="deepseek-chat" />
                <el-option label="DeepSeek Reasoner" value="deepseek-reasoner" />
              </el-select>
            </el-form-item>
            <el-form-item label="温度 (Temperature)">
              <el-slider v-model="form.ai_temperature_num" :min="0" :max="2" :step="0.1" show-input style="width: 300px" />
              <div class="form-tip">值越高回复越随机，0.7 为默认值</div>
            </el-form-item>
            <el-form-item label="最大 Tokens">
              <el-input-number v-model="form.ai_max_tokens_num" :min="512" :max="8192" :step="512" />
              <div class="form-tip">单次回复最大长度，默认 2048</div>
            </el-form-item>
            <el-divider />
            <el-form-item>
              <el-button type="primary" :loading="saving" @click="saveSettings">保存配置</el-button>
              <el-button @click="testAI" :loading="testingAI">测试连接</el-button>
              <span v-if="aiTestResult" :class="['save-hint', { error: !aiTestResult.ok }]">
                {{ aiTestResult.msg }}
              </span>
            </el-form-item>
          </el-form>
        </div>

        <!-- 知识库 -->
        <div v-show="activeTab === 'kb'" class="settings-section">
          <div class="section-header">
            <h3>知识库</h3>
            <p class="section-desc">知识库运行状态和维护操作</p>
          </div>
          <el-card shadow="never" class="settings-card">
            <el-descriptions :column="1" border size="small">
              <el-descriptions-item label="运行状态">
                <el-tag :type="kbStatus.running ? 'success' : 'danger'" size="small">
                  {{ kbStatus.running ? '运行中' : '未启动' }}
                </el-tag>
              </el-descriptions-item>
              <el-descriptions-item label="集合名称">{{ kbStatus.collection || '-' }}</el-descriptions-item>
              <el-descriptions-item label="文档块数">{{ kbStatus.chunks ?? '-' }}</el-descriptions-item>
            </el-descriptions>
            <div class="kb-actions">
              <el-button @click="refreshKB" :loading="kbLoading">刷新状态</el-button>
              <el-button type="warning" @click="reindexKB" :loading="reindexing">重新索引</el-button>
            </div>
          </el-card>
        </div>

        <!-- AI 权限 -->
        <div v-show="activeTab === 'ai-perm'" class="settings-section">
          <div class="section-header">
            <h3>AI 工具权限</h3>
            <p class="section-desc">控制每个角色可用的 AI 工具，以及按人独立覆盖</p>
          </div>

          <el-card shadow="never" class="settings-card-wide">
            <h4 class="subsection-title">角色预设</h4>
            <el-table :data="aiRoleTableData" border stripe style="width: 100%">
              <el-table-column label="工具" fixed width="200">
                <template #default="{ row }">
                  <div class="tool-cell">
                    <span class="tool-name">{{ row.label }}</span>
                    <span class="tool-desc">{{ row.desc }}</span>
                  </div>
                </template>
              </el-table-column>
              <el-table-column v-for="r in aiRoles" :key="r.id" :label="r.label" min-width="120">
                <template #default="{ row }">
                  <el-switch :model-value="row.roles[r.id]" @change="(v) => updateAiRoleTool(row.name, r.id, v)" size="small" />
                </template>
              </el-table-column>
            </el-table>
          </el-card>

          <el-card shadow="never" class="settings-card-wide" style="margin-top: 16px;">
            <h4 class="subsection-title">个人例外</h4>
            <p class="section-desc">为特定用户单独覆盖 AI 工具权限，优先级高于角色预设</p>
            <div class="user-selector">
              <el-select v-model="aiSelectedUserId" placeholder="选择用户" filterable style="width: 240px" @change="loadAiUserTools">
                <el-option v-for="u in aiAllUsers" :key="u.id" :label="u.username" :value="u.id" />
              </el-select>
              <span v-if="aiSelectedUserLabel" class="selected-user-label">— {{ aiSelectedUserLabel }}</span>
            </div>
            <div v-if="aiSelectedUserId" class="user-tools">
              <div v-for="tool in aiToolList" :key="tool.name" class="user-tool-item">
                <div class="user-tool-info">
                  <span class="tool-name">{{ tool.label }}</span>
                  <span class="tool-desc">{{ tool.desc }}</span>
                </div>
                <div class="user-tool-status">
                  <span v-if="aiUserToolInherited(tool.name)" class="inherited-badge">继承</span>
                  <span v-else class="overridden-badge">已覆盖</span>
                </div>
                <el-switch :model-value="aiUserToolAllowed(tool.name)" @change="(v) => updateAiUserTool(tool.name, v)" size="small" />
              </div>
            </div>
          </el-card>
        </div>

        <!-- 用户管理 -->
        <div v-show="activeTab === 'users'" class="settings-section">
          <div class="section-header">
            <h3>用户管理</h3>
            <p class="section-desc">管理系统用户和角色分配</p>
          </div>
          <el-card shadow="never" class="settings-card-wide">
            <div class="users-toolbar">
              <el-button type="primary" size="small" @click="showAddUser = true">+ 新增用户</el-button>
            </div>
            <el-table :data="userList" stripe v-loading="userLoading" style="width: 100%">
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
                  <el-button v-if="row.username !== 'fuyulnk'" link size="small" @click="editUserRole(row)">分配角色</el-button>
                  <el-button v-if="row.username !== 'fuyulnk'" type="danger" link size="small" @click="deleteUser(row)">删除</el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-card>
        </div>

        <!-- 新增用户弹窗 -->
        <el-dialog v-model="showAddUser" title="新增用户" width="380px" append-to-body>
          <el-form :model="addUserForm" label-width="60px">
            <el-form-item label="账号">
              <el-input v-model="addUserForm.username" />
            </el-form-item>
            <el-form-item label="密码">
              <el-input v-model="addUserForm.password" type="password" show-password />
            </el-form-item>
            <el-form-item label="角色">
              <el-select v-model="addUserForm.role" style="width: 100%">
                <el-option v-for="r in userRoles" :key="r.id" :label="r.label" :value="r.name" />
              </el-select>
            </el-form-item>
          </el-form>
          <template #footer>
            <el-button @click="showAddUser = false">取消</el-button>
            <el-button type="primary" :loading="userSaving" @click="handleAddUser">确定</el-button>
          </template>
        </el-dialog>

        <!-- 分配角色弹窗 -->
        <el-dialog v-model="showAssignRole" title="分配角色" width="380px" append-to-body>
          <p>用户：<strong>{{ editingUser?.username }}</strong></p>
          <el-select v-model="selectedUserRole" style="width: 100%">
            <el-option v-for="r in userRoles" :key="r.id" :label="r.label" :value="r.name" />
          </el-select>
          <template #footer>
            <el-button @click="showAssignRole = false">取消</el-button>
            <el-button type="primary" :loading="userSaving" @click="handleAssignRole">确定</el-button>
          </template>
        </el-dialog>

        <!-- 关于 -->
        <div v-show="activeTab === 'about'" class="settings-section">
          <div class="section-header">
            <h3>关于</h3>
            <p class="section-desc">系统和框架版本信息</p>
          </div>
          <el-card shadow="never" class="settings-card">
            <el-descriptions :column="1" border size="small">
              <el-descriptions-item label="系统版本">1.0.0</el-descriptions-item>
              <el-descriptions-item label="后端框架">Fastify + better-sqlite3</el-descriptions-item>
              <el-descriptions-item label="前端框架">Vue 3 + Element Plus</el-descriptions-item>
              <el-descriptions-item label="AI 服务">DeepSeek API</el-descriptions-item>
              <el-descriptions-item label="知识库引擎">ChromaDB + sentence-transformers</el-descriptions-item>
              <el-descriptions-item label="Node.js 版本">v26.0.0</el-descriptions-item>
            </el-descriptions>
          </el-card>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Setting, Aim, Collection, InfoFilled, User, Operation } from '@element-plus/icons-vue'
import UserAvatar from '../../components/UserAvatar.vue'

const navItems = [
  { key: 'profile', label: '个人资料', icon: User },
  { key: 'basic', label: '基本设置', icon: Setting },
  { key: 'ai', label: 'AI 配置', icon: Aim },
  { key: 'kb', label: '知识库', icon: Collection },
  { key: 'ai-perm', label: 'AI 权限', icon: Operation },
  { key: 'users', label: '用户管理', icon: User },
  { key: 'about', label: '关于', icon: InfoFilled },
]

const activeTab = ref('basic')
const saving = ref(false)
const saved = ref(false)
const testingAI = ref(false)
const aiTestResult = ref(null)
const kbLoading = ref(false)
const reindexing = ref(false)

// ====== AI 权限 ======
const aiRawData = ref([])
const aiRoles = ref([])
const aiToolList = ref([])
const aiAllUsers = ref([])
const aiSelectedUserId = ref(null)
const aiUserOverrides = ref([])
const aiUserRoleId = ref(null)

const aiRoleTableData = computed(() => {
  const map = {}
  for (const r of aiRawData.value) {
    if (!map[r.tool_name]) {
      const tool = aiToolList.value.find(t => t.name === r.tool_name)
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

const aiSelectedUserLabel = computed(() => {
  const u = aiAllUsers.value.find(x => x.id === aiSelectedUserId.value)
  return u ? `${u.username}（${u.role_label || u.role}）` : ''
})

function aiUserToolAllowed(toolName) {
  const override = aiUserOverrides.value.find(o => o.tool_name === toolName)
  if (override !== undefined) return !!override.allowed
  const row = aiRawData.value.find(r => r.tool_name === toolName && r.role_id === aiUserRoleId.value)
  return !!row?.allowed
}

function aiUserToolInherited(toolName) {
  return !aiUserOverrides.value.find(o => o.tool_name === toolName)
}

async function fetchAiData() {
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
  if (tj.success) aiRawData.value = tj.data
  if (rj.success) aiRoles.value = rj.data
  if (lj.success) aiToolList.value = lj.data
  if (uj.success) aiAllUsers.value = uj.data
}

async function updateAiRoleTool(toolName, roleId, allowed) {
  const row = aiRawData.value.find(r => r.tool_name === toolName && r.role_id === roleId)
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

async function loadAiUserTools(userId) {
  const u = aiAllUsers.value.find(x => x.id === userId)
  aiUserRoleId.value = aiRoles.value.find(r => r.name === u?.role)?.id || null
  try {
    const res = await fetch(`/api/ai-tools/users/${userId}`, {
      headers: { Authorization: `Bearer ${token()}` }
    })
    const json = await res.json()
    if (json.success) aiUserOverrides.value = json.data
  } catch {}
}

async function updateAiUserTool(toolName, allowed) {
  if (!aiSelectedUserId.value) return
  try {
    const res = await fetch(`/api/ai-tools/users/${aiSelectedUserId.value}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({ tool_name: toolName, allowed })
    })
    const json = await res.json()
    if (json.success) {
      await loadAiUserTools(aiSelectedUserId.value)
      ElMessage.success(allowed ? '已允许该工具' : '已禁止该工具')
    } else {
      ElMessage.error(json.message || '更新失败')
    }
  } catch {
    ElMessage.error('网络错误')
  }
}

// ====== 用户管理 ======
const userList = ref([])
const userRoles = ref([])
const userLoading = ref(false)
const showAddUser = ref(false)
const showAssignRole = ref(false)
const userSaving = ref(false)
const editingUser = ref(null)
const selectedUserRole = ref('')
const addUserForm = ref({ username: '', password: '', role: 'employee' })

async function fetchUsers() {
  userLoading.value = true
  try {
    const [uRes, rRes] = await Promise.all([
      fetch('/api/users', { headers: { Authorization: `Bearer ${token()}` } }),
      fetch('/api/roles', { headers: { Authorization: `Bearer ${token()}` } })
    ])
    const uj = await uRes.json()
    const rj = await rRes.json()
    if (uj.success) userList.value = uj.data
    if (rj.success) userRoles.value = rj.data
  } finally {
    userLoading.value = false
  }
}

async function handleAddUser() {
  if (!addUserForm.value.username || !addUserForm.value.password) {
    ElMessage.warning('请填写账号和密码')
    return
  }
  userSaving.value = true
  try {
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify(addUserForm.value)
    })
    const json = await res.json()
    if (json.success) {
      ElMessage.success('新增成功')
      showAddUser.value = false
      addUserForm.value = { username: '', password: '', role: 'employee' }
      fetchUsers()
    } else {
      ElMessage.error(json.message)
    }
  } finally {
    userSaving.value = false
  }
}

function editUserRole(row) {
  editingUser.value = row
  selectedUserRole.value = row.role
  showAssignRole.value = true
}

async function handleAssignRole() {
  userSaving.value = true
  try {
    const res = await fetch(`/api/users/${editingUser.value.id}/role`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({ role: selectedUserRole.value })
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      ElMessage.error(err.message || '操作失败')
      return
    }
    ElMessage.success('角色已更新')
    showAssignRole.value = false
    fetchUsers()
  } finally {
    userSaving.value = false
  }
}

async function deleteUser(row) {
  try {
    await ElMessageBox.confirm(`确定删除用户「${row.username}」？`, '提示')
    await fetch(`/api/users/${row.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token()}` }
    })
    ElMessage.success('已删除')
    fetchUsers()
  } catch {}
}

// 个人资料
const fileInput = ref(null)
const uploading = ref(false)
const savingPwd = ref(false)
const previewUrl = ref('')
const fileData = ref(null)
const fileName = ref('')
const userName = ref('用户')
const userAvatar = ref('')
const pwdForm = ref({ old_password: '', new_password: '', confirm_password: '' })

const form = reactive({
  company_name: '',
  system_title: '',
  ai_model: 'deepseek-chat',
  ai_temperature_num: 0.7,
  ai_max_tokens_num: 2048,
})

const kbStatus = reactive({
  running: false,
  collection: '',
  chunks: null,
})

function token() { return localStorage.getItem('token') }

async function fetchSettings() {
  try {
    const res = await fetch('/api/settings', {
      headers: { Authorization: `Bearer ${token()}` }
    })
    const json = await res.json()
    if (json.success && json.data) {
      form.company_name = json.data.company_name || '简尚'
      form.system_title = json.data.system_title || '简尚装饰工程管理系统'
      form.ai_model = json.data.ai_model || 'deepseek-chat'
      form.ai_temperature_num = parseFloat(json.data.ai_temperature || '0.7')
      form.ai_max_tokens_num = parseInt(json.data.ai_max_tokens || '2048')
    }
  } catch {}
}

async function fetchKB() {
  kbLoading.value = true
  try {
    const res = await fetch('/api/settings/knowledge-base', {
      headers: { Authorization: `Bearer ${token()}` }
    })
    const json = await res.json()
    if (json.success && json.data) {
      kbStatus.running = true
      kbStatus.collection = json.data.collection || ''
      kbStatus.chunks = json.data.chunks ?? null
    } else {
      kbStatus.running = false
      kbStatus.collection = ''
      kbStatus.chunks = null
    }
  } catch {
    kbStatus.running = false
  }
  kbLoading.value = false
}

async function saveSettings() {
  saving.value = true
  saved.value = false
  try {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({
        company_name: form.company_name,
        system_title: form.system_title,
        ai_model: form.ai_model,
        ai_temperature: String(form.ai_temperature_num),
        ai_max_tokens: String(form.ai_max_tokens_num),
      }),
    })
    const json = await res.json()
    if (json.success) {
      saved.value = true
      ElMessage.success('设置已保存')
      setTimeout(() => { saved.value = false }, 3000)
    } else {
      ElMessage.error(json.message || '保存失败')
    }
  } catch {
    ElMessage.error('网络错误')
  }
  saving.value = false
}

async function testAI() {
  testingAI.value = true
  aiTestResult.value = null
  try {
    const res = await fetch('/api/settings/test-ai', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token()}` },
    })
    const json = await res.json()
    if (json.success) {
      aiTestResult.value = { ok: true, msg: `AI 正常 (${json.reply})` }
    } else {
      aiTestResult.value = { ok: false, msg: `失败: ${json.message}` }
    }
  } catch {
    aiTestResult.value = { ok: false, msg: '后端连接失败' }
  }
  testingAI.value = false
}

async function refreshKB() {
  await fetchKB()
  ElMessage.success(kbStatus.running ? '知识库运行正常' : '知识库未启动')
}

async function reindexKB() {
  try {
    await ElMessageBox.confirm('重新索引可能需要几分钟，确认执行？', '提示', {
      confirmButtonText: '确认', cancelButtonText: '取消', type: 'warning'
    })
  } catch { return }
  reindexing.value = true
  ElMessage.info('请在服务器执行: cd ~/.openclaw/workspace && python3 scripts/ingest-jianshang-docs.py')
  reindexing.value = false
}

// ====== 个人资料 ======
async function fetchUserInfo() {
  try {
    const res = await fetch('/api/me', {
      headers: { Authorization: `Bearer ${token()}` }
    })
    const json = await res.json()
    if (json.success) {
      userName.value = json.user.username || '用户'
      userAvatar.value = json.user.avatar_url || ''
    }
  } catch {}
}

function onFileSelect(e) {
  const file = e.target.files?.[0]
  if (!file) return
  fileName.value = file.name
  const reader = new FileReader()
  reader.onload = (ev) => {
    previewUrl.value = ev.target.result
    fileData.value = ev.target.result
  }
  reader.readAsDataURL(file)
  e.target.value = ''
}

async function uploadAvatar() {
  if (!fileData.value) { ElMessage.warning('请先选择图片'); return }
  uploading.value = true
  try {
    const res = await fetch('/api/profile/avatar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({ image: fileData.value }),
    })
    const json = await res.json()
    if (json.success) {
      userAvatar.value = json.avatar_url
      previewUrl.value = ''
      fileData.value = null
      fileName.value = ''
      ElMessage.success('头像已更新')
    } else {
      ElMessage.error(json.message || '上传失败')
    }
  } catch {
    ElMessage.error('网络错误')
  }
  uploading.value = false
}

async function changePassword() {
  const { old_password, new_password, confirm_password } = pwdForm.value
  if (!old_password || !new_password || !confirm_password) {
    ElMessage.warning('请填写完整'); return
  }
  if (new_password.length < 6) { ElMessage.warning('新密码至少 6 位'); return }
  if (new_password !== confirm_password) { ElMessage.warning('两次输入的密码不一致'); return }

  savingPwd.value = true
  try {
    const res = await fetch('/api/profile/password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({ old_password: old_password, new_password }),
    })
    const json = await res.json()
    if (json.success) {
      ElMessage.success('密码已修改')
      pwdForm.value = { old_password: '', new_password: '', confirm_password: '' }
    } else {
      ElMessage.error(json.message || '修改失败')
    }
  } catch {
    ElMessage.error('网络错误')
  }
  savingPwd.value = false
}

onMounted(() => {
  fetchSettings()
  fetchKB()
  fetchUserInfo()
  fetchAiData()
  fetchUsers()
})
</script>

<style scoped>
.settings-page {
  max-width: 1000px;
}
.settings-layout {
  display: flex;
  gap: 24px;
  align-items: flex-start;
}

/* 左侧导航 */
.settings-sidebar {
  width: 200px;
  flex-shrink: 0;
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-light);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
  position: sticky;
  top: 84px;
}
.settings-nav-header {
  padding: 20px 20px 12px;
  border-bottom: 1px solid var(--border-light);
}
.settings-nav-header h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
}
.settings-nav {
  padding: 8px;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 14px;
  color: var(--text-secondary);
  transition: all 0.15s ease;
  margin-bottom: 2px;
}
.nav-item:hover {
  background: var(--border-light);
  color: var(--text-primary);
}
.nav-item.active {
  background: var(--color-primary-bg);
  color: var(--color-primary);
  font-weight: 600;
}

/* 右侧内容 */
.settings-content {
  flex: 1;
  min-width: 0;
}
.settings-section {
  animation: fade-in 0.2s ease;
}
.section-header {
  margin-bottom: 24px;
}
.section-header h3 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.3px;
}
.section-desc {
  margin: 4px 0 0;
  font-size: 14px;
  color: var(--text-tertiary);
}

@keyframes fade-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

.settings-form {
  max-width: 560px;
  background: var(--bg-card);
  padding: 24px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-light);
  box-shadow: var(--shadow-sm);
}
.form-tip {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-top: 4px;
  line-height: 1.4;
}
.save-hint {
  margin-left: 12px;
  font-size: 13px;
  color: var(--color-success);
}
.save-hint.error {
  color: var(--color-danger);
}
.settings-card {
  max-width: 560px;
}
.kb-actions {
  margin-top: 20px;
  display: flex;
  gap: 12px;
}
.avatar-upload {
  display: flex;
  align-items: flex-start;
  gap: 20px;
}
.avatar-preview-wrap {
  flex-shrink: 0;
}
.avatar-actions {
  flex: 1;
}
.settings-card-wide {
  max-width: 100%;
}
.subsection-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 12px;
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
.users-toolbar {
  margin-bottom: 12px;
}
</style>
