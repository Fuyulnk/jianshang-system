// 财务总览模块 — 照搬飞书资金总览表逻辑
import * as XLSX from 'xlsx'
import crypto from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, extname, join } from 'path'
import { fileURLToPath } from 'url'
import { authMiddleware } from '../middleware/auth.js'
import { patchXlsxCells } from '../utils/xlsxTemplateExport.js'
import { getActiveDocumentTemplate } from '../services/documentTemplateService.js'

const LARGE_LEDGER_BODY_LIMIT = 80 * 1024 * 1024
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const LEDGER_SOURCE_DIR = join(__dirname, '../../data/finance-ledgers')

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

  server.get('/api/finance/ledger/workbooks', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireFinanceAccess(request, reply)) return

    const rows = db.prepare(`
      SELECT w.*,
             COUNT(DISTINCT s.id) as sheet_count,
             COUNT(DISTINCT c.id) as cell_count,
             COUNT(DISTINCT cm.id) as comment_count
      FROM finance_ledger_workbooks w
      LEFT JOIN finance_ledger_sheets s ON s.workbook_id = w.id
      LEFT JOIN finance_ledger_cells c ON c.workbook_id = w.id
      LEFT JOIN finance_ledger_comments cm ON cm.workbook_id = w.id AND COALESCE(cm.comment_text, '') != ''
      GROUP BY w.id
      ORDER BY w.id DESC
      LIMIT 50
    `).all()
    return { success: true, data: rows }
  })

  server.get('/api/finance/ledger/workbooks/:id', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireFinanceAccess(request, reply)) return
    const workbookId = toInt(request.params.id)
    const workbook = db.prepare('SELECT * FROM finance_ledger_workbooks WHERE id = ?').get(workbookId)
    if (!workbook) return reply.code(404).send({ success: false, message: '入账登记表不存在' })
    const sheets = db.prepare('SELECT * FROM finance_ledger_sheets WHERE workbook_id = ? ORDER BY sheet_index ASC, id ASC').all(workbookId)
    const requestedSheetId = toInt(request.query?.sheet_id)
    const activeSheet = sheets.find(sheet => Number(sheet.id) === requestedSheetId) || sheets[0]
    const cells = activeSheet
      ? db.prepare('SELECT * FROM finance_ledger_cells WHERE sheet_id = ? ORDER BY row_index ASC, col_index ASC').all(activeSheet.id)
      : []
    const comments = activeSheet
      ? db.prepare("SELECT * FROM finance_ledger_comments WHERE sheet_id = ? AND COALESCE(comment_text, '') != '' ORDER BY row_index ASC, col_index ASC").all(activeSheet.id)
      : []
    return {
      success: true,
      data: {
        workbook,
        sheets,
        active_sheet_id: activeSheet?.id || 0,
        cells,
        comments
      }
    }
  })

  server.post('/api/finance/ledger/workbooks/import', { bodyLimit: LARGE_LEDGER_BODY_LIMIT }, async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireFinanceAccess(request, reply)) return
    const { file_name = '', file_data = '' } = request.body || {}
    if (!file_name || !file_data) return { success: false, message: '请选择入账登记表 Excel 文件' }
    try {
      const buffer = decodeData(file_data)
      if (!buffer.length) return { success: false, message: '文件内容为空' }
      const workbook = XLSX.read(buffer, {
        type: 'buffer',
        cellDates: false,
        cellFormula: true,
        cellNF: true,
        cellText: true,
        cellStyles: true
      })
      if (!workbook.SheetNames.length) return { success: false, message: 'Excel 内没有可读取的工作表' }

      let workbookId = 0
      let storedPath = ''
      const tx = db.transaction(() => {
        const created = db.prepare(`
          INSERT INTO finance_ledger_workbooks (title, source_file_name, source_file_path, imported_by)
          VALUES (?, ?, '', ?)
        `).run(fileNameWithoutExt(file_name), safeText(file_name, 240), request.user.userId)
        workbookId = created.lastInsertRowid
        storedPath = saveLedgerSourceWorkbook(workbookId, file_name, buffer)
        db.prepare('UPDATE finance_ledger_workbooks SET source_file_path = ? WHERE id = ?').run(storedPath, workbookId)
        const insertSheet = db.prepare(`
          INSERT INTO finance_ledger_sheets (workbook_id, sheet_index, name, row_count, col_count)
          VALUES (?, ?, ?, ?, ?)
        `)
        const insertCell = db.prepare(`
          INSERT INTO finance_ledger_cells (
            workbook_id, sheet_id, row_index, col_index, address, value, raw_value, formula, number_format, updated_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        const insertComment = db.prepare(`
          INSERT INTO finance_ledger_comments (
            workbook_id, sheet_id, row_index, col_index, address, comment_text, created_by, updated_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)

        workbook.SheetNames.forEach((sheetName, sheetIndex) => {
          const sheet = workbook.Sheets[sheetName]
          const range = safeDecodeRange(sheet?.['!ref'])
          const sheetCreated = insertSheet.run(
            workbookId,
            sheetIndex,
            safeText(sheetName, 120),
            range.row_count,
            range.col_count
          )
          const sheetId = sheetCreated.lastInsertRowid
          for (const address of Object.keys(sheet || {})) {
            if (address.startsWith('!')) continue
            const cell = sheet[address] || {}
            const pos = XLSX.utils.decode_cell(address)
            const value = cell.w !== undefined ? String(cell.w) : cell.v !== undefined ? String(cell.v) : ''
            const rawValue = cell.v === undefined ? '' : String(cell.v)
            const comments = Array.isArray(cell.c) ? cell.c.map(item => fixMojibakeText(item.t || '')).filter(Boolean).join('\n') : ''
            if (value !== '' || rawValue !== '' || cell.f || comments) {
              insertCell.run(workbookId, sheetId, pos.r + 1, pos.c + 1, address, value, rawValue, cell.f || '', cell.z || '', request.user.userId)
            }
            if (comments) {
              insertComment.run(workbookId, sheetId, pos.r + 1, pos.c + 1, address, safeText(comments, 2000), request.user.userId, request.user.userId)
            }
          }
        })
        db.prepare(`
          INSERT INTO finance_ledger_logs (workbook_id, action, new_value, created_by)
          VALUES (?, 'import_workbook', ?, ?)
        `).run(workbookId, safeText(file_name, 240), request.user.userId)
      })
      tx()
      const detail = buildLedgerWorkbookDetail(db, workbookId)
      return { success: true, data: detail }
    } catch (err) {
      reply.code(400).send({ success: false, message: err.message || '入账登记表导入失败' })
    }
  })

  server.get('/api/finance/ledger/workbooks/:id/export', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireFinanceAccess(request, reply)) return
    const workbookId = toInt(request.params.id)
    const workbook = db.prepare('SELECT * FROM finance_ledger_workbooks WHERE id = ?').get(workbookId)
    if (!workbook) return reply.code(404).send({ success: false, message: '入账登记表不存在' })
    const template = workbook.source_file_path ? null : getActiveDocumentTemplate(db, 'finance_ledger')
    const sourcePath = workbook.source_file_path
      ? join(LEDGER_SOURCE_DIR, workbook.source_file_path)
      : template?.source_file_path || ''
    const sourceName = workbook.source_file_path
      ? (workbook.source_file_name || workbook.source_file_path)
      : (template?.source_file_name || template?.title || '入账登记表模板')
    if (!sourcePath) return reply.code(400).send({ success: false, message: '这份入账登记表没有保存原始 Excel，也没有可用的系统固定模板。' })
    if (!/\.xlsx$/i.test(sourceName || sourcePath || '')) {
      return reply.code(400).send({ success: false, message: '原格式导出第一阶段只支持 .xlsx，旧版 .xls 请先另存为 .xlsx 后重新导入。' })
    }
    if (!existsSync(sourcePath)) return reply.code(404).send({ success: false, message: '原始 Excel 或系统固定模板文件已丢失。' })
    try {
      const sheets = db.prepare('SELECT * FROM finance_ledger_sheets WHERE workbook_id = ? ORDER BY sheet_index ASC').all(workbookId)
      const sheetMap = new Map(sheets.map(sheet => [sheet.id, sheet]))
      const cells = db.prepare('SELECT * FROM finance_ledger_cells WHERE workbook_id = ? ORDER BY sheet_id, row_index, col_index').all(workbookId)
      const updates = cells.map(cell => {
        const sheet = sheetMap.get(cell.sheet_id)
        return {
          sheetName: sheet?.name || '',
          sheetIndex: Number(sheet?.sheet_index || 0),
          address: cell.address,
          value: cell.value
        }
      })
      const output = patchXlsxCells(readFileSync(sourcePath), updates)
      const fileName = `${fileNameWithoutExt(workbook.source_file_name || workbook.title || sourceName || '入账登记表')}-原格式导出.xlsx`
      db.prepare(`
        INSERT INTO finance_ledger_logs (workbook_id, action, new_value, created_by)
        VALUES (?, 'export_workbook', ?, ?)
      `).run(workbookId, safeText(fileName, 240), request.user.userId)
      reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`)
        .header('Content-Length', output.length)
        .send(output)
    } catch (err) {
      reply.code(500).send({ success: false, message: err.message || '入账登记表原格式导出失败' })
    }
  })

  server.put('/api/finance/ledger/cells/:id', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireFinanceAccess(request, reply)) return
    const cellId = toInt(request.params.id)
    let cell = cellId ? db.prepare('SELECT * FROM finance_ledger_cells WHERE id = ?').get(cellId) : null
    if (!cell && cellId) return reply.code(404).send({ success: false, message: '单元格不存在' })
    if (!cell) {
      const sheetId = toInt(request.body?.sheet_id)
      const sheet = db.prepare('SELECT * FROM finance_ledger_sheets WHERE id = ?').get(sheetId)
      if (!sheet) return reply.code(404).send({ success: false, message: '工作表不存在' })
      const rowIndex = Math.max(1, toInt(request.body?.row_index))
      const colIndex = Math.max(1, toInt(request.body?.col_index))
      const address = XLSX.utils.encode_cell({ r: rowIndex - 1, c: colIndex - 1 })
      const created = db.prepare(`
        INSERT INTO finance_ledger_cells (
          workbook_id, sheet_id, row_index, col_index, address, value, raw_value, formula, number_format, updated_by
        ) VALUES (?, ?, ?, ?, ?, '', '', '', '', ?)
      `).run(sheet.workbook_id, sheet.id, rowIndex, colIndex, address, request.user.userId)
      cell = db.prepare('SELECT * FROM finance_ledger_cells WHERE id = ?').get(created.lastInsertRowid)
    }
    const nextValue = safeText(request.body?.value ?? '', 5000)
    db.prepare(`
      UPDATE finance_ledger_cells
      SET value = ?, raw_value = ?, formula = '', updated_by = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(nextValue, nextValue, request.user.userId, cell.id)
    db.prepare(`
      INSERT INTO finance_ledger_logs (workbook_id, sheet_id, address, action, old_value, new_value, created_by)
      VALUES (?, ?, ?, 'update_cell', ?, ?, ?)
    `).run(cell.workbook_id, cell.sheet_id, cell.address, cell.value || '', nextValue, request.user.userId)
    return { success: true, data: db.prepare('SELECT * FROM finance_ledger_cells WHERE id = ?').get(cell.id) }
  })

  server.put('/api/finance/ledger/comments', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireFinanceAccess(request, reply)) return
    const sheetId = toInt(request.body?.sheet_id)
    const sheet = db.prepare('SELECT * FROM finance_ledger_sheets WHERE id = ?').get(sheetId)
    if (!sheet) return reply.code(404).send({ success: false, message: '工作表不存在' })
    const address = safeText(request.body?.address || '', 20).toUpperCase()
    const pos = address ? XLSX.utils.decode_cell(address) : {
      r: Math.max(0, toInt(request.body?.row_index) - 1),
      c: Math.max(0, toInt(request.body?.col_index) - 1)
    }
    const normalizedAddress = address || XLSX.utils.encode_cell(pos)
    const rowIndex = pos.r + 1
    const colIndex = pos.c + 1
    const text = safeText(request.body?.comment_text || '', 2000)
    const existing = db.prepare('SELECT * FROM finance_ledger_comments WHERE sheet_id = ? AND row_index = ? AND col_index = ?')
      .get(sheet.id, rowIndex, colIndex)
    if (existing) {
      db.prepare(`
        UPDATE finance_ledger_comments
        SET comment_text = ?, updated_by = ?, updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `).run(text, request.user.userId, existing.id)
      db.prepare(`
        INSERT INTO finance_ledger_logs (workbook_id, sheet_id, address, action, old_value, new_value, created_by)
        VALUES (?, ?, ?, 'update_comment', ?, ?, ?)
      `).run(sheet.workbook_id, sheet.id, normalizedAddress, existing.comment_text || '', text, request.user.userId)
      return { success: true, data: db.prepare('SELECT * FROM finance_ledger_comments WHERE id = ?').get(existing.id) }
    }
    const created = db.prepare(`
      INSERT INTO finance_ledger_comments (
        workbook_id, sheet_id, row_index, col_index, address, comment_text, created_by, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(sheet.workbook_id, sheet.id, rowIndex, colIndex, normalizedAddress, text, request.user.userId, request.user.userId)
    db.prepare(`
      INSERT INTO finance_ledger_logs (workbook_id, sheet_id, address, action, new_value, created_by)
      VALUES (?, ?, ?, 'create_comment', ?, ?)
    `).run(sheet.workbook_id, sheet.id, normalizedAddress, text, request.user.userId)
    return { success: true, data: db.prepare('SELECT * FROM finance_ledger_comments WHERE id = ?').get(created.lastInsertRowid) }
  })
}

function buildLedgerWorkbookDetail(db, workbookId) {
  const workbook = db.prepare('SELECT * FROM finance_ledger_workbooks WHERE id = ?').get(workbookId)
  const sheets = db.prepare('SELECT * FROM finance_ledger_sheets WHERE workbook_id = ? ORDER BY sheet_index ASC, id ASC').all(workbookId)
  const activeSheet = sheets[0]
  const cells = activeSheet ? db.prepare('SELECT * FROM finance_ledger_cells WHERE sheet_id = ? ORDER BY row_index ASC, col_index ASC').all(activeSheet.id) : []
  const comments = activeSheet ? db.prepare("SELECT * FROM finance_ledger_comments WHERE sheet_id = ? AND COALESCE(comment_text, '') != '' ORDER BY row_index ASC, col_index ASC").all(activeSheet.id) : []
  return {
    workbook,
    sheets,
    active_sheet_id: activeSheet?.id || 0,
    cells,
    comments
  }
}

function saveLedgerSourceWorkbook(workbookId, fileName, buffer) {
  const originalName = safeFileName(fileName || 'ledger.xlsx')
  const ext = extname(originalName).toLowerCase() || '.xlsx'
  mkdirSync(LEDGER_SOURCE_DIR, { recursive: true })
  const storedName = `${workbookId}_${Date.now()}_${crypto.randomBytes(5).toString('hex')}${ext}`
  writeFileSync(join(LEDGER_SOURCE_DIR, storedName), buffer)
  return storedName
}

function getLatestFinanceDocs(db, projectIds) {
  if (!projectIds.length) return {}
  const placeholders = projectIds.map(() => '?').join(',')
  const rows = db.prepare(`
    SELECT *
    FROM project_documents
    WHERE project_id IN (${placeholders})
      AND document_type IN ('project_payment_request', 'material_io', 'labor_settlement', 'cost_check', 'finance_settlement')
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
  const payment = docs.project_payment_request?.confirmed_data?.summary || {}
  const labor = docs.labor_settlement?.confirmed_data?.summary || {}
  const cost = docs.cost_check?.confirmed_data?.summary || {}
  const finance = docs.finance_settlement?.confirmed_data?.summary || {}

  const revenueAmount = firstMoney(
    finance.delivery_revenue,
    cost.revenue_amount,
    project.settlement_amount,
    finance.contract_amount,
    payment.contract_amount,
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
  const receivedAmount = firstMoney(finance.received_amount, payment.received_amount, project.deposit_amount)
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

function decodeData(value = '') {
  const text = String(value || '')
  const base64 = text.includes(',') ? text.split(',').pop() : text
  return Buffer.from(base64, 'base64')
}

function safeDecodeRange(ref) {
  if (!ref) return { row_count: 1, col_count: 1 }
  try {
    const range = XLSX.utils.decode_range(ref)
    return {
      row_count: Math.max(1, range.e.r + 1),
      col_count: Math.max(1, range.e.c + 1)
    }
  } catch {
    return { row_count: 1, col_count: 1 }
  }
}

function fileNameWithoutExt(value = '') {
  const name = safeText(value, 240) || '入账登记表'
  return name.replace(/\.[^.]+$/, '') || '入账登记表'
}

function toInt(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0
}

function safeText(value, max = 500) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function safeFileName(name = '') {
  return String(name || 'file')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180) || 'file'
}

function fixMojibakeText(value) {
  const text = String(value || '')
  if (!/[ÃÂäåæèé]/.test(text)) return text
  try {
    const fixed = Buffer.from(text, 'latin1').toString('utf8')
    return /[\u4e00-\u9fa5]/.test(fixed) ? fixed : text
  } catch {
    return text
  }
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback
  } catch {
    return fallback
  }
}
