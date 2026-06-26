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
        <UserAvatar v-else-if="conv.avatar_url" :username="conv.name || '群聊'" :avatar-url="conv.avatar_url" :size="40" />
        <div v-else class="conv-avatar">群</div>
        <div class="conv-info">
          <div class="conv-top">
            <span class="conv-name">
              <span v-if="conv.is_pinned" class="conv-badge">置顶</span>
              <span class="conv-title">{{ conv.type === 'group' ? conv.name : (conv.other_user?.username || '未知') }}</span>
              <span v-if="conv.muted" class="conv-muted">免打扰</span>
            </span>
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
          <div class="msg-header-right">
            <div v-if="currentConvName === '财务群'" class="recent-dropdown" @click.stop>
              <el-button size="small" text @click="showRecent = !showRecent">📋 最近录入</el-button>
              <div v-if="showRecent" class="recent-panel" @mouseleave="showRecent = false">
                <div v-if="recentLoading" class="recent-loading">加载中...</div>
                <div v-else-if="!recentEntries.length" class="recent-empty">暂无录入</div>
                <div v-for="item in recentEntries" :key="item.id" class="recent-item" @click="goToFinance">
                  <span :class="['recent-type', item.type]">{{ item.type === 'income' ? '收入' : '支出' }}</span>
                  <span class="recent-amount">{{ formatMoney(item.amount) }}</span>
                  <span class="recent-desc">{{ item.description || item.party || '-' }}</span>
                  <span v-if="item.status === 'pending'" class="recent-status">待确认</span>
                  <button
                    v-if="item.status === 'pending'"
                    class="recent-confirm"
                    type="button"
                    :disabled="confirmingEntryId === item.id"
                    @click.stop="confirmRecentEntry(item)"
                  >
                    确认
                  </button>
                  <span class="recent-time">{{ formatShortTime(item.created_at) }}</span>
                </div>
              </div>
            </div>
          </div>
          <el-button
            v-if="currentConvType === 'group'"
            size="small"
            text
            :icon="Setting"
            title="群聊设置"
            @click="showGroupSettings = true"
          >
            群设置
          </el-button>
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
              <UserAvatar :username="msg.display_name || msg.username || '?'" :avatar-url="msg.avatar_url || ''" :size="32" />
            </div>
            <div class="msg-body">
              <div class="msg-name" v-if="msg.user_id !== userId && currentConvType === 'group'">
                {{ msg.username === 'ai' ? 'AI 小助手' : (msg.display_name || msg.username) }}
              </div>
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
            <div class="input-wrap">
              <span v-if="currentConvType === 'group'" class="input-ai" @click="insertAtAi" title="在输入中插入 @AI">@AI</span>
              <input v-model="inputText" type="text" :placeholder="inputPlaceholder" :disabled="uploading" @keydown.enter="sendMessage" />
              <button class="input-send" :disabled="uploading || (!inputText.trim() && !pendingFiles.length)" @click="sendMessage" title="发送">
                <el-icon><Promotion /></el-icon>
              </button>
            </div>
            <input ref="fileInputRef" type="file" multiple class="hidden-file-input" @change="handleFilePick" />
            <button class="input-file" :loading="uploading" @click="openFilePicker" title="选择文件">
              <el-icon><Paperclip /></el-icon>
            </button>
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
          <div class="input-wrap">
            <input v-model="aiInput" type="text" placeholder="向 AI 小助手提问..." :disabled="aiStreaming" @keydown.enter="sendAiMessage" />
            <button class="input-send" :disabled="aiStreaming || !aiInput.trim()" @click="sendAiMessage" title="发送">
              <el-icon><Promotion /></el-icon>
            </button>
          </div>
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

    <GroupSettingsDrawer
      v-model="showGroupSettings"
      :conversation-id="currentConvId"
      :conversation-name="currentConvName"
      :conversation="currentConv || {}"
      @changed="handleGroupSettingsChanged"
      @cleared="handleGroupMessagesCleared"
    />
  </div>
</template>

<script setup>
import { getAuthToken } from '../../utils/authSession'
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ChatDotSquare, Cpu, Document, Download, Paperclip, Promotion, Setting, UploadFilled } from '@element-plus/icons-vue'
import { io } from 'socket.io-client'
import UserAvatar from '../../components/UserAvatar.vue'
import GroupSettingsDrawer from '../../components/chat/GroupSettingsDrawer.vue'

const conversations = ref([])
const messages = ref([])
const currentConvId = ref(null)
const currentConv = ref(null)
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
const showRecent = ref(false)
const recentEntries = ref([])
const recentLoading = ref(false)
const confirmingEntryId = ref(0)

const showNewConv = ref(false)
const newConvName = ref('')
const creating = ref(false)
const showGroupSettings = ref(false)

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

function token() { return getAuthToken() }

// Socket.io
function connectSocket() {
  socket.value = io({ auth: { token: token() }, reconnectionAttempts: Infinity })
  socket.value.on('connect', () => {
    // 断线重连后自动 rejoin 当前会话
    if (currentConvId.value) {
      socket.value.emit('join:conversation', currentConvId.value)
    }
  })
  socket.value.on('message:new', (msg) => {
    if (msg.conversation_id === currentConvId.value) {
      if (!messages.value.some(item => item.id === msg.id)) messages.value.push(msg)
      loadImagePreviews([msg])
      scrollBottom()
    }
    refreshConversations()
  })
  socket.value.on('conversation:members_changed', (event) => {
    if (event?.conversation_id === currentConvId.value && event.member_count) {
      currentConvMeta.value = `${event.member_count} 人`
    }
    refreshConversations()
  })
  socket.value.on('conversation:member_removed', (event) => {
    if (event?.conversation_id !== currentConvId.value) {
      refreshConversations()
      return
    }
    if (Number(event.user_id) === Number(userId.value)) {
      ElMessage.warning('你已被移出该群聊')
      resetCurrentConversation()
      refreshConversations()
      return
    }
    if (event.member_count) currentConvMeta.value = `${event.member_count} 人`
  })
  socket.value.on('conversation:messages_cleared', (event) => {
    if (event?.conversation_id === currentConvId.value) handleGroupMessagesCleared()
    refreshConversations()
  })
  socket.value.on('conversation:updated', (event) => {
    if (event?.conversation_id === currentConvId.value && currentConv.value) {
      currentConv.value = {
        ...currentConv.value,
        name: event.name || currentConv.value.name,
        avatar_url: event.avatar_url || ''
      }
      currentConvName.value = currentConv.value.name || currentConvName.value
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
    if (json.success) {
      conversations.value = json.data || []
      if (currentConvId.value) {
        const latest = conversations.value.find(item => Number(item.id) === Number(currentConvId.value))
        if (latest) {
          currentConv.value = latest
          currentConvName.value = latest.type === 'group' ? latest.name : (latest.other_user?.username || '私聊')
        }
      }
    }
  } finally { loading.value = false }
}

// 选择 AI 对话
function selectAi() {
  isAiMode.value = true
  currentConvId.value = null
  currentConv.value = null
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
    const response = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({
        message: text,
        session_id: aiSessionId.value,
        agent_key: 'general',
        context_type: 'page',
        context_key: 'chat'
      })
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
  currentConv.value = conv
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

function resetCurrentConversation() {
  currentConvId.value = null
  currentConv.value = null
  currentConvType.value = ''
  currentConvName.value = ''
  currentConvMeta.value = ''
  messages.value = []
  inputText.value = ''
  showGroupSettings.value = false
  clearPendingFiles()
  clearMessageImages()
}

function handleGroupSettingsChanged(event) {
  if (event?.member_count && currentConvType.value === 'group') {
    currentConvMeta.value = `${event.member_count} 人`
  }
  if (event?.conversation && currentConv.value) {
    currentConv.value = {
      ...currentConv.value,
      ...event.conversation
    }
    currentConvName.value = currentConv.value.name || currentConvName.value
  }
  if (event?.preferences && currentConv.value) {
    currentConv.value = {
      ...currentConv.value,
      is_pinned: event.preferences.is_pinned ? 1 : 0,
      muted: event.preferences.muted ? 1 : 0,
      group_nickname: event.preferences.group_nickname || ''
    }
  }
  refreshConversations()
}

function handleGroupMessagesCleared() {
  messages.value = []
  clearMessageImages()
  refreshConversations()
}

async function sendMessage() {
  const text = inputText.value.trim()
  const files = [...pendingFiles.value]
  if ((!text && !files.length) || !currentConvId.value || uploading.value) return

  if (text) {
    socket.value?.emit('message:send', { conversation_id: currentConvId.value, content: text })
    inputText.value = ''
    if (currentConvName.value === '财务群') {
      window.setTimeout(fetchRecentEntries, 900)
    }
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

function clearMessageImages() {
  for (const url of Object.values(messageImageUrls.value)) URL.revokeObjectURL(url)
  messageImageUrls.value = {}
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
  const d = parseDateTime(t)
  if (!d) return ''
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

function formatShortTime(t) {
  if (!t) return ''
  const d = parseDateTime(t)
  if (!d) return ''
  const raw = String(t || '')
  if (/\s00:00(?::00)?$/.test(raw) || /T00:00(?::00)?/.test(raw)) {
    return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
  }
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function parseDateTime(value) {
  const text = String(value || '').trim()
  if (!text) return null
  const normalized = text.includes('T') ? text : text.replace(/-/g, '/')
  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function formatMoney(v) {
  const n = Number(v || 0)
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

async function fetchRecentEntries() {
  if (currentConvName.value !== '财务群') return
  recentLoading.value = true
  try {
    const res = await fetch('/api/transactions/recent?entry_source=finance_group&limit=5', {
      headers: { Authorization: `Bearer ${token()}` }
    })
    const json = await res.json()
    if (json.success) recentEntries.value = json.data
  } catch {} finally { recentLoading.value = false }
}

async function confirmRecentEntry(item) {
  try {
    await ElMessageBox.confirm('确认后这条流水会生效，并更新账户余额。', '确认流水')
    confirmingEntryId.value = item.id
    const res = await fetch(`/api/transactions/${item.id}/confirm`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token()}` }
    })
    const json = await res.json()
    if (!json.success) throw new Error(json.message || '确认失败')
    ElMessage.success(json.message || '流水已确认')
    await fetchRecentEntries()
  } catch (error) {
    if (!['cancel', 'close'].includes(error)) ElMessage.error(error.message || '确认失败')
  } finally {
    confirmingEntryId.value = 0
  }
}

function goToFinance() {
  window.open('/main/transactions', '_blank')
}

watch(currentConvName, (name) => {
  if (name === '财务群') fetchRecentEntries()
  else showRecent.value = false
})

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
  clearMessageImages()
})
</script>

<style scoped>
.chat-page {
  display: flex;
  gap: 8px;
  height: calc(100vh - var(--header-height));
  margin: -24px;
  padding: 8px;
  align-items: stretch;
  overflow: hidden;
}
.conv-list {
  width: 280px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-radius: 16px;
  overflow: hidden;
  isolation: isolate;
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.6);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.06);
}
.dark .conv-list {
  background: var(--bg-card);
  border-color: var(--border-light);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.28);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  isolation: isolate;
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
  margin: 0 6px;
  border-radius: 10px;
}
.conv-item:hover { background: rgba(0, 0, 0, 0.04); }
.dark .conv-item:hover { background: rgba(255, 255, 255, 0.06); }
.conv-item.active { background: rgba(64, 128, 255, 0.1); }
.dark .conv-item.active { background: rgba(64, 128, 255, 0.15); }
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
.conv-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.conv-name {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
}
.conv-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.conv-badge,
.conv-muted {
  flex: 0 0 auto;
  padding: 1px 5px;
  border-radius: 999px;
  font-size: 10px;
  line-height: 16px;
  font-weight: 600;
}
.conv-badge {
  background: rgba(59, 130, 246, 0.12);
  color: #2563eb;
}
.conv-muted {
  background: rgba(148, 163, 184, 0.14);
  color: #64748b;
}
.conv-time { font-size: 11px; color: var(--text-tertiary); }
.conv-last { font-size: 13px; color: var(--text-tertiary); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.msg-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  border-radius: 16px;
  overflow: hidden;
  background: var(--bg-page);
  box-shadow: var(--shadow-sm);
  min-width: 0;
  isolation: isolate;
}
.no-conv { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--text-tertiary); }
.no-conv-icon { font-size: 64px; margin-bottom: 16px; color: var(--text-placeholder); }
.msg-header {
  padding: 16px 20px; border-bottom: 1px solid var(--border-color);
  font-weight: 600; font-size: 15px; display: flex; align-items: center; gap: 12px;
}
.msg-header-meta { font-weight: 400; font-size: 13px; color: var(--text-tertiary); }
.msg-header-right {
  margin-left: auto;
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
}
.recent-dropdown { position: relative; }
.recent-panel {
  position: absolute; right: 0; top: 36px; z-index: 100;
  width: 360px; max-height: 320px; overflow-y: auto;
  background: var(--bg-card); border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.12); border: 1px solid var(--border-color);
  padding: 8px;
}
.dark .recent-panel { background: rgba(30,30,35,0.95); }
.recent-loading, .recent-empty { padding: 24px; text-align: center; color: var(--text-tertiary); font-size: 13px; }
.recent-item {
  display: flex; align-items: center; gap: 8px; padding: 8px 10px;
  border-radius: 8px; cursor: pointer; text-decoration: none; transition: background 0.1s;
}
.recent-item:hover { background: var(--border-light); }
.recent-type {
  font-size: 11px; font-weight: 600; padding: 2px 6px; border-radius: 4px; flex-shrink: 0;
}
.recent-type.income { background: #dcfce7; color: #166534; }
.recent-type.expense { background: #fee2e2; color: #991b1b; }
.dark .recent-type.income { background: rgba(22,101,52,0.3); color: #86efac; }
.dark .recent-type.expense { background: rgba(153,27,27,0.3); color: #fca5a5; }
.recent-amount { font-size: 13px; font-weight: 600; color: var(--text-primary); flex-shrink: 0; }
.recent-desc { font-size: 12px; color: var(--text-tertiary); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.recent-time { font-size: 11px; color: var(--text-placeholder); flex-shrink: 0; }
.recent-status {
  flex-shrink: 0;
  padding: 2px 6px;
  border-radius: 999px;
  background: rgba(245, 158, 11, 0.14);
  color: #b45309;
  font-size: 11px;
  font-weight: 700;
}
.recent-confirm {
  flex-shrink: 0;
  border: 0;
  border-radius: 6px;
  padding: 4px 8px;
  background: var(--color-primary);
  color: #fff;
  font-size: 12px;
  cursor: pointer;
}
.recent-confirm:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.dark .recent-status {
  background: rgba(245, 158, 11, 0.24);
  color: #fcd34d;
}
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
  padding: 0 12px 12px;
  background: transparent;
  border-top: none;
}
.pending-files {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0 12px 8px;
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
.msg-input {
  display: flex;
  padding: 8px 12px;
  gap: 8px;
  align-items: center;
  border-radius: 14px;
  background: var(--bg-card);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
  border: 1px solid var(--border-color);
  transition: box-shadow 0.2s, border-color 0.2s;
}
.msg-input:focus-within {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
  border-color: var(--color-primary);
}
.dark .msg-input {
  background: rgba(40, 40, 45, 0.8);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
}
.msg-input input {
  flex: 1; border: 1px solid var(--border-color); border-radius: 20px; padding: 8px 16px; font-size: 14px; outline: none;
  transition: border-color 0.2s;
  background: transparent;
}
.msg-input input:focus { border-color: var(--color-primary); }
.msg-input input:disabled { background: var(--bg-page); cursor: not-allowed; }
.msg-input input:disabled { background: transparent; cursor: not-allowed; }
.input-ai {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  font-size: 10px;
  font-weight: 700;
  background: var(--color-primary);
  color: #fff;
  cursor: pointer;
  flex-shrink: 0;
  margin-left: 4px;
  transition: opacity 0.15s;
  user-select: none;
}
.input-ai:hover { opacity: 0.85; }
.hidden-file-input { display: none; }
.msg-input {
  display: flex;
  align-items: center;
  gap: 6px;
}
.input-wrap {
  flex: 1;
  display: flex;
  align-items: center;
  border: 1px solid var(--border-color);
  border-radius: 20px;
  background: var(--bg-card);
  transition: border-color 0.2s, box-shadow 0.2s;
  overflow: hidden;
}
.input-wrap:focus-within {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 1px var(--color-primary);
}
.dark .input-wrap {
  background: rgba(40, 40, 45, 0.8);
}
.input-wrap input {
  flex: 1;
  border: none;
  outline: none;
  padding: 8px 0 8px 6px;
  font-size: 14px;
  background: transparent;
}
.input-send {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: var(--color-primary);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  margin-right: 3px;
  transition: opacity 0.15s;
}
.input-send:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.input-send:hover:not(:disabled) {
  opacity: 0.85;
}
.input-file {
  width: 34px;
  height: 34px;
  border: 1px solid var(--border-color);
  border-radius: 50%;
  background: transparent;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: color 0.15s, border-color 0.15s;
}
.input-file:hover {
  color: var(--color-primary);
  border-color: var(--color-primary);
}


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
