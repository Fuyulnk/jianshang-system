import { authMiddleware } from '../middleware/auth.js'

export default function transactionRoutes(server, db) {
  // 获取交易列表
  server.get('/api/transactions', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return

    const { account_id, account_type, type, category, start_date, end_date, page = 1, pageSize = 20 } = request.query
    const offset = (Number(page) - 1) * Number(pageSize)

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
    if (start_date) {
      conditions.push("t.created_at >= ?")
      params.push(start_date)
    }
    if (end_date) {
      conditions.push("t.created_at <= ?")
      params.push(end_date + ' 23:59:59')
    }

    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''

    const total = db.prepare(`SELECT COUNT(*) as count FROM transactions t LEFT JOIN accounts a ON t.account_id = a.id ${where}`).get(...params)
    const list = db.prepare(
      `SELECT t.*, a.name as account_name, a.type as account_type FROM transactions t LEFT JOIN accounts a ON t.account_id = a.id ${where} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, Number(pageSize), offset)

    return { success: true, data: list, total: total.count }
  })

  // 获取所有交易分类
  server.get('/api/transactions/categories', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    const data = db.prepare(
      "SELECT DISTINCT category FROM transactions WHERE category IS NOT NULL AND category != '' ORDER BY category"
    ).all()
    return { success: true, data: data.map(r => r.category) }
  })

  // 新增交易
  server.post('/api/transactions', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return

    const { account_id, type, amount, category, description, party, proxy } = request.body

    if (!account_id || !type || amount === undefined) {
      return { success: false, message: '账户、类型和金额不能为空' }
    }

    const result = db.prepare(
      `INSERT INTO transactions (account_id, type, amount, category, description, party, proxy, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))`
    ).run(account_id, type, amount, category || null, description || null, party || null, proxy || null)

    // 更新账户余额
    const sign = type === 'income' ? 1 : -1
    db.prepare(
      "UPDATE accounts SET current_balance = current_balance + ?, updated_at = datetime('now', 'localtime') WHERE id = ?"
    ).run(sign * amount, account_id)

    return { success: true, id: result.lastInsertRowid }
  })

  // 删除交易
  server.delete('/api/transactions/:id', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return

    const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(request.params.id)
    if (!tx) {
      reply.code(404).send({ success: false, message: '交易记录不存在' })
      return
    }

    // 回退账户余额
    const sign = tx.type === 'income' ? -1 : 1
    db.prepare(
      "UPDATE accounts SET current_balance = current_balance + ?, updated_at = datetime('now', 'localtime') WHERE id = ?"
    ).run(sign * tx.amount, tx.account_id)

    db.prepare('DELETE FROM transactions WHERE id = ?').run(request.params.id)
    return { success: true }
  })
}
