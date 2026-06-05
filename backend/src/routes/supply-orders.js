import { authMiddleware } from '../middleware/auth.js'
import { canAccessModule, getDataScope } from '../utils/permissions.js'

const MAX_MONEY_VALUE = 100000000

const STATUS_META = {
  ordered: { label: '销售下单', next: 'payment_confirmed', roles: ['super_admin', 'admin', 'finance'] },
  payment_confirmed: { label: '财务确认收款', next: 'materials_ordered', roles: ['super_admin', 'admin', 'warehouse'] },
  materials_ordered: { label: '仓库订材料', next: 'shipped', roles: ['super_admin', 'admin', 'warehouse'] },
  shipped: { label: '材料到位发货', next: 'completed', roles: ['super_admin', 'admin', 'warehouse'] },
  completed: { label: '完结', next: '', roles: [] }
}

export default function supplyOrderRoutes(server, db) {
  server.get('/api/supply-orders', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!canAccessModule(db, request.user, 'projects', 'can_view')) {
      reply.code(403).send({ success: false, message: '无权限查看项目供货单' })
      return
    }
    const keyword = cleanText(request.query?.keyword)
    const status = cleanText(request.query?.status)
    const params = []
    let sql = 'SELECT * FROM supply_orders WHERE 1=1'
    if (!canSeeAll(db, request.user)) {
      sql += ' AND created_by = ?'
      params.push(request.user.userId)
    }
    if (status) {
      sql += ' AND status = ?'
      params.push(status)
    }
    if (keyword) {
      sql += ' AND (order_no LIKE ? OR customer LIKE ? OR phone LIKE ? OR source LIKE ? OR address LIKE ?)'
      const k = `%${keyword}%`
      params.push(k, k, k, k, k)
    }
    sql += ' ORDER BY id DESC LIMIT 200'
    const rows = db.prepare(sql).all(...params).map(row => decorateOrder(db, row, false))
    return { success: true, data: rows }
  })

  server.get('/api/supply-orders/:id', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    const order = db.prepare('SELECT * FROM supply_orders WHERE id = ?').get(toInt(request.params.id))
    if (!order || !canViewOrder(db, request.user, order)) {
      reply.code(404).send({ success: false, message: '供货单不存在或无权限' })
      return
    }
    return { success: true, data: decorateOrder(db, order, true) }
  })

  server.post('/api/supply-orders', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!canAccessModule(db, request.user, 'projects', 'can_create')) {
      reply.code(403).send({ success: false, message: '无权限新建项目供货单' })
      return
    }
    const draft = normalizeOrder(request.body || {})
    if (!draft.customer) return { success: false, message: '客户/项目名称必填' }
    const items = normalizeItems(request.body?.items)
    const orderNo = nextOrderNo(db)
    const tx = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO supply_orders (order_no, customer, phone, source, address, amount, note, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(orderNo, draft.customer, draft.phone, draft.source, draft.address, draft.amount, draft.note, request.user.userId)
      saveItems(db, result.lastInsertRowid, items)
      addLog(db, result.lastInsertRowid, '新建供货单', request.user.username, `创建供货单 ${orderNo}`)
      return result.lastInsertRowid
    })
    return { success: true, id: tx(), order_no: orderNo }
  })

  server.put('/api/supply-orders/:id', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    const order = db.prepare('SELECT * FROM supply_orders WHERE id = ?').get(toInt(request.params.id))
    if (!order || !canViewOrder(db, request.user, order)) {
      reply.code(404).send({ success: false, message: '供货单不存在或无权限' })
      return
    }
    if (!canEditOrder(db, request.user, order)) {
      reply.code(403).send({ success: false, message: '无权限编辑该供货单' })
      return
    }
    const draft = normalizeOrder(request.body || {})
    const items = normalizeItems(request.body?.items)
    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE supply_orders
        SET customer = ?, phone = ?, source = ?, address = ?, amount = ?, note = ?, updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `).run(draft.customer, draft.phone, draft.source, draft.address, draft.amount, draft.note, order.id)
      db.prepare('DELETE FROM supply_order_items WHERE order_id = ?').run(order.id)
      saveItems(db, order.id, items)
      addLog(db, order.id, '编辑供货单', request.user.username, '更新供货单基础信息和明细')
    })
    tx()
    return { success: true }
  })

  server.put('/api/supply-orders/:id/status', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    const order = db.prepare('SELECT * FROM supply_orders WHERE id = ?').get(toInt(request.params.id))
    if (!order || !canViewOrder(db, request.user, order)) {
      reply.code(404).send({ success: false, message: '供货单不存在或无权限' })
      return
    }
    const target = cleanText(request.body?.status)
    const current = STATUS_META[order.status]
    if (!current || current.next !== target || !STATUS_META[target]) return { success: false, message: '只能按供货流程顺序推进' }
    if (!current.roles.includes(request.user.role)) {
      reply.code(403).send({ success: false, message: '当前角色不能执行这一步' })
      return
    }
    const fieldByStatus = {
      payment_confirmed: ['finance_confirmed_by', 'finance_confirmed_at'],
      materials_ordered: ['warehouse_confirmed_by', 'warehouse_confirmed_at'],
      shipped: ['shipped_by', 'shipped_at'],
      completed: ['completed_by', 'completed_at']
    }
    const [userField, timeField] = fieldByStatus[target] || []
    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE supply_orders
        SET status = ?, ${userField} = ?, ${timeField} = datetime('now', 'localtime'), updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `).run(target, request.user.userId, order.id)
      addLog(db, order.id, '状态推进', request.user.username, `${STATUS_META[order.status].label} → ${STATUS_META[target].label}`)
    })
    tx()
    return { success: true }
  })
}

function decorateOrder(db, order, withDetail) {
  const meta = STATUS_META[order.status] || STATUS_META.ordered
  const items = withDetail ? db.prepare('SELECT * FROM supply_order_items WHERE order_id = ? ORDER BY id ASC').all(order.id) : []
  const logs = withDetail ? db.prepare('SELECT * FROM supply_order_logs WHERE order_id = ? ORDER BY id DESC LIMIT 50').all(order.id) : []
  return {
    ...order,
    status_label: meta.label,
    next_status: meta.next,
    next_label: meta.next ? STATUS_META[meta.next]?.label : '',
    items,
    logs
  }
}

function saveItems(db, orderId, items) {
  const stmt = db.prepare(`
    INSERT INTO supply_order_items (order_id, product_id, product_name, category, unit, quantity, unit_price, amount, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const item of items) {
    stmt.run(orderId, item.product_id, item.product_name, item.category, item.unit, item.quantity, item.unit_price, item.amount, item.note)
  }
}

function normalizeOrder(input) {
  return {
    customer: cleanText(input.customer),
    phone: cleanText(input.phone),
    source: cleanText(input.source),
    address: cleanText(input.address),
    amount: toMoney(input.amount),
    note: cleanText(input.note)
  }
}

function normalizeItems(items) {
  if (!Array.isArray(items)) return []
  return items.map(item => {
    const quantity = toQuantity(item.quantity)
    const unitPrice = toMoney(item.unit_price)
    const amount = toMoney(item.amount) || roundMoney(quantity * unitPrice)
    return {
      product_id: toInt(item.product_id),
      product_name: cleanText(item.product_name),
      category: cleanText(item.category),
      unit: cleanText(item.unit),
      quantity,
      unit_price: unitPrice,
      amount,
      note: cleanText(item.note)
    }
  }).filter(item => item.product_name)
}

function nextOrderNo(db) {
  const prefix = `GH-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`
  const row = db.prepare("SELECT order_no FROM supply_orders WHERE order_no LIKE ? ORDER BY order_no DESC LIMIT 1").get(`${prefix}-%`)
  const last = Number(String(row?.order_no || '').split('-').pop() || 0)
  return `${prefix}-${String(last + 1).padStart(3, '0')}`
}

function canViewOrder(db, user, order) {
  if (!canAccessModule(db, user, 'projects', 'can_view')) return false
  return canSeeAll(db, user) || order.created_by === user.userId
}

function canEditOrder(db, user, order) {
  if (['super_admin', 'admin'].includes(user.role)) return true
  return order.status === 'ordered' && order.created_by === user.userId && canAccessModule(db, user, 'projects', 'can_edit')
}

function canSeeAll(db, user) {
  if (user?.role === 'super_admin') return true
  return getDataScope(db, user, 'projects') === 'all'
}

function addLog(db, orderId, action, operator, content) {
  db.prepare('INSERT INTO supply_order_logs (order_id, action, operator, content) VALUES (?, ?, ?, ?)')
    .run(orderId, action, operator || '', content || '')
}

function cleanText(value) {
  return String(value ?? '').trim()
}

function toInt(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0
}

function toMoney(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.min(MAX_MONEY_VALUE, Math.max(0, Number(n.toFixed(2))))
}

function toQuantity(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.min(MAX_MONEY_VALUE, Math.max(0, Number(n.toFixed(3))))
}

function roundMoney(value) {
  const n = Number(value || 0)
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0
}
