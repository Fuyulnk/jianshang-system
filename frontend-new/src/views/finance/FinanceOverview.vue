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
        <el-button @click="fetchData" :loading="loading" icon="Refresh">刷新</el-button>
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
import FinanceSphere from '../../components/FinanceSphere.vue'

const router = useRouter()
const loading = ref(false)
const accounts = ref([])
const totals = ref({ total_assets: 0, total_income: 0, total_expense: 0, account_count: 0 })
const incomeCategories = ref([])
const expenseCategories = ref([])

function token() { return localStorage.getItem('token') }

function formatMoney(v) {
  const n = Number(v) || 0
  return (n >= 0 ? '' : '-') + '¥' + Math.abs(n).toLocaleString('zh-CN', { minimumFractionDigits: 2 })
}

async function fetchData() {
  loading.value = true
  try {
    const [overviewRes, catRes] = await Promise.all([
      fetch('/api/finance/overview', { headers: { Authorization: `Bearer ${token()}` } }),
      fetch('/api/finance/categories', { headers: { Authorization: `Bearer ${token()}` } })
    ])
    const overview = await overviewRes.json()
    const cats = await catRes.json()

    if (overview.success) {
      accounts.value = overview.data.accounts
      totals.value = overview.data.totals
    }
    if (cats.success) {
      incomeCategories.value = cats.data.filter(c => c.type === 'income')
      expenseCategories.value = cats.data.filter(c => c.type === 'expense')
    }
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
    else if (col.property === 'account_count') sums[col.property] = accounts.value.length
    else sums[col.property] = ''
  })
  return sums
}

function viewTransactions(row) {
  router.push(`/main/transactions?account_id=${row.id}`)
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
</style>
