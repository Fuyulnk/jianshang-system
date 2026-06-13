<template>
  <div class="ai-chat">
    <!-- 悬浮气泡 -->
    <div v-if="!visible" class="ai-bubble" @click="openChat">
      <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
    </div>

    <!-- 聊天窗口 -->
    <div v-if="visible" class="chat-panel">
      <div class="chat-header">
        <span class="chat-title">简尚小助手</span>
        <button class="close-btn" @click="closeChat">✕</button>
      </div>

      <div class="chat-messages" ref="msgContainer">
        <div v-if="messages.length === 0" class="welcome-msg">
          <div class="welcome-icon"><el-icon :size="48"><ChatDotSquare /></el-icon></div>
          <p>你好！我是简尚小助手，有什么可以帮你的？</p>
        </div>
        <div
          v-for="(msg, i) in messages"
          :key="i"
          :class="['message', msg.role === 'user' ? 'user-msg' : 'ai-msg']"
        >
          <div class="msg-content">{{ msg.content }}</div>
        </div>
        <div v-if="streaming" class="message ai-msg">
          <div class="msg-content typing">
            <span class="dot">.</span><span class="dot">.</span><span class="dot">.</span>
          </div>
        </div>
      </div>

      <div class="chat-input">
        <input
          v-model="inputText"
          type="text"
          placeholder="输入消息..."
          :disabled="streaming"
          @keydown.enter="sendMessage"
        />
        <button :class="['send-btn', { loading: streaming }]" @click="sendMessage" :disabled="streaming">
          {{ streaming ? '...' : '发送' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, nextTick, watch } from 'vue'
import { ChatDotSquare } from '@element-plus/icons-vue'

const visible = ref(false)
const inputText = ref('')
const messages = ref([])
const streaming = ref(false)
const sessionId = ref(null)
const msgContainer = ref(null)

function scrollToBottom() {
  nextTick(() => {
    const el = msgContainer.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

watch(messages, scrollToBottom, { deep: true })
watch(streaming, scrollToBottom)

function openChat() {
  visible.value = true
  loadHistory()
}

function closeChat() {
  visible.value = false
}

async function loadHistory() {
  const token = localStorage.getItem('token')
  if (!token) return
  try {
    const res = await fetch('/api/chat/history', {
      headers: { Authorization: `Bearer ${token}` }
    })
    const json = await res.json()
    if (json.success) {
      const sessions = Object.values(json.data)
      if (sessions.length > 0) {
        messages.value = sessions[sessions.length - 1]
        // 从历史消息中提取 session_id，保持上下文连续
        const lastMsg = sessions[sessions.length - 1]
        if (lastMsg.length > 0 && lastMsg[0].session_id) {
          sessionId.value = lastMsg[0].session_id
        }
      }
    }
  } catch {}
}

async function sendMessage() {
  const text = inputText.value.trim()
  if (!text || streaming.value) return

  const token = localStorage.getItem('token')
  if (!token) {
    messages.value.push({ role: 'assistant', content: '请先登录' })
    return
  }

  messages.value.push({ role: 'user', content: text })
  inputText.value = ''

  const aiIndex = messages.value.length
  messages.value.push({ role: 'assistant', content: '' })
  streaming.value = true

  try {
    const response = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        message: text,
        session_id: sessionId.value,
        agent_key: 'general',
        context_type: 'page',
        context_key: 'ai-chat'
      })
    })

    if (!response.ok) {
      messages.value[aiIndex] = { role: 'assistant', content: '请求失败，请稍后重试' }
      streaming.value = false
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

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
            if (parsed.type === 'session') {
              sessionId.value = parsed.session_id
            } else if (parsed.type === 'text') {
              messages.value[aiIndex] = {
                role: 'assistant',
                content: (messages.value[aiIndex]?.content || '') + parsed.content
              }
              messages.value = [...messages.value]
            } else if (parsed.type === 'error') {
              messages.value[aiIndex] = { role: 'assistant', content: parsed.content }
              messages.value = [...messages.value]
            }
          } catch {}
        }
      }
    }
  } catch {
    messages.value[aiIndex] = { role: 'assistant', content: '网络错误，请稍后重试' }
  }

  streaming.value = false
}
</script>

<style scoped>
.ai-bubble {
  position: fixed;
  bottom: 30px;
  right: 30px;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--color-primary);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 4px 20px rgba(79, 109, 245, 0.35);
  z-index: 1000;
  transition: transform 0.2s, box-shadow 0.2s;
}
.ai-bubble:hover {
  transform: scale(1.1);
  box-shadow: 0 6px 25px rgba(79, 109, 245, 0.45);
}

.chat-panel {
  position: fixed;
  bottom: 30px;
  right: 30px;
  width: 380px;
  height: 560px;
  background: var(--bg-card);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: slideUp 0.3s ease;
  border: 1px solid var(--border-light);
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  background: var(--color-primary);
  color: white;
}
.chat-title {
  font-size: 16px;
  font-weight: 600;
}
.close-btn {
  background: none;
  border: none;
  color: white;
  font-size: 18px;
  cursor: pointer;
  opacity: 0.8;
  padding: 0;
  line-height: 1;
}
.close-btn:hover { opacity: 1; }

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  background: var(--bg-page);
}

.welcome-msg {
  text-align: center;
  color: var(--text-tertiary);
  margin-top: 80px;
}
.welcome-icon { font-size: 48px; margin-bottom: 12px; }
.welcome-msg p { font-size: 14px; line-height: 1.6; }

.message { margin-bottom: 12px; display: flex; }
.user-msg { justify-content: flex-end; }
.ai-msg { justify-content: flex-start; }

.msg-content {
  max-width: 80%;
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.5;
  word-break: break-word;
}

.user-msg .msg-content {
  background: var(--color-primary);
  color: white;
  border-bottom-right-radius: 4px;
}

.ai-msg .msg-content {
  background: var(--bg-card);
  color: var(--text-primary);
  border-bottom-left-radius: 4px;
  box-shadow: var(--shadow-xs);
  border: 1px solid var(--border-light);
}

.typing .dot { animation: blink 1.4s infinite; font-size: 24px; line-height: 0; }
.typing .dot:nth-child(2) { animation-delay: 0.2s; }
.typing .dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes blink { 0%,60%,100% { opacity: 0.3; } 30% { opacity: 1; } }

.chat-input {
  display: flex;
  padding: 12px;
  border-top: 1px solid var(--border-color);
  background: var(--bg-card);
  gap: 8px;
}
.chat-input input {
  flex: 1;
  border: 1px solid var(--border-color);
  border-radius: 20px;
  padding: 8px 16px;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
  background: var(--bg-page);
  color: var(--text-primary);
}
.chat-input input:focus { border-color: var(--color-primary); }
.chat-input input:disabled { opacity: 0.6; cursor: not-allowed; }

.send-btn {
  padding: 8px 16px;
  border: none;
  border-radius: 20px;
  background: var(--color-primary);
  color: white;
  font-size: 14px;
  cursor: pointer;
  transition: opacity 0.2s;
}
.send-btn:hover { opacity: 0.9; }
.send-btn.loading { opacity: 0.6; cursor: not-allowed; }
</style>
