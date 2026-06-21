export function createTransaction(db, payload = {}) {
  const accountId = toPositiveInt(payload.account_id)
  const type = cleanText(payload.type)
  const amount = toPositiveMoney(payload.amount)
  if (!accountId || !type || payload.amount === undefined) {
    throw commandError('账户、类型和金额不能为空', 400)
  }
  if (!['income', 'expense'].includes(type)) {
    throw commandError('类型必须为 income 或 expense', 400)
  }
  if (!amount) {
    throw commandError('金额必须为正数', 400)
  }
  const account = db.prepare('SELECT id FROM accounts WHERE id = ?').get(accountId)
  if (!account) {
    throw commandError('账户不存在', 400)
  }

  const tx = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO transactions (account_id, type, amount, category, description, party, proxy, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
    `).run(
      accountId,
      type,
      amount,
      cleanNullable(payload.category),
      cleanNullable(payload.description),
      cleanNullable(payload.party),
      cleanNullable(payload.proxy)
    )

    const sign = type === 'income' ? 1 : -1
    db.prepare(`
      UPDATE accounts
      SET current_balance = current_balance + ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(sign * amount, accountId)

    return result.lastInsertRowid
  })

  return { id: tx() }
}

export function deleteTransaction(db, transactionId) {
  const id = toPositiveInt(transactionId)
  const transaction = id ? db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) : null
  if (!transaction) {
    throw commandError('交易记录不存在', 404)
  }

  const tx = db.transaction(() => {
    if (transaction.status !== 'cancelled') {
      const sign = transaction.type === 'income' ? -1 : 1
      db.prepare(`
        UPDATE accounts
        SET current_balance = current_balance + ?, updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `).run(sign * Number(transaction.amount || 0), transaction.account_id)
    }
    db.prepare('DELETE FROM transactions WHERE id = ?').run(id)
  })

  tx()
  return { id }
}

function commandError(message, statusCode = 400) {
  const err = new Error(message)
  err.statusCode = statusCode
  return err
}

function toPositiveInt(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0
}

function toPositiveMoney(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function cleanText(value) {
  return String(value ?? '').trim()
}

function cleanNullable(value) {
  const text = cleanText(value)
  return text || null
}
