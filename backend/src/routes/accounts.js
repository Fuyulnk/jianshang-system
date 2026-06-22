import { authMiddleware } from '../middleware/auth.js'
import { requireModuleAccess } from '../utils/permissions.js'

function requireAccountAccess(db, request, reply, permission) {
  if (authMiddleware(request, reply) === false) return false
  return requireModuleAccess(db, request, reply, 'accounts', permission, '无权限访问账户数据')
}

export default function accountRoutes(server, db) {
  // 获取账户列表
  server.get('/api/accounts', async (request, reply) => {
    if (!requireAccountAccess(db, request, reply, 'can_view')) return

    const accounts = db.prepare('SELECT * FROM accounts ORDER BY id ASC').all()
    return { success: true, data: accounts }
  })

  // 账户月度/总览汇总。用于账户页按月份查看跨月收入、支出和月末余额。
  server.get('/api/accounts/summary', async (request, reply) => {
    if (!requireAccountAccess(db, request, reply, 'can_view')) return

    const { mode = 'month', month } = request.query || {}
    const monthInfo = normalizeMonth(month)
    const useMonth = mode !== 'all' && monthInfo
    const accounts = db.prepare('SELECT id, initial_balance, current_balance FROM accounts ORDER BY id ASC').all()

    const periodRows = useMonth
      ? db.prepare(`
          SELECT account_id,
                 COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as income_total,
                 COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as expense_total
          FROM transactions
          WHERE account_id IS NOT NULL
            AND (status IS NULL OR status = '' OR status = 'approved')
            AND created_at >= ?
            AND created_at < ?
          GROUP BY account_id
        `).all(monthInfo.start, monthInfo.next)
      : db.prepare(`
          SELECT account_id,
                 COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as income_total,
                 COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as expense_total
          FROM transactions
          WHERE account_id IS NOT NULL
            AND (status IS NULL OR status = '' OR status = 'approved')
          GROUP BY account_id
        `).all()

    const beforeRows = useMonth
      ? db.prepare(`
          SELECT account_id,
                 COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END), 0) as before_net
          FROM transactions
          WHERE account_id IS NOT NULL
            AND (status IS NULL OR status = '' OR status = 'approved')
            AND created_at < ?
          GROUP BY account_id
        `).all(monthInfo.start)
      : []

    const periodMap = new Map(periodRows.map(row => [Number(row.account_id), row]))
    const beforeMap = new Map(beforeRows.map(row => [Number(row.account_id), row]))
    const summaries = accounts.map(account => {
      const period = periodMap.get(Number(account.id)) || {}
      const income = roundMoney(period.income_total)
      const expense = roundMoney(period.expense_total)
      const net = roundMoney(income - expense)
      const openingBalance = useMonth
        ? roundMoney(Number(account.initial_balance || 0) + Number(beforeMap.get(Number(account.id))?.before_net || 0))
        : roundMoney(Number(account.initial_balance || 0))
      return {
        account_id: account.id,
        income_total: income,
        expense_total: expense,
        net_change: net,
        opening_balance: openingBalance,
        period_balance: useMonth ? roundMoney(openingBalance + net) : roundMoney(account.current_balance)
      }
    })

    return {
      success: true,
      data: summaries,
      meta: {
        mode: useMonth ? 'month' : 'all',
        month: useMonth ? monthInfo.value : '',
        label: useMonth ? `${monthInfo.value} 月度` : '总览'
      }
    }
  })

  // 获取单个账户
  server.get('/api/accounts/:id', async (request, reply) => {
    if (!requireAccountAccess(db, request, reply, 'can_view')) return

    const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(request.params.id)
    if (!account) {
      reply.code(404).send({ success: false, message: '账户不存在' })
      return
    }
    return { success: true, data: account }
  })

  // 新增账户
  server.post('/api/accounts', async (request, reply) => {
    if (!requireAccountAccess(db, request, reply, 'can_create')) return

    const { name, type, initial_balance, current_balance } = request.body
    if (!name) {
      return { success: false, message: '账户名称不能为空' }
    }
    const initialBalance = toMoney(initial_balance)
    const currentBalance = request.body?.current_balance === undefined || request.body?.current_balance === ''
      ? initialBalance
      : toMoney(current_balance)

    const result = db.prepare(
      'INSERT INTO accounts (name, type, initial_balance, current_balance) VALUES (?, ?, ?, ?)'
    ).run(cleanText(name), type || 'personal', initialBalance, currentBalance)

    return { success: true, id: result.lastInsertRowid }
  })

  // 更新账户
  server.put('/api/accounts/:id', async (request, reply) => {
    if (!requireAccountAccess(db, request, reply, 'can_edit')) return

    const { name, type, initial_balance, current_balance } = request.body
    if (!name) {
      return { success: false, message: '账户名称不能为空' }
    }
    const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(request.params.id)
    if (!account) {
      reply.code(404).send({ success: false, message: '账户不存在' })
      return
    }
    db.prepare(
      `UPDATE accounts
       SET name = ?, type = ?, initial_balance = ?, current_balance = ?, updated_at = datetime('now', 'localtime')
       WHERE id = ?`
    ).run(
      cleanText(name),
      type || account.type || 'personal',
      toMoney(initial_balance),
      toMoney(current_balance),
      request.params.id
    )

    return { success: true }
  })

  // 删除账户（关联交易归零，避免孤儿数据）
  server.delete('/api/accounts/:id', async (request, reply) => {
    if (!requireAccountAccess(db, request, reply, 'can_delete')) return

    const account = db.prepare('SELECT id FROM accounts WHERE id = ?').get(request.params.id)
    if (!account) {
      reply.code(404).send({ success: false, message: '账户不存在' })
      return
    }
    const txCount = db.prepare('SELECT COUNT(*) as cnt FROM transactions WHERE account_id = ?').get(request.params.id)
    if (txCount.cnt > 0) {
      db.prepare("UPDATE transactions SET account_id = NULL WHERE account_id = ?").run(request.params.id)
    }
    db.prepare('DELETE FROM accounts WHERE id = ?').run(request.params.id)
    return { success: true }
  })
}

function normalizeMonth(value) {
  const text = String(value || '').trim()
  if (!/^\d{4}-\d{2}$/.test(text)) return null
  const [year, month] = text.split('-').map(Number)
  if (year < 2000 || month < 1 || month > 12) return null
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  return {
    value: `${year}-${String(month).padStart(2, '0')}`,
    start: `${year}-${String(month).padStart(2, '0')}-01 00:00:00`,
    next: `${nextYear}-${String(nextMonth).padStart(2, '0')}-01 00:00:00`
  }
}

function roundMoney(value) {
  const n = Number(value || 0)
  return Math.round(n * 100) / 100
}

function toMoney(value) {
  const n = Number(value)
  return Number.isFinite(n) ? roundMoney(n) : 0
}

function cleanText(value) {
  return String(value ?? '').trim()
}
