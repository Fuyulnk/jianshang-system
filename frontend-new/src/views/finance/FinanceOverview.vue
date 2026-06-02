<template>
  <div class="finance-page">
    <!-- 汇总卡片 -->
    <el-row :gutter="20" style="margin-bottom: 20px;">
      <el-col :span="8">
        <el-card class="summary-card" shadow="never">
          <div class="summary-item">
            <div class="summary-label">总资产</div>
            <div class="summary-value primary">{{ formatMoney(totals.total_assets) }}</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card class="summary-card" shadow="never">
          <div class="summary-item">
            <div class="summary-label">总收入</div>
            <div class="summary-value success">{{ formatMoney(totals.total_income) }}</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="8">
        <el-card class="summary-card" shadow="never">
          <div class="summary-item">
            <div class="summary-label">总支出</div>
            <div class="summary-value danger">{{ formatMoney(totals.total_expense) }}</div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 实时分析 -->
    <el-card class="page-card analysis-card">
      <div class="page-header">
        <div>
          <h2>实时财务分析</h2>
          <p class="page-desc">先用系统流水做确定性统计，后续再接 AI 解释和月报</p>
        </div>
        <div class="header-actions">
          <el-button :icon="Download" :loading="exporting" @click="exportAllTransactions">下载流水</el-button>
          <el-button :icon="Refresh" @click="fetchData" :loading="loading">刷新</el-button>
        </div>
      </div>

      <el-row :gutter="16" class="analysis-metrics">
        <el-col :span="8">
          <div class="analysis-metric">
            <span>本月净现金流</span>
            <strong :class="analysis.this_month.net >= 0 ? 'income' : 'expense'">{{ formatMoney(analysis.this_month.net) }}</strong>
          </div>
        </el-col>
        <el-col :span="8">
          <div class="analysis-metric">
            <span>收入环比</span>
            <strong :class="analysis.this_month.income_change_percent >= 0 ? 'income' : 'expense'">{{ formatPercent(analysis.this_month.income_change_percent) }}</strong>
          </div>
        </el-col>
        <el-col :span="8">
          <div class="analysis-metric">
            <span>支出环比</span>
            <strong :class="analysis.this_month.expense_change_percent <= 0 ? 'income' : 'expense'">{{ formatPercent(analysis.this_month.expense_change_percent) }}</strong>
          </div>
        </el-col>
      </el-row>

      <div class="analysis-grid">
        <div class="analysis-block">
          <h3>本月支出排行</h3>
          <div v-if="analysis.top_expense_categories.length" class="rank-list">
            <div v-for="item in analysis.top_expense_categories" :key="item.category" class="rank-row">
              <span>{{ item.category }}</span>
              <strong>{{ formatMoney(item.total) }}</strong>
            </div>
          </div>
          <el-empty v-else description="暂无支出分类" :image-size="64" />
        </div>
        <div class="analysis-block">
          <h3>系统提醒</h3>
          <ul class="suggestions">
            <li v-for="item in analysis.suggestions" :key="item">{{ item }}</li>
          </ul>
        </div>
      </div>
    </el-card>

    <!-- 球型可视化 -->
    <el-row :gutter="20" style="margin-bottom: 20px;">
      <el-col :span="12">
        <FinanceSphere title="收入占比" :accounts="accounts" type="income" />
      </el-col>
      <el-col :span="12">
        <FinanceSphere title="支出占比" :accounts="accounts" type="expense" />
      </el-col>
    </el-row>

    <!-- 资金总览表 -->
    <el-card class="page-card">
      <div class="page-header">
        <div>
          <h2>资金总览</h2>
          <p class="page-desc">所有账户的收支汇总与当前余额，相当于飞书资金总览表</p>
        </div>
        <el-button @click="fetchData" :loading="loading" :icon="Refresh">刷新</el-button>
      </div>

      <el-table :data="accounts" stripe v-loading="loading" style="width: 100%" :summary-method="summaries" show-summary>
        <el-table-column prop="name" label="账户" min-width="160" />
        <el-table-column prop="type_label" label="类型" width="80">
          <template #default="{ row }">
            <el-tag :type="row.type === 'company' ? 'primary' : 'success'" size="small">
              {{ row.type_label }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="initial_balance" label="期初余额" width="130" align="right">
          <template #default="{ row }">{{ formatMoney(row.initial_balance) }}</template>
        </el-table-column>
        <el-table-column prop="total_income" label="总收入" width="130" align="right">
          <template #default="{ row }">
            <span class="income">{{ formatMoney(row.total_income) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="total_expense" label="总支出" width="130" align="right">
          <template #default="{ row }">
            <span class="expense">{{ formatMoney(row.total_expense) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="current_balance" label="当前余额" width="140" align="right">
          <template #default="{ row }">
            <span :class="row.current_balance >= 0 ? 'income' : 'expense'">
              {{ formatMoney(row.current_balance) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="tx_count" label="交易笔数" width="100" align="center" />
        <el-table-column label="操作" width="80" fixed="right">
          <template #default="{ row }">
            <el-button type="primary" link size="small" @click="viewTransactions(row)">明细</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 按分类统计 -->
    <el-row :gutter="20" style="margin-top: 20px;">
      <el-col :span="12">
        <el-card class="page-card">
          <h3 class="card-title">收入分类</h3>
          <el-table :data="incomeCategories" stripe size="small" v-if="incomeCategories.length">
            <el-table-column prop="category" label="分类" />
            <el-table-column prop="total" label="金额" align="right">
              <template #default="{ row }">{{ formatMoney(row.total) }}</template>
            </el-table-column>
            <el-table-column prop="count" label="笔数" width="80" align="center" />
          </el-table>
          <el-empty v-else description="暂无收入" :image-size="80" />
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card class="page-card">
          <h3 class="card-title">支出分类</h3>
          <el-table :data="expenseCategories" stripe size="small" v-if="expenseCategories.length">
            <el-table-column prop="category" label="分类" />
            <el-table-column prop="total" label="金额" align="right">
              <template #default="{ row }">{{ formatMoney(row.total) }}</template>
            </el-table-column>
            <el-table-column prop="count" label="笔数" width="80" align="center" />
          </el-table>
          <el-empty v-else description="暂无支出" :image-size="80" />
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Download, Refresh } from '@element-plus/icons-vue'
import FinanceSphere from '../../components/FinanceSphere.vue'

const router = useRouter()
const loading = ref(false)
const exporting = ref(false)
const accounts = ref([])
const totals = ref({ total_assets: 0, total_income: 0, total_expense: 0, account_count: 0 })
const incomeCategories = ref([])
const expenseCategories = ref([])
const analysis = ref({
  this_month: { income: 0, expense: 0, net: 0, count: 0, income_change_percent: 0, expense_change_percent: 0 },
  last_month: { income: 0, expense: 0, net: 0, count: 0 },
  recent_trend: [],
  top_expense_categories: [],
  high_expenses: [],
  duplicate_candidates: [],
  negative_accounts: [],
  suggestions: ['暂无分析数据']
})

function token() { return localStorage.getItem('token') }

function formatMoney(v) {
  const n = Number(v) || 0
  return (n >= 0 ? '' : '-') + '¥' + Math.abs(n).toLocaleString('zh-CN', { minimumFractionDigits: 2 })
}

function formatPercent(v) {
  const n = Number(v) || 0
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`
}

async function fetchData() {
  loading.value = true
  try {
    const [overviewRes, catRes, analysisRes] = await Promise.all([
      fetch('/api/finance/overview', { headers: { Authorization: `Bearer ${token()}` } }),
      fetch('/api/finance/categories', { headers: { Authorization: `Bearer ${token()}` } }),
      fetch('/api/finance/analysis', { headers: { Authorization: `Bearer ${token()}` } })
    ])
    const overview = await overviewRes.json()
    const cats = await catRes.json()
    const nextAnalysis = await analysisRes.json()

    if (overview.success) {
      accounts.value = overview.data.accounts
      totals.value = overview.data.totals
    }
    if (cats.success) {
      incomeCategories.value = cats.data.filter(c => c.type === 'income')
      expenseCategories.value = cats.data.filter(c => c.type === 'expense')
    }
    if (nextAnalysis.success) analysis.value = nextAnalysis.data
  } finally {
    loading.value = false
  }
}

function summaries(param) {
  const sums = {}
  param.columns.forEach(col => {
    if (col.property === 'name') sums[col.property] = '合计'
    else if (col.property === 'current_balance') sums[col.property] = formatMoney(totals.value.total_assets)
    else if (col.property === 'total_income') sums[col.property] = formatMoney(totals.value.total_income)
    else if (col.property === 'total_expense') sums[col.property] = formatMoney(totals.value.total_expense)
    else if (col.property === 'tx_count') sums[col.property] = accounts.value.length
    else sums[col.property] = ''
  })
  return sums
}

function viewTransactions(row) {
  router.push(`/main/transactions?account_id=${row.id}`)
}

async function exportAllTransactions() {
  exporting.value = true
  try {
    const res = await fetch('/api/transactions/export?format=xls', {
      headers: { Authorization: `Bearer ${token()}` }
    })
    if (!res.ok) throw new Error('下载失败')
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `简尚财务流水-${new Date().toISOString().slice(0, 10)}.xls`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    ElMessage.success('已开始下载')
  } catch (error) {
    ElMessage.error(error.message || '下载失败')
  } finally {
    exporting.value = false
  }
}

onMounted(fetchData)
</script>

<style scoped>
.summary-card {
  border-radius: var(--radius-md) !important;
  border: 1px solid var(--border-light) !important;
}
.summary-item { text-align: center; padding: 8px 0; }
.summary-label { font-size: 13px; color: var(--text-tertiary); margin-bottom: 8px; }
.summary-value { font-size: 26px; font-weight: 700; letter-spacing: -0.5px; }
.summary-value.primary { color: var(--color-primary); }
.summary-value.success { color: var(--color-success); }
.summary-value.danger { color: #ef4444; }

.income { color: var(--color-success); font-weight: 600; }
.expense { color: #ef4444; font-weight: 600; }
.card-title { margin: 0 0 16px; font-size: 15px; font-weight: 600; color: var(--text-primary); }

.page-card { border-radius: var(--radius-md) !important; border: 1px solid var(--border-light) !important; }
.page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
.page-header h2 { margin: 0; font-size: 18px; color: var(--text-primary); }
.page-desc { margin: 4px 0 0; font-size: 13px; color: var(--text-tertiary); }

.analysis-card { margin-bottom: 20px; }
.header-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}
.analysis-metrics { margin-bottom: 16px; }
.analysis-metric {
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  padding: 12px;
  background: color-mix(in srgb, var(--bg-card) 88%, var(--bg-page));
}
.analysis-metric span {
  display: block;
  margin-bottom: 6px;
  color: var(--text-tertiary);
  font-size: 12px;
}
.analysis-metric strong { font-size: 18px; }
.analysis-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
}
.analysis-block {
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  padding: 14px;
  background: var(--bg-card);
}
.analysis-block h3 {
  margin: 0 0 12px;
  font-size: 14px;
  color: var(--text-primary);
}
.rank-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.rank-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  color: var(--text-secondary);
  font-size: 13px;
}
.suggestions {
  margin: 0;
  padding-left: 18px;
  color: var(--text-secondary);
  line-height: 1.8;
  font-size: 13px;
}

@media (max-width: 900px) {
  .analysis-grid { grid-template-columns: 1fr; }
  .page-header {
    flex-direction: column;
    gap: 12px;
  }
  .header-actions { justify-content: flex-start; }
}
</style>
