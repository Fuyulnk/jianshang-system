<template>
  <div class="chat-page">
    <!-- 左侧会话列表 -->
    <div class="conv-list">
      <div class="conv-header">
        <span>聊天</span>
        <el-button circle size="small" type="primary" @click="showNewConv = true" title="添加群聊">+</el-button>
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
        <div
          ref="msgListRef"
          :class="['msg-list', { 'drag-over': dragOver }]"
          @dragenter.prevent="handleDragEnter"
          @dragover.prevent="handleDragOver"
          @dragleave.prevent="handleDragLeave"
          @drop.prevent="handleDrop"
        >
          <div v-if="dragOver" class="drop-overlay">
            <el-icon :size="36"><UploadFilled /></el-icon>
            <span>松开添加到待发送</span>
          </div>
          <div v-for="msg in messages" :key="msg.id"
            :class="['msg-item', msg.user_id === userId ? 'mine' : '']">
            <div v-if="msg.user_id !== userId && currentConvType === 'group'" class="msg-avatar-wrapper">
              <UserAvatar :username="msg.username || '?'" :avatar-url="msg.avatar_url || ''" :size="32" />
            </div>
            <div class="msg-body">
              <div class="msg-name" v-if="msg.user_id !== userId && currentConvType === 'group'">{{ msg.username === 'ai' ? 'AI 小助手' : msg.username }}</div>
              <div :class="['msg-bubble', msg.username === 'ai' ? 'ai-group-bubble' : '', msg.message_type === 'file' ? 'file-bubble' : '']">
                <template v-if="msg.message_type === 'file'">
                  <div v-if="isImageMessage(msg)" class="image-message">
                    <img v-if="messageImageUrls[msg.file_id]" :src="messageImageUrls[msg.file_id]" :alt="msg.file_name || msg.content" @click="downloadFile(msg)" />
                    <div v-else class="image-loading">图片加载中...</div>
                    <div class="image-meta">
                      <span>{{ msg.file_name || msg.content }}</span>
                      <button class="file-download" title="下载原图" @click.stop="downloadFile(msg)">
                        <el-icon><Download /></el-icon>
                      </button>
                    </div>
                  </div>
                  <div v-else class="file-card">
                    <el-icon class="file-icon"><Document /></el-icon>
                    <div class="file-info">
                      <div class="file-name">{{ msg.file_name || msg.content }}</div>
                      <div class="file-meta">{{ formatFileSize(msg.file_size) }}</div>
                    </div>
                    <button class="file-download" title="下载文件" @click.stop="downloadFile(msg)">
                      <el-icon><Download /></el-icon>
                    </button>
                  </div>
                </template>
                <template v-else>{{ msg.content }}</template>
              </div>
              <div class="msg-time">{{ formatTime(msg.created_at) }}</div>
            </div>
          </div>
          <div v-if="messages.length === 0" class="no-msg">暂无消息，发送第一条吧</div>
        </div>
        <div class="msg-composer">
          <div v-if="pendingFiles.length" class="pending-files">
            <div v-for="item in pendingFiles" :key="item.id" class="pending-file">
              <img v-if="item.preview_url" :src="item.preview_url" :alt="item.file.name" />
              <el-icon v-else class="pending-file-icon"><Document /></el-icon>
              <div class="pending-file-info">
                <div class="pending-file-name">{{ item.file.name }}</div>
                <div class="pending-file-size">{{ formatFileSize(item.file.size) }}</div>
              </div>
              <button class="pending-remove" title="移除" @click="removePendingFile(item.id)">×</button>
            </div>
          </div>
          <div class="msg-input">
            <div class="input-row" v-if="currentConvType === 'group'">
              <span class="ai-tag" @click="insertAtAi" title="在输入中插入 @AI">@AI</span>
            </div>
            <input ref="fileInputRef" type="file" multiple class="hidden-file-input" @change="handleFilePick" />
            <el-button :icon="Paperclip" :loading="uploading" @click="openFilePicker" title="选择文件">文件</el-button>
            <input v-model="inputText" type="text" :placeholder="inputPlaceholder" :disabled="uploading" @keydown.enter="sendMessage" />
            <el-button type="primary" :loading="uploading" @click="sendMessage">发送</el-button>
          </div>
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
    <el-dialog v-model="showNewConv" title="添加群聊" width="420px">
      <el-form label-width="60px">
        <el-form-item label="群名">
          <el-input v-model="newConvName" placeholder="输入群聊名称" />
        </el-form-item>
        <div class="dialog-tip">创建后先只有你在群里。系统默认群会自动出现：财务群、仓库群、工程群、总群。</div>
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
import { ChatDotSquare, Cpu, Document, Download, Paperclip, UploadFilled } from '@element-plus/icons-vue'
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
const fileInputRef = ref(null)
const userId = ref(null)
const socket = ref(null)
const dragOver = ref(false)
const uploading = ref(false)
const pendingFiles = ref([])
const messageImageUrls = ref({})

const showNewConv = ref(false)
const newConvName = ref('')
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
      if (!messages.value.some(item => item.id === msg.id)) messages.value.push(msg)
      loadImagePreviews([msg])
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
  clearPendingFiles()
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
  clearPendingFiles()
  if (socket.value?.connected) socket.value.emit('join:conversation', conv.id)
  try {
    const res = await fetch(`/api/conversations/${conv.id}/messages`, {
      headers: { Authorization: `Bearer ${token()}` }
    })
    const json = await res.json()
    if (json.success) {
      messages.value = json.data
      loadImagePreviews(json.data)
      nextTick(scrollBottom)
    }
  } catch {}
}

async function sendMessage() {
  const text = inputText.value.trim()
  const files = [...pendingFiles.value]
  if ((!text && !files.length) || !currentConvId.value || uploading.value) return

  if (text) {
    socket.value?.emit('message:send', { conversation_id: currentConvId.value, content: text })
    inputText.value = ''
  }
  if (files.length) {
    await uploadFiles(files)
  }
}

function openFilePicker() {
  if (!currentConvId.value || currentConvType.value !== 'group') {
    ElMessage.warning('请选择一个群聊')
    return
  }
  fileInputRef.value?.click()
}

async function handleFilePick(event) {
  const files = Array.from(event.target.files || [])
  event.target.value = ''
  addPendingFiles(files)
}

function handleDragEnter(event) {
  if (!hasFiles(event) || currentConvType.value !== 'group') return
  dragOver.value = true
}

function handleDragOver(event) {
  if (!hasFiles(event) || currentConvType.value !== 'group') return
  dragOver.value = true
}

function handleDragLeave(event) {
  if (event.currentTarget?.contains(event.relatedTarget)) return
  dragOver.value = false
}

async function handleDrop(event) {
  dragOver.value = false
  if (!currentConvId.value || currentConvType.value !== 'group') return
  const files = Array.from(event.dataTransfer?.files || [])
  addPendingFiles(files)
}

function hasFiles(event) {
  return Array.from(event.dataTransfer?.types || []).includes('Files')
}

function addPendingFiles(files) {
  const validFiles = files.filter(Boolean)
  if (!validFiles.length) return
  if (!currentConvId.value || currentConvType.value !== 'group') {
    ElMessage.warning('请选择一个群聊')
    return
  }

  const next = []
  for (const file of validFiles) {
    if (file.size > 8 * 1024 * 1024) {
      ElMessage.warning(`${file.name} 超过 8MB，暂未添加`)
      continue
    }
    next.push({
      id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
      file,
      preview_url: file.type?.startsWith('image/') ? URL.createObjectURL(file) : ''
    })
  }
  pendingFiles.value = [...pendingFiles.value, ...next]
}

function removePendingFile(id) {
  const item = pendingFiles.value.find(file => file.id === id)
  if (item?.preview_url) URL.revokeObjectURL(item.preview_url)
  pendingFiles.value = pendingFiles.value.filter(file => file.id !== id)
}

function clearPendingFiles() {
  for (const item of pendingFiles.value) {
    if (item.preview_url) URL.revokeObjectURL(item.preview_url)
  }
  pendingFiles.value = []
}

async function uploadFiles(items) {
  const validItems = items.filter(item => item?.file)
  if (!validItems.length) return

  uploading.value = true
  const uploadedIds = new Set()
  try {
    for (const item of validItems) {
      const file = item.file
      const data = await readFileAsDataUrl(file)
      const res = await fetch(`/api/conversations/${currentConvId.value}/files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({
          name: file.name,
          mime_type: file.type || 'application/octet-stream',
          size: file.size,
          data
        })
      })
      const json = await res.json()
      if (!json.success) {
        ElMessage.error(json.message || `${file.name} 上传失败`)
        continue
      }
      uploadedIds.add(item.id)
      if (!socket.value?.connected && json.data && !messages.value.some(item => item.id === json.data.id)) {
        messages.value.push(json.data)
        loadImagePreviews([json.data])
      }
    }
    for (const id of uploadedIds) removePendingFile(id)
    if (uploadedIds.size) ElMessage.success('已发送')
    refreshConversations()
  } finally {
    uploading.value = false
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

async function downloadFile(msg) {
  if (!msg.file_id) return
  try {
    const res = await fetch(`/api/chat/files/${msg.file_id}/download`, {
      headers: { Authorization: `Bearer ${token()}` }
    })
    if (!res.ok) throw new Error('下载失败')
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = msg.file_name || msg.content || '聊天文件'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  } catch (error) {
    ElMessage.error(error.message || '下载失败')
  }
}

function isImageMessage(msg) {
  return msg?.message_type === 'file' && String(msg.file_mime_type || '').startsWith('image/')
}

async function loadImagePreviews(list = []) {
  const imageMessages = list.filter(msg => isImageMessage(msg) && msg.file_id && !messageImageUrls.value[msg.file_id])
  for (const msg of imageMessages) {
    try {
      const res = await fetch(`/api/chat/files/${msg.file_id}/download`, {
        headers: { Authorization: `Bearer ${token()}` }
      })
      if (!res.ok) continue
      const blob = await res.blob()
      messageImageUrls.value = {
        ...messageImageUrls.value,
        [msg.file_id]: URL.createObjectURL(blob)
      }
    } catch {}
  }
}

function formatFileSize(size) {
  const n = Number(size || 0)
  if (!n) return '未知大小'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

async function handleCreateConv() {
  if (!newConvName.value) { ElMessage.warning('请输入群聊名称'); return }
  creating.value = true
  try {
    const res = await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({ type: 'group', name: newConvName.value, participant_ids: [] })
    })
    const json = await res.json()
    if (json.success) {
      ElMessage.success('创建成功')
      showNewConv.value = false
      newConvName.value = ''
      refreshConversations()
    }
  } finally { creating.value = false }
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
  connectSocket()
})

onUnmounted(() => {
  socket.value?.disconnect()
  clearPendingFiles()
  for (const url of Object.values(messageImageUrls.value)) URL.revokeObjectURL(url)
})
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
.msg-list { flex: 1; overflow-y: auto; padding: 20px; background: var(--bg-page); position: relative; }
.msg-list.drag-over {
  outline: 2px dashed var(--color-primary);
  outline-offset: -10px;
}
.drop-overlay {
  position: absolute;
  inset: 12px;
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--bg-card) 88%, var(--color-primary) 12%);
  color: var(--color-primary);
  font-weight: 600;
  pointer-events: none;
}
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
.file-bubble {
  padding: 8px;
  min-width: 260px;
}
.msg-item.mine .file-bubble {
  background: var(--bg-card);
  color: var(--text-primary);
}
.file-card {
  display: flex;
  align-items: center;
  gap: 10px;
}
.file-icon {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-primary) 14%, var(--bg-page));
  color: var(--color-primary);
  flex-shrink: 0;
}
.file-info {
  min-width: 0;
  flex: 1;
}
.file-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.file-meta {
  margin-top: 2px;
  font-size: 12px;
  color: var(--text-tertiary);
}
.file-download {
  width: 30px;
  height: 30px;
  border: 1px solid var(--border-light);
  border-radius: 6px;
  background: var(--bg-card);
  color: var(--text-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
}
.file-download:hover {
  color: var(--color-primary);
  border-color: var(--color-primary);
}
.image-message {
  width: min(300px, 60vw);
}
.image-message img {
  display: block;
  width: 100%;
  max-height: 260px;
  object-fit: contain;
  border-radius: 8px;
  background: var(--bg-page);
  cursor: zoom-in;
}
.image-loading {
  width: 260px;
  height: 150px;
  border-radius: 8px;
  background: var(--bg-page);
  color: var(--text-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
}
.image-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 6px;
  color: var(--text-tertiary);
  font-size: 12px;
}
.image-meta span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.msg-time { font-size: 11px; color: var(--text-placeholder); margin-top: 4px; }
.msg-item.mine .msg-time { text-align: right; }
.no-msg { text-align: center; color: var(--text-placeholder); margin-top: 60px; font-size: 14px; }
.msg-composer {
  border-top: 1px solid var(--border-color);
  background: var(--bg-card);
}
.pending-files {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 16px 0;
}
.pending-file {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 220px;
  min-height: 54px;
  padding: 8px 28px 8px 8px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--bg-card) 88%, var(--bg-page));
}
.pending-file img {
  width: 38px;
  height: 38px;
  border-radius: 6px;
  object-fit: cover;
  background: var(--bg-page);
  flex-shrink: 0;
}
.pending-file-icon {
  width: 38px;
  height: 38px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--color-primary) 12%, var(--bg-page));
  color: var(--color-primary);
  flex-shrink: 0;
}
.pending-file-info {
  min-width: 0;
}
.pending-file-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pending-file-size {
  margin-top: 2px;
  font-size: 12px;
  color: var(--text-tertiary);
}
.pending-remove {
  position: absolute;
  top: 5px;
  right: 5px;
  width: 18px;
  height: 18px;
  border: 0;
  border-radius: 50%;
  background: var(--border-light);
  color: var(--text-secondary);
  line-height: 18px;
  cursor: pointer;
}
.pending-remove:hover {
  background: #ef4444;
  color: #fff;
}
.msg-input { display: flex; padding: 12px 16px; gap: 8px; align-items: center; }
.msg-input input {
  flex: 1; border: 1px solid var(--border-color); border-radius: 20px; padding: 8px 16px; font-size: 14px; outline: none;
  transition: border-color 0.2s;
}
.msg-input input:focus { border-color: var(--color-primary); }
.msg-input input:disabled { background: var(--bg-page); cursor: not-allowed; }
.hidden-file-input { display: none; }
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
.dialog-tip {
  margin: -4px 0 4px 60px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-tertiary);
}
.typing-dots .dot { animation: blink 1.4s infinite; font-size: 24px; line-height: 0; }
.typing-dots .dot:nth-child(2) { animation-delay: 0.2s; }
.typing-dots .dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes blink { 0%,60%,100% { opacity: 0.3; } 30% { opacity: 1; } }
</style>
