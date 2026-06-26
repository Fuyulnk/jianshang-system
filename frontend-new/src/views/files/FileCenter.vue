<script setup>
import { getAuthToken } from '../../utils/authSession'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, Download, FolderOpened, Link } from '@element-plus/icons-vue'

const router = useRouter()
const files = ref([])
const projectFolders = ref([])
const receiptFolders = ref([])
const userInfo = ref({ role: '', assignment_status: '' })
const allowedModules = ref([])
const loading = ref(false)
const filters = ref({
  entity_type: '',
  keyword: '',
  start_date: '',
  end_date: '',
  amount_min: '',
  amount_max: '',
  person: ''
})

const totalSize = computed(() => files.value.reduce((sum, item) => sum + Number(item.size || 0), 0))
const isPendingAssignment = computed(() => userInfo.value.assignment_status === 'pending')
const isAdmin = computed(() => ['super_admin', 'admin'].includes(userInfo.value.role))
const safeAllowedModules = computed(() => Array.isArray(allowedModules.value) ? allowedModules.value : [])
const canViewProjects = computed(() => hasModule('projects') || userInfo.value.role === 'finance')
const canViewTransactions = computed(() => hasModule('transactions'))
const canViewProducts = computed(() => hasModule('products'))
const canViewPrivateWorkspace = computed(() => !isPendingAssignment.value)
const entityOptions = computed(() => [
  canViewProjects.value && { label: '工单附件', value: 'project' },
  canViewTransactions.value && { label: '流水凭证', value: 'transaction' },
  canViewProducts.value && { label: '库存资料', value: 'product' },
  canViewPrivateWorkspace.value && { label: '私有工作区', value: 'private_workspace' }
].filter(Boolean))

function token() {
  return getAuthToken()
}

function hasModule(module) {
  if (isPendingAssignment.value) return false
  return isAdmin.value || safeAllowedModules.value.includes(module)
}

async function fetchAccessContext() {
  try {
    const [meRes, menuRes] = await Promise.all([
      fetch('/api/me', { headers: { Authorization: `Bearer ${token()}` } }),
      fetch('/api/user-menu', { headers: { Authorization: `Bearer ${token()}` } })
    ])
    const meJson = await meRes.json().catch(() => ({}))
    const menuJson = await menuRes.json().catch(() => ({}))
    if (meJson.success) userInfo.value = meJson.user || userInfo.value
    allowedModules.value = Array.isArray(menuJson.data) ? menuJson.data : []
    if (filters.value.entity_type && !entityOptions.value.some(option => option.value === filters.value.entity_type)) {
      filters.value.entity_type = ''
    }
  } catch {
    allowedModules.value = []
  }
}

async function fetchFiles() {
  loading.value = true
  try {
    const params = new URLSearchParams({ limit: '200' })
    for (const [key, value] of Object.entries(filters.value)) {
      const text = String(value || '').trim()
      if (text) params.set(key, text)
    }
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

async function fetchProjectFolders() {
  if (!canViewProjects.value) {
    projectFolders.value = []
    return
  }
  try {
    const params = new URLSearchParams({ limit: '80' })
    if (filters.value.keyword.trim()) params.set('keyword', filters.value.keyword.trim())
    const res = await fetch(`/api/files/project-folders?${params}`, {
      headers: { Authorization: `Bearer ${token()}` }
    })
    const json = await res.json()
    if (json.success) projectFolders.value = json.data || []
  } catch {}
}

async function fetchReceiptFolders() {
  if (!canViewTransactions.value) {
    receiptFolders.value = []
    return
  }
  try {
    const params = new URLSearchParams({ limit: '80' })
    for (const key of ['keyword', 'start_date', 'end_date', 'amount_min', 'amount_max', 'person']) {
      const text = String(filters.value[key] || '').trim()
      if (text) params.set(key, text)
    }
    const res = await fetch(`/api/files/receipt-folders?${params}`, {
      headers: { Authorization: `Bearer ${token()}` }
    })
    const json = await res.json()
    if (json.success) receiptFolders.value = json.data || []
    else receiptFolders.value = []
  } catch {
    receiptFolders.value = []
  }
}

async function fetchAll() {
  await Promise.all([fetchFiles(), fetchProjectFolders(), fetchReceiptFolders()])
}

function resetFilters() {
  filters.value = { entity_type: '', keyword: '', start_date: '', end_date: '', amount_min: '', amount_max: '', person: '' }
  fetchAll()
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

function openProjectFolder(folder) {
  filters.value.entity_type = 'project'
  filters.value.keyword = folder.name || folder.customer || ''
  fetchFiles()
}

function openReceiptFolder(folder) {
  filters.value.entity_type = 'transaction'
  filters.value.keyword = folder.description || folder.party || folder.category || ''
  const date = String(folder.created_at || '').slice(0, 10)
  filters.value.start_date = date
  filters.value.end_date = date
  filters.value.amount_min = String(folder.amount || '')
  filters.value.amount_max = String(folder.amount || '')
  filters.value.person = folder.party || folder.proxy || ''
  fetchFiles()
}

function receiptFolderTitle(folder) {
  const type = folder.type === 'income' ? '收入' : '支出'
  const amount = Number(folder.amount || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })
  return `${type} ¥${amount}`
}

function receiptFolderMeta(folder) {
  return [
    formatDate(folder.created_at),
    folder.account_name,
    folder.party || folder.proxy || folder.description
  ].filter(Boolean).join(' · ')
}

function formatDate(value) {
  const text = String(value || '').slice(0, 10)
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return match ? `${match[1]}/${Number(match[2])}/${Number(match[3])}` : text
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

onMounted(async () => {
  await fetchAccessContext()
  await fetchAll()
})
</script>

<template>
  <div class="page">
    <el-card class="page-card">
      <div class="page-header">
        <div>
          <h2>文件中心</h2>
          <p class="page-desc">工单附件、流水凭证和仓库资料统一归档；只展示当前账号有权访问的文件。</p>
        </div>
        <div class="file-stats">
          <span>{{ files.length }} 个文件</span>
          <strong>{{ formatSize(totalSize) }}</strong>
        </div>
      </div>

      <div class="filter-bar">
        <el-select v-model="filters.entity_type" clearable placeholder="文件归属" style="width: 140px" @change="fetchFiles">
          <el-option v-for="option in entityOptions" :key="option.value" :label="option.label" :value="option.value" />
        </el-select>
        <el-input v-model="filters.keyword" clearable placeholder="搜索文件名、工程名、交易备注" style="width: 260px" @keyup.enter="fetchAll" />
        <el-input v-model="filters.person" clearable placeholder="上传人/对方/经手人" style="width: 160px" @keyup.enter="fetchFiles" />
        <el-date-picker v-model="filters.start_date" type="date" value-format="YYYY-MM-DD" placeholder="开始日期" style="width: 150px" @change="fetchFiles" />
        <el-date-picker v-model="filters.end_date" type="date" value-format="YYYY-MM-DD" placeholder="结束日期" style="width: 150px" @change="fetchFiles" />
        <el-input v-model="filters.amount_min" clearable placeholder="最小金额" style="width: 120px" @keyup.enter="fetchFiles" />
        <el-input v-model="filters.amount_max" clearable placeholder="最大金额" style="width: 120px" @keyup.enter="fetchFiles" />
        <el-button type="primary" :loading="loading" @click="fetchAll">查询</el-button>
        <el-button @click="resetFilters">重置</el-button>
      </div>

      <section v-if="canViewProjects" class="folder-section">
        <div class="section-head">
          <h3>项目文件夹</h3>
          <span>{{ projectFolders.length }} 个项目有文件</span>
        </div>
        <div v-if="projectFolders.length" class="folder-grid">
          <button v-for="folder in projectFolders" :key="folder.id" class="project-folder" @click="openProjectFolder(folder)">
            <el-icon><FolderOpened /></el-icon>
            <span class="folder-name">{{ folder.name || `项目 #${folder.id}` }}</span>
            <span class="folder-meta">{{ folder.customer || '未填客户' }} · {{ folder.file_count }} 个文件</span>
            <span class="folder-size">{{ formatSize(folder.total_size) }}</span>
          </button>
        </div>
        <el-empty v-else description="暂无可见项目文件夹" :image-size="72" />
      </section>

      <section v-if="canViewTransactions" class="folder-section">
        <div class="section-head">
          <h3>流水凭证文件夹</h3>
          <span>{{ receiptFolders.length }} 条流水有凭证</span>
        </div>
        <div v-if="receiptFolders.length" class="folder-grid receipt-folder-grid">
          <button v-for="folder in receiptFolders" :key="folder.id" class="project-folder receipt-folder" @click="openReceiptFolder(folder)">
            <el-icon><FolderOpened /></el-icon>
            <span class="folder-name">{{ receiptFolderTitle(folder) }}</span>
            <span class="folder-meta">{{ receiptFolderMeta(folder) || '未填关联信息' }} · {{ folder.file_count }} 个凭证</span>
            <span class="folder-size">{{ formatSize(folder.total_size) }}</span>
          </button>
        </div>
        <el-empty v-else description="暂无可见流水凭证文件夹" :image-size="72" />
      </section>

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

.folder-section {
  margin-bottom: 18px;
  padding: 14px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--bg-card) 92%, var(--bg-page));
}

.section-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.section-head h3 {
  margin: 0;
  color: var(--text-primary);
  font-size: 15px;
}

.section-head span {
  color: var(--text-tertiary);
  font-size: 12px;
}

.folder-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
}

.project-folder {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  grid-template-areas:
    "icon name"
    "icon meta"
    "icon size";
  gap: 2px 10px;
  padding: 12px;
  border: 1px solid var(--border-light);
  border-radius: 10px;
  background: var(--bg-card);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.16s, transform 0.16s, box-shadow 0.16s;
}

.project-folder:hover {
  transform: translateY(-1px);
  border-color: rgba(59, 130, 246, 0.36);
  box-shadow: 0 8px 20px rgba(15, 23, 42, 0.08);
}

.project-folder .el-icon {
  grid-area: icon;
  align-self: center;
  justify-self: center;
  color: var(--color-primary);
  font-size: 24px;
}

.receipt-folder {
  background: color-mix(in srgb, var(--bg-card) 88%, #eff6ff);
}

.receipt-folder .el-icon {
  color: #0ea5e9;
}

:global(html.dark) .receipt-folder {
  background: color-mix(in srgb, var(--bg-card) 86%, #0f172a);
}

.folder-name {
  grid-area: name;
  overflow: hidden;
  color: var(--text-primary);
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.folder-meta {
  grid-area: meta;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.folder-size {
  grid-area: size;
  color: var(--text-tertiary);
  font-size: 12px;
}
</style>
