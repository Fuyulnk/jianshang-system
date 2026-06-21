import { authMiddleware } from '../middleware/auth.js'
import { requireModuleAccess } from '../utils/permissions.js'
import { parseFinanceTransactionDraft } from '../utils/financeParser.js'
import { createTransaction, deleteTransaction } from '../services/financeCommands.js'

function buildTransactionFilter(query = {}) {
  const { account_id, account_type, type, category, start_date, end_date } = query
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
    .filter(row => row.type === 'income')
    .reduce((sum, row) => sum + Number(row.amount || 0), 0)
  const expenseTotal = rows
    .filter(row => row.type === 'expense')
    .reduce((sum, row) => sum + Number(row.amount || 0), 0)
  const netTotal = incomeTotal - expenseTotal
  const generatedAt = new Date().toLocaleString('zh-CN', { hour12: false })
  const filterText = getFilterLabels(query)

  const tableRows = rows.map((row, index) => {
    const isExpense = row.type === 'expense'
    const signedAmount = Number(row.amount || 0) * (isExpense ? -1 : 1)
    const amountClass = isExpense ? 'expense' : 'income'
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
