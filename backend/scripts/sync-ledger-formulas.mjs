import Database from 'better-sqlite3'
import * as XLSX from 'xlsx'
import { existsSync, readFileSync } from 'fs'
import { basename, extname, join } from 'path'
import { homedir } from 'os'

const xlsxPath = process.argv[2] || ''
const selector = process.argv[3] || ''
const dbPath = process.env.DB_PATH || join(homedir(), 'fuyulnk', 'jianshang.db')

if (!xlsxPath || !existsSync(xlsxPath)) {
  console.error('请传入存在的入账登记表 xlsx 文件路径')
  process.exit(1)
}

const db = new Database(dbPath)
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
  cellText: true
})
const sheetRows = db.prepare('SELECT * FROM finance_ledger_sheets WHERE workbook_id = ? ORDER BY sheet_index ASC, id ASC').all(workbook.id)
const sheetsByName = new Map(sheetRows.map(sheet => [sheet.name, sheet]))
const sheetsByIndex = new Map(sheetRows.map(sheet => [Number(sheet.sheet_index), sheet]))

const getCell = db.prepare('SELECT * FROM finance_ledger_cells WHERE sheet_id = ? AND row_index = ? AND col_index = ?')
const updateCell = db.prepare(`
  UPDATE finance_ledger_cells
  SET formula = ?, number_format = ?, raw_value = CASE WHEN COALESCE(raw_value, '') = '' THEN ? ELSE raw_value END,
      value = CASE WHEN COALESCE(value, '') = '' THEN ? ELSE value END,
      updated_at = datetime('now', 'localtime')
  WHERE id = ?
`)
const insertCell = db.prepare(`
  INSERT INTO finance_ledger_cells (
    workbook_id, sheet_id, row_index, col_index, address, value, raw_value, formula, number_format, updated_by
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
`)
const insertLog = db.prepare(`
  INSERT INTO finance_ledger_logs (workbook_id, action, new_value, created_by)
  VALUES (?, 'sync_ledger_formulas', ?, 0)
`)

let formulaCount = 0
let updated = 0
let inserted = 0

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
      const existing = getCell.get(targetSheet.id, pos.r + 1, pos.c + 1)
      if (existing) {
        updateCell.run(String(cell.f || ''), String(cell.z || ''), rawValue, value, existing.id)
        updated += 1
      } else {
        insertCell.run(workbook.id, targetSheet.id, pos.r + 1, pos.c + 1, address, value, rawValue, String(cell.f || ''), String(cell.z || ''))
        inserted += 1
      }
    }
  })
  insertLog.run(workbook.id, JSON.stringify({ source_file_name: sourceName, formula_count: formulaCount, updated, inserted }))
})

tx()
console.log(`已同步公式：workbook #${workbook.id} ${workbook.title}`)
console.log(`Excel 公式 ${formulaCount} 个，更新 ${updated} 个，新增 ${inserted} 个。`)

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
