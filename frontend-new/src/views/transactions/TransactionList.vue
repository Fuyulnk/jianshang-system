<template>
  <div class="page">
    <el-card class="page-card">
      <div class="page-header">
        <div>
          <h2>交易流水</h2>
          <p class="page-desc">按账户分组的交易记录</p>
        </div>
        <el-button type="primary" @click="showAdd = true">+ 新增交易</el-button>
      </div>

      <!-- 筛选栏 -->
      <el-form :model="filters" class="filter-bar" @keyup.enter="doSearch">
        <el-form-item label="类型">
          <el-select v-model="filters.type" placeholder="全部" clearable style="width: 110px" @change="doSearch">
            <el-option label="收入" value="income" />
            <el-option label="支出" value="expense" />
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
              <span class="stat-income">收入 {{ fmt(group.income) }}</span>
              <span class="stat-expense">支出 {{ fmt(group.expense) }}</span>
              <span :class="['stat-balance', group.balance >= 0 ? 'income' : 'expense']">
                余额 {{ fmt(group.balance) }}
              </span>
            </div>
            <div class="group-count">{{ group.txs.length }} 笔</div>
          </div>

          <!-- 交易列表 -->
          <el-collapse-transition>
            <div v-show="isExpanded(group.id)" class="group-body">
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
                    <span :class="row.type === 'income' ? 'income' : 'expense'">
                      {{ row.type === 'expense' ? '- ' : '+ ' }}¥{{ Number(row.amount).toLocaleString('zh-CN', { minimumFractionDigits: 2 }) }}
                    </span>
                  </template>
                </el-table-column>
                <el-table-column prop="category" label="分类" width="100" />
                <el-table-column prop="description" label="备注" min-width="140" />
                <el-table-column prop="party" label="对方" width="110" />
                <el-table-column label="操作" width="70" fixed="right">
                  <template #default="{ row }">
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
      </el-form>
      <template #footer>
        <el-button @click="showAdd = false">取消</el-button>
        <el-button type="primary" @click="handleAdd" :loading="saving">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowRight } from '@element-plus/icons-vue'

const route = useRoute()
const transactions = ref([])
const allAccounts = ref([])
const categories = ref([])
const loading = ref(false)
const showAdd = ref(false)
const saving = ref(false)
const addForm = ref({ account_id: null, type: 'expense', amount: 0, category: '', description: '', party: '' })

const filters = ref({ type: '', account_id: null, account_type: '', category: '' })
const dateRange = ref(null)

function token() { return localStorage.getItem('token') }

function fmt(v) {
  return '¥' + Number(v || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2 })
}

// 展开状态（持久化，不被 computed 重置）
const expandedMap = reactive({})

function toggleGroup(id) {
  expandedMap[id] = !expandedMap[id]
}

function isExpanded(id) {
  return expandedMap[id] !== false // 默认展开
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
        balance: acc?.current_balance ?? 0,
        income: 0,
        expense: 0,
        txs: []
      }
    }
    map[key].txs.push(tx)
    if (tx.type === 'income') map[key].income += tx.amount
    else map[key].expense += tx.amount
  }
  return Object.values(map)
})

function buildQuery() {
  const params = new URLSearchParams()
  // 一次性拉 200 条，前端分组
  params.set('pageSize', '200')
  if (filters.value.type) params.set('type', filters.value.type)
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
    if (json.success) transactions.value = json.data
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

function doSearch() { fetchList() }

function resetFilters() {
  filters.value = { type: '', account_id: null, account_type: '', category: '' }
  dateRange.value = null
  fetchList()
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
      ElMessage.success('新增成功')
      showAdd.value = false
      addForm.value = { account_id: null, type: 'expense', amount: 0, category: '', description: '', party: '' }
      fetchList()
      fetchCategories()
    }
  } finally {
    saving.value = false
  }
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
  } catch {}
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
