<template>
  <div class="page">
    <el-card class="page-card">
      <div class="page-header">
        <div>
          <h2>交易流水</h2>
          <p class="page-desc">按账户分组的交易记录</p>
        </div>
        <div class="header-actions">
          <input ref="importInput" class="hidden-input" type="file" accept=".xls,.xlsx,.csv" @change="onImportTransactionFile" />
          <el-button :loading="importing" @click="openImportTransactions">导入流水</el-button>
          <el-button :icon="Download" :loading="exporting" @click="exportTransactions">导出当前筛选</el-button>
          <el-button type="primary" @click="openAddDialog">+ 新增交易</el-button>
        </div>
      </div>

      <!-- 筛选栏 -->
      <el-form :model="filters" class="filter-bar" @keyup.enter="doSearch">
        <el-form-item label="类型">
          <el-select v-model="filters.type" placeholder="全部" clearable style="width: 110px" @change="doSearch">
            <el-option label="收入" value="income" />
            <el-option label="支出" value="expense" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="filters.status" placeholder="全部" clearable style="width: 120px" @change="doSearch">
            <el-option label="已确认" value="approved" />
            <el-option label="待确认" value="pending" />
            <el-option label="已作废" value="cancelled" />
          </el-select>
        </el-form-item>
        <el-form-item label="账户">
          <el-select v-model="filters.account_id" placeholder="全部" clearable style="width: 160px" @change="doSearch">
            <el-option v-for="a in allAccounts" :key="a.id" :label="a.name" :value="a.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="账户类型">
          <el-select v-model="filters.account_type" placeholder="全部" clearable style="width: 110px" @change="doSearch">
            <el-option label="公账" value="company" />
            <el-option label="私账" value="personal" />
          </el-select>
        </el-form-item>
        <el-form-item label="分类">
          <el-select v-model="filters.category" placeholder="全部" clearable style="width: 130px" @change="doSearch">
            <el-option v-for="c in categories" :key="c" :label="c" :value="c" />
          </el-select>
        </el-form-item>
        <el-form-item label="日期">
          <el-date-picker
            v-model="dateRange"
            type="daterange"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            value-format="YYYY-MM-DD"
            style="width: 240px"
            @change="doSearch"
          />
        </el-form-item>
        <el-form-item>
          <el-button @click="resetFilters">重置</el-button>
        </el-form-item>
      </el-form>
      <div class="transaction-summary">
        <span>当前筛选：{{ filterSummaryText }}</span>
        <span>已加载 {{ transactions.length }} 条{{ totalCount > transactions.length ? ` / 共 ${totalCount} 条，建议缩小筛选后查看` : '' }}</span>
        <span>默认折叠明细，点击账户查看流水</span>
      </div>

      <!-- 账户分组列表 -->
      <div v-loading="loading" class="account-groups">
        <div v-for="group in groups" :key="group.id" class="account-group">
          <!-- 账户头 -->
          <div class="group-header" @click="toggleGroup(group.id)">
            <div class="group-toggle">
              <el-icon :class="{ rotated: isExpanded(group.id) }"><ArrowRight /></el-icon>
            </div>
            <div class="group-info">
              <span class="group-name">{{ group.name }}</span>
              <el-tag :type="group.type === 'company' ? 'primary' : 'success'" size="small">
                {{ group.type === 'company' ? '公账' : '私账' }}
              </el-tag>
            </div>
            <div class="group-stats">
              <span class="stat-init">初期 {{ fmt(group.initial_balance) }}</span>
              <span class="stat-income">收入 {{ fmt(group.income) }}</span>
              <span class="stat-expense">支出 {{ fmt(group.expense) }}</span>
              <span :class="['stat-balance', (group.initial_balance + group.income - group.expense) >= 0 ? 'income' : 'expense']">
                余额 {{ fmt(group.initial_balance + group.income - group.expense) }}
              </span>
            </div>
            <div class="group-count">{{ group.txs.length }} 笔</div>
          </div>

          <!-- 交易列表 -->
          <el-collapse-transition>
            <div v-if="isExpanded(group.id)" class="group-body">
              <el-table v-if="group.txs.length" :data="group.txs" stripe size="small" style="width: 100%">
                <el-table-column prop="created_at" label="日期" width="155" />
                <el-table-column label="类型" width="70">
                  <template #default="{ row }">
                    <el-tag :type="row.type === 'income' ? 'success' : 'danger'" size="small">
                      {{ row.type === 'income' ? '收入' : '支出' }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="amount" label="金额" width="110">
                  <template #default="{ row }">
                    <span :class="transactionSignedAmount(row) >= 0 ? 'income' : 'expense'">
                      {{ transactionSignedAmount(row) >= 0 ? '+ ' : '- ' }}¥{{ Math.abs(transactionSignedAmount(row)).toLocaleString('zh-CN', { minimumFractionDigits: 2 }) }}
                    </span>
                  </template>
                </el-table-column>
                <el-table-column prop="category" label="分类" width="100" />
                <el-table-column prop="description" label="备注" min-width="140" />
                <el-table-column prop="party" label="对方" width="110" />
                <el-table-column label="状态" width="90">
                  <template #default="{ row }">
                    <el-tag :type="transactionStatusType(row.status)" size="small">
                      {{ transactionStatusLabel(row.status) }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="操作" width="160" fixed="right">
                  <template #default="{ row }">
                    <el-button v-if="row.status === 'pending'" type="success" link size="small" @click="handleConfirm(row)">确认</el-button>
                    <el-button link size="small" @click="openAttachmentDialog(row)">附件</el-button>
                    <el-button type="danger" link size="small" @click="handleDelete(row)">删除</el-button>
                  </template>
                </el-table-column>
              </el-table>
              <div v-else class="empty-txs">暂无交易</div>
            </div>
          </el-collapse-transition>
        </div>

        <el-empty v-if="!loading && groups.length === 0" description="没有匹配的交易" :image-size="80" />
      </div>
    </el-card>

    <!-- 新增弹窗 -->
    <el-dialog v-model="showAdd" title="新增交易" width="500px">
      <div class="smart-entry">
        <div class="smart-head">
          <div>
            <strong>智能录入</strong>
            <span>粘贴财务消息，系统会先填入下方表单</span>
          </div>
          <el-button size="small" type="primary" plain :loading="parsing" @click="parseFinanceText">智能解析</el-button>
        </div>
        <el-input
          v-model="smartText"
          type="textarea"
          :rows="2"
          placeholder="例如：支付霞光材料款 2000 晓婉中行，给张三"
          @keyup.meta.enter="parseFinanceText"
          @keyup.ctrl.enter="parseFinanceText"
        />
        <div v-if="parseWarnings.length" class="parse-warnings">
          <span v-for="item in parseWarnings" :key="item">{{ item }}</span>
        </div>
      </div>
      <el-form :model="addForm" label-width="80px">
        <el-form-item label="账户">
          <el-select v-model="addForm.account_id" placeholder="选择账户" style="width: 100%">
            <el-option v-for="a in allAccounts" :key="a.id" :label="a.name" :value="a.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="类型">
          <el-radio-group v-model="addForm.type">
            <el-radio value="income">收入</el-radio>
            <el-radio value="expense">支出</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="金额">
          <el-input-number v-model="addForm.amount" :min="0" :precision="2" style="width: 100%" />
        </el-form-item>
        <el-form-item label="分类">
          <el-input v-model="addForm.category" placeholder="如：材料费、工资" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="addForm.description" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="对方">
          <el-input v-model="addForm.party" placeholder="交易对方" />
        </el-form-item>
        <el-form-item label="凭证附件">
          <div class="receipt-uploader">
            <input ref="receiptInput" class="hidden-input" type="file" multiple @change="onReceiptSelect" />
            <div class="receipt-actions">
              <el-button :icon="Paperclip" @click="receiptInput?.click()">选择凭证</el-button>
              <span class="receipt-tip">可先选发票、截图、收据，保存流水后自动归档</span>
            </div>
            <div v-if="pendingReceipts.length" class="receipt-list">
              <div v-for="item in pendingReceipts" :key="item.id" class="receipt-item">
                <span class="receipt-kind">{{ receiptKind(item.file) }}</span>
                <div class="receipt-info">
                  <span class="receipt-name">{{ item.file.name }}</span>
                  <span class="receipt-size">{{ formatFileSize(item.file.size) }}</span>
                </div>
                <el-button link type="danger" @click="removeReceipt(item.id)">移除</el-button>
              </div>
            </div>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAdd = false">取消</el-button>
        <el-button type="primary" @click="handleAdd" :loading="saving">确定</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showAttachments" :title="attachmentDialogTitle" width="720px">
      <AttachmentPanel
        v-if="selectedTransaction"
        entity-type="transaction"
        :entity-id="selectedTransaction.id"
        title="流水附件"
        compact
      />
    </el-dialog>
  </div>
</template>

<script setup>
import { getAuthToken } from '../../utils/authSession'
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowRight, Download, Paperclip } from '@element-plus/icons-vue'
import AttachmentPanel from '../../components/AttachmentPanel.vue'

const route = useRoute()
const transactions = ref([])
const allAccounts = ref([])
const categories = ref([])
const totalCount = ref(0)
const loading = ref(false)
const showAdd = ref(false)
const saving = ref(false)
const exporting = ref(false)
const importing = ref(false)
const parsing = ref(false)
const showAttachments = ref(false)
const selectedTransaction = ref(null)
const receiptInput = ref(null)
const importInput = ref(null)
const pendingReceipts = ref([])
const smartText = ref('')
const parseWarnings = ref([])
const addForm = ref({ account_id: null, type: 'expense', amount: 0, category: '', description: '', party: '' })

const filters = ref({ type: '', status: '', account_id: null, account_type: '', category: '' })
const dateRange = ref(null)
const LIST_PAGE_SIZE = 1000

function token() { return getAuthToken() }

function fmt(v) {
  return '¥' + Number(v || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })
}

function transactionSignedAmount(row) {
  const amount = Number(row?.amount || 0)
  return row?.type === 'expense' ? -amount : amount
}

// 展开状态（持久化，不被 computed 重置）
const expandedMap = reactive({})

function toggleGroup(id) {
  expandedMap[id] = !expandedMap[id]
}

function isExpanded(id) {
  return expandedMap[id] === true
}

// 按账户分组
const groups = computed(() => {
  const map = {}
  for (const tx of transactions.value) {
    const key = tx.account_id
    if (!map[key]) {
      const acc = allAccounts.value.find(a => a.id === key)
      map[key] = {
        id: key,
        name: tx.account_name || '未知',
        type: tx.account_type || acc?.type || 'personal',
        initial_balance: Number(acc?.initial_balance || 0),
        income: 0,
        expense: 0,
        txs: []
      }
    }
    map[key].txs.push(tx)
    if (transactionStatusLabel(tx.status) !== '已确认') continue
    if (tx.type === 'income') map[key].income += tx.amount
    else map[key].expense += tx.amount
  }
  return Object.values(map)
})

const attachmentDialogTitle = computed(() => {
  if (!selectedTransaction.value) return '流水附件'
  const tx = selectedTransaction.value
  const type = tx.type === 'income' ? '收入' : '支出'
  return `${type} ¥${Number(tx.amount || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })} 的附件`
})

const filterSummaryText = computed(() => {
  const labels = []
  if (filters.value.type) labels.push(filters.value.type === 'income' ? '收入' : '支出')
  if (filters.value.status) labels.push(transactionStatusLabel(filters.value.status))
  if (filters.value.account_id) {
    const account = allAccounts.value.find(item => item.id === filters.value.account_id)
    if (account) labels.push(account.name)
  }
  if (filters.value.account_type) labels.push(filters.value.account_type === 'company' ? '公账' : '私账')
  if (filters.value.category) labels.push(filters.value.category)
  if (dateRange.value?.length === 2) labels.push(`${dateRange.value[0]} 至 ${dateRange.value[1]}`)
  return labels.length ? labels.join(' / ') : '全部月份、全部账户'
})

function buildQuery() {
  const params = new URLSearchParams()
  // 一次拉够当前阶段的全部流水；明细默认折叠，避免一次性渲染大量表格。
  params.set('pageSize', String(LIST_PAGE_SIZE))
  if (filters.value.type) params.set('type', filters.value.type)
  if (filters.value.status) params.set('status', filters.value.status)
  if (filters.value.account_id) params.set('account_id', filters.value.account_id)
  if (filters.value.account_type) params.set('account_type', filters.value.account_type)
  if (filters.value.category) params.set('category', filters.value.category)
  if (dateRange.value) {
    params.set('start_date', dateRange.value[0])
    params.set('end_date', dateRange.value[1])
  }
  return params
}

async function fetchList() {
  loading.value = true
  try {
    const qs = buildQuery()
    const res = await fetch(`/api/transactions?${qs}`, {
      headers: { Authorization: `Bearer ${token()}` }
    })
    const json = await res.json()
    if (json.success) {
      transactions.value = json.data
      totalCount.value = Number(json.total || json.data?.length || 0)
    }
  } finally {
    loading.value = false
  }
}

async function fetchAccounts() {
  try {
    const res = await fetch('/api/accounts', {
      headers: { Authorization: `Bearer ${token()}` }
    })
    const json = await res.json()
    if (json.success) allAccounts.value = json.data
  } catch {}
}

async function fetchCategories() {
  try {
    const res = await fetch('/api/transactions/categories', {
      headers: { Authorization: `Bearer ${token()}` }
    })
    const json = await res.json()
    if (json.success) categories.value = json.data
  } catch {}
}

function openAddDialog() {
  addForm.value = { account_id: null, type: 'expense', amount: 0, category: '', description: '', party: '' }
  pendingReceipts.value = []
  smartText.value = ''
  parseWarnings.value = []
  showAdd.value = true
}

async function exportTransactions() {
  exporting.value = true
  try {
    const qs = buildQuery()
    qs.delete('pageSize')
    qs.set('format', 'xls')
    const res = await fetch(`/api/transactions/export?${qs}`, {
      headers: { Authorization: `Bearer ${token()}` }
    })
    if (!res.ok) throw new Error('导出失败')
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `简尚交易流水-${new Date().toISOString().slice(0, 10)}.xls`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    ElMessage.success('已开始下载')
  } catch (error) {
    ElMessage.error(error.message || '导出失败')
  } finally {
    exporting.value = false
  }
}

function openImportTransactions() {
  importInput.value?.click()
}

async function onImportTransactionFile(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  if (file.size > 20 * 1024 * 1024) {
    ElMessage.warning('导入文件不能超过 20MB')
    return
  }
  importing.value = true
  try {
    const fileData = await readAsDataUrl(file)
    const res = await fetch('/api/transactions/import-feishu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({
        file_name: file.name,
        file_data: fileData
      })
    })
    const json = await parseImportResponse(res)
    if (!res.ok || !json.success) {
      await showImportFailure(json, res.status)
      return
    }
    const warnings = json.data?.warning_count ? `，${json.data.warning_count} 条需要留意` : ''
    ElMessage.success(`${json.message || '导入完成'}${warnings}`)
    if (json.data?.warnings?.length) {
      console.warn('交易流水导入提示', json.data.warnings)
      await ElMessageBox.alert(json.data.warnings.slice(0, 10).join('\n'), '导入完成，但有部分行需要留意', {
        confirmButtonText: '知道了',
        customClass: 'import-message-box'
      })
    }
    await fetchList()
    await fetchAccounts()
    await fetchCategories()
  } catch (error) {
    ElMessage.error(error.message || '导入失败')
  } finally {
    importing.value = false
  }
}

async function parseImportResponse(res) {
  const text = await res.text()
  if (res.status === 404) {
    return {
      success: false,
      message: '导入接口不存在（404）：当前后端还没有更新到最新版，或服务没有重启。请上传/重启后端后再试。'
    }
  }
  if (!text) return { success: false, message: `导入接口没有返回内容（${res.status}）` }
  try {
    return JSON.parse(text)
  } catch {
    return {
      success: false,
      message: res.ok
        ? '导入接口返回格式异常，请刷新后重试'
        : `导入接口异常（${res.status}）：${text.replace(/\s+/g, ' ').slice(0, 120)}`
    }
  }
}

async function showImportFailure(json, status) {
  const warnings = Array.isArray(json?.data?.warnings) ? json.data.warnings.filter(Boolean) : []
  const message = json?.message || `导入失败（${status}）`
  if (warnings.length) {
    await ElMessageBox.alert(warnings.slice(0, 12).join('\n'), message, {
      confirmButtonText: '知道了',
      customClass: 'import-message-box'
    })
    return
  }
  ElMessage.error(message)
}

function doSearch() { fetchList() }

function resetFilters() {
  filters.value = { type: '', status: '', account_id: null, account_type: '', category: '' }
  dateRange.value = null
  fetchList()
}

async function parseFinanceText() {
  const rawText = smartText.value.trim()
  if (!rawText) {
    ElMessage.warning('请先粘贴一条财务消息')
    return
  }
  parsing.value = true
  parseWarnings.value = []
  try {
    const res = await fetch('/api/transactions/parse-draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({ raw_text: rawText })
    })
    const json = await res.json()
    if (!json.success) throw new Error(json.message || '解析失败')
    const draft = json.data || {}
    addForm.value = {
      account_id: draft.account_id || addForm.value.account_id || null,
      type: draft.type || 'expense',
      amount: Number(draft.amount || 0),
      category: draft.category || '',
      description: draft.description || rawText,
      party: draft.party || ''
    }
    parseWarnings.value = Array.isArray(draft.warnings) ? draft.warnings : []
    if (parseWarnings.value.length) {
      ElMessage.warning('已填入表单，请补齐提示项')
    } else {
      ElMessage.success('已填入表单，核对后点确定保存')
    }
  } catch (error) {
    ElMessage.error(error.message || '解析失败')
  } finally {
    parsing.value = false
  }
}

async function handleAdd() {
  if (!addForm.value.account_id || !addForm.value.amount) {
    ElMessage.warning('请选择账户并输入金额')
    return
  }
  saving.value = true
  try {
    const res = await fetch('/api/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify(addForm.value)
    })
    const json = await res.json()
    if (json.success) {
      if (pendingReceipts.value.length) {
        await uploadTransactionReceipts(json.id)
      }
      ElMessage.success('新增成功')
      showAdd.value = false
      addForm.value = { account_id: null, type: 'expense', amount: 0, category: '', description: '', party: '' }
      smartText.value = ''
      parseWarnings.value = []
      pendingReceipts.value = []
      fetchList()
      fetchAccounts()
      fetchCategories()
    }
  } finally {
    saving.value = false
  }
}

function onReceiptSelect(event) {
  const files = Array.from(event.target.files || [])
  for (const file of files) {
    if (file.size > 10 * 1024 * 1024) {
      ElMessage.warning(`${file.name} 超过 10MB，暂不上传`)
      continue
    }
    pendingReceipts.value.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      file
    })
  }
  event.target.value = ''
}

function removeReceipt(id) {
  pendingReceipts.value = pendingReceipts.value.filter(item => item.id !== id)
}

async function uploadTransactionReceipts(transactionId) {
  const uploadedIds = new Set()
  try {
    for (const item of pendingReceipts.value) {
      const data = await readAsDataUrl(item.file)
      const res = await fetch('/api/files/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({
          entity_type: 'transaction',
          entity_id: transactionId,
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
  } catch (error) {
    pendingReceipts.value = pendingReceipts.value.filter(item => !uploadedIds.has(item.id))
    ElMessage.warning(`流水已保存，部分附件未上传：${error.message || '上传失败'}`)
  }
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = event => resolve(event.target.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function receiptKind(file) {
  if ((file.type || '').startsWith('image/')) return '图片'
  if ((file.type || '').includes('pdf')) return 'PDF'
  if (/\.(xls|xlsx|csv)$/i.test(file.name)) return '表格'
  return '文件'
}

function formatFileSize(size) {
  const bytes = Number(size || 0)
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

async function handleDelete(row) {
  try {
    await ElMessageBox.confirm('确定删除该交易？', '提示')
    await fetch(`/api/transactions/${row.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token()}` }
    })
    ElMessage.success('已删除')
    fetchList()
    fetchAccounts()
  } catch {}
}

async function handleConfirm(row) {
  try {
    await ElMessageBox.confirm('确认后这条流水会生效，并更新账户余额。', '确认流水')
    const res = await fetch(`/api/transactions/${row.id}/confirm`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token()}` }
    })
    const json = await res.json()
    if (!json.success) throw new Error(json.message || '确认失败')
    ElMessage.success(json.message || '流水已确认')
    fetchList()
    fetchAccounts()
  } catch (error) {
    if (!['cancel', 'close'].includes(error)) ElMessage.error(error.message || '确认失败')
  }
}

function openAttachmentDialog(row) {
  selectedTransaction.value = row
  showAttachments.value = true
}

function transactionStatusLabel(status) {
  if (status === 'pending') return '待确认'
  if (status === 'cancelled') return '已作废'
  return '已确认'
}

function transactionStatusType(status) {
  if (status === 'pending') return 'warning'
  if (status === 'cancelled') return 'info'
  return 'success'
}

watch(() => route.query, (q) => {
  if (q.account_id) {
    filters.value.account_id = Number(q.account_id)
    fetchList()
  }
}, { immediate: true })

onMounted(() => { fetchList(); fetchAccounts(); fetchCategories() })
</script>

<style scoped>
.filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 16px;
  padding: 16px;
  background: color-mix(in srgb, var(--bg-card) 88%, var(--bg-page));
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm, 8px);
}
.filter-bar :deep(.el-form-item) { margin-bottom: 0; }
.filter-bar :deep(.el-form-item__label) { color: var(--text-secondary); }

.transaction-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: -4px 0 14px;
  color: var(--text-tertiary);
  font-size: 12px;
}

.transaction-summary span {
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--bg-card) 82%, var(--bg-page));
  border: 1px solid var(--border-light);
}

.smart-entry {
  padding: 14px;
  margin-bottom: 18px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--color-primary-bg) 38%, var(--bg-card));
}
.smart-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 10px;
}
.smart-head strong {
  display: block;
  color: var(--text-primary);
  font-size: 14px;
}
.smart-head span {
  color: var(--text-tertiary);
  font-size: 12px;
}
.parse-warnings {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.parse-warnings span {
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 12px;
  color: var(--color-warning);
  background: rgba(245, 158, 11, 0.12);
}

.header-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.receipt-uploader {
  width: 100%;
}
.hidden-input {
  display: none;
}
.receipt-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.receipt-tip,
.receipt-size {
  font-size: 12px;
  color: var(--text-tertiary);
}
.receipt-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}
.receipt-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: var(--bg-page);
}
.receipt-kind {
  min-width: 44px;
  padding: 3px 6px;
  border-radius: 6px;
  background: var(--color-primary-bg);
  color: var(--color-primary);
  font-size: 12px;
  text-align: center;
}
.receipt-info {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
}
.receipt-name {
  overflow: hidden;
  color: var(--text-primary);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.income { color: var(--color-success); font-weight: 600; }
.expense { color: #ef4444; font-weight: 600; }

.account-groups {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.account-group {
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--bg-card);
}

.group-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  cursor: pointer;
  user-select: none;
  transition: background 0.2s;
}
.group-header:hover {
  background: color-mix(in srgb, var(--bg-card) 84%, var(--color-primary) 16%);
}

.group-toggle {
  display: flex;
  align-items: center;
  transition: transform 0.2s;
  color: var(--text-tertiary);
}
.group-toggle .rotated { transform: rotate(90deg); }

.group-info {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 160px;
}
.group-name {
  font-weight: 600;
  font-size: 14px;
  color: var(--text-primary);
}

.group-stats {
  display: flex;
  gap: 16px;
  font-size: 13px;
  flex: 1;
}
.stat-init { color: var(--text-tertiary); }
.stat-income { color: var(--color-success); }
.stat-expense { color: #ef4444; }
.stat-balance { font-weight: 600; }
.stat-balance.income { color: var(--color-success); }
.stat-balance.expense { color: #ef4444; }

.group-count {
  color: var(--text-tertiary);
  font-size: 12px;
  white-space: nowrap;
}

.group-body {
  border-top: 1px solid var(--border-light);
  transform-origin: top;
  transition: opacity 0.22s ease, transform 0.22s ease;
}

.empty-txs {
  padding: 24px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 13px;
}

:deep(.collapse-transition-leave-active),
:deep(.collapse-transition-enter-active) {
  transition: height 0.24s ease, padding-top 0.24s ease, padding-bottom 0.24s ease, opacity 0.18s ease;
}
:deep(.collapse-transition-enter-from),
:deep(.collapse-transition-leave-to) {
  opacity: 0;
}
</style>
