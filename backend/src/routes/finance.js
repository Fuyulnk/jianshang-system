// 财务总览模块 — 照搬飞书资金总览表逻辑
import { authMiddleware } from '../middleware/auth.js'

function requireFinanceAccess(request, reply) {
  if (!['super_admin', 'admin', 'finance'].includes(request.user.role)) {
    reply.code(403).send({ success: false, message: '无权限查看财务数据' })
    return false
  }
  return true
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
}
