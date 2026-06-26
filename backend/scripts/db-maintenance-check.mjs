import Database from 'better-sqlite3'
import { existsSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const args = new Set(process.argv.slice(2))
const dbPathArg = process.argv.find(arg => arg.startsWith('--db='))
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const defaultDbPath = join(__dirname, '../data/jianshang.db')
const dbPath = resolve(dbPathArg ? dbPathArg.slice(5) : (process.env.DB_PATH || defaultDbPath))
const shouldCheckpoint = args.has('--checkpoint')
const shouldVacuum = args.has('--vacuum')
const readonly = !shouldCheckpoint && !shouldVacuum

if (!existsSync(dbPath)) {
  console.error(`数据库不存在：${dbPath}`)
  process.exit(1)
}

const db = new Database(dbPath, { readonly })
const report = {
  db_path: dbPath,
  mode: readonly ? 'readonly' : 'maintenance',
  integrity_check: runValue("PRAGMA integrity_check"),
  foreign_key_check: safeAll("PRAGMA foreign_key_check"),
  tables: {},
  warnings: []
}

for (const table of [
  'users',
  'employees',
  'projects',
  'transactions',
  'accounts',
  'products',
  'attachments',
  'finance_ledger_workbooks',
  'finance_ledger_cells',
  'messages',
  'conversations'
]) {
  if (tableExists(table)) report.tables[table] = countRows(table)
}

if (tableExists('attachments')) {
  report.orphan_attachments = orphanAttachmentCounts()
  report.missing_upload_files = countMissingUploads()
  report.soft_deleted_attachments = scalar("SELECT COUNT(*) FROM attachments WHERE COALESCE(deleted_at, '') != ''")
}

if (tableExists('finance_ledger_cells')) {
  report.ledger_formula_cells = scalar("SELECT COUNT(*) FROM finance_ledger_cells WHERE COALESCE(formula, '') != ''")
  report.ledger_styled_cells = scalar("SELECT COUNT(*) FROM finance_ledger_cells WHERE COALESCE(style_json, '{}') NOT IN ('', '{}')")
  report.ledger_empty_cells = scalar(`
    SELECT COUNT(*) FROM finance_ledger_cells
    WHERE COALESCE(value, '') = ''
      AND COALESCE(raw_value, '') = ''
      AND COALESCE(formula, '') = ''
      AND COALESCE(style_json, '{}') IN ('', '{}')
  `)
}
if (tableExists('finance_ledger_workbooks')) {
  report.missing_ledger_source_files = countMissingLedgerSources()
}

if (shouldCheckpoint) {
  report.wal_checkpoint_truncate = safeAll('PRAGMA wal_checkpoint(TRUNCATE)')
}
if (shouldVacuum) {
  db.exec('VACUUM')
  report.vacuum = 'done'
}

if (report.integrity_check !== 'ok') report.warnings.push('integrity_check 不是 ok，需要先备份再排查。')
if (report.foreign_key_check.length) report.warnings.push('存在外键检查异常。')
if (report.orphan_attachments?.total) report.warnings.push('存在孤儿附件记录，先人工确认归属再清理。')
if (report.missing_upload_files) report.warnings.push('存在数据库有记录但本地上传文件缺失的附件。')
if (report.missing_ledger_source_files) report.warnings.push('存在入账登记表记录找不到原始 Excel，原格式导出会失败。')

console.log(JSON.stringify(report, null, 2))
db.close()

function tableExists(table) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(table))
}

function countRows(table) {
  return scalar(`SELECT COUNT(*) FROM ${table}`)
}

function scalar(sql) {
  const row = db.prepare(sql).get()
  return Number(Object.values(row || {})[0] || 0)
}

function runValue(sql) {
  const row = db.prepare(sql).get()
  return String(Object.values(row || {})[0] || '')
}

function safeAll(sql) {
  try {
    return db.prepare(sql).all()
  } catch {
    return []
  }
}

function orphanAttachmentCounts() {
  const counts = {
    project: tableExists('projects')
      ? scalar("SELECT COUNT(*) FROM attachments a LEFT JOIN projects p ON a.entity_type = 'project' AND a.entity_id = p.id WHERE a.entity_type = 'project' AND p.id IS NULL")
      : 0,
    transaction: tableExists('transactions')
      ? scalar("SELECT COUNT(*) FROM attachments a LEFT JOIN transactions t ON a.entity_type = 'transaction' AND a.entity_id = t.id WHERE a.entity_type = 'transaction' AND t.id IS NULL")
      : 0,
    product: tableExists('products')
      ? scalar("SELECT COUNT(*) FROM attachments a LEFT JOIN products p ON a.entity_type = 'product' AND a.entity_id = p.id WHERE a.entity_type = 'product' AND p.id IS NULL")
      : 0,
    private_workspace: tableExists('private_workspaces')
      ? scalar("SELECT COUNT(*) FROM attachments a LEFT JOIN private_workspaces w ON a.entity_type = 'private_workspace' AND a.entity_id = w.id WHERE a.entity_type = 'private_workspace' AND w.id IS NULL")
      : 0
  }
  return { ...counts, total: counts.project + counts.transaction + counts.product + counts.private_workspace }
}

function countMissingUploads() {
  const rows = db.prepare("SELECT stored_name FROM attachments WHERE COALESCE(deleted_at, '') = ''").all()
  const uploadDir = resolve(dbPath, '..', 'uploads')
  return rows.filter(row => !existsSync(join(uploadDir, row.stored_name || ''))).length
}

function countMissingLedgerSources() {
  const rows = db.prepare("SELECT source_file_path FROM finance_ledger_workbooks WHERE COALESCE(source_file_path, '') != ''").all()
  const ledgerDir = resolve(dbPath, '..', 'finance-ledgers')
  return rows.filter(row => !existsSync(join(ledgerDir, row.source_file_path || ''))).length
}
