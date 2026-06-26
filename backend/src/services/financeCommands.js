export function createTransaction(db, payload = {}) {
  const accountId = toPositiveInt(payload.account_id)
  const type = cleanText(payload.type)
  const amount = payload.allow_signed_import
    ? toSignedMoney(payload.amount)
    : toPositiveMoney(payload.amount)
  const status = normalizeTransactionStatus(payload.status)
  const createdAt = normalizeCreatedAt(payload.created_at)
  if (!accountId || !type || payload.amount === undefined) {
    throw commandError('账户、类型和金额不能为空', 400)
  }
  if (!['income', 'expense'].includes(type)) {
    throw commandError('类型必须为 income 或 expense', 400)
  }
  if (!amount) {
    throw commandError(payload.allow_signed_import ? '金额不能为 0' : '金额必须为正数', 400)
  }
  const account = db.prepare('SELECT id FROM accounts WHERE id = ?').get(accountId)
  if (!account) {
    throw commandError('账户不存在', 400)
  }

  const tx = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO transactions (account_id, type, amount, category, description, party, proxy, status, entry_source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now', 'localtime')))
    `).run(
      accountId,
      type,
      amount,
      cleanNullable(payload.category),
      cleanNullable(payload.description),
      cleanNullable(payload.party),
      cleanNullable(payload.proxy),
      status,
      cleanTransactionSource(payload.entry_source),
      createdAt
    )

    if (status === 'approved') {
      applyAccountBalanceDelta(db, accountId, type, amount)
    }

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
    if (isBalanceAppliedStatus(transaction.status)) {
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

export function confirmTransaction(db, transactionId) {
  const id = toPositiveInt(transactionId)
  const tx = db.transaction(() => {
    const transaction = id ? db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) : null
    if (!transaction) {
      throw commandError('交易记录不存在', 404)
    }
    if (transaction.status === 'cancelled') {
      throw commandError('已作废的流水不能确认', 400)
    }
    if (isBalanceAppliedStatus(transaction.status)) {
      return { id, already_confirmed: true }
    }

    const updated = db.prepare(`
      UPDATE transactions
      SET status = 'approved'
      WHERE id = ? AND status = 'pending'
    `).run(id)
    if (!updated.changes) {
      const fresh = db.prepare('SELECT status FROM transactions WHERE id = ?').get(id)
      if (isBalanceAppliedStatus(fresh?.status)) return { id, already_confirmed: true }
      throw commandError('流水状态已变化，请刷新后重试', 409)
    }
    applyAccountBalanceDelta(db, transaction.account_id, transaction.type, Number(transaction.amount || 0))
    return { id, already_confirmed: false }
  })
  return tx()
}

export function createFinanceArapItem(db, payload = {}, createdBy = 0) {
  const item = normalizeArapPayload(payload)
  if (!item.title) throw commandError('事项名称不能为空', 400)
  if (!item.amount || item.amount <= 0) throw commandError('金额必须大于 0', 400)

  const result = db.prepare(`
    INSERT INTO finance_arap_items (
      type, title, counterparty, amount, settled_amount, due_date, status,
      category, project_id, source_type, source_id, owner_user_id, note, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    item.type, item.title, item.counterparty, item.amount, item.settled_amount,
    item.due_date, item.status, item.category, item.project_id, item.source_type,
    item.source_id, item.owner_user_id, item.note, toPositiveInt(createdBy)
  )
  return { id: Number(result.lastInsertRowid), item }
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

function toNonNegativeMoney(value) {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

function toSignedMoney(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function cleanText(value) {
  return String(value ?? '').trim()
}

function cleanNullable(value) {
  const text = cleanText(value)
  return text || null
}

function cleanTransactionSource(value) {
  const source = cleanText(value)
  return /^[a-z_]{1,40}$/.test(source) ? source : 'manual'
}

function normalizeArapPayload(payload = {}) {
  const amount = toPositiveMoney(payload.amount)
  const settledAmount = Math.min(toNonNegativeMoney(payload.settled_amount ?? payload.settledAmount), amount)
  const requestedStatus = cleanText(payload.status)
  const status = ['pending', 'partial', 'done'].includes(requestedStatus)
    ? requestedStatus
    : settledAmount >= amount && amount > 0 ? 'done' : settledAmount > 0 ? 'partial' : 'pending'
  return {
    type: cleanText(payload.type) === 'payable' ? 'payable' : 'receivable',
    title: cleanText(payload.title).slice(0, 120),
    counterparty: cleanText(payload.counterparty).slice(0, 120),
    amount,
    settled_amount: settledAmount,
    due_date: normalizeArapDate(payload.due_date ?? payload.dueDate),
    status,
    category: cleanText(payload.category).slice(0, 80),
    project_id: toPositiveInt(payload.project_id ?? payload.projectId),
    source_type: cleanText(payload.source_type ?? payload.sourceType).slice(0, 60),
    source_id: toPositiveInt(payload.source_id ?? payload.sourceId),
    owner_user_id: toPositiveInt(payload.owner_user_id ?? payload.ownerUserId),
    note: cleanText(payload.note).slice(0, 500)
  }
}

function normalizeArapDate(value) {
  const match = cleanText(value).match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (!match) return ''
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
}

function normalizeTransactionStatus(value) {
  const status = cleanText(value)
  return ['pending', 'approved', 'cancelled'].includes(status) ? status : 'approved'
}

function normalizeCreatedAt(value) {
  const text = cleanText(value)
  if (!text) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text} 00:00:00`
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}$/.test(text)) return `${text}:00`
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(text)) return text
  return null
}

function isBalanceAppliedStatus(status) {
  return !status || status === 'approved'
}

function applyAccountBalanceDelta(db, accountId, type, amount) {
  const sign = type === 'income' ? 1 : -1
  db.prepare(`
    UPDATE accounts
    SET current_balance = current_balance + ?, updated_at = datetime('now', 'localtime')
    WHERE id = ?
  `).run(sign * Number(amount || 0), accountId)
}
