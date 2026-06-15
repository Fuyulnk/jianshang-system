<script setup>
import { getAuthToken } from '../../utils/authSession'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, Download, Link } from '@element-plus/icons-vue'

const router = useRouter()
const files = ref([])
const loading = ref(false)
const filters = ref({ entity_type: '', keyword: '' })

const totalSize = computed(() => files.value.reduce((sum, item) => sum + Number(item.size || 0), 0))

function token() {
  return getAuthToken()
}

async function fetchFiles() {
  loading.value = true
  try {
    const params = new URLSearchParams({ limit: '200' })
    if (filters.value.entity_type) params.set('entity_type', filters.value.entity_type)
    if (filters.value.keyword.trim()) params.set('keyword', filters.value.keyword.trim())
    const res = await fetch(`/api/files/recent?${params}`, {
      headers: { Authorization: `Bearer ${token()}` }
    })
    const json = await res.json()
    if (json.success) files.value = json.data || []
    else ElMessage.error(json.message || '文件加载失败')
  } catch {
    ElMessage.error('文件加载失败')
  } finally {
    loading.value = false
  }
}

function resetFilters() {
  filters.value = { entity_type: '', keyword: '' }
  fetchFiles()
}

function entityLabel(row) {
  if (row.entity_type === 'project') return '工单'
  if (row.entity_type === 'transaction') return '流水'
  if (row.entity_type === 'product') return '库存'
  if (row.entity_type === 'private_workspace') return '私有区'
  return row.entity_type || '-'
}

function entityText(row) {
  if (row.entity_type === 'project') return row.project_name ? `${row.project_name} / ${row.project_customer || '-'}` : `工单 #${row.entity_id}`
  if (row.entity_type === 'transaction') {
    const type = row.transaction_type === 'income' ? '收入' : '支出'
    const amount = Number(row.transaction_amount || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })
    return `${type} ¥${amount} / ${row.transaction_party || row.transaction_description || '未备注'}`
  }
  if (row.entity_type === 'private_workspace') return row.workspace_name || `私有工作区 #${row.entity_id}`
  return `#${row.entity_id}`
}

function fileKind(row) {
  const mime = row.mime_type || ''
  if (mime.startsWith('image/')) return '图片'
  if (mime.includes('pdf')) return 'PDF'
  if (mime.includes('spreadsheet') || /\.(xls|xlsx|csv)$/i.test(row.original_name || '')) return '表格'
  return '文件'
}

function formatSize(size) {
  const bytes = Number(size || 0)
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

function uploaderName(row) {
  return row.uploader_real_name || row.uploader_name || '未知'
}

function openEntity(row) {
  if (row.entity_type === 'project') {
    router.push(`/main/projects/${row.entity_id}`)
    return
  }
  if (row.entity_type === 'transaction') {
    router.push('/main/transactions')
    return
  }
  if (row.entity_type === 'product') {
    router.push('/main/products')
  }
}

async function downloadFile(row) {
  try {
    const res = await fetch(`/api/files/${row.id}/download`, {
      headers: { Authorization: `Bearer ${token()}` }
    })
    if (!res.ok) throw new Error('下载失败')
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = row.original_name || '附件'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  } catch (error) {
    ElMessage.error(error.message || '下载失败')
  }
}

async function deleteFile(row) {
  try {
    await ElMessageBox.confirm(`确定删除附件「${row.original_name}」？`, '提示', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning'
    })
    const res = await fetch(`/api/files/${row.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token()}` }
    })
    const json = await res.json()
    if (json.success) {
      ElMessage.success('附件已删除')
      fetchFiles()
    } else {
      ElMessage.error(json.message || '删除失败')
    }
  } catch {}
}

onMounted(fetchFiles)
</script>

<template>
  <div class="page">
    <el-card class="page-card">
      <div class="page-header">
        <div>
          <h2>文件中心</h2>
          <p class="page-desc">工单附件、流水凭证和仓库资料统一归档</p>
        </div>
        <div class="file-stats">
          <span>{{ files.length }} 个文件</span>
          <strong>{{ formatSize(totalSize) }}</strong>
        </div>
      </div>

      <div class="filter-bar">
        <el-select v-model="filters.entity_type" clearable placeholder="文件归属" style="width: 140px" @change="fetchFiles">
          <el-option label="工单附件" value="project" />
          <el-option label="流水凭证" value="transaction" />
          <el-option label="库存资料" value="product" />
          <el-option label="私有工作区" value="private_workspace" />
        </el-select>
        <el-input v-model="filters.keyword" clearable placeholder="搜索文件名、工程名、交易备注" style="width: 280px" @keyup.enter="fetchFiles" />
        <el-button type="primary" :loading="loading" @click="fetchFiles">查询</el-button>
        <el-button @click="resetFilters">重置</el-button>
      </div>

      <el-table :data="files" v-loading="loading" stripe style="width: 100%">
        <el-table-column label="类型" width="80">
          <template #default="{ row }"><el-tag size="small">{{ fileKind(row) }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="original_name" label="文件名" min-width="220" show-overflow-tooltip />
        <el-table-column label="归属" width="90">
          <template #default="{ row }">{{ entityLabel(row) }}</template>
        </el-table-column>
        <el-table-column label="关联对象" min-width="240" show-overflow-tooltip>
          <template #default="{ row }">{{ entityText(row) }}</template>
        </el-table-column>
        <el-table-column label="大小" width="90">
          <template #default="{ row }">{{ formatSize(row.size) }}</template>
        </el-table-column>
        <el-table-column label="上传人" width="110">
          <template #default="{ row }">{{ uploaderName(row) }}</template>
        </el-table-column>
        <el-table-column prop="created_at" label="上传时间" width="150" />
        <el-table-column label="操作" width="190" fixed="right">
          <template #default="{ row }">
            <el-button :icon="Link" link @click="openEntity(row)">打开</el-button>
            <el-button :icon="Download" link @click="downloadFile(row)">下载</el-button>
            <el-button :icon="Delete" link type="danger" @click="deleteFile(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<style scoped>
.filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
  padding: 14px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--bg-card) 88%, var(--bg-page));
}
.file-stats {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  color: var(--text-tertiary);
  font-size: 13px;
}
.file-stats strong {
  color: var(--text-primary);
  font-size: 18px;
}
</style>
