import { authMiddleware } from '../middleware/auth.js'
import { requireModuleAccess } from '../utils/permissions.js'
import { parseFinanceTransactionDraft } from '../utils/financeParser.js'
import { confirmTransaction, createTransaction, deleteTransaction } from '../services/financeCommands.js'
import * as XLSX from 'xlsx'

const LARGE_IMPORT_BODY_LIMIT = 25 * 1024 * 1024

function buildTransactionFilter(query = {}) {
  const { account_id, account_type, type, category, start_date, end_date, status } = query
  const keyword = String(query.query || query.keyword || '').trim()
  const conditions = []
  const params = []

  if (account_id) {
    conditions.push('t.account_id = ?')
    params.push(account_id)
  }
  if (account_type === 'company' || account_type === 'personal') {
    conditions.push('a.type = ?')
    params.push(account_type)
  }
  if (type === 'income' || type === 'expense') {
    conditions.push('t.type = ?')
    params.push(type)
  }
  if (['pending', 'approved', 'cancelled'].includes(status)) {
    conditions.push("COALESCE(t.status, 'approved') = ?")
    params.push(status)
  }
  if (category) {
    conditions.push('t.category = ?')
    params.push(category)
  }
  if (keyword) {
    conditions.push('(t.category LIKE ? OR t.description LIKE ? OR t.party LIKE ? OR t.proxy LIKE ? OR a.name LIKE ?)')
    const like = `%${keyword}%`
    params.push(like, like, like, like, like)
  }
  if (start_date) {
    conditions.push('t.created_at >= ?')
    params.push(start_date)
  }
  if (end_date) {
    conditions.push('t.created_at <= ?')
    params.push(end_date + ' 23:59:59')
  }

  return {
    where: conditions.length ? 'WHERE ' + conditions.join(' AND ') : '',
    params
  }
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value)
  return `"${text.replaceAll('"', '""')}"`
}

function htmlCell(value) {
  const text = value === null || value === undefined ? '' : String(value)
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

function getFilterLabels(query = {}) {
  const labels = []
  if (query.type === 'income') labels.push('类型：收入')
  if (query.type === 'expense') labels.push('类型：支出')
  if (query.account_type === 'company') labels.push('账户类型：公账')
  if (query.account_type === 'personal') labels.push('账户类型：私账')
  if (query.category) labels.push(`分类：${query.category}`)
  if (query.start_date || query.end_date) {
    labels.push(`日期：${query.start_date || '不限'} 至 ${query.end_date || '不限'}`)
  }
  return labels.length ? labels.join('；') : '全部流水'
}

function statusLabel(status) {
  if (status === 'approved') return '已确认'
  if (status === 'cancelled') return '已作废'
  if (status === 'pending') return '待确认'
  return status || '已确认'
}

function decodeData(value = '') {
  const text = String(value || '')
  const base64 = text.includes(',') ? text.split(',').pop() : text
  return Buffer.from(base64, 'base64')
}

function normalizeHeader(value) {
  return String(value ?? '').trim().replace(/\s+/g, '').replace(/[：:]/g, '')
}

function normalizeAccountName(value) {
  return normalizeHeader(value).replace(/[·•.\-_/\\|｜()（）【】\[\]{}]/g, '')
}

function simplifyAccountName(value) {
  return normalizeAccountName(value)
    .replace(/对公账户|银行账户|银行卡|公账|私账|账户|银行/g, '')
}

function sortedChars(value) {
  return [...simplifyAccountName(value)].sort().join('')
}

function uniqueById(accounts = []) {
  return [...new Map(accounts.filter(Boolean).map(account => [Number(account.id), account])).values()]
}

function resolveImportAccount(accountName, accounts) {
  const exactKey = normalizeAccountName(accountName)
  const simpleKey = simplifyAccountName(accountName)
  if (!exactKey) return { account: null, ambiguous: [] }

  const exactMatches = accounts.filter(account => normalizeAccountName(account.name) === exactKey)
  if (exactMatches.length === 1) return { account: exactMatches[0], ambiguous: [] }

  const simpleMatches = accounts.filter(account => simplifyAccountName(account.name) === simpleKey)
  if (simpleMatches.length === 1) return { account: simpleMatches[0], ambiguous: [] }

  const charKey = sortedChars(accountName)
  const charMatches = charKey.length >= 4
    ? accounts.filter(account => sortedChars(account.name) === charKey)
    : []
  const charUnique = uniqueById(charMatches)
  if (charUnique.length === 1) return { account: charUnique[0], ambiguous: [] }

  const containsMatches = simpleKey.length >= 3
    ? accounts.filter(account => {
        const accountKey = simplifyAccountName(account.name)
        if (accountKey.length < 3) return false
        if (Math.abs(accountKey.length - simpleKey.length) > 2) return false
        return accountKey.includes(simpleKey) || simpleKey.includes(accountKey)
      })
    : []
  const containsUnique = uniqueById(containsMatches)
  if (containsUnique.length === 1) return { account: containsUnique[0], ambiguous: [] }

  const ambiguous = uniqueById([...exactMatches, ...simpleMatches, ...containsUnique, ...charUnique])
  return { account: null, ambiguous }
}

function cellText(value) {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map(item => cellText(item)).filter(Boolean).join('、')
  if (typeof value === 'object') return cellText(value.text || value.name || value.value || '')
  return String(value).trim()
}

function pickField(row, names) {
  for (const name of names) {
    const value = row[normalizeHeader(name)]
    if (cellText(value)) return value
  }
  return ''
}

function parseMoney(value) {
  const raw = cellText(value)
  const negative = /^\s*[\(（]/.test(raw) || raw.includes('-')
  const text = raw.replace(/[,，￥¥\s()（）+-]/g, '')
  if (!text) return 0
  const n = Number(text)
  if (!Number.isFinite(n)) return 0
  return negative ? -n : n
}

function normalizeDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')} ${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}:${String(value.getSeconds()).padStart(2, '0')}`
  }
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (parsed) {
      return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')} ${String(parsed.H || 0).padStart(2, '0')}:${String(parsed.M || 0).padStart(2, '0')}:${String(Math.trunc(parsed.S || 0)).padStart(2, '0')}`
    }
  }
  const text = cellText(value).replace(/[./年]/g, '-').replace(/[月]/g, '-').replace(/[日]/g, '').replace(/\s+/g, ' ')
  const match = text.match(/(\d{4}-\d{1,2}-\d{1,2})(?:\s+(\d{1,2}:\d{1,2}(?::\d{1,2})?))?/)
  if (!match) return ''
  const [y, m, d] = match[1].split('-')
  const time = match[2] || '00:00:00'
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')} ${time.length === 5 ? `${time}:00` : time}`
}

function normalizeType(value, signedAmount, incomeAmount, expenseAmount) {
  const text = cellText(value)
  if (/收入|收款|入账|进账|income/i.test(text)) return 'income'
  if (/支出|付款|出账|费用|expense/i.test(text)) return 'expense'
  if (incomeAmount > 0) return 'income'
  if (expenseAmount > 0) return 'expense'
  return signedAmount < 0 ? 'expense' : 'income'
}

function normalizeStatus(value) {
  const text = cellText(value)
  if (/待确认|待支付|待收款|未确认|pending/i.test(text)) return 'pending'
  if (/作废|取消|cancel/i.test(text)) return 'cancelled'
  return 'approved'
}

function findHeaderRow(rows) {
  const candidates = ['日期', '账户', '金额', '收入', '支出', '分类', '事由', '对方', '收支类型']
  return rows.findIndex(row => {
    const headers = row.map(normalizeHeader)
    return candidates.filter(item => headers.includes(normalizeHeader(item))).length >= 2
  })
}

function rowsFromImportFile(fileName, fileData) {
  const buffer = decodeData(fileData)
  if (!buffer.length) throw new Error('文件内容为空')
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, raw: false })
  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: false })
    if (findHeaderRow(rows) >= 0) return rows
  }
  throw new Error('文件里没有识别到收支明细表，请确认导出内容包含日期、账户、金额等字段')
}

function parseFeishuTransactionRows(fileName, fileData, db) {
  const rows = rowsFromImportFile(fileName, fileData)
  const headerIndex = findHeaderRow(rows)
  if (headerIndex < 0) throw new Error('没有识别到飞书流水表头，请确认导出表包含日期、账户、金额等字段')
  const headers = rows[headerIndex].map(normalizeHeader)
  const accounts = db.prepare('SELECT id, name FROM accounts ORDER BY id ASC').all()
  const parsed = []
  const warnings = []

  rows.slice(headerIndex + 1).forEach((cells, rowOffset) => {
    const sourceRow = headerIndex + rowOffset + 2
    const row = {}
    headers.forEach((header, index) => {
      if (header) row[header] = cells[index]
    })
    const accountName = cellText(pickField(row, ['账户', '账户名称', '收支账户', '收付款账户']))
    const { account, ambiguous } = resolveImportAccount(accountName, accounts)
    const statusText = cellText(row[normalizeHeader('状态')])
    const incomeAmount = Math.abs(parseMoney(pickField(row, ['收入', '入账', '收款金额', '收入金额'])))
    const expenseAmount = Math.abs(parseMoney(pickField(row, ['支出', '出账', '付款金额', '支出金额'])))
    const signedAmount = parseMoney(pickField(row, ['金额', '发生金额', '收支金额']))
    const typeText = cellText(pickField(row, ['收支类型', '类型', '交易类型']))
    const createdAt = normalizeDate(pickField(row, ['日期', '交易日期', '发生日期', '时间', '创建时间']))
    const type = normalizeType(typeText, signedAmount, incomeAmount, expenseAmount)
    const amount = incomeAmount || expenseAmount || (type === 'income' ? signedAmount : -signedAmount)
    const category = cellText(pickField(row, ['分类', '收支分类', '类目', '项目']))
    const description = cellText(pickField(row, ['事由', '备注', '说明', '摘要', '用途']))
    const party = cellText(pickField(row, ['对方', '交易对方', '客户', '供应商', '收付款方']))
    const proxy = cellText(pickField(row, ['经手人', '录入人', '操作人']))
    const status = normalizeStatus(pickField(row, ['状态']))

    if (!accountName && !amount && !description) return
    if (!account) {
      if (ambiguous.length) {
        warnings.push(`第 ${sourceRow} 行账户匹配到多个可能项：${accountName}（${ambiguous.map(item => item.name).join('、')}）`)
        return
      }
      warnings.push(`第 ${sourceRow} 行账户未匹配：${accountName || '空'}`)
      return
    }
    if (!amount) {
      warnings.push(`第 ${sourceRow} 行金额为空或格式不对`)
      return
    }
    if (!createdAt) {
      warnings.push(`第 ${sourceRow} 行日期为空或格式不对`)
      return
    }
    if (status !== 'approved') {
      warnings.push(`第 ${sourceRow} 行状态为 ${statusText || status}，已跳过`)
      return
    }

    parsed.push({
      source_row: sourceRow,
      account_id: account.id,
      account_name: account.name,
      type,
      amount,
      category,
      description,
      party,
      proxy,
      status,
      created_at: createdAt,
      allow_signed_import: true
    })
  })

  return { rows: parsed, warnings }
}

function isDuplicateTransaction(db, row) {
  const found = db.prepare(`
    SELECT id FROM transactions
    WHERE account_id = ?
      AND type = ?
      AND amount = ?
      AND created_at = ?
      AND COALESCE(category, '') = ?
      AND COALESCE(description, '') = ?
      AND COALESCE(party, '') = ?
    LIMIT 1
  `).get(
    row.account_id,
    row.type,
    row.amount,
    row.created_at,
    row.category || '',
    row.description || '',
    row.party || ''
  )
  return Boolean(found)
}

function makeCsv(rows) {
  const header = ['日期', '账户', '金额', '分类', '凭证', '对方', '事由', '收支类型', '录入人', '备注', '状态']
  const lines = rows.map(row => [
    row.created_at,
    row.account_name,
    (Number(row.amount || 0) * (row.type === 'expense' ? -1 : 1)).toFixed(2),
    row.category,
    '',
    row.party,
    row.description,
    row.type === 'income' ? '收入' : '支出',
    row.proxy,
    '',
    statusLabel(row.status)
  ].map(csvCell).join(','))

  return '\uFEFF' + [header.map(csvCell).join(','), ...lines].join('\n')
}

function makeExcelHtml(rows, query = {}) {
  const incomeTotal = rows
    .filter(row => row.type === 'income' && statusLabel(row.status) === '已确认')
    .reduce((sum, row) => sum + Number(row.amount || 0), 0)
  const expenseTotal = rows
    .filter(row => row.type === 'expense' && statusLabel(row.status) === '已确认')
    .reduce((sum, row) => sum + Number(row.amount || 0), 0)
  const netTotal = incomeTotal - expenseTotal
  const generatedAt = new Date().toLocaleString('zh-CN', { hour12: false })
  const filterText = getFilterLabels(query)

  const tableRows = rows.map((row, index) => {
    const isExpense = row.type === 'expense'
    const signedAmount = Number(row.amount || 0) * (isExpense ? -1 : 1)
    const amountClass = signedAmount < 0 ? 'expense' : 'income'
    return `
      <tr>
        <td class="center">${index + 1}</td>
        <td>${htmlCell(row.created_at)}</td>
        <td>${htmlCell(row.account_name)}</td>
        <td class="money ${amountClass}">${formatMoney(signedAmount)}</td>
        <td>${htmlCell(row.category || '未分类')}</td>
        <td class="center muted">待接附件</td>
        <td>${htmlCell(row.party)}</td>
        <td>${htmlCell(row.description)}</td>
        <td class="center ${amountClass}">${row.type === 'income' ? '收入' : '支出'}</td>
        <td>${htmlCell(row.proxy)}</td>
        <td>${htmlCell('')}</td>
        <td class="center">${htmlCell(statusLabel(row.status))}</td>
        <td class="center">${row.account_type === 'company' ? '公账' : '私账'}</td>
      </tr>
    `
  }).join('')

  return `<!doctype html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>
    body { font-family: "Microsoft YaHei", Arial, sans-serif; color: #111827; }
    .title { font-size: 20px; font-weight: 700; color: #111827; }
    .meta { color: #6b7280; font-size: 12px; }
    .summary-label { background: #f3f4f6; font-weight: 700; text-align: center; }
    .summary-value { font-weight: 700; text-align: right; mso-number-format: "\\#\\,\\#\\#0\\.00"; }
    .income { color: #047857; }
    .expense { color: #dc2626; }
    .net { color: ${netTotal >= 0 ? '#047857' : '#dc2626'}; }
    .muted { color: #9ca3af; }
    table { border-collapse: collapse; table-layout: fixed; }
    th { background: #1f2937; color: #ffffff; font-weight: 700; text-align: center; border: 1px solid #d1d5db; padding: 6px; }
    td { border: 1px solid #d1d5db; padding: 5px; vertical-align: middle; }
    .center { text-align: center; }
    .money { text-align: right; mso-number-format: "\\#\\,\\#\\#0\\.00"; }
    .note { color: #6b7280; font-size: 12px; }
    .empty { text-align: center; color: #6b7280; }
  </style>
</head>
<body>
  <table>
    <colgroup>
      <col style="width: 48px" />
      <col style="width: 150px" />
      <col style="width: 150px" />
      <col style="width: 120px" />
      <col style="width: 120px" />
      <col style="width: 90px" />
      <col style="width: 120px" />
      <col style="width: 240px" />
      <col style="width: 100px" />
      <col style="width: 90px" />
      <col style="width: 180px" />
      <col style="width: 90px" />
      <col style="width: 80px" />
    </colgroup>
    <tr><td class="title" colspan="13">简尚涂装交易流水导出表</td></tr>
    <tr><td class="meta" colspan="13">导出时间：${htmlCell(generatedAt)}　筛选条件：${htmlCell(filterText)}　参考飞书视图：收支明细表</td></tr>
    <tr><td colspan="13"></td></tr>
    <tr>
      <td class="summary-label" colspan="2">总收入</td>
      <td class="summary-value income" colspan="2">${formatMoney(incomeTotal)}</td>
      <td class="summary-label" colspan="2">总支出</td>
      <td class="summary-value expense" colspan="2">${formatMoney(expenseTotal)}</td>
      <td class="summary-label">净额</td>
      <td class="summary-value net" colspan="2">${formatMoney(netTotal)}</td>
      <td colspan="2"></td>
    </tr>
    <tr><td colspan="13"></td></tr>
    <tr>
      <th>序号</th>
      <th>日期</th>
      <th>账户</th>
      <th>金额</th>
      <th>分类</th>
      <th>凭证</th>
      <th>对方</th>
      <th>事由</th>
      <th>收支类型</th>
      <th>经手人</th>
      <th>备注</th>
      <th>状态</th>
      <th>账户类型</th>
    </tr>
    ${tableRows || '<tr><td class="empty" colspan="13">暂无匹配流水</td></tr>'}
    <tr><td class="note" colspan="13">说明：本导出参考飞书 Base「收支明细表」字段顺序；凭证列需等系统文件中心完成后自动关联附件。</td></tr>
  </table>
</body>
</html>`
}

export default function transactionRoutes(server, db) {
  // 获取交易列表
  server.get('/api/transactions', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireModuleAccess(db, request, reply, 'transactions', 'can_view', '无权限查看交易流水')) return

    const { page = 1, pageSize = 20 } = request.query
    const offset = (Number(page) - 1) * Number(pageSize)
    const { where, params } = buildTransactionFilter(request.query)

    const total = db.prepare(`SELECT COUNT(*) as count FROM transactions t LEFT JOIN accounts a ON t.account_id = a.id ${where}`).get(...params)
    const list = db.prepare(
      `SELECT t.*, a.name as account_name, a.type as account_type FROM transactions t LEFT JOIN accounts a ON t.account_id = a.id ${where} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, Number(pageSize), offset)

    return { success: true, data: list, total: total.count }
  })

  // 导出当前筛选下的交易流水。默认生成 Excel 可打开的格式化 .xls，format=csv 可保留纯 CSV。
  server.get('/api/transactions/export', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireModuleAccess(db, request, reply, 'transactions', 'can_view', '无权限导出交易流水')) return

    const { where, params } = buildTransactionFilter(request.query)
    const rows = db.prepare(
      `SELECT t.*, a.name as account_name, a.type as account_type
       FROM transactions t
       LEFT JOIN accounts a ON t.account_id = a.id
       ${where}
       ORDER BY t.created_at DESC`
    ).all(...params)

    if (request.query.format === 'csv') {
      const csvFilename = `jianshang-transactions-${new Date().toISOString().slice(0, 10)}.csv`
      reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${csvFilename}"; filename*=UTF-8''${encodeURIComponent(csvFilename)}`)
        .send(makeCsv(rows))
      return
    }

    const filename = `jianshang-transactions-${new Date().toISOString().slice(0, 10)}.xls`
    reply
      .header('Content-Type', 'application/vnd.ms-excel; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`)
      .send(makeExcelHtml(rows, request.query))
  })

  // 最近交易（供聊天页面板使用）
  server.get('/api/transactions/recent', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireModuleAccess(db, request, reply, 'transactions', 'can_view', '无权限查看交易流水')) return
    const limit = Math.min(Math.max(Number(request.query.limit) || 5, 1), 20)
    const rows = db.prepare(`
      SELECT t.*, a.name as account_name
      FROM transactions t
      LEFT JOIN accounts a ON t.account_id = a.id
      ORDER BY t.id DESC
      LIMIT ?
    `).all(limit)
    return { success: true, data: rows }
  })

  // 获取所有交易分类
  server.get('/api/transactions/categories', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireModuleAccess(db, request, reply, 'transactions', 'can_view', '无权限查看交易分类')) return
    const data = db.prepare(
      "SELECT DISTINCT category FROM transactions WHERE category IS NOT NULL AND category != '' ORDER BY category"
    ).all()
    return { success: true, data: data.map(r => r.category) }
  })

  // 智能解析财务录入文本。只填表，不落库；点“确定”新增流水才是唯一人工确认。
  server.post('/api/transactions/parse-draft', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireModuleAccess(db, request, reply, 'transactions', 'can_create', '无权限新增交易流水')) return

    const rawText = String(request.body?.raw_text || '').trim()
    if (!rawText) return { success: false, message: '请输入需要解析的财务消息' }

    const draft = parseFinanceTransactionDraft(rawText, db)
    return {
      success: true,
      message: '已解析并填入录入表单',
      data: {
        ...draft,
        single_confirm_flow: true
      }
    }
  })

  server.post('/api/transactions/import-feishu', { bodyLimit: LARGE_IMPORT_BODY_LIMIT }, async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireModuleAccess(db, request, reply, 'transactions', 'can_create', '无权限导入交易流水')) return

    const { file_name = '', file_data = '' } = request.body || {}
    if (!file_name || !file_data) return { success: false, message: '请选择飞书多维表格导出的 Excel 或 CSV 文件' }

    try {
      const parsed = parseFeishuTransactionRows(file_name, file_data, db)
      if (!parsed.rows.length) {
        const warningText = parsed.warnings.slice(0, 3).join('；')
        return {
          success: false,
          message: parsed.warnings.length ? `没有可导入流水：${warningText}` : '没有识别到可导入流水',
          data: { warnings: parsed.warnings.slice(0, 30) }
        }
      }

      let created = 0
      let skipped = 0
      const warnings = [...parsed.warnings]
      const tx = db.transaction(() => {
        for (const row of parsed.rows) {
          if (isDuplicateTransaction(db, row)) {
            skipped += 1
            continue
          }
          createTransaction(db, row)
          created += 1
        }
      })
      tx()

      return {
        success: true,
        message: `已导入 ${created} 条流水${skipped ? `，跳过 ${skipped} 条重复流水` : ''}`,
        data: {
          imported_count: created,
          skipped_count: skipped,
          warning_count: warnings.length,
          warnings: warnings.slice(0, 30)
        }
      }
    } catch (err) {
      reply.code(400).send({ success: false, message: err.message || '导入交易流水失败' })
    }
  })

  // 新增交易
  server.post('/api/transactions', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireModuleAccess(db, request, reply, 'transactions', 'can_create', '无权限新增交易流水')) return

    try {
      const result = createTransaction(db, request.body || {})
      return { success: true, id: result.id }
    } catch (err) {
      reply.code(err.statusCode || 400).send({ success: false, message: err.message || '新增交易失败' })
    }
  })

  // 确认待确认流水：确认后才更新账户余额。
  server.post('/api/transactions/:id/confirm', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireModuleAccess(db, request, reply, 'transactions', 'can_edit', '无权限确认交易流水')) return

    try {
      const result = confirmTransaction(db, request.params.id)
      return {
        success: true,
        id: result.id,
        message: result.already_confirmed ? '该流水已确认' : '流水已确认并更新账户余额'
      }
    } catch (err) {
      reply.code(err.statusCode || 400).send({ success: false, message: err.message || '确认交易失败' })
    }
  })

  // 删除交易
  server.delete('/api/transactions/:id', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireModuleAccess(db, request, reply, 'transactions', 'can_delete', '无权限删除交易流水')) return

    try {
      deleteTransaction(db, request.params.id)
      return { success: true }
    } catch (err) {
      reply.code(err.statusCode || 400).send({ success: false, message: err.message || '删除交易失败' })
    }
  })
}
