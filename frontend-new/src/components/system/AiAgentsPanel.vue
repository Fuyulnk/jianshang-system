<script setup>
import { getAuthToken } from '../../utils/authSession'
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'

const agents = ref([])
const tools = ref([])
const selectedAgentId = ref(null)
const loading = ref(false)
const saving = ref(false)
const toolSaving = ref(false)
const creating = ref(false)

const roleOptions = [
  { label: '超级管理员', value: 'super_admin' },
  { label: '管理员', value: 'admin' },
  { label: '财务', value: 'finance' },
  { label: '仓库', value: 'warehouse' },
  { label: '工程', value: 'engineering' },
  { label: '员工', value: 'employee' }
]

const draft = reactive({
  key: '',
  name: '',
  purpose: '',
  scenario_type: 'custom',
  base_prompt: '',
  allowed_roles: [],
  memory_enabled: false,
  memory_retention_days: 7,
  enabled: true
})

const selectedAgent = computed(() => agents.value.find(agent => agent.id === selectedAgentId.value) || agents.value[0] || null)
const selectedToolMap = computed(() => {
  const map = {}
  for (const item of selectedAgent.value?.tools || []) map[item.tool_name] = !!item.allowed
  return map
})
const groupedTools = computed(() => {
  const groups = {}
  for (const tool of tools.value) {
    const tier = tool.tier || 'L1'
    if (!groups[tier]) groups[tier] = []
    groups[tier].push(tool)
  }
  return Object.entries(groups).map(([tier, items]) => ({ tier, items }))
})

function token() {
  return getAuthToken()
}

async function readJson(res) {
  const text = await res.text()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return { success: false, message: text.slice(0, 120) || '服务器返回异常' }
  }
}

async function fetchData() {
  loading.value = true
  try {
    const [agentRes, toolRes] = await Promise.all([
      fetch('/api/ai/agents', { headers: { Authorization: `Bearer ${token()}` } }),
      fetch('/api/ai/tools', { headers: { Authorization: `Bearer ${token()}` } })
    ])
    const [agentJson, toolJson] = await Promise.all([readJson(agentRes), readJson(toolRes)])
    if (!agentJson.success) throw new Error(agentJson.message || '读取分身失败')
    if (!toolJson.success) throw new Error(toolJson.message || '读取工具失败')
    agents.value = agentJson.data || []
    tools.value = toolJson.data || []
    if (!selectedAgentId.value && agents.value.length) selectedAgentId.value = agents.value[0].id
    fillDraft(selectedAgent.value)
  } catch (err) {
    ElMessage.error(err.message || '读取 AI 控制台失败')
  } finally {
    loading.value = false
  }
}

function fillDraft(agent) {
  if (!agent) return
  draft.key = agent.key || ''
  draft.name = agent.name || ''
  draft.purpose = agent.purpose || ''
  draft.scenario_type = agent.scenario_type || 'custom'
  draft.base_prompt = agent.base_prompt || ''
  draft.allowed_roles = parseRoles(agent.allowed_roles)
  draft.memory_enabled = !!agent.memory_enabled
  draft.memory_retention_days = Number(agent.memory_retention_days || 7)
  draft.enabled = !!agent.enabled
}

function parseRoles(value) {
  if (Array.isArray(value)) return value
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return String(value || '').split(',').map(item => item.trim()).filter(Boolean)
  }
}

function selectAgent(agent) {
  selectedAgentId.value = agent.id
  fillDraft(agent)
}

async function saveAgent() {
  if (!selectedAgent.value) return
  saving.value = true
  try {
    const res = await fetch(`/api/ai/agents/${selectedAgent.value.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify(draft)
    })
    const json = await readJson(res)
    if (!json.success) throw new Error(json.message || '保存失败')
    ElMessage.success('分身已保存')
    await fetchData()
  } catch (err) {
    ElMessage.error(err.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function createAgent() {
  creating.value = true
  try {
    const key = `custom_${Date.now().toString(36)}`
    const res = await fetch('/api/ai/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({
        key,
        name: '新分身',
        purpose: '自定义场景',
        scenario_type: 'custom',
        base_prompt: '你是简尚内部助手。回答前先判断是否需要查询系统数据，写入动作必须让用户确认。',
        allowed_roles: ['super_admin', 'admin'],
        memory_enabled: 0,
        memory_retention_days: 7,
        enabled: 1
      })
    })
    const json = await readJson(res)
    if (!json.success) throw new Error(json.message || '创建失败')
    selectedAgentId.value = json.data.id
    ElMessage.success('新分身已创建')
    await fetchData()
  } catch (err) {
    ElMessage.error(err.message || '创建失败')
  } finally {
    creating.value = false
  }
}

async function updateAgentTool(toolName, allowed) {
  if (!selectedAgent.value) return
  toolSaving.value = true
  try {
    const current = { ...selectedToolMap.value, [toolName]: !!allowed }
    const payload = tools.value.map(tool => ({ tool_name: tool.tool_name, allowed: !!current[tool.tool_name] }))
    const res = await fetch(`/api/ai/agents/${selectedAgent.value.id}/tools`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({ tools: payload })
    })
    const json = await readJson(res)
    if (!json.success) throw new Error(json.message || '更新工具失败')
    await fetchData()
  } catch (err) {
    ElMessage.error(err.message || '更新工具失败')
  } finally {
    toolSaving.value = false
  }
}

function riskType(level) {
  return { low: 'success', medium: 'warning', high: 'danger' }[level] || 'info'
}

onMounted(fetchData)
</script>

<template>
  <div class="ai-agent-panel" v-loading="loading">
    <div class="agent-layout">
      <aside class="agent-list">
        <div class="agent-list-head">
          <strong>AI 分身</strong>
          <el-button size="small" type="primary" :loading="creating" @click="createAgent">新增</el-button>
        </div>
        <button
          v-for="agent in agents"
          :key="agent.id"
          class="agent-item"
          :class="{ active: agent.id === selectedAgentId }"
          type="button"
          @click="selectAgent(agent)"
        >
          <span>{{ agent.name }}</span>
          <small>{{ agent.purpose || agent.scenario_type }}</small>
        </button>
      </aside>

      <section v-if="selectedAgent" class="agent-editor">
        <div class="editor-head">
          <div>
            <h4>{{ selectedAgent.name }}</h4>
            <p>分身决定提示词、工具权限和轻记忆范围；数据库事实仍以系统查询为准。</p>
          </div>
          <el-button type="primary" :loading="saving" @click="saveAgent">保存分身</el-button>
        </div>

        <el-form label-width="110px" class="agent-form">
          <el-row :gutter="16">
            <el-col :xs="24" :md="12">
              <el-form-item label="名称">
                <el-input v-model="draft.name" maxlength="40" />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :md="12">
              <el-form-item label="场景">
                <el-select v-model="draft.scenario_type" style="width:100%">
                  <el-option label="通用" value="general" />
                  <el-option label="财务" value="finance" />
                  <el-option label="仓库" value="warehouse" />
                  <el-option label="项目" value="project" />
                  <el-option label="自定义" value="custom" />
                </el-select>
              </el-form-item>
            </el-col>
          </el-row>
          <el-form-item label="用途">
            <el-input v-model="draft.purpose" maxlength="200" />
          </el-form-item>
          <el-form-item label="提示词">
            <el-input v-model="draft.base_prompt" type="textarea" :rows="5" maxlength="4000" show-word-limit />
          </el-form-item>
          <el-form-item label="可用角色">
            <el-checkbox-group v-model="draft.allowed_roles" class="role-checks">
              <el-checkbox v-for="role in roleOptions" :key="role.value" :label="role.value">
                {{ role.label }}
              </el-checkbox>
            </el-checkbox-group>
          </el-form-item>
          <el-row :gutter="16">
            <el-col :xs="24" :md="8">
              <el-form-item label="启用">
                <el-switch v-model="draft.enabled" />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :md="8">
              <el-form-item label="轻记忆">
                <el-switch v-model="draft.memory_enabled" />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :md="8">
              <el-form-item label="保留天数">
                <el-input-number v-model="draft.memory_retention_days" :min="1" :max="90" :disabled="!draft.memory_enabled" />
              </el-form-item>
            </el-col>
          </el-row>
        </el-form>

        <div class="tool-section">
          <div class="tool-head">
            <h4>分身工具权限</h4>
            <span v-if="toolSaving">保存中...</span>
          </div>
          <div v-for="group in groupedTools" :key="group.tier" class="tool-group">
            <div class="tool-tier">{{ group.tier }}</div>
            <div class="tool-grid">
              <div v-for="tool in group.items" :key="tool.tool_name" class="tool-row">
                <div class="tool-info">
                  <strong>{{ tool.label || tool.tool_name }}</strong>
                  <span>{{ tool.description }}</span>
                  <div class="tool-tags">
                    <el-tag size="small" :type="riskType(tool.risk_level)">{{ tool.risk_level }}</el-tag>
                    <el-tag v-if="tool.requires_confirmation" size="small" type="danger">需确认</el-tag>
                  </div>
                </div>
                <el-switch :model-value="selectedToolMap[tool.tool_name]" @change="v => updateAgentTool(tool.tool_name, v)" />
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.agent-layout {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  gap: 18px;
}
.agent-list {
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  padding: 12px;
  align-self: start;
}
.agent-list-head,
.editor-head,
.tool-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.agent-item {
  display: block;
  width: 100%;
  margin-top: 8px;
  padding: 10px;
  text-align: left;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
}
.agent-item span,
.agent-item small {
  display: block;
}
.agent-item small {
  margin-top: 4px;
  color: var(--text-tertiary);
}
.agent-item.active {
  border-color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary) 8%, var(--bg-page));
}
.agent-editor {
  min-width: 0;
}
.editor-head {
  margin-bottom: 16px;
}
.editor-head h4,
.tool-head h4 {
  margin: 0 0 4px;
}
.editor-head p {
  margin: 0;
  color: var(--text-tertiary);
  font-size: 13px;
}
.agent-form {
  max-width: 920px;
}
.tool-section {
  margin-top: 18px;
}
.tool-group {
  margin-top: 12px;
}
.tool-tier {
  margin-bottom: 8px;
  color: var(--text-secondary);
  font-weight: 700;
}
.tool-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
.tool-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
}
.tool-info {
  min-width: 0;
}
.tool-info strong,
.tool-info span {
  display: block;
}
.tool-info span {
  margin-top: 3px;
  color: var(--text-tertiary);
  font-size: 12px;
}
.tool-tags {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
.role-checks {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
}
@media (max-width: 900px) {
  .agent-layout,
  .tool-grid {
    grid-template-columns: 1fr;
  }
}
</style>
