import { authMiddleware } from '../middleware/auth.js'
import { canAccessModule, canAccessProjectRecord, getDataScope } from '../utils/permissions.js'
import { parseSupplyOrderDocument } from '../utils/supplyOrderImport.js'
import { deductStock, recordInventoryMovement } from '../services/inventoryCommands.js'

const MAX_MONEY_VALUE = 100000000

/** 根据供货方式获取状态的下一步 */
function nextStatus(status, fulfillmentType) {
  const base = {
    ordered: 'payment_confirmed',
    shipped: 'completed',
    completed: ''
  }
  if (base[status] !== undefined) return base[status]
  if (status === 'payment_confirmed') {
    return fulfillmentType === 'purchase' ? 'shipped' : 'stock_out'
  }
  if (status === 'stock_out' || status === 'materials_ordered' || status === 'purchase_paid') return 'shipped'
  return ''
}

const STATUS_META = {
  ordered: {
    label: '销售下单', todoLabel: '待财务确认收款',
    next: 'payment_confirmed', actionLabel: '财务确认收款',
    roles: ['super_admin', 'admin', 'finance']
  },
  payment_confirmed: {
    label: '财务已确认收款', todoLabel: '待处理供货',
    roles: ['super_admin', 'admin', 'finance']
  },
  stock_out: {
    label: '仓管出库', todoLabel: '待出库发货',
    roles: ['super_admin', 'admin', 'warehouse'],
    next: 'shipped', actionLabel: '确认出库发货'
  },
  purchase_paid: {
    label: '总部款已记录', todoLabel: '待确认总部发货',
    roles: ['super_admin', 'admin', 'finance'],
    next: 'shipped', actionLabel: '确认总部已发货'
  },
  materials_ordered: {
    label: '仓库已订材料', todoLabel: '待材料到位发货',
    roles: ['super_admin', 'admin', 'warehouse'],
    next: 'shipped', actionLabel: '确认到位发货'
  },
  shipped: {
    label: '材料已发货', todoLabel: '待完结',
    next: 'completed', actionLabel: '确认完结',
    roles: ['super_admin', 'admin', 'warehouse']
  },
  completed: { label: '已完结', todoLabel: '已完结', next: '', actionLabel: '', roles: [] }
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
    const scoped = buildScopedOrderWhere(db, request.user)
    sql += scoped.sql
    params.push(...scoped.params)
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

  server.post('/api/supply-orders/imports/parse', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!canAccessModule(db, request.user, 'projects', 'can_create')) {
      logAiAudit(db, request.user, {
        toolName: 'parse_supply_order',
        status: 'denied',
        errorMessage: '无权限导入项目供货单'
      })
      reply.code(403).send({ success: false, message: '无权限导入项目供货单' })
      return
    }
    const { file_name = '', file_data = '' } = request.body || {}
    if (!file_name || !file_data) return { success: false, message: '请上传供货销售单或材料预算单' }
    try {
      const parsed = parseSupplyOrderDocument(file_name, file_data)
      logAiAudit(db, request.user, {
        toolName: 'parse_supply_order',
        requestSummary: file_name,
        resultSummary: `供货单识别：${parsed.form_data?.items?.length || 0} 条明细，金额 ${parsed.form_data?.amount || 0}`
      })
      return { success: true, data: parsed }
    } catch (err) {
      logAiAudit(db, request.user, {
        toolName: 'parse_supply_order',
        status: 'failed',
        errorMessage: err.message || '供货单解析失败'
      })
      reply.code(400).send({ success: false, message: err.message || '供货单解析失败' })
    }
  })

  server.post('/api/supply-orders/imports/confirm-create', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!canAccessModule(db, request.user, 'projects', 'can_create')) {
      logAiAudit(db, request.user, {
        toolName: 'create_supply_order',
        status: 'denied',
        errorMessage: '无权限从导入草稿创建供货单'
      })
      reply.code(403).send({ success: false, message: '无权限从导入草稿创建供货单' })
      return
    }
    const validation = validateOrderInput(request.body?.confirmed_data || {}, { requireItems: true })
    if (validation) return { success: false, message: validation }
    const draft = normalizeOrder(request.body?.confirmed_data || {})
    const items = normalizeItems(request.body?.confirmed_data?.items)
    if (!draft.customer) return { success: false, message: '客户/项目名称必填' }
    const warnings = Array.isArray(request.body?.warnings) ? request.body.warnings : []
    const sourceFile = cleanText(request.body?.source_file || request.body?.parsed_data?.source_file)
    const orderNo = nextOrderNo(db)
    const tx = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO supply_orders (order_no, project_id, customer, phone, source, address, amount, note, fulfillment_type, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(orderNo, draft.project_id, draft.customer, draft.phone, draft.source, draft.address, draft.amount, draft.note, draft.fulfillment_type || 'warehouse', request.user.userId)
      saveItems(db, result.lastInsertRowid, items)
      addLog(
        db,
        result.lastInsertRowid,
        '导入供货单创建',
        request.user.username,
        `由供货单导入创建；来源文件：${sourceFile || '未记录'}；AI分析提示 ${warnings.length} 项；已进入财务确认收款待办`
      )
      return result.lastInsertRowid
    })
    const id = tx()
    logAiAudit(db, request.user, {
      toolName: 'create_supply_order',
      requestSummary: sourceFile || draft.customer,
      resultSummary: `创建供货单 ${orderNo}，明细 ${items.length} 条，金额 ${draft.amount}`
    })
    return { success: true, id, order_no: orderNo, status: 'ordered', fulfillment_type: draft.fulfillment_type || 'warehouse', next_status: 'payment_confirmed', next_label: '财务确认收款' }
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
    const validation = validateOrderInput(request.body || {}, { requireItems: true })
    if (validation) return { success: false, message: validation }
    const draft = normalizeOrder(request.body || {})
    if (!draft.customer) return { success: false, message: '客户/项目名称必填' }
    const items = normalizeItems(request.body?.items)
    const orderNo = nextOrderNo(db)
    const tx = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO supply_orders (order_no, project_id, customer, phone, source, address, amount, note, fulfillment_type, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(orderNo, draft.project_id, draft.customer, draft.phone, draft.source, draft.address, draft.amount, draft.note, draft.fulfillment_type || 'warehouse', request.user.userId)
      saveItems(db, result.lastInsertRowid, items)
      addLog(db, result.lastInsertRowid, '新建供货单', request.user.username, `创建供货单 ${orderNo}`)
      return result.lastInsertRowid
    })
    return { success: true, id: tx(), order_no: orderNo, status: 'ordered', fulfillment_type: draft.fulfillment_type || 'warehouse', next_status: 'payment_confirmed', next_label: '财务确认收款' }
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
    const lockedBody = { ...(request.body || {}), fulfillment_type: order.fulfillment_type || request.body?.fulfillment_type }
    const validation = validateOrderInput(lockedBody, { requireItems: true })
    if (validation) return { success: false, message: validation }
    const draft = normalizeOrder(lockedBody)
    const items = normalizeItems(lockedBody.items)
    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE supply_orders
        SET project_id = ?, customer = ?, phone = ?, source = ?, address = ?, amount = ?, note = ?, fulfillment_type = ?, updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `).run(draft.project_id, draft.customer, draft.phone, draft.source, draft.address, draft.amount, draft.note, order.fulfillment_type || draft.fulfillment_type || 'warehouse', order.id)
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
    const expectedNext = nextStatus(order.status, order.fulfillment_type || 'warehouse')
    if (target !== expectedNext || !STATUS_META[target]) {
      return { success: false, message: '只能按供货流程顺序推进' }
    }
    const allowedRoles = rolesForTransition(order, target)
    if (allowedRoles.length && !allowedRoles.includes(request.user.role)) {
      reply.code(403).send({ success: false, message: '当前角色不能执行这一步' })
      return
    }

    const fieldByStatus = {
      payment_confirmed: ['finance_confirmed_by', 'finance_confirmed_at'],
      stock_out: ['stock_out_by', 'stock_out_at'],
      shipped: ['shipped_by', 'shipped_at'],
      completed: ['completed_by', 'completed_at']
    }
    const [userField, timeField] = fieldByStatus[target] || []
    const tx = db.transaction(() => {
      if (target === 'stock_out') {
        const items = db.prepare('SELECT * FROM supply_order_items WHERE order_id = ?').all(order.id)
        for (const item of items) {
          const productId = toInt(item.product_id) || resolveProductId(db, item.product_name)
          if (!productId) throw new Error(`自有库存发货需要关联库存产品：${item.product_name || '未命名材料'}`)
          const quantity = toQuantity(item.quantity)
          if (!quantity) continue
          const product = deductStock(db, productId, quantity)
          const before = toNumber(product.stock)
          const after = before - quantity
          recordInventoryMovement(db, {
            product_id: productId, project_id: order.project_id || 0, material_request_id: 0,
            movement_type: 'out', quantity_delta: -quantity,
            quantity_before: before, quantity_after: product.stock_after ?? after, unit: product.unit || item.unit || '',
            reason: '供货单出库', note: `供货单 #${order.id} 出库：${item.product_name}`,
            created_by: request.user.userId,
            location_id: item.location_id || product.location_id || 0,
            reference_type: 'supply_order',
            reference_id: order.id
          })
        }
      }
      const result = db.prepare(`
        UPDATE supply_orders
        SET status = ?, ${userField} = ?, ${timeField} = datetime('now', 'localtime'), updated_at = datetime('now', 'localtime')
        WHERE id = ? AND status = ?
      `).run(target, request.user.userId, order.id, order.status)
      if (result.changes === 0) {
        const conflict = new Error('供货单状态已被其他请求推进，请刷新后重试')
        conflict.statusCode = 409
        throw conflict
      }
      addLog(db, order.id, '状态推进', request.user.username, `${STATUS_META[order.status]?.label || order.status} → ${STATUS_META[target].label}`)
    })
    try {
      tx()
    } catch (err) {
      reply.code(err.statusCode || 400).send({ success: false, message: err.message || '状态推进失败' })
      return
    }
    return { success: true }
  })

  server.delete('/api/supply-orders/:id', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    const order = db.prepare('SELECT * FROM supply_orders WHERE id = ?').get(toInt(request.params.id))
    if (!order || !canViewOrder(db, request.user, order)) {
      reply.code(404).send({ success: false, message: '供货单不存在或无权限' })
      return
    }
    if (!canDeleteOrder(db, request.user, order)) {
      reply.code(403).send({ success: false, message: '无权限删除该供货单' })
      return
    }
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM supply_order_items WHERE order_id = ?').run(order.id)
      db.prepare('DELETE FROM supply_order_logs WHERE order_id = ?').run(order.id)
      db.prepare('DELETE FROM supply_orders WHERE id = ?').run(order.id)
    })
    tx()
    return { success: true }
  })
}

function decorateOrder(db, order, withDetail) {
  const meta = STATUS_META[order.status] || STATUS_META.ordered
  const next = nextStatus(order.status, order.fulfillment_type || 'warehouse')
  const items = withDetail ? db.prepare(`
    SELECT soi.*, wl.code as location_code, wl.label as location_label, p.warehouse_code as product_warehouse_code
    FROM supply_order_items soi
    LEFT JOIN warehouse_locations wl ON wl.id = soi.location_id
    LEFT JOIN products p ON p.id = soi.product_id
    WHERE soi.order_id = ?
    ORDER BY soi.id ASC
  `).all(order.id) : []
  const logs = withDetail ? db.prepare('SELECT * FROM supply_order_logs WHERE order_id = ? ORDER BY id DESC LIMIT 50').all(order.id) : []
  return {
    ...order,
    status_label: meta.label,
    todo_label: meta.todoLabel || meta.label,
    next_status: next,
    next_label: next ? STATUS_META[next]?.label : '',
    action_label: actionLabelFor(order, next, meta),
    items,
    logs
  }
}

function actionLabelFor(order, next, meta) {
  const fulfillmentType = order.fulfillment_type || 'warehouse'
  if (!next) return ''
  if (order.status === 'payment_confirmed' && fulfillmentType === 'purchase') return '确认总部已发货'
  if (order.status === 'payment_confirmed' && fulfillmentType === 'warehouse') return '确认仓管出库'
  if (order.status === 'stock_out') return '确认已发货'
  return meta.actionLabel || STATUS_META[next]?.label || meta.todoLabel || ''
}

function rolesForTransition(order, target) {
  const status = String(order?.status || '')
  const fulfillmentType = order?.fulfillment_type || 'warehouse'
  if (status === 'ordered' && target === 'payment_confirmed') return ['super_admin', 'admin', 'finance']
  if (status === 'payment_confirmed' && target === 'stock_out') return ['super_admin', 'admin', 'warehouse']
  if (status === 'payment_confirmed' && fulfillmentType === 'purchase' && target === 'shipped') return ['super_admin', 'admin', 'finance', 'warehouse']
  if (status === 'stock_out' && target === 'shipped') return ['super_admin', 'admin', 'warehouse']
  if (status === 'materials_ordered' && target === 'shipped') return ['super_admin', 'admin', 'warehouse']
  if (status === 'purchase_paid' && target === 'shipped') return ['super_admin', 'admin', 'finance', 'warehouse']
  if (status === 'shipped' && target === 'completed') return ['super_admin', 'admin', 'finance', 'warehouse']
  return STATUS_META[status]?.roles || []
}

function saveItems(db, orderId, items) {
  const stmt = db.prepare(`
    INSERT INTO supply_order_items (order_id, product_id, product_name, category, unit, quantity, unit_price, amount, note, location_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const item of items) {
    const product = item.product_id ? db.prepare('SELECT location_id FROM products WHERE id = ?').get(item.product_id) : null
    stmt.run(orderId, item.product_id, item.product_name, item.category, item.unit, item.quantity, item.unit_price, item.amount, item.note, item.location_id || product?.location_id || 0)
  }
}

function resolveProductId(db, productName) {
  const keyword = compactSku(productName)
  if (!keyword) return 0
  const rows = db.prepare('SELECT id, name, spec FROM products ORDER BY id ASC').all()
  const skuMatch = rows.find(row => compactSku(productDisplayName(row)) === keyword)
  if (skuMatch) return skuMatch.id
  const nameMatches = rows.filter(row => compactSku(row.name) === keyword)
  return nameMatches.length === 1 ? nameMatches[0].id : 0
}

function productDisplayName(product) {
  const name = cleanText(product?.name)
  const spec = cleanText(product?.spec)
  if (!spec || name.includes(spec)) return name
  return `${name}${spec}`
}

function compactSku(value) {
  return cleanText(value).replace(/[｜|\s　/／·,，-]/g, '').toLowerCase()
}

function normalizeOrder(input) {
  return {
    project_id: toInt(input.project_id),
    customer: cleanText(input.customer),
    phone: cleanText(input.phone),
    source: cleanText(input.source),
    address: cleanText(input.address),
    amount: toMoney(input.amount),
    note: cleanText(input.note),
    fulfillment_type: normalizeFulfillmentType(input.fulfillment_type)
  }
}

function normalizeFulfillmentType(value) {
  const raw = cleanText(value)
  const compacted = compactSku(raw)
  if (['purchase', 'hq', 'headquarters', 'direct'].includes(compacted)) return 'purchase'
  if (raw.includes('总部') || raw.includes('采购') || raw.includes('直发')) return 'purchase'
  return 'warehouse'
}

function validateOrderInput(input, { requireItems = false } = {}) {
  const customer = cleanText(input?.customer)
  if (!customer) return '客户/项目名称必填'
  const fulfillmentType = normalizeFulfillmentType(input?.fulfillment_type)
  const amountMessage = validateNumberInput(input?.amount, '供货金额', { allowZero: true, max: MAX_MONEY_VALUE })
  if (amountMessage) return amountMessage

  const rawItems = Array.isArray(input?.items) ? input.items : []
  if (requireItems && !rawItems.length) return '至少需要一条供货明细'
  const meaningfulItems = rawItems.filter(hasMeaningfulItemValue)
  if (requireItems && !meaningfulItems.length) return '至少需要一条有效供货明细'
  for (const [index, item] of meaningfulItems.entries()) {
    const rowLabel = `第 ${index + 1} 条供货明细`
    if (!cleanText(item.product_name)) return `${rowLabel}缺产品/材料名称`
    if (fulfillmentType === 'warehouse' && !toInt(item.product_id)) {
      return `${rowLabel}必须选择库存产品，不能只手填名称`
    }
    const quantityMessage = validateNumberInput(item.quantity, `${rowLabel}数量`, { allowZero: false, max: MAX_MONEY_VALUE })
    if (quantityMessage) return quantityMessage
    const priceMessage = validateNumberInput(item.unit_price, `${rowLabel}单价`, { allowZero: true, max: MAX_MONEY_VALUE })
    if (priceMessage) return priceMessage
    const amountMessage = validateNumberInput(item.amount, `${rowLabel}金额`, { allowZero: true, max: MAX_MONEY_VALUE })
    if (amountMessage) return amountMessage
  }
  return ''
}

function hasMeaningfulItemValue(item) {
  return ['product_name', 'category', 'unit', 'quantity', 'unit_price', 'amount', 'note']
    .some(key => cleanText(item?.[key]) !== '')
}

function validateNumberInput(value, label, { allowZero, max }) {
  const text = cleanText(value)
  if (!text) return allowZero ? '' : `${label}必须大于 0`
  const n = Number(text)
  if (!Number.isFinite(n)) return `${label}必须是有效数字`
  if (n < 0) return `${label}不能为负数`
  if (!allowZero && n <= 0) return `${label}必须大于 0`
  if (n > max) return `${label}不能超过 ${max}`
  return ''
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
      location_id: toInt(item.location_id),
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
  return canSeeAll(db, user) || order.created_by === user.userId || canAccessLinkedProject(db, user, order)
}

function canEditOrder(db, user, order) {
  if (['super_admin', 'admin'].includes(user.role)) return true
  return order.status === 'ordered' && order.created_by === user.userId && canAccessModule(db, user, 'projects', 'can_edit')
}

function canDeleteOrder(db, user, order) {
  if (!canAccessModule(db, user, 'projects', 'can_delete')) return false
  return canSeeAll(db, user) || order.created_by === user.userId || canAccessLinkedProject(db, user, order)
}

function canSeeAll(db, user) {
  if (user?.role === 'super_admin') return true
  if (['admin', 'finance', 'warehouse'].includes(user?.role)) return true
  return getDataScope(db, user, 'projects') === 'all'
}

function buildScopedOrderWhere(db, user) {
  if (canSeeAll(db, user)) return { sql: '', params: [] }
  const scope = getDataScope(db, user, 'projects')
  const userId = toInt(user?.userId)
  if (!userId || scope === 'none' || scope === 'private_grant') return { sql: ' AND 1=0', params: [] }
  if (scope === 'project_related' || scope === 'department' || scope === 'self') {
    return {
      sql: `
        AND (
          created_by = ?
          OR project_id IN (
            SELECT id FROM projects
            WHERE created_by = ?
              OR manager_user_id = ?
              OR assignee_user_id = ?
              OR EXISTS (
                SELECT 1 FROM json_each(COALESCE(projects.crew_member_user_ids, '[]'))
                WHERE CAST(json_each.value AS INTEGER) = ?
              )
          )
        )
      `,
      params: [userId, userId, userId, userId, userId]
    }
  }
  return { sql: ' AND created_by = ?', params: [userId] }
}

function canAccessLinkedProject(db, user, order) {
  const projectId = toInt(order?.project_id)
  if (!projectId) return false
  const project = db.prepare(`
    SELECT id, created_by, manager_user_id, assignee_user_id, crew_member_user_ids
    FROM projects
    WHERE id = ?
  `).get(projectId)
  return canAccessProjectRecord(db, user, project)
}

function addLog(db, orderId, action, operator, content) {
  db.prepare('INSERT INTO supply_order_logs (order_id, action, operator, content) VALUES (?, ?, ?, ?)')
    .run(orderId, action, operator || '', content || '')
}

function logAiAudit(db, user, data) {
  db.prepare(`
    INSERT INTO ai_audit_logs (
      user_id, employee_id, role, action_type, tool_name, request_summary,
      result_summary, status, error_message, model
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    user?.userId || 0,
    user?.employeeId || 0,
    user?.role || '',
    data.actionType || 'tool_write',
    data.toolName || '',
    cleanText(data.requestSummary || '').slice(0, 500),
    cleanText(data.resultSummary || '').slice(0, 500),
    data.status || 'ok',
    cleanText(data.errorMessage || '').slice(0, 500),
    'builtin-supply-import'
  )
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
