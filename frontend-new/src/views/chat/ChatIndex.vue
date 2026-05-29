<template>
  <div class="chat-page">
    <!-- 左侧会话列表 -->
    <div class="conv-list">
      <div class="conv-header">
        <span>聊天</span>
        <el-button circle size="small" type="primary" @click="showNewConv = true" title="新建对话">+</el-button>
      </div>

      <!-- AI 小助手 -->
      <div :class="['conv-item', { active: isAiMode }]" @click="selectAi">
        <UserAvatar username="AI 小助手" :size="40" />
        <div class="conv-info">
          <div class="conv-top">
            <span class="conv-name">AI 小助手</span>
          </div>
          <div class="conv-last">智能财务助手，随时为您解答</div>
        </div>
      </div>

      <div class="conv-divider">对话</div>

      <div v-if="loading" class="loading-tip">加载中...</div>
      <div v-for="conv in conversations" :key="conv.id"
        :class="['conv-item', { active: currentConvId === conv.id }]"
        @click="selectConversation(conv)">
        <UserAvatar v-if="conv.type !== 'group'" :username="conv.other_user?.username || '?'" :avatar-url="conv.other_user?.avatar_url || ''" :size="40" />
        <div v-else class="conv-avatar">群</div>
        <div class="conv-info">
          <div class="conv-top">
            <span class="conv-name">{{ conv.type === 'group' ? conv.name : (conv.other_user?.username || '未知') }}</span>
            <span class="conv-time">{{ formatTime(conv.last_time) }}</span>
          </div>
          <div class="conv-last">{{ conv.last_message || '暂无消息' }}</div>
        </div>
      </div>
    </div>

    <!-- 右侧消息区 -->
    <div class="msg-area">
      <!-- 未选择 -->
      <div v-if="!currentConvId && !isAiMode" class="no-conv">
        <div class="no-conv-icon"><el-icon :size="64"><ChatDotSquare /></el-icon></div>
        <p>选择一个对话开始聊天</p>
      </div>

      <!-- 普通对话 -->
      <template v-else-if="!isAiMode">
        <div class="msg-header">
          <span>{{ currentConvName }}</span>
          <span class="msg-header-meta" v-if="currentConvMeta">{{ currentConvMeta }}</span>
        </div>
        <div class="msg-list" ref="msgListRef">
          <div v-for="msg in messages" :key="msg.id"
            :class="['msg-item', msg.user_id === userId ? 'mine' : '']">
            <div v-if="msg.user_id !== userId && currentConvType === 'group'" class="msg-avatar-wrapper">
              <UserAvatar :username="msg.username || '?'" :avatar-url="msg.avatar_url || ''" :size="32" />
            </div>
            <div class="msg-body">
              <div class="msg-name" v-if="msg.user_id !== userId && currentConvType === 'group'">{{ msg.username === 'ai' ? 'AI 小助手' : msg.username }}</div>
              <div :class="['msg-bubble', msg.username === 'ai' ? 'ai-group-bubble' : '']">{{ msg.content }}</div>
              <div class="msg-time">{{ formatTime(msg.created_at) }}</div>
            </div>
          </div>
          <div v-if="messages.length === 0" class="no-msg">暂无消息，发送第一条吧</div>
        </div>
        <div class="msg-input">
          <div class="input-row" v-if="currentConvType === 'group'">
            <span class="ai-tag" @click="insertAtAi" title="在输入中插入 @AI">@AI</span>
          </div>
          <input v-model="inputText" type="text" :placeholder="inputPlaceholder" @keydown.enter="sendMessage" />
          <el-button type="primary" @click="sendMessage">发送</el-button>
        </div>
      </template>

      <!-- AI 对话 -->
      <template v-else>
        <div class="msg-header">
          <span>AI 小助手</span>
          <span class="msg-header-meta">智能财务助手</span>
        </div>
        <div class="msg-list" ref="aiMsgRef">
          <div v-for="(msg, i) in aiMessages" :key="i"
            :class="['msg-item', msg.role === 'user' ? 'mine' : '']">
            <div class="msg-body">
              <div class="msg-bubble" :class="msg.role === 'assistant' ? 'ai-bubble' : ''">{{ msg.content }}</div>
            </div>
          </div>
          <div v-if="aiStreaming" class="msg-item">
            <div class="msg-body">
              <div class="msg-bubble ai-bubble typing-dots">
                <span class="dot">.</span><span class="dot">.</span><span class="dot">.</span>
              </div>
            </div>
          </div>
          <div v-if="aiMessages.length === 0 && !aiStreaming" class="no-conv" style="position:static;padding:40px 0">
            <div class="no-conv-icon"><el-icon :size="64"><Cpu /></el-icon></div>
            <p>我是简尚小助手，有什么可以帮你的？</p>
          </div>
        </div>
        <div class="msg-input">
          <input v-model="aiInput" type="text" placeholder="向 AI 小助手提问..." :disabled="aiStreaming" @keydown.enter="sendAiMessage" />
          <el-button type="primary" :loading="aiStreaming" @click="sendAiMessage">{{ aiStreaming ? '思考中' : '发送' }}</el-button>
        </div>
      </template>
    </div>

    <!-- 新建对话弹窗 -->
    <el-dialog v-model="showNewConv" title="新建对话" width="420px">
      <el-form label-width="60px">
        <el-form-item label="类型">
          <el-radio-group v-model="newConvType">
            <el-radio value="private">私聊</el-radio>
            <el-radio value="group">群聊</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="newConvType === 'group'" label="群名">
          <el-input v-model="newConvName" placeholder="输入群聊名称" />
        </el-form-item>
        <el-form-item label="成员">
          <el-select v-model="newConvMembers" multiple style="width: 100%" placeholder="选择成员">
            <el-option v-for="u in userList" :key="u.id" :label="`${u.username} (${u.role_label})`" :value="u.id" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showNewConv = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="handleCreateConv">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { ChatDotSquare, Cpu } from '@element-plus/icons-vue'
import { io } from 'socket.io-client'
import UserAvatar from '../../components/UserAvatar.vue'

const conversations = ref([])
const messages = ref([])
const currentConvId = ref(null)
const currentConvType = ref('')
const currentConvName = ref('')
const currentConvMeta = ref('')
const loading = ref(true)
const inputText = ref('')
const msgListRef = ref(null)
const userId = ref(null)
const socket = ref(null)

const showNewConv = ref(false)
const newConvType = ref('private')
const newConvName = ref('')
const newConvMembers = ref([])
const userList = ref([])
const creating = ref(false)

// AI 对话
const isAiMode = ref(false)
const aiInput = ref('')
const aiMessages = ref([])
const aiStreaming = ref(false)
const aiSessionId = ref(null)
const aiMsgRef = ref(null)

const inputPlaceholder = ref('输入消息...')

function insertAtAi() {
  inputText.value = '@AI ' + inputText.value
}

function token() { return localStorage.getItem('token') }

// Socket.io
function connectSocket() {
  socket.value = io({ auth: { token: token() } })
  socket.value.on('connect', () => {})
  socket.value.on('message:new', (msg) => {
    if (msg.conversation_id === currentConvId.value) {
      messages.value.push(msg)
      scrollBottom()
    }
    refreshConversations()
  })
}

// 获取会话列表
async function refreshConversations() {
  try {
    const res = await fetch('/api/conversations', {
      headers: { Authorization: `Bearer ${token()}` }
    })
    const json = await res.json()
    if (json.success) conversations.value = json.data
  } finally { loading.value = false }
}

// 选择 AI 对话
function selectAi() {
  isAiMode.value = true
  currentConvId.value = null
  aiMessages.value = []
  aiSessionId.value = null
  loadAiHistory()
}

// 加载 AI 历史
async function loadAiHistory() {
  try {
    const res = await fetch('/api/chat/history', {
      headers: { Authorization: `Bearer ${token()}` }
    })
    const json = await res.json()
    if (json.success) {
      const sessions = Object.values(json.data)
      if (sessions.length > 0) {
        const last = sessions[sessions.length - 1]
        aiMessages.value = last
      }
    }
  } catch {}
}

// 发送 AI 消息
async function sendAiMessage() {
  const text = aiInput.value.trim()
  if (!text || aiStreaming.value) return
  aiMessages.value.push({ role: 'user', content: text })
  aiInput.value = ''
  aiStreaming.value = true
  scrollBottomAi()

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({ message: text, session_id: aiSessionId.value })
    })
    if (!response.ok) {
      aiMessages.value.push({ role: 'assistant', content: '请求失败，请稍后重试' })
      aiStreaming.value = false
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let aiContent = ''
    const aiIdx = aiMessages.value.length
    aiMessages.value.push({ role: 'assistant', content: '' })

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim()
          if (data === '[DONE]') continue
          try {
            const parsed = JSON.parse(data)
            if (parsed.type === 'session') aiSessionId.value = parsed.session_id
            else if (parsed.type === 'text') {
              aiContent += parsed.content
              aiMessages.value[aiIdx] = { role: 'assistant', content: aiContent }
              aiMessages.value = [...aiMessages.value]
              scrollBottomAi()
            }
          } catch {}
        }
      }
    }
  } catch {
    aiMessages.value.push({ role: 'assistant', content: '网络错误，请稍后重试' })
  }
  aiStreaming.value = false
}

// 选择普通会话
async function selectConversation(conv) {
  isAiMode.value = false
  currentConvId.value = conv.id
  inputPlaceholder.value = conv.type === 'group' ? '输入消息，@AI 可召唤小助手' : '输入消息...'
  currentConvType.value = conv.type
  currentConvName.value = conv.type === 'group' ? conv.name : (conv.other_user?.username || '私聊')
  currentConvMeta.value = conv.type === 'group' ? `${conv.member_count} 人` : ''
  messages.value = []
  if (socket.value?.connected) socket.value.emit('join:conversation', conv.id)
  try {
    const res = await fetch(`/api/conversations/${conv.id}/messages`, {
      headers: { Authorization: `Bearer ${token()}` }
    })
    const json = await res.json()
    if (json.success) {
      messages.value = json.data
      nextTick(scrollBottom)
    }
  } catch {}
}

function sendMessage() {
  const text = inputText.value.trim()
  if (!text || !currentConvId.value) return
  socket.value?.emit('message:send', { conversation_id: currentConvId.value, content: text })
  inputText.value = ''
}

async function handleCreateConv() {
  if (newConvType.value === 'group' && !newConvName.value) { ElMessage.warning('请输入群聊名称'); return }
  if (!newConvMembers.value.length) { ElMessage.warning('请选择成员'); return }
  creating.value = true
  try {
    const res = await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({ type: newConvType.value, name: newConvName.value, participant_ids: newConvMembers.value })
    })
    const json = await res.json()
    if (json.success) {
      ElMessage.success('创建成功')
      showNewConv.value = false
      newConvName.value = ''
      newConvMembers.value = []
      refreshConversations()
    }
  } finally { creating.value = false }
}

async function fetchUsers() {
  try {
    const res = await fetch('/api/users/chat', { headers: { Authorization: `Bearer ${token()}` } })
    const json = await res.json()
    if (json.success) userList.value = json.data.filter(u => u.id !== userId.value)
  } catch {}
}

function scrollBottom() {
  nextTick(() => { const el = msgListRef.value; if (el) el.scrollTop = el.scrollHeight })
}
function scrollBottomAi() {
  nextTick(() => { const el = aiMsgRef.value; if (el) el.scrollTop = el.scrollHeight })
}

function formatTime(t) {
  if (!t) return ''
  const d = new Date(t)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

watch(messages, scrollBottom, { deep: true })

onMounted(async () => {
  const me = await fetch('/api/me', { headers: { Authorization: `Bearer ${token()}` } })
  const meJson = await me.json()
  if (meJson.success) userId.value = meJson.user.id
  await refreshConversations()
  await fetchUsers()
  connectSocket()
})

onUnmounted(() => { socket.value?.disconnect() })
</script>

<style scoped>
.chat-page {
  display: flex;
  height: calc(100vh - 100px);
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  overflow: hidden;
  box-shadow: var(--shadow-sm);
}
.conv-list {
  width: 300px;
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  background: var(--bg-card);
}
.conv-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 16px 16px 20px;
  border-bottom: 1px solid var(--border-color);
  font-weight: 600;
  font-size: 16px;
}
.conv-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  cursor: pointer;
  transition: all 0.15s;
  margin: 0 4px;
  border-radius: var(--radius-sm);
}
.conv-item:hover { background: var(--border-light); }
.conv-item.active { background: var(--color-primary-bg); }
.conv-divider {
  padding: 12px 16px 4px;
  font-size: 11px;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 1px;
  font-weight: 600;
}
.conv-avatar {
  width: 40px; height: 40px; border-radius: 50%;
  background: var(--color-primary);
  color: #fff; display: flex; align-items: center; justify-content: center;
  font-size: 14px; font-weight: bold; flex-shrink: 0;
}
.msg-avatar-wrapper {
  flex-shrink: 0;
}
.conv-info { flex: 1; min-width: 0; }
.conv-top { display: flex; justify-content: space-between; align-items: center; }
.conv-name { font-size: 14px; font-weight: 500; color: var(--text-primary); }
.conv-time { font-size: 11px; color: var(--text-tertiary); }
.conv-last { font-size: 13px; color: var(--text-tertiary); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.msg-area { flex: 1; display: flex; flex-direction: column; }
.no-conv { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--text-tertiary); }
.no-conv-icon { font-size: 64px; margin-bottom: 16px; color: var(--text-placeholder); }
.msg-header {
  padding: 16px 20px; border-bottom: 1px solid var(--border-color);
  font-weight: 600; font-size: 15px; display: flex; align-items: center; gap: 12px;
}
.msg-header-meta { font-weight: 400; font-size: 13px; color: var(--text-tertiary); }
.msg-list { flex: 1; overflow-y: auto; padding: 20px; background: var(--bg-page); }
.msg-item { display: flex; margin-bottom: 16px; gap: 8px; }
.msg-item.mine { flex-direction: row-reverse; }
.msg-body { max-width: 70%; }
.msg-bubble {
  padding: 10px 14px; border-radius: 12px; font-size: 14px; line-height: 1.5; word-break: break-word;
  background: var(--bg-card); color: var(--text-primary);
  border-bottom-left-radius: 4px; box-shadow: var(--shadow-sm);
}
.msg-item.mine .msg-bubble {
  background: var(--color-primary);
  color: #fff; border-bottom-left-radius: 12px; border-bottom-right-radius: 4px;
}
.msg-time { font-size: 11px; color: var(--text-placeholder); margin-top: 4px; }
.msg-item.mine .msg-time { text-align: right; }
.no-msg { text-align: center; color: var(--text-placeholder); margin-top: 60px; font-size: 14px; }
.msg-input { display: flex; padding: 12px 16px; border-top: 1px solid var(--border-color); gap: 8px; align-items: center; }
.msg-input input {
  flex: 1; border: 1px solid var(--border-color); border-radius: 20px; padding: 8px 16px; font-size: 14px; outline: none;
  transition: border-color 0.2s;
}
.msg-input input:focus { border-color: var(--color-primary); }
.msg-input input:disabled { background: var(--bg-page); cursor: not-allowed; }
.input-row { display: flex; align-items: center; }
.ai-tag {
  display: inline-flex; align-items: center; justify-content: center;
  height: 24px; padding: 0 8px; margin-right: 6px;
  border-radius: 4px; font-size: 12px; font-weight: 600;
  background: var(--color-primary);
  color: #fff; cursor: pointer; user-select: none;
  transition: opacity 0.15s; flex-shrink: 0;
}
.ai-tag:hover { opacity: 0.85; }
.ai-group-bubble {
  background: var(--color-primary-bg) !important;
  border: 1px solid var(--border-color);
}
.loading-tip { padding: 24px; text-align: center; color: var(--text-tertiary); font-size: 14px; }
.typing-dots .dot { animation: blink 1.4s infinite; font-size: 24px; line-height: 0; }
.typing-dots .dot:nth-child(2) { animation-delay: 0.2s; }
.typing-dots .dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes blink { 0%,60%,100% { opacity: 0.3; } 30% { opacity: 1; } }
</style>
