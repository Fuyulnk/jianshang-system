import Database from 'better-sqlite3'
import * as XLSX from 'xlsx'
import { existsSync, readFileSync } from 'fs'

const args = parseArgs(process.argv.slice(2))
const dbPath = args.db
const workbooks = args.workbook || []
const importedBy = Number(args.userId || 1)

if (!dbPath || !workbooks.length) {
  console.error('用法：node backend/scripts/rebuild-finance-data.mjs --db <jianshang.db> --workbook <4月.xlsx> --workbook <5月.xlsx> [--user-id 1]')
  process.exit(1)
}

for (const file of workbooks) {
  if (!existsSync(file)) {
    console.error(`文件不存在：${file}`)
    process.exit(1)
  }
}

const db = new Database(dbPath)
ensureTables(db)

const summaries = []
const transactions = []
const warnings = []
for (const file of workbooks) {
  const parsed = parseWorkbook(file, db)
  summaries.push(...parsed.summaries)
  transactions.push(...parsed.transactions)
  warnings.push(...parsed.warnings)
}

const months = [...new Set([
  ...summaries.map(row => row.month),
  ...transactions.map(row => row.created_at.slice(0, 7))
].filter(Boolean))].sort()

const result = db.transaction(() => {
  for (const month of months) {
    const range = monthRange(month)
    db.prepare('DELETE FROM transactions WHERE created_at >= ? AND created_at < ?').run(range.start, range.next)
  }

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
  const updateAccount = db.prepare(`
    UPDATE accounts
    SET type = ?, current_balance = ?, updated_at = datetime('now', 'localtime')
    WHERE id = ?
  `)
  for (const row of summaries) {
    upsertSnapshot.run(
      row.account_id,
      row.month,
      row.opening_balance,
      row.income_total,
      row.expense_total,
      row.closing_balance,
      row.source_file_name,
      importedBy,
      row.updated_at,
      row.note
    )
  }

  const insertTransaction = db.prepare(`
    INSERT INTO transactions (account_id, type, amount, category, description, party, proxy, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const row of transactions) {
    insertTransaction.run(
      row.account_id,
      row.type,
      row.amount,
      row.category,
      row.description,
      row.party,
      row.proxy,
      row.status,
      row.created_at
    )
  }

  const latestSnapshots = db.prepare(`
    SELECT s.*
    FROM account_monthly_snapshots s
    JOIN (
      SELECT account_id, MAX(month) as month
      FROM account_monthly_snapshots
      GROUP BY account_id
    ) latest ON latest.account_id = s.account_id AND latest.month = s.month
  `).all()
  for (const snapshot of latestSnapshots) {
    const account = db.prepare('SELECT id, type FROM accounts WHERE id = ?').get(snapshot.account_id)
    if (account) updateAccount.run(account.type || 'personal', snapshot.closing_balance, account.id)
  }

  return {
    months,
    snapshots: summaries.length,
    transactions: transactions.length,
    warnings: warnings.slice(0, 60)
  }
})()

console.log(JSON.stringify(result, null, 2))
if (warnings.length) {
  console.log(`warnings_total=${warnings.length}`)
}

function parseWorkbook(file, db) {
  const workbook = XLSX.read(readFileSync(file), { type: 'buffer', cellDates: true, raw: false })
  const accounts = db.prepare('SELECT id, name FROM accounts ORDER BY id ASC').all()
  const summaries = parseSummarySheet(file, workbook, db, accounts)
  const transactions = parseTransactionSheet(file, workbook, accounts)
  return {
    summaries,
    transactions: transactions.rows,
    warnings: transactions.warnings
  }
}

function parseSummarySheet(file, workbook, db, accounts) {
  const sheetName = workbook.SheetNames.find(name => name.includes('资金总览')) || workbook.SheetNames[1]
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: false })
  const headerIndex = findHeaderRow(rows, ['账户', '期初余额', '当前余额'])
  if (headerIndex < 0) return []
  const headers = rows[headerIndex].map(normalizeHeader)
  const sourceFileName = file.split('/').pop()
  const output = []
  for (const cells of rows.slice(headerIndex + 1)) {
    const row = toRow(headers, cells)
    const name = cleanText(pick(row, ['账户', '账户名称']))
    if (!name) continue
    let account = resolveAccount(name, accounts).account
    if (!account) {
      const type = normalizeAccountType(pick(row, ['账户类型', '类型']))
      const created = db.prepare('INSERT INTO accounts (name, type, initial_balance, current_balance) VALUES (?, ?, 0, 0)').run(name, type)
      account = { id: created.lastInsertRowid, name }
      accounts.push(account)
    }
    const updatedAt = normalizeDateOnly(pick(row, ['最后更新时间', '更新时间']))
    const month = updatedAt.slice(0, 7)
    if (!month) continue
    output.push({
      account_id: account.id,
      month,
      opening_balance: parseMoney(pick(row, ['期初余额', '月初余额', '初始余额'])),
      income_total: parseMoney(pick(row, ['总收入', '收入', '本月收入'])),
      expense_total: parseMoney(pick(row, ['总支出', '支出', '本月支出'])),
      closing_balance: parseMoney(pick(row, ['当前余额', '月末余额', '期末余额'])),
      updated_at: updatedAt,
      note: cleanText(pick(row, ['备注'])),
      source_file_name: sourceFileName
    })
  }
  return output
}

function parseTransactionSheet(file, workbook, accounts) {
  const sheetName = workbook.SheetNames.find(name => name.includes('收支明细')) || workbook.SheetNames[0]
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: false })
  const headerIndex = findHeaderRow(rows, ['日期', '账户', '金额'])
  if (headerIndex < 0) return { rows: [], warnings: [`${file} 未识别到收支明细表`] }
  const headers = rows[headerIndex].map(normalizeHeader)
  const parsed = []
  const warnings = []
  for (const [rowOffset, cells] of rows.slice(headerIndex + 1).entries()) {
    const sourceRow = headerIndex + rowOffset + 2
    const row = toRow(headers, cells)
    const accountName = cleanText(pick(row, ['账户', '账户名称', '收支账户', '收付款账户']))
    const signedAmount = parseMoney(pick(row, ['金额', '发生金额', '收支金额']))
    const description = cleanText(pick(row, ['事由', '备注', '说明', '摘要', '用途']))
    if (!accountName && !signedAmount && !description) continue
    const statusText = cleanText(row[normalizeHeader('状态')])
    const status = normalizeStatus(statusText)
    if (status !== 'approved') {
      warnings.push(`${file} 第 ${sourceRow} 行状态为 ${statusText || status}，已跳过`)
      continue
    }
    const account = resolveAccount(accountName, accounts).account
    if (!account) {
      warnings.push(`${file} 第 ${sourceRow} 行账户未匹配：${accountName || '空'}`)
      continue
    }
    const typeText = cleanText(pick(row, ['收支类型', '类型', '交易类型']))
    const type = /收入|收款|入账|进账|income/i.test(typeText)
      ? 'income'
      : /支出|付款|出账|费用|expense/i.test(typeText)
        ? 'expense'
        : signedAmount < 0 ? 'expense' : 'income'
    const createdAt = normalizeDateTime(pick(row, ['日期', '交易日期', '发生日期', '时间', '创建时间']))
    if (!createdAt) {
      warnings.push(`${file} 第 ${sourceRow} 行日期为空或格式不对`)
      continue
    }
    const amount = type === 'income' ? signedAmount : -signedAmount
    if (!amount) {
      warnings.push(`${file} 第 ${sourceRow} 行金额为空或格式不对`)
      continue
    }
    parsed.push({
      account_id: account.id,
      type,
      amount,
      category: cleanText(pick(row, ['分类', '收支分类', '类目', '项目'])),
      description,
      party: cleanText(pick(row, ['对方', '交易对方', '客户', '供应商', '收付款方'])),
      proxy: cleanText(pick(row, ['经手人', '录入人', '操作人'])),
      status,
      created_at: createdAt
    })
  }
  return { rows: parsed, warnings }
}

function parseArgs(argv) {
  const out = { workbook: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--workbook') out.workbook.push(argv[++i])
    else if (arg === '--db') out.db = argv[++i]
    else if (arg === '--user-id') out.userId = argv[++i]
  }
  return out
}

function ensureTables(db) {
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

function findHeaderRow(rows, required) {
  return rows.findIndex(row => {
    const headers = row.map(normalizeHeader)
    return required.filter(item => headers.includes(normalizeHeader(item))).length >= Math.min(2, required.length)
  })
}

function toRow(headers, cells) {
  const row = {}
  headers.forEach((header, index) => {
    if (header) row[header] = cells[index]
  })
  return row
}

function pick(row, names) {
  for (const name of names) {
    const value = row[normalizeHeader(name)]
    if (cleanText(value)) return value
  }
  return ''
}

function normalizeHeader(value) {
  return cleanText(value).replace(/\s+/g, '').replace(/[：:]/g, '')
}

function cleanText(value) {
  return String(value ?? '').trim()
}

function normalizeAccountName(value) {
  return normalizeHeader(value).replace(/[·•.\-_/\\|｜()（）【】\[\]{}]/g, '')
}

function simplifyAccountName(value) {
  return normalizeAccountName(value).replace(/对公账户|银行账户|银行卡|公账|私账|账户|银行/g, '')
}

function sortedChars(value) {
  return [...simplifyAccountName(value)].sort().join('')
}

function resolveAccount(accountName, accounts) {
  const exactKey = normalizeAccountName(accountName)
  const simpleKey = simplifyAccountName(accountName)
  if (!exactKey) return { account: null }
  const exact = accounts.filter(account => normalizeAccountName(account.name) === exactKey)
  if (exact.length === 1) return { account: exact[0] }
  const simple = accounts.filter(account => simplifyAccountName(account.name) === simpleKey)
  if (simple.length === 1) return { account: simple[0] }
  const charKey = sortedChars(accountName)
  const charMatches = charKey.length >= 4 ? accounts.filter(account => sortedChars(account.name) === charKey) : []
  if (charMatches.length === 1) return { account: charMatches[0] }
  return { account: null }
}

function parseMoney(value) {
  const raw = cleanText(value)
  const negative = /^\s*[\(（]/.test(raw) || raw.includes('-')
  const text = raw.replace(/[,，￥¥\s()（）+-]/g, '')
  if (!text) return 0
  const n = Number(text)
  if (!Number.isFinite(n)) return 0
  return roundMoney(negative ? -n : n)
}

function normalizeAccountType(value) {
  return /公账|公司|企业|company/i.test(cleanText(value)) ? 'company' : 'personal'
}

function normalizeStatus(value) {
  const text = cleanText(value)
  if (/待确认|待支付|待收款|未确认|pending/i.test(text)) return 'pending'
  if (/作废|取消|cancel/i.test(text)) return 'cancelled'
  return 'approved'
}

function normalizeDateOnly(value) {
  const text = cleanText(value).replace(/[./年]/g, '-').replace(/[月]/g, '-').replace(/[日]/g, '')
  const match = text.match(/\d{4}-\d{1,2}-\d{1,2}/)
  if (!match) return ''
  const [year, month, day] = match[0].split('-')
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

function normalizeDateTime(value) {
  const date = normalizeDateOnly(value)
  return date ? `${date} 00:00:00` : ''
}

function monthRange(month) {
  const [year, value] = month.split('-').map(Number)
  const nextYear = value === 12 ? year + 1 : year
  const nextMonth = value === 12 ? 1 : value + 1
  return {
    start: `${year}-${String(value).padStart(2, '0')}-01 00:00:00`,
    next: `${nextYear}-${String(nextMonth).padStart(2, '0')}-01 00:00:00`
  }
}

function roundMoney(value) {
  const n = Number(value || 0)
  return Math.round(n * 100) / 100
}
