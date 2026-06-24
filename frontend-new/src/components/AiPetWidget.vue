<template>
  <div class="ai-pet-wrap">
    <!-- 隐藏时的触发区 -->
    <div v-if="hidden" class="pet-hidden-trigger" @mouseenter="hiddenTrigger = true" @mouseleave="hiddenTrigger = false">
      <Transition name="fade">
        <div v-if="hiddenTrigger" class="pet-show-btn" @click="showPet">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          显示 AI
          <span class="shortcut-hint">⌘⇧A</span>
        </div>
      </Transition>
    </div>

    <!-- 宠物主体 -->
    <div v-show="!hidden" ref="petRef" class="pet-container" :style="petStyle">
      <!-- 角色 -->
      <div class="pet-character" draggable="false" @dragstart.prevent @mousedown.prevent="startDrag" @contextmenu.prevent="openMenu">
        <div class="pet-avatar">
          <span class="pet-emoji">{{ characters[currentChar].emoji }}</span>
        </div>
      </div>

      <!-- 对话气泡 -->
      <Transition name="bubble">
        <div v-if="chatOpen" ref="bubbleRef" :class="['pet-bubble', { resizing: resizeState }]" :style="bubbleStyle">
          <div class="bubble-header">
            <div class="bubble-title">
              <span class="bubble-avatar">{{ characters[currentChar].emoji }}</span>
              <span>{{ aiName }}</span>
            </div>
            <div class="bubble-actions">
              <button class="bubble-action" @click="resetBubbleSize" title="还原尺寸">
                <el-icon><Refresh /></el-icon>
              </button>
              <button class="bubble-action" @click="chatOpen = false" title="关闭">
                <el-icon><Close /></el-icon>
              </button>
            </div>
          </div>

          <div class="bubble-msgs" ref="msgRef">
            <div v-if="messages.length === 0" class="bubble-welcome">
              <p>你好！有什么可以帮你？</p>
            </div>
            <div v-for="(msg, i) in messages" :key="i"
              :class="['bubble-msg', msg.role === 'user' ? 'user' : 'ai']">
              <div class="bubble-text">{{ msg.content }}</div>
            </div>
            <div v-if="streaming" class="bubble-msg ai">
              <div class="bubble-text typing">
                <span class="dot">.</span><span class="dot">.</span><span class="dot">.</span>
              </div>
            </div>
          </div>

          <div class="bubble-foot">
            <input v-model="inputText" type="text" placeholder="提问..." :disabled="streaming"
              @keydown.enter="sendMessage" />
            <button :class="['bubble-send', { loading: streaming }]" :disabled="streaming"
              @click="sendMessage">{{ streaming ? '…' : '↵' }}</button>
          </div>

          <div class="bubble-resize-handle" @mousedown.prevent="startResize" title="拖拽调整窗口大小" />
        </div>
      </Transition>
    </div>

    <!-- 右键菜单 -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="menuShow" class="menu-overlay" @click="menuShow = false" @contextmenu.prevent />
      </Transition>
      <Transition name="pop">
        <div v-if="menuShow" class="pet-menu" :style="{ left: menuX + 'px', top: menuY + 'px' }">
          <div class="menu-item" @click="hidePet"><el-icon><Hide /></el-icon> 隐藏</div>
          <div class="menu-item" @click="cycleChar"><el-icon><Refresh /></el-icon> 切换形象</div>
          <div class="menu-item" @click="resetBubbleSize"><el-icon><Refresh /></el-icon> 还原窗口尺寸</div>
          <div class="menu-item" @click="menuShow = false"><el-icon><Close /></el-icon> 取消</div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import { getAuthToken, safeJsonParse, safeLocalStorageGet, safeLocalStorageSet } from '../utils/authSession'
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { Hide, Refresh, Close } from '@element-plus/icons-vue'

// ====== 形象管理 ======
const characters = [
  { emoji: '😼', name: '望舒' },
  { emoji: '🤖', name: 'AI' },
  { emoji: '🐱', name: '小猫' },
  { emoji: '🦊', name: '狐狸' },
  { emoji: '👻', name: '幽灵' },
]

// ====== 状态 ======
const hidden = ref(false)
const hiddenTrigger = ref(false)
const chatOpen = ref(false)
const currentChar = ref(0)
const charX = ref(0)
const charY = ref(0)
const dragState = ref(null)
const menuShow = ref(false)
const menuX = ref(0)
const menuY = ref(0)
const inputText = ref('')
const messages = ref([])
const streaming = ref(false)
const sessionId = ref(null)
const msgRef = ref(null)
const bubbleRef = ref(null)
const aiName = ref('简尚小助手')
const viewport = ref({ width: window.innerWidth, height: window.innerHeight })
const bubbleSize = ref({ width: 380, height: 560 })
const resizeState = ref(null)

const DEFAULT_BUBBLE_SIZE = { width: 380, height: 560 }
const MIN_BUBBLE_SIZE = { width: 320, height: 420 }
const VIEWPORT_MARGIN = 16

const isMobile = computed(() => viewport.value.width <= 640)

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function getClampedBubbleSize(size = bubbleSize.value) {
  const maxWidth = Math.max(MIN_BUBBLE_SIZE.width, viewport.value.width - VIEWPORT_MARGIN * 2)
  const maxHeight = Math.max(MIN_BUBBLE_SIZE.height, viewport.value.height - VIEWPORT_MARGIN * 2)
  return {
    width: clamp(size.width, MIN_BUBBLE_SIZE.width, maxWidth),
    height: clamp(size.height, MIN_BUBBLE_SIZE.height, maxHeight)
  }
}

// ====== 从 localStorage 恢复 ======
function loadState() {
  const pos = safeLocalStorageGet('ai-pet-pos', '')
  if (pos) {
    const [x, y] = pos.split(',').map(Number)
    if (!isNaN(x) && !isNaN(y)) { charX.value = x; charY.value = y }
  }
  const ch = safeLocalStorageGet('ai-pet-char')
  if (ch !== null) currentChar.value = parseInt(ch) || 0
  const h = safeLocalStorageGet('ai-pet-hidden')
  if (h === 'true') hidden.value = true
  aiName.value = safeLocalStorageGet('ai-name', '简尚小助手') || '简尚小助手'
  const storedSize = safeLocalStorageGet('ai-pet-size', '')
  if (storedSize) {
    const parsed = safeJsonParse(storedSize, null)
    if (Number.isFinite(parsed?.width) && Number.isFinite(parsed?.height)) {
      bubbleSize.value = getClampedBubbleSize(parsed)
    }
  }
}

function applySettings(e) {
  const detail = e.detail || {}
  if (typeof detail.hidden === 'boolean') hidden.value = detail.hidden
  if (detail.aiName) aiName.value = detail.aiName
}

function savePos() {
  safeLocalStorageSet('ai-pet-pos', `${charX.value},${charY.value}`)
}

function saveBubbleSize() {
  safeLocalStorageSet('ai-pet-size', JSON.stringify(bubbleSize.value))
}

// ====== 宠物定位 ======
const petStyle = computed(() => ({
  left: charX.value + 'px',
  top: charY.value + 'px',
}))

const bubbleStyle = computed(() => {
  if (isMobile.value) return {}

  const size = getClampedBubbleSize()
  const petSize = 56
  const gap = 10
  const centerX = charX.value + petSize / 2
  const spaceBelow = viewport.value.height - (charY.value + petSize)
  const showBelow = spaceBelow >= size.height + gap + VIEWPORT_MARGIN || spaceBelow >= charY.value
  const absLeft = clamp(
    centerX - size.width / 2,
    VIEWPORT_MARGIN,
    viewport.value.width - size.width - VIEWPORT_MARGIN
  )
  const desiredTop = showBelow ? charY.value + petSize + gap : charY.value - size.height - gap
  const absTop = clamp(
    desiredTop,
    VIEWPORT_MARGIN,
    viewport.value.height - size.height - VIEWPORT_MARGIN
  )

  return {
    left: `${absLeft - charX.value}px`,
    top: `${absTop - charY.value}px`,
    transform: 'none',
    width: `${size.width}px`,
    height: `${size.height}px`
  }
})

// ====== 默认位置 ======
function setDefaultPos() {
  charX.value = window.innerWidth - 100
  charY.value = window.innerHeight - 160
}

function updateViewport() {
  viewport.value = { width: window.innerWidth, height: window.innerHeight }
  bubbleSize.value = getClampedBubbleSize()
  const pet = document.querySelector('.pet-container')
  const rect = pet?.getBoundingClientRect()
  const w = rect?.width || 56
  const h = rect?.height || 56
  charX.value = clamp(charX.value, 0, Math.max(0, window.innerWidth - w))
  charY.value = clamp(charY.value, 0, Math.max(0, window.innerHeight - h))
  savePos()
  saveBubbleSize()
}

function resetBubbleSize() {
  bubbleSize.value = getClampedBubbleSize(DEFAULT_BUBBLE_SIZE)
  saveBubbleSize()
  menuShow.value = false
}

// ====== 拖拽 ======
function startDrag(e) {
  if (e.button !== 0) return
  window.getSelection?.()?.removeAllRanges()
  dragState.value = {
    startX: e.clientX, startY: e.clientY,
    origX: charX.value, origY: charY.value,
    isDrag: false
  }
  document.body.classList.add('ai-pet-dragging')
  document.addEventListener('mousemove', onDrag)
  document.addEventListener('mouseup', endDrag)
}

// ====== 窗口缩放 ======
function startResize(e) {
  if (isMobile.value) return
  e.preventDefault()
  window.getSelection?.()?.removeAllRanges()
  resizeState.value = {
    startX: e.clientX,
    startY: e.clientY,
    startWidth: bubbleSize.value.width,
    startHeight: bubbleSize.value.height
  }
  document.body.classList.add('ai-pet-resizing')
  document.addEventListener('mousemove', onResize)
  document.addEventListener('mouseup', endResize)
}

function onResize(e) {
  if (!resizeState.value) return
  e.preventDefault()
  window.getSelection?.()?.removeAllRanges()
  const maxWidth = Math.max(MIN_BUBBLE_SIZE.width, viewport.value.width - VIEWPORT_MARGIN * 2)
  const maxHeight = Math.max(MIN_BUBBLE_SIZE.height, viewport.value.height - VIEWPORT_MARGIN * 2)
  bubbleSize.value = {
    width: clamp(resizeState.value.startWidth - (e.clientX - resizeState.value.startX), MIN_BUBBLE_SIZE.width, maxWidth),
    height: clamp(resizeState.value.startHeight - (e.clientY - resizeState.value.startY), MIN_BUBBLE_SIZE.height, maxHeight)
  }
}

function endResize() {
  document.removeEventListener('mousemove', onResize)
  document.removeEventListener('mouseup', endResize)
  document.body.classList.remove('ai-pet-resizing')
  window.getSelection?.()?.removeAllRanges()
  if (resizeState.value) saveBubbleSize()
  resizeState.value = null
}

function onDrag(e) {
  if (!dragState.value) return
  e.preventDefault()
  const dx = e.clientX - dragState.value.startX
  const dy = e.clientY - dragState.value.startY
  if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
    dragState.value.isDrag = true
  }
  if (dragState.value.isDrag) {
    const pet = document.querySelector('.pet-container')
    const rect = pet?.getBoundingClientRect()
    const w = rect?.width || 56
    const h = rect?.height || 56
    charX.value = Math.max(0, Math.min(window.innerWidth - w, dragState.value.origX + dx))
    charY.value = Math.max(0, Math.min(window.innerHeight - h, dragState.value.origY + dy))
  }
}

function endDrag() {
  document.removeEventListener('mousemove', onDrag)
  document.removeEventListener('mouseup', endDrag)
  document.body.classList.remove('ai-pet-dragging')
  window.getSelection?.()?.removeAllRanges()
  if (dragState.value) {
    if (!dragState.value.isDrag) {
      toggleChat()
    } else {
      savePos()
    }
  }
  dragState.value = null
}

// ====== 对话 ======
function toggleChat() {
  chatOpen.value = !chatOpen.value
  if (chatOpen.value && messages.value.length === 0) loadHistory()
}

function scrollDown() {
  nextTick(() => {
    const el = msgRef.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

watch(messages, scrollDown, { deep: true })
watch(streaming, scrollDown)

function token() { return getAuthToken() }

async function loadHistory() {
  const t = token()
  if (!t) return
  try {
    const res = await fetch('/api/chat/history', { headers: { Authorization: `Bearer ${t}` } })
    const json = await res.json()
    if (json.success) {
      const sessions = Object.values(json.data)
      if (sessions.length) {
        messages.value = sessions[sessions.length - 1]
        const lastSession = sessions[sessions.length - 1]
        if (lastSession.length && lastSession[0].session_id) {
          sessionId.value = lastSession[0].session_id
        }
      }
    }
  } catch {}
}

async function sendMessage() {
  const text = inputText.value.trim()
  if (!text || streaming.value) return
  const t = token()
  if (!t) {
    messages.value.push({ role: 'assistant', content: '请先登录后再使用简尚小助手。' })
    return
  }

  messages.value.push({ role: 'user', content: text })
  const idx = messages.value.length
  messages.value.push({ role: 'assistant', content: '' })
  inputText.value = ''
  streaming.value = true

  try {
    const res = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
      body: JSON.stringify({
        message: text,
        session_id: sessionId.value,
        agent_key: 'general',
        context_type: 'page',
        context_key: 'ai-pet'
      })
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      messages.value[idx] = { role: 'assistant', content: err.message || 'AI 请求失败，请稍后重试。' }
      messages.value = [...messages.value]
      return
    }
    if (!res.body) {
      messages.value[idx] = { role: 'assistant', content: 'AI 没有返回内容，请稍后重试。' }
      messages.value = [...messages.value]
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let content = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() || ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (data === '[DONE]') continue
        try {
          const p = JSON.parse(data)
          if (p.type === 'session') sessionId.value = p.session_id
          else if (p.type === 'text') {
            content += p.content
            messages.value[idx] = { role: 'assistant', content }
            messages.value = [...messages.value]
          } else if (p.type === 'error') {
            messages.value[idx] = { role: 'assistant', content: p.content || 'AI 返回错误，请稍后重试。' }
            messages.value = [...messages.value]
          }
        } catch {}
      }
    }
    if (!content && !messages.value[idx]?.content) {
      messages.value[idx] = { role: 'assistant', content: 'AI 暂时没有返回内容，请稍后再试。' }
      messages.value = [...messages.value]
    }
  } catch {
    messages.value[idx] = { role: 'assistant', content: '网络错误，请检查服务器连接。' }
    messages.value = [...messages.value]
  } finally {
    streaming.value = false
  }
}

// ====== 右键菜单 ======
function openMenu(e) {
  const menuWidth = 156
  const menuHeight = 150
  menuX.value = clamp(e.clientX, VIEWPORT_MARGIN, window.innerWidth - menuWidth - VIEWPORT_MARGIN)
  menuY.value = clamp(e.clientY, VIEWPORT_MARGIN, window.innerHeight - menuHeight - VIEWPORT_MARGIN)
  menuShow.value = true
}

function hidePet() {
  hidden.value = true
  chatOpen.value = false
  menuShow.value = false
  safeLocalStorageSet('ai-pet-hidden', 'true')
}

function showPet() {
  hidden.value = false
  hiddenTrigger.value = false
  safeLocalStorageSet('ai-pet-hidden', 'false')
}

function cycleChar() {
  currentChar.value = (currentChar.value + 1) % characters.length
  safeLocalStorageSet('ai-pet-char', String(currentChar.value))
  menuShow.value = false
}

// ====== 键盘快捷键 ======
function handleKeydown(e) {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'a' || e.key === 'A')) {
    e.preventDefault()
    if (hidden.value) {
      showPet()
    } else {
      hidePet()
    }
  }
}

// ====== 生命周期 ======
onMounted(() => {
  loadState()
  if (charX.value === 0 && charY.value === 0) setDefaultPos()
  document.addEventListener('keydown', handleKeydown)
  window.addEventListener('resize', updateViewport)
  window.addEventListener('ai-pet-settings', applySettings)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
  document.removeEventListener('mousemove', onResize)
  document.removeEventListener('mouseup', endResize)
  document.body.classList.remove('ai-pet-resizing')
  document.body.classList.remove('ai-pet-dragging')
  window.removeEventListener('resize', updateViewport)
  window.removeEventListener('ai-pet-settings', applySettings)
})
</script>

<style scoped>
.ai-pet-wrap {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 9999;
  user-select: none;
  -webkit-user-select: none;
}
.ai-pet-wrap > * {
  pointer-events: auto;
}

/* 隐藏触发区 */
.pet-hidden-trigger {
  position: fixed;
  bottom: 0;
  right: 0;
  width: 80px;
  height: 60px;
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  padding: 0 8px 8px;
}
.pet-show-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  border-radius: 20px;
  background: var(--color-primary);
  color: #fff;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  box-shadow: var(--shadow-md);
  transition: opacity 0.2s;
}
.pet-show-btn:hover {
  opacity: 0.9;
}
.shortcut-hint {
  font-size: 10px;
  opacity: 0.6;
  margin-left: 2px;
}

/* 宠物容器 */
.pet-container {
  position: fixed;
  z-index: 9999;
  pointer-events: auto;
  user-select: none;
  -webkit-user-select: none;
}

/* 角色 */
.pet-character {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--bg-card);
  border: 2px solid var(--border-color);
  box-shadow: var(--shadow-md);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  transition: box-shadow 0.2s, border-color 0.2s;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  touch-action: none;
}
.pet-character:hover {
  box-shadow: var(--shadow-lg);
  border-color: var(--color-primary);
}
.pet-character:active {
  cursor: grabbing;
}
.pet-avatar {
  line-height: 1;
  pointer-events: none;
  user-select: none;
  -webkit-user-select: none;
}
.pet-emoji {
  font-size: 28px;
  pointer-events: none;
  user-select: none;
  -webkit-user-select: none;
}

/* 对话气泡 */
.pet-bubble {
  position: absolute;
  min-width: 320px;
  min-height: 420px;
  background: color-mix(in srgb, var(--bg-card) 96%, transparent);
  border-radius: 12px;
  box-shadow: 0 18px 60px rgba(15, 23, 42, 0.18), var(--shadow-xl);
  border: 1px solid color-mix(in srgb, var(--border-light) 86%, transparent);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  touch-action: none;
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}
.bubble-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 46px;
  padding: 9px 10px 9px 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 82%, transparent);
  background: color-mix(in srgb, var(--bg-card) 92%, var(--color-primary) 8%);
  flex-shrink: 0;
  user-select: none;
  -webkit-user-select: none;
}
.bubble-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}
.bubble-avatar {
  font-size: 18px;
  line-height: 1;
  pointer-events: none;
  user-select: none;
  -webkit-user-select: none;
}
.bubble-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.bubble-action {
  width: 28px;
  height: 28px;
  border: none;
  background: none;
  color: var(--text-tertiary);
  cursor: pointer;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
  user-select: none;
  -webkit-user-select: none;
}
.bubble-action:hover {
  background: var(--border-light);
  color: var(--text-primary);
}

.bubble-msgs {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  min-height: 0;
  background: var(--bg-page);
}
.bubble-welcome {
  text-align: center;
  color: var(--text-tertiary);
  font-size: 13px;
  margin-top: 24px;
}
.bubble-welcome p {
  margin: 0;
}
.bubble-msg {
  margin-bottom: 8px;
  display: flex;
}
.bubble-msg.user {
  justify-content: flex-end;
}
.bubble-text {
  max-width: 92%;
  padding: 7px 11px;
  border-radius: 10px;
  font-size: 13px;
  line-height: 1.45;
  word-break: break-word;
}
.bubble-msg.user .bubble-text {
  background: var(--color-primary);
  color: #fff;
  border-bottom-right-radius: 3px;
}
.bubble-msg.ai .bubble-text {
  background: var(--bg-card);
  color: var(--text-primary);
  box-shadow: var(--shadow-xs);
  border: 1px solid var(--border-light);
  border-bottom-left-radius: 3px;
}

.bubble-foot {
  display: flex;
  padding: 10px 12px 12px;
  gap: 8px;
  border-top: 1px solid var(--border-color);
  flex-shrink: 0;
  background: color-mix(in srgb, var(--bg-card) 94%, transparent);
}
.bubble-foot input {
  flex: 1;
  border: 1px solid var(--border-color);
  border-radius: 16px;
  padding: 6px 12px;
  font-size: 13px;
  outline: none;
  background: var(--bg-page);
  color: var(--text-primary);
  transition: border-color 0.2s;
}
.bubble-foot input:focus {
  border-color: var(--color-primary);
}
.bubble-foot input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.bubble-send {
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 50%;
  background: var(--color-primary);
  color: #fff;
  font-size: 14px;
  cursor: pointer;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.2s;
}
.bubble-send:hover { opacity: 0.9; }
.bubble-send.loading { opacity: 0.6; cursor: not-allowed; }
.bubble-resize-handle {
  position: absolute;
  left: 4px;
  top: 4px;
  width: 22px;
  height: 22px;
  cursor: nwse-resize;
  border-left: 2px solid color-mix(in srgb, var(--color-primary) 58%, transparent);
  border-top: 2px solid color-mix(in srgb, var(--color-primary) 58%, transparent);
  border-radius: 6px 0 0 0;
  opacity: 0.5;
  transition: opacity 0.15s;
  user-select: none;
  -webkit-user-select: none;
  touch-action: none;
}
.bubble-resize-handle:hover,
.pet-bubble.resizing .bubble-resize-handle {
  opacity: 0.9;
}
:global(.ai-pet-resizing) {
  user-select: none !important;
  cursor: nwse-resize !important;
}
:global(.ai-pet-resizing *) {
  user-select: none !important;
}
:global(.ai-pet-dragging) {
  user-select: none !important;
  cursor: grabbing !important;
}
:global(.ai-pet-dragging *) {
  user-select: none !important;
}

/* 右键菜单 */
.menu-overlay {
  position: fixed;
  inset: 0;
  z-index: 100001;
}
.pet-menu {
  position: fixed;
  z-index: 100002;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-lg);
  padding: 4px;
  min-width: 120px;
}
.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: var(--radius-xs);
  font-size: 13px;
  color: var(--text-primary);
  cursor: pointer;
  transition: background 0.12s;
}
.menu-item:hover {
  background: var(--border-light);
}

/* 打字动画 */
.typing .dot {
  animation: blink 1.4s infinite;
  font-size: 20px;
  line-height: 0;
}
.typing .dot:nth-child(2) { animation-delay: 0.2s; }
.typing .dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes blink { 0%,60%,100% { opacity: 0.3; } 30% { opacity: 1; } }

/* 过渡动画 */
.bubble-enter-active, .bubble-leave-active { transition: opacity 0.16s ease; }
.bubble-enter-from, .bubble-leave-to { opacity: 0; }
.fade-enter-active, .fade-leave-active { transition: opacity 0.15s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.pop-enter-active { animation: popIn 0.15s ease; }
.pop-leave-active { animation: popIn 0.1s ease reverse; }
@keyframes popIn {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}

@media (max-width: 640px) {
  .pet-container {
    left: auto !important;
    top: auto !important;
    right: 18px;
    bottom: 18px;
  }

  .pet-bubble {
    position: fixed;
    left: 10px !important;
    right: 10px !important;
    bottom: 10px !important;
    top: auto !important;
    width: auto !important;
    height: min(70vh, calc(100vh - 24px)) !important;
    min-width: 0;
    min-height: 360px;
    transform: none !important;
    border-radius: var(--radius-lg);
  }

  .bubble-resize-handle {
    display: none;
  }

  .bubble-title {
    min-width: 0;
  }

  .bubble-title span:last-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
</style>
