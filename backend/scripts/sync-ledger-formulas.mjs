import Database from 'better-sqlite3'
import * as XLSX from 'xlsx'
import { existsSync, readFileSync } from 'fs'
import { basename, dirname, extname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const positional = process.argv.slice(2).filter(arg => !arg.startsWith('--'))
const xlsxPath = positional[0] || ''
const selector = positional[1] || ''
const dbArg = process.argv.find(arg => arg.startsWith('--db='))
const dryRun = process.argv.includes('--dry-run')
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const defaultDbPath = join(__dirname, '../data/jianshang.db')
const dbPath = resolve(dbArg ? dbArg.slice(5) : (process.env.DB_PATH || defaultDbPath))

if (!xlsxPath || !existsSync(xlsxPath)) {
  console.error('请传入存在的入账登记表 xlsx 文件路径，例如：node backend/scripts/sync-ledger-formulas.mjs 入账登记表.xlsx --db=backend/data/jianshang.db --dry-run')
  process.exit(1)
}

if (!existsSync(dbPath)) {
  console.error(`数据库不存在：${dbPath}`)
  process.exit(1)
}

const db = new Database(dbPath, { readonly: dryRun })
for (const table of ['finance_ledger_workbooks', 'finance_ledger_sheets', 'finance_ledger_cells']) {
  if (!tableExists(table)) {
    console.error(`数据库缺少 ${table} 表，请先启动一次新版后端完成迁移，再同步公式。`)
    db.close()
    process.exit(1)
  }
}
const sourceName = basename(xlsxPath)
const title = sourceName.slice(0, sourceName.length - extname(sourceName).length)
const workbook = findWorkbook(selector || sourceName, title)

if (!workbook) {
  console.log(`没有找到匹配的系统入账登记表：${sourceName}`)
  console.log('可在第二个参数传 workbook id 或标题关键字后重试。')
  process.exit(0)
}

const excel = XLSX.read(readFileSync(xlsxPath), {
  type: 'buffer',
  cellDates: false,
  cellFormula: true,
  cellNF: true,
  cellText: true,
  cellStyles: true
})
const sheetRows = db.prepare('SELECT * FROM finance_ledger_sheets WHERE workbook_id = ? ORDER BY sheet_index ASC, id ASC').all(workbook.id)
const sheetsByName = new Map(sheetRows.map(sheet => [sheet.name, sheet]))
const sheetsByIndex = new Map(sheetRows.map(sheet => [Number(sheet.sheet_index), sheet]))

const getCell = db.prepare('SELECT * FROM finance_ledger_cells WHERE sheet_id = ? AND row_index = ? AND col_index = ?')
const updateCell = db.prepare(`
  UPDATE finance_ledger_cells
  SET formula = ?, number_format = ?, raw_value = CASE WHEN COALESCE(raw_value, '') = '' THEN ? ELSE raw_value END,
      value = CASE WHEN COALESCE(value, '') = '' THEN ? ELSE value END,
      style_json = CASE WHEN COALESCE(style_json, '') IN ('', '{}') THEN ? ELSE style_json END,
      updated_at = datetime('now', 'localtime')
  WHERE id = ?
`)
const insertCell = db.prepare(`
  INSERT INTO finance_ledger_cells (
    workbook_id, sheet_id, row_index, col_index, address, value, raw_value, formula, number_format, style_json, updated_by
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
`)
const insertLog = db.prepare(`
  INSERT INTO finance_ledger_logs (workbook_id, action, new_value, created_by)
  VALUES (?, 'sync_ledger_formulas', ?, 0)
`)

let formulaCount = 0
let styleCount = 0
let updated = 0
let inserted = 0
let stylePatched = 0

const tx = db.transaction(() => {
  excel.SheetNames.forEach((sheetName, sheetIndex) => {
    const targetSheet = sheetsByName.get(sheetName) || sheetsByIndex.get(sheetIndex)
    if (!targetSheet) return
    const sheet = excel.Sheets[sheetName]
    for (const address of Object.keys(sheet || {})) {
      if (address.startsWith('!')) continue
      const cell = sheet[address] || {}
      if (!cell.f) continue
      formulaCount += 1
      const pos = XLSX.utils.decode_cell(address)
      const value = cell.w !== undefined ? String(cell.w) : cell.v !== undefined ? String(cell.v) : ''
      const rawValue = cell.v === undefined ? '' : String(cell.v)
      const styleJson = JSON.stringify(extractLedgerCellStyle(cell.s))
      if (styleJson !== '{}') styleCount += 1
      const existing = getCell.get(targetSheet.id, pos.r + 1, pos.c + 1)
      if (existing) {
        updateCell.run(String(cell.f || ''), String(cell.z || ''), rawValue, value, styleJson, existing.id)
        if (styleJson !== '{}' && ['', '{}'].includes(String(existing.style_json || ''))) stylePatched += 1
        updated += 1
      } else {
        insertCell.run(workbook.id, targetSheet.id, pos.r + 1, pos.c + 1, address, value, rawValue, String(cell.f || ''), String(cell.z || ''), styleJson)
        if (styleJson !== '{}') stylePatched += 1
        inserted += 1
      }
    }
  })
  insertLog.run(workbook.id, JSON.stringify({ source_file_name: sourceName, formula_count: formulaCount, style_count: styleCount, updated, inserted, style_patched: stylePatched }))
})

if (dryRun) {
  collectSyncStats()
  console.log(`DRY-RUN：将同步 workbook #${workbook.id} ${workbook.title}`)
} else {
  tx()
  console.log(`已同步公式：workbook #${workbook.id} ${workbook.title}`)
}
console.log(`数据库：${dbPath}`)
console.log(`Excel 公式 ${formulaCount} 个，更新 ${updated} 个，新增 ${inserted} 个，原表可同步底色 ${styleCount} 个，实际补样式 ${stylePatched} 个。`)

function findWorkbook(value, fallbackTitle) {
  if (/^\d+$/.test(String(value))) {
    const byId = db.prepare('SELECT * FROM finance_ledger_workbooks WHERE id = ?').get(Number(value))
    if (byId) return byId
  }
  const keyword = `%${String(value || fallbackTitle || '').replace(/\.(xlsx|xls)$/i, '')}%`
  return db.prepare(`
    SELECT * FROM finance_ledger_workbooks
    WHERE source_file_name = ?
       OR title LIKE ?
       OR source_file_name LIKE ?
    ORDER BY id DESC
    LIMIT 1
  `).get(sourceName, keyword, keyword)
}

function tableExists(table) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(table))
}

function collectSyncStats() {
  excel.SheetNames.forEach((sheetName, sheetIndex) => {
    const targetSheet = sheetsByName.get(sheetName) || sheetsByIndex.get(sheetIndex)
    if (!targetSheet) return
    const sheet = excel.Sheets[sheetName]
    for (const address of Object.keys(sheet || {})) {
      if (address.startsWith('!')) continue
      const cell = sheet[address] || {}
      if (!cell.f) continue
      formulaCount += 1
      const pos = XLSX.utils.decode_cell(address)
      const styleJson = JSON.stringify(extractLedgerCellStyle(cell.s))
      if (styleJson !== '{}') styleCount += 1
      const existing = getCell.get(targetSheet.id, pos.r + 1, pos.c + 1)
      if (existing) {
        updated += 1
        if (styleJson !== '{}' && ['', '{}'].includes(String(existing.style_json || ''))) stylePatched += 1
      } else {
        inserted += 1
        if (styleJson !== '{}') stylePatched += 1
      }
    }
  })
}

function extractLedgerCellStyle(style = {}) {
  const alignment = style?.alignment || {}
  const verticalMap = { center: 'middle', top: 'top', bottom: 'bottom' }
  const horizontal = ['left', 'center', 'right'].includes(alignment.horizontal) ? alignment.horizontal : ''
  const vertical = verticalMap[alignment.vertical] || ''
  const fillRgb = style?.patternType && style.patternType !== 'none'
    ? normalizeStyleColor(style?.fgColor?.rgb || style?.bgColor?.rgb || '')
    : ''
  const next = {}
  if (horizontal) next.horizontal = horizontal
  if (vertical) next.vertical = vertical
  if (fillRgb) next.backgroundColor = fillRgb
  return next
}

function normalizeStyleColor(value = '') {
  const text = String(value || '').replace(/^#/, '').trim()
  if (/^[0-9a-fA-F]{8}$/.test(text)) return `#${text.slice(2)}`
  if (/^[0-9a-fA-F]{6}$/.test(text)) return `#${text}`
  if (/^[0-9a-fA-F]{3}$/.test(text)) return `#${text}`
  return ''
}
