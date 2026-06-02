<script setup>
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, Download, Paperclip, UploadFilled } from '@element-plus/icons-vue'

const props = defineProps({
  entityType: { type: String, required: true },
  entityId: { type: [Number, String], required: true },
  title: { type: String, default: '附件' },
  compact: { type: Boolean, default: false }
})

const attachments = ref([])
const pendingFiles = ref([])
const loading = ref(false)
const uploading = ref(false)
const dragging = ref(false)
const fileInput = ref(null)

const hasEntity = computed(() => props.entityType && Number(props.entityId) > 0)
const totalSize = computed(() => attachments.value.reduce((sum, item) => sum + Number(item.size || 0), 0))

function token() {
  return localStorage.getItem('token')
}

function openPicker() {
  fileInput.value?.click()
}

function addFiles(fileList) {
  const files = Array.from(fileList || [])
  for (const file of files) {
    if (file.size > 10 * 1024 * 1024) {
      ElMessage.warning(`${file.name} 超过 10MB，暂不上传`)
      continue
    }
    pendingFiles.value.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      file
    })
  }
}

function onFileChange(event) {
  addFiles(event.target.files)
  event.target.value = ''
}

function onDrop(event) {
  dragging.value = false
  addFiles(event.dataTransfer?.files)
}

function removePending(id) {
  pendingFiles.value = pendingFiles.value.filter(item => item.id !== id)
}

async function fetchAttachments() {
  if (!hasEntity.value) return
  loading.value = true
  try {
    const params = new URLSearchParams({
      entity_type: props.entityType,
      entity_id: String(props.entityId)
    })
    const res = await fetch(`/api/files?${params}`, {
      headers: { Authorization: `Bearer ${token()}` }
    })
    const json = await res.json()
    if (json.success) attachments.value = json.data || []
    else ElMessage.error(json.message || '附件加载失败')
  } catch {
    ElMessage.error('附件加载失败')
  } finally {
    loading.value = false
  }
}

async function uploadPending() {
  if (!pendingFiles.value.length || !hasEntity.value) return
  uploading.value = true
  const uploadedIds = new Set()
  try {
    for (const item of pendingFiles.value) {
      const data = await readAsDataUrl(item.file)
      const res = await fetch('/api/files/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({
          entity_type: props.entityType,
          entity_id: Number(props.entityId),
          name: item.file.name,
          mime_type: item.file.type || 'application/octet-stream',
          size: item.file.size,
          data
        })
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.message || `${item.file.name} 上传失败`)
      uploadedIds.add(item.id)
    }
    pendingFiles.value = pendingFiles.value.filter(item => !uploadedIds.has(item.id))
    ElMessage.success('附件已上传')
    await fetchAttachments()
  } catch (error) {
    pendingFiles.value = pendingFiles.value.filter(item => !uploadedIds.has(item.id))
    ElMessage.error(error.message || '上传失败')
  } finally {
    uploading.value = false
  }
}

async function downloadAttachment(file) {
  try {
    const res = await fetch(`/api/files/${file.id}/download`, {
      headers: { Authorization: `Bearer ${token()}` }
    })
    if (!res.ok) throw new Error('下载失败')
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = file.original_name || '附件'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  } catch (error) {
    ElMessage.error(error.message || '下载失败')
  }
}

async function deleteAttachment(file) {
  try {
    await ElMessageBox.confirm(`确定删除附件「${file.original_name}」？`, '提示', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning'
    })
    const res = await fetch(`/api/files/${file.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token()}` }
    })
    const json = await res.json()
    if (json.success) {
      ElMessage.success('附件已删除')
      await fetchAttachments()
    } else {
      ElMessage.error(json.message || '删除失败')
    }
  } catch {}
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = event => resolve(event.target.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function formatSize(size) {
  const bytes = Number(size || 0)
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

function uploaderName(file) {
  return file.uploader_real_name || file.uploader_name || '未知'
}

function fileKind(file) {
  const mime = file.mime_type || file.file?.type || ''
  if (mime.startsWith('image/')) return '图片'
  if (mime.includes('pdf')) return 'PDF'
  if (mime.includes('spreadsheet') || /\.(xls|xlsx|csv)$/i.test(file.original_name || file.file?.name || '')) return '表格'
  return '文件'
}

watch(() => [props.entityType, props.entityId], fetchAttachments, { immediate: true })
</script>

<template>
  <el-card
    class="attachment-panel"
    :class="{ compact }"
    shadow="never"
    @dragenter.prevent="dragging = true"
    @dragover.prevent="dragging = true"
    @dragleave.prevent="dragging = false"
    @drop.prevent="onDrop"
  >
    <template #header>
      <div class="attachment-header">
        <div>
          <div class="attachment-title">{{ title }}</div>
          <div class="attachment-meta">{{ attachments.length }} 个附件 · {{ formatSize(totalSize) }}</div>
        </div>
        <div class="attachment-actions">
          <input ref="fileInput" type="file" multiple class="hidden-input" @change="onFileChange" />
          <el-button :icon="Paperclip" @click="openPicker">选择文件</el-button>
          <el-button :loading="loading" @click="fetchAttachments">刷新</el-button>
        </div>
      </div>
    </template>

    <div v-if="dragging" class="drop-hint">
      <el-icon><UploadFilled /></el-icon>
      <span>松开后加入待上传</span>
    </div>

    <div v-if="pendingFiles.length" class="pending-area">
      <div class="pending-title">待上传</div>
      <div class="pending-list">
        <div v-for="item in pendingFiles" :key="item.id" class="pending-item">
          <span class="file-badge">{{ fileKind({ file: item.file }) }}</span>
          <div class="file-info">
            <div class="file-name">{{ item.file.name }}</div>
            <div class="file-meta">{{ formatSize(item.file.size) }}</div>
          </div>
          <el-button link type="danger" @click="removePending(item.id)">移除</el-button>
        </div>
      </div>
      <div class="pending-actions">
        <el-button @click="pendingFiles = []" :disabled="uploading">清空</el-button>
        <el-button type="primary" :loading="uploading" @click="uploadPending">确认上传</el-button>
      </div>
    </div>

    <div v-loading="loading" class="attachment-list">
      <div v-for="file in attachments" :key="file.id" class="attachment-item">
        <span class="file-badge">{{ fileKind(file) }}</span>
        <div class="file-info">
          <div class="file-name">{{ file.original_name }}</div>
          <div class="file-meta">{{ formatSize(file.size) }} · {{ uploaderName(file) }} · {{ file.created_at }}</div>
        </div>
        <div class="file-actions">
          <el-button :icon="Download" link @click="downloadAttachment(file)">下载</el-button>
          <el-button :icon="Delete" link type="danger" @click="deleteAttachment(file)">删除</el-button>
        </div>
      </div>
      <el-empty v-if="!loading && !attachments.length" description="暂无附件" :image-size="72" />
    </div>
  </el-card>
</template>

<style scoped>
.attachment-panel {
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
}
.attachment-panel.compact {
  border-radius: var(--radius-sm);
}
.attachment-header,
.attachment-actions,
.pending-item,
.attachment-item,
.file-actions {
  display: flex;
  align-items: center;
}
.attachment-header {
  justify-content: space-between;
  gap: 16px;
}
.attachment-title {
  font-weight: 700;
  color: var(--text-primary);
}
.attachment-meta,
.file-meta {
  margin-top: 3px;
  font-size: 12px;
  color: var(--text-tertiary);
}
.attachment-actions {
  gap: 8px;
}
.hidden-input {
  display: none;
}
.drop-hint {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-bottom: 12px;
  min-height: 72px;
  border: 1px dashed var(--color-primary);
  border-radius: var(--radius-sm);
  background: var(--color-primary-bg);
  color: var(--color-primary);
  font-weight: 600;
}
.pending-area {
  margin-bottom: 14px;
  padding: 12px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--bg-card) 86%, var(--color-warning) 14%);
}
.pending-title {
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
}
.pending-list,
.attachment-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.pending-item,
.attachment-item {
  gap: 10px;
  min-height: 48px;
  padding: 8px 10px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
}
.attachment-item {
  min-height: 56px;
}
.file-badge {
  flex: 0 0 auto;
  min-width: 44px;
  padding: 4px 6px;
  border-radius: 6px;
  background: var(--color-primary-bg);
  color: var(--color-primary);
  font-size: 12px;
  text-align: center;
}
.file-info {
  min-width: 0;
  flex: 1;
}
.file-name {
  overflow: hidden;
  color: var(--text-primary);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-actions {
  gap: 4px;
  flex-shrink: 0;
}
.pending-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}

@media (max-width: 720px) {
  .attachment-header,
  .attachment-item {
    align-items: stretch;
    flex-direction: column;
  }
  .attachment-actions,
  .file-actions {
    justify-content: flex-start;
  }
}
</style>
