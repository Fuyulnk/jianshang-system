// 财务总览模块 — 照搬飞书资金总览表逻辑
import { authMiddleware } from '../middleware/auth.js'

function requireFinanceAccess(request, reply) {
  if (!['super_admin', 'admin', 'finance'].includes(request.user.role)) {
    reply.code(403).send({ success: false, message: '无权限查看财务数据' })
    return false
  }
  return true
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100
}

function percentChange(current, previous) {
  const cur = Number(current) || 0
  const prev = Number(previous) || 0
  if (!prev) return cur ? 100 : 0
  return Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10
}

export default function financeRoutes(server, db) {
  // 财务总览：每个账户的收入/支出汇总 + 余额
  server.get('/api/finance/overview', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireFinanceAccess(request, reply)) return

    // 所有账户
    const accounts = db.prepare(
      'SELECT id, name, type, initial_balance, current_balance FROM accounts ORDER BY id'
    ).all()

    // 各账户汇总（忽略已作废的交易）
    const summaries = db.prepare(`
      SELECT
        account_id,
        COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END), 0) as total_income,
        COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0) as total_expense,
        COUNT(*) as tx_count
      FROM transactions
      WHERE (status != 'cancelled' OR status IS NULL)
      GROUP BY account_id
    `).all()

    const summaryMap = {}
    for (const s of summaries) {
      summaryMap[s.account_id] = s
    }

    // 组装
    const accountData = accounts.map(a => {
      const s = summaryMap[a.id] || { total_income: 0, total_expense: 0, tx_count: 0 }
      return {
        id: a.id,
        name: a.name,
        type: a.type,
        type_label: a.type === 'company' ? '公账' : '私账',
        initial_balance: a.initial_balance,
        current_balance: a.current_balance,
        total_income: s.total_income,
        total_expense: s.total_expense,
        tx_count: s.tx_count
      }
    })

    // 汇总行
    const totals = {
      total_assets: accounts.reduce((s, a) => s + a.current_balance, 0),
      total_income: accountData.reduce((s, a) => s + a.total_income, 0),
      total_expense: accountData.reduce((s, a) => s + a.total_expense, 0),
      account_count: accounts.length
    }

    return { success: true, data: { accounts: accountData, totals } }
  })

  // 收支分类统计（按分类汇总，用于图表）
  server.get('/api/finance/categories', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireFinanceAccess(request, reply)) return

    const { type, days } = request.query
    const params = []
    let where = "WHERE (t.status != 'cancelled' OR t.status IS NULL)"

    if (type === 'income' || type === 'expense') {
      where += ' AND t.type = ?'
      params.push(type)
    }
    if (days) {
      where += " AND t.created_at >= datetime('now', 'localtime', '-' || ? || ' days')"
      params.push(parseInt(days))
    }

    const data = db.prepare(`
      SELECT
        t.type,
        t.category,
        COALESCE(SUM(t.amount), 0) as total,
        COUNT(*) as count
      FROM transactions t
      ${where}
      GROUP BY t.type, t.category
      ORDER BY t.type, total DESC
    `).all(...params)

    return { success: true, data }
  })

  // 实时财务分析：先做确定性 SQL 统计，后续再让 AI 基于这些结果解释。
  server.get('/api/finance/analysis', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireFinanceAccess(request, reply)) return

    const activeWhere = "(status != 'cancelled' OR status IS NULL)"
    const thisMonth = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END), 0) as income,
        COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0) as expense,
        COUNT(*) as count
      FROM transactions
      WHERE ${activeWhere}
        AND created_at >= datetime('now', 'localtime', 'start of month')
    `).get()

    const lastMonth = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END), 0) as income,
        COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0) as expense,
        COUNT(*) as count
      FROM transactions
      WHERE ${activeWhere}
        AND created_at >= datetime('now', 'localtime', 'start of month', '-1 month')
        AND created_at < datetime('now', 'localtime', 'start of month')
    `).get()

    const recentTrend = db.prepare(`
      SELECT
        date(created_at) as day,
        COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END), 0) as income,
        COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0) as expense
      FROM transactions
      WHERE ${activeWhere}
        AND created_at >= datetime('now', 'localtime', '-30 days')
      GROUP BY date(created_at)
      ORDER BY day ASC
    `).all().map(row => ({
      day: row.day,
      income: roundMoney(row.income),
      expense: roundMoney(row.expense),
      net: roundMoney(row.income - row.expense)
    }))

    const topExpenseCategories = db.prepare(`
      SELECT COALESCE(category, '未分类') as category, COALESCE(SUM(amount), 0) as total, COUNT(*) as count
      FROM transactions
      WHERE ${activeWhere}
        AND type = 'expense'
        AND created_at >= datetime('now', 'localtime', 'start of month')
      GROUP BY COALESCE(category, '未分类')
      ORDER BY total DESC
      LIMIT 6
    `).all()

    const avgExpense = db.prepare(`
      SELECT COALESCE(AVG(amount), 0) as avg_amount
      FROM transactions
      WHERE ${activeWhere}
        AND type = 'expense'
        AND created_at >= datetime('now', 'localtime', '-90 days')
    `).get().avg_amount
    const highExpenseFloor = Math.max(Number(avgExpense || 0) * 2, 1000)
    const highExpenses = db.prepare(`
      SELECT t.id, t.created_at, t.amount, t.category, t.description, t.party, a.name as account_name
      FROM transactions t
      LEFT JOIN accounts a ON t.account_id = a.id
      WHERE (t.status != 'cancelled' OR t.status IS NULL)
        AND t.type = 'expense'
        AND t.amount >= ?
      ORDER BY t.amount DESC
      LIMIT 8
    `).all(highExpenseFloor)

    const duplicateCandidates = db.prepare(`
      SELECT
        date(created_at) as day,
        type,
        amount,
        COALESCE(category, '') as category,
        COALESCE(party, '') as party,
        COUNT(*) as count
      FROM transactions
      WHERE ${activeWhere}
        AND created_at >= datetime('now', 'localtime', '-60 days')
      GROUP BY date(created_at), type, amount, COALESCE(category, ''), COALESCE(party, '')
      HAVING COUNT(*) > 1
      ORDER BY count DESC, day DESC
      LIMIT 8
    `).all()

    const negativeAccounts = db.prepare(`
      SELECT id, name, type, current_balance
      FROM accounts
      WHERE current_balance < 0
      ORDER BY current_balance ASC
    `).all()

    const monthNet = roundMoney(thisMonth.income - thisMonth.expense)
    const suggestions = []
    if (monthNet < 0) suggestions.push('本月净现金流为负，建议优先检查大额支出和未回款项目。')
    if (highExpenses.length) suggestions.push('存在高额支出记录，月底汇总时建议逐笔核对发票、合同或报销凭证。')
    if (duplicateCandidates.length) suggestions.push('发现疑似重复流水，建议财务导出明细后按日期、金额、对方复核。')
    if (negativeAccounts.length) suggestions.push('存在负余额账户，建议确认是否为垫付、未同步入账或账户余额录入错误。')
    if (!suggestions.length) suggestions.push('当前未发现明显异常，月底可按账户和分类导出流水做人工复核。')

    return {
      success: true,
      data: {
        generated_at: new Date().toISOString(),
        this_month: {
          income: roundMoney(thisMonth.income),
          expense: roundMoney(thisMonth.expense),
          net: monthNet,
          count: thisMonth.count,
          income_change_percent: percentChange(thisMonth.income, lastMonth.income),
          expense_change_percent: percentChange(thisMonth.expense, lastMonth.expense)
        },
        last_month: {
          income: roundMoney(lastMonth.income),
          expense: roundMoney(lastMonth.expense),
          net: roundMoney(lastMonth.income - lastMonth.expense),
          count: lastMonth.count
        },
        recent_trend: recentTrend,
        top_expense_categories: topExpenseCategories.map(row => ({
          ...row,
          total: roundMoney(row.total)
        })),
        high_expenses: highExpenses.map(row => ({ ...row, amount: roundMoney(row.amount) })),
        duplicate_candidates: duplicateCandidates.map(row => ({ ...row, amount: roundMoney(row.amount) })),
        negative_accounts: negativeAccounts.map(row => ({ ...row, current_balance: roundMoney(row.current_balance) })),
        suggestions
      }
    }
  })

  server.get('/api/finance/project-profit-summary', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireFinanceAccess(request, reply)) return

    const projects = db.prepare(`
      SELECT id, name, customer, status, total_amount, deposit_amount, settlement_amount, updated_at
      FROM projects
      WHERE status IN ('material_returned', 'labor_settled', 'cost_checked', 'finance_settled', 'archived')
      ORDER BY updated_at DESC, id DESC
      LIMIT 200
    `).all()
    const docs = getLatestFinanceDocs(db, projects.map(item => item.id))
    const rows = projects.map(project => buildProjectProfitRow(project, docs[project.id] || {}))
    const activeRows = rows.filter(row => row.revenue_amount || row.total_cost || row.gross_profit || row.unpaid_amount)
    const totals = activeRows.reduce((sum, row) => {
      sum.revenue_amount += row.revenue_amount
      sum.total_cost += row.total_cost
      sum.gross_profit += row.gross_profit
      sum.unpaid_amount += row.unpaid_amount
      if (row.payment_status !== 'paid') sum.pending_finance_count += 1
      if (row.gross_profit < 0) sum.negative_profit_count += 1
      return sum
    }, {
      project_count: activeRows.length,
      revenue_amount: 0,
      total_cost: 0,
      gross_profit: 0,
      unpaid_amount: 0,
      pending_finance_count: 0,
      negative_profit_count: 0
    })
    totals.revenue_amount = roundMoney(totals.revenue_amount)
    totals.total_cost = roundMoney(totals.total_cost)
    totals.gross_profit = roundMoney(totals.gross_profit)
    totals.unpaid_amount = roundMoney(totals.unpaid_amount)
    totals.profit_rate = totals.revenue_amount ? Number((totals.gross_profit / totals.revenue_amount).toFixed(4)) : 0

    return {
      success: true,
      data: {
        totals,
        projects: rows.slice(0, 80)
      }
    }
  })
}

function getLatestFinanceDocs(db, projectIds) {
  if (!projectIds.length) return {}
  const placeholders = projectIds.map(() => '?').join(',')
  const rows = db.prepare(`
    SELECT *
    FROM project_documents
    WHERE project_id IN (${placeholders})
      AND document_type IN ('material_io', 'labor_settlement', 'cost_check', 'finance_settlement')
    ORDER BY project_id ASC, document_type ASC, id DESC
  `).all(...projectIds)
  const map = {}
  for (const row of rows) {
    if (!map[row.project_id]) map[row.project_id] = {}
    if (!map[row.project_id][row.document_type]) {
      map[row.project_id][row.document_type] = {
        ...row,
        confirmed_data: parseJson(row.confirmed_data, {})
      }
    }
  }
  return map
}

function buildProjectProfitRow(project, docs) {
  const material = docs.material_io?.confirmed_data?.summary || {}
  const labor = docs.labor_settlement?.confirmed_data?.summary || {}
  const cost = docs.cost_check?.confirmed_data?.summary || {}
  const finance = docs.finance_settlement?.confirmed_data?.summary || {}

  const revenueAmount = firstMoney(
    finance.delivery_revenue,
    cost.revenue_amount,
    project.settlement_amount,
    finance.contract_amount,
    project.total_amount
  )
  const laborFee = firstMoney(labor.labor_fee, cost.labor_fee)
  const materialFee = firstMoney(material.material_fee, cost.material_fee)
  const auxiliaryFee = firstMoney(material.auxiliary_fee, cost.auxiliary_fee)
  const toolFee = firstMoney(material.tool_fee, cost.tool_fee)
  const transportFee = firstMoney(material.transport_fee, cost.transport_fee)
  const otherFee = firstMoney(cost.other_fee)
  const autoTotalCost = roundMoney(laborFee + materialFee + auxiliaryFee + toolFee + transportFee + otherFee)
  const totalCost = firstMoney(cost.total_cost, autoTotalCost)
  const grossProfit = roundMoney(revenueAmount - totalCost)
  const profitRate = revenueAmount ? Number((grossProfit / revenueAmount).toFixed(4)) : 0
  const receivedAmount = firstMoney(finance.received_amount, project.deposit_amount)
  const unpaidAmount = firstMoney(finance.unpaid_amount, Math.max(revenueAmount - receivedAmount, 0))
  const warnings = []
  if (cost.total_cost && autoTotalCost && Math.abs(Number(cost.total_cost) - autoTotalCost) > 0.01) {
    warnings.push('成本表合计与自动汇总不一致')
  }
  if (revenueAmount && !docs.finance_settlement) warnings.push('缺财务结算/归档凭证')
  if (grossProfit < 0) warnings.push('毛利为负')
  if (unpaidAmount > 0) warnings.push('存在尾款/未收')

  return {
    project_id: project.id,
    project_name: project.name,
    customer: project.customer,
    status: project.status,
    revenue_amount: roundMoney(revenueAmount),
    labor_fee: roundMoney(laborFee),
    material_fee: roundMoney(materialFee),
    auxiliary_fee: roundMoney(auxiliaryFee),
    tool_fee: roundMoney(toolFee),
    transport_fee: roundMoney(transportFee),
    total_cost: roundMoney(totalCost),
    gross_profit: roundMoney(grossProfit),
    profit_rate: profitRate,
    received_amount: roundMoney(receivedAmount),
    unpaid_amount: roundMoney(unpaidAmount),
    payment_status: finance.payment_status || (unpaidAmount > 0 ? 'partial' : revenueAmount ? 'paid' : 'pending'),
    finance_note: finance.finance_note || '',
    warnings,
    updated_at: project.updated_at
  }
}

function firstMoney(...values) {
  for (const value of values) {
    const n = Number(value)
    if (Number.isFinite(n) && n > 0) return n
  }
  return 0
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback
  } catch {
    return fallback
  }
}
