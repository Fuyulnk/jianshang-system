import { authMiddleware } from '../middleware/auth.js'
import { requireModuleAccess } from '../utils/permissions.js'
import * as XLSX from 'xlsx'

const LARGE_ACCOUNT_IMPORT_BODY_LIMIT = 12 * 1024 * 1024

function requireAccountAccess(db, request, reply, permission) {
  if (authMiddleware(request, reply) === false) return false
  return requireModuleAccess(db, request, reply, 'accounts', permission, '无权限访问账户数据')
}

export default function accountRoutes(server, db) {
  ensureAccountSnapshotTables(db)

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
    const snapshotRows = useMonth
      ? db.prepare('SELECT * FROM account_monthly_snapshots WHERE month = ?').all(monthInfo.value)
      : []
    const snapshotMap = new Map(snapshotRows.map(row => [Number(row.account_id), row]))
    const summaries = accounts.map(account => {
      const snapshot = snapshotMap.get(Number(account.id))
      if (snapshot) {
        const income = roundMoney(snapshot.income_total)
        const expense = roundMoney(snapshot.expense_total)
        return {
          account_id: account.id,
          income_total: income,
          expense_total: expense,
          net_change: roundMoney(income - expense),
          opening_balance: roundMoney(snapshot.opening_balance),
          period_balance: roundMoney(snapshot.closing_balance),
          source: 'imported_snapshot'
        }
      }
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
        period_balance: useMonth ? roundMoney(openingBalance + net) : roundMoney(account.current_balance),
        source: useMonth ? 'calculated' : 'account_current'
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

  server.post('/api/accounts/monthly-summary/import', { bodyLimit: LARGE_ACCOUNT_IMPORT_BODY_LIMIT }, async (request, reply) => {
    if (!requireAccountAccess(db, request, reply, 'can_edit')) return

    const { file_name = '', file_data = '', month = '' } = request.body || {}
    const monthInfo = normalizeMonth(month)
    if (!monthInfo) return { success: false, message: '请选择要导入的月份' }
    if (!file_name || !file_data) return { success: false, message: '请选择资金总览表 Excel 文件' }

    try {
      const rows = parseAccountMonthlySummaryRows(file_data)
      if (!rows.length) return { success: false, message: '没有识别到账户余额明细，请确认表头包含账户、期初余额、总收入、总支出、当前余额' }
      const targetMonth = detectSummaryMonth(rows) || monthInfo.value
      const targetMonthInfo = normalizeMonth(targetMonth)
      let createdAccounts = 0
      let updatedSnapshots = 0
      const warnings = []
      if (targetMonthInfo.value !== monthInfo.value) {
        warnings.push(`已按表格最后更新时间识别为 ${targetMonthInfo.value}，没有导入到页面当前选择的 ${monthInfo.value}`)
      }
      const tx = db.transaction(() => {
        const findAccount = db.prepare('SELECT * FROM accounts WHERE name = ?')
        const createAccount = db.prepare('INSERT INTO accounts (name, type, initial_balance, current_balance) VALUES (?, ?, ?, ?)')
        const updateAccountType = db.prepare("UPDATE accounts SET type = ?, updated_at = datetime('now', 'localtime') WHERE id = ? AND COALESCE(type, '') != ?")
        const upsertSnapshot = db.prepare(`
          INSERT INTO account_monthly_snapshots (
            account_id, month, opening_balance, income_total, expense_total, closing_balance,
            source_file_name, imported_by, updated_at, note
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(account_id, month) DO UPDATE SET
            opening_balance = excluded.opening_balance,
            income_total = excluded.income_total,
            expense_total = excluded.expense_total,
            closing_balance = excluded.closing_balance,
            source_file_name = excluded.source_file_name,
            imported_by = excluded.imported_by,
            imported_at = datetime('now', 'localtime'),
            updated_at = excluded.updated_at,
            note = excluded.note
        `)

        for (const row of rows) {
          let account = findAccount.get(row.name)
          if (!account) {
            const result = createAccount.run(row.name, row.type, row.opening_balance, row.closing_balance)
            account = { id: result.lastInsertRowid, name: row.name, type: row.type }
            createdAccounts += 1
          } else {
            updateAccountType.run(row.type, account.id, row.type)
          }
          upsertSnapshot.run(
            account.id,
            targetMonthInfo.value,
            row.opening_balance,
            row.income_total,
            row.expense_total,
            row.closing_balance,
            safeText(file_name, 240),
            request.user.userId,
            row.updated_at,
            row.note
          )
          updatedSnapshots += 1
        }
      })
      tx()
      return {
        success: true,
        message: `已导入 ${targetMonthInfo.value} 账户余额 ${updatedSnapshots} 条${createdAccounts ? `，新增账户 ${createdAccounts} 个` : ''}`,
        data: { imported_count: updatedSnapshots, created_accounts: createdAccounts, month: targetMonthInfo.value, warnings }
      }
    } catch (err) {
      reply.code(400).send({ success: false, message: err.message || '导入账户余额失败' })
    }
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

function ensureAccountSnapshotTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS account_monthly_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      month TEXT NOT NULL,
      opening_balance REAL DEFAULT 0,
      income_total REAL DEFAULT 0,
      expense_total REAL DEFAULT 0,
      closing_balance REAL DEFAULT 0,
      source_file_name TEXT DEFAULT '',
      imported_by INTEGER DEFAULT 0,
      imported_at DATETIME DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT '',
      note TEXT DEFAULT '',
      UNIQUE(account_id, month)
    )
  `)
}

function parseAccountMonthlySummaryRows(fileData) {
  const workbook = XLSX.read(decodeData(fileData), { type: 'buffer', cellDates: true, raw: false })
  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: false })
    const headerIndex = findAccountSummaryHeaderRow(rows)
    if (headerIndex < 0) continue
    const headers = rows[headerIndex].map(normalizeHeader)
    return rows.slice(headerIndex + 1).map(cells => {
      const row = {}
      headers.forEach((header, index) => { if (header) row[header] = cells[index] })
      const name = cleanText(pickField(row, ['账户', '账户名称']))
      if (!name) return null
      return {
        name,
        type: normalizeAccountType(pickField(row, ['账户类型', '类型'])),
        opening_balance: toMoney(pickField(row, ['期初余额', '月初余额', '初始余额'])),
        income_total: toMoney(pickField(row, ['总收入', '收入', '本月收入'])),
        expense_total: toMoney(pickField(row, ['总支出', '支出', '本月支出'])),
        closing_balance: toMoney(pickField(row, ['当前余额', '月末余额', '期末余额'])),
        updated_at: normalizeDateText(pickField(row, ['最后更新时间', '更新时间'])),
        note: cleanText(pickField(row, ['备注']))
      }
    }).filter(Boolean)
  }
  return []
}

function findAccountSummaryHeaderRow(rows) {
  const required = ['账户', '期初余额', '当前余额']
  return rows.findIndex(row => {
    const headers = row.map(normalizeHeader)
    return required.filter(item => headers.includes(normalizeHeader(item))).length >= 2
      && headers.some(item => ['总收入', '收入'].includes(item))
      && headers.some(item => ['总支出', '支出'].includes(item))
  })
}

function normalizeHeader(value) {
  return cleanText(value).replace(/\s+/g, '').replace(/[：:]/g, '')
}

function pickField(row, names) {
  for (const name of names) {
    const value = row[normalizeHeader(name)]
    if (cleanText(value)) return value
  }
  return ''
}

function normalizeAccountType(value) {
  const text = cleanText(value)
  return /公账|公司|企业|company/i.test(text) ? 'company' : 'personal'
}

function normalizeDateText(value) {
  const text = cleanText(value).replace(/[./年]/g, '-').replace(/[月]/g, '-').replace(/[日]/g, '')
  const match = text.match(/\d{4}-\d{1,2}-\d{1,2}/)
  if (!match) return text
  const [year, month, day] = match[0].split('-')
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

function detectSummaryMonth(rows) {
  const counts = new Map()
  for (const row of rows) {
    const match = cleanText(row.updated_at).match(/^(\d{4}-\d{2})-\d{2}/)
    if (!match) continue
    counts.set(match[1], (counts.get(match[1]) || 0) + 1)
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1])
  return ranked[0]?.[1] >= Math.ceil(rows.length / 2) ? ranked[0][0] : ''
}

function decodeData(value = '') {
  const text = String(value || '')
  const base64 = text.includes(',') ? text.split(',').pop() : text
  return Buffer.from(base64, 'base64')
}

function roundMoney(value) {
  const n = Number(value || 0)
  return Math.round(n * 100) / 100
}

function toMoney(value) {
  const n = Number(String(value ?? '').replace(/[,，￥¥\s]/g, ''))
  return Number.isFinite(n) ? roundMoney(n) : 0
}

function cleanText(value) {
  return String(value ?? '').trim()
}

function safeText(value, limit = 200) {
  return cleanText(value).slice(0, limit)
}
