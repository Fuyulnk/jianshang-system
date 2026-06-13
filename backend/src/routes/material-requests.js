import { authMiddleware } from '../middleware/auth.js'
import { canAccessModule, canAccessProjectRecord } from '../utils/permissions.js'

const STATUS_LABELS = {
  requested: '待仓库确认',
  confirmed: '已出库',
  cancelled: '已取消'
}

const PROJECT_STATUS_ALIASES = {
  info_confirmed: 'handover_received',
  condition_met: 'recheck_done',
  team_assigned: 'recheck_done',
  completed: 'inspection_done',
  settled: 'finance_settled',
  closed: 'archived'
}

export default function materialRequestRoutes(server, db) {
  server.get('/api/material-requests', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    const projectId = toInt(request.query.project_id)
    const status = cleanText(request.query.status)
    const conditions = []
    const params = []

    if (projectId) {
      conditions.push('mr.project_id = ?')
      params.push(projectId)
    }
    if (status) {
      conditions.push('mr.status = ?')
      params.push(status)
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const rows = db.prepare(`
      SELECT mr.*, p.name as project_name, p.customer as project_customer, p.status as project_status,
             p.created_by as created_by, p.manager_user_id as manager_user_id,
             p.assignee_user_id as assignee_user_id, p.crew_member_user_ids as crew_member_user_ids,
             u.username as requester_username, u.real_name as requester_real_name,
             cu.username as confirmer_username, cu.real_name as confirmer_real_name
      FROM material_requests mr
      LEFT JOIN projects p ON mr.project_id = p.id
      LEFT JOIN users u ON mr.requested_by = u.id
      LEFT JOIN users cu ON mr.confirmed_by = cu.id
      ${where}
      ORDER BY mr.id DESC
      LIMIT 200
    `).all(...params)

    const visible = rows.filter(row => canSeeMaterialRequest(db, request.user, row))
    const items = getItemsForRequests(db, visible.map(row => row.id))
    return { success: true, data: visible.map(row => formatRequest(row, items[row.id] || [])) }
  })

  server.post('/api/projects/:id/material-requests', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(toInt(request.params.id))
    if (!project) return reply.code(404).send({ success: false, message: '项目不存在' })
    const canEditProject = canAccessModule(db, request.user, 'projects', 'can_edit')
    const canHandleWarehouse = canAccessModule(db, request.user, 'products', 'can_edit')
    if ((!canEditProject && !canHandleWarehouse) || !canAccessProjectRecord(db, request.user, project)) {
      reply.code(403).send({ success: false, message: '无权限为该工单申请出库' })
      return
    }
    if (canonicalProjectStatus(project.status) !== 'briefing_done') {
      return { success: false, message: '只有交底完成待出库的项目工单才能发起出库申请' }
    }

    const items = normalizeItems(request.body?.items)
    if (!items.length) return { success: false, message: '请至少添加一项出库材料' }
    const summary = summarizeItems(items, request.body?.summary)
    const checkedItems = []
    for (const item of items) {
      const product = item.product_id
        ? db.prepare('SELECT id, name, category, unit, stock, unit_price FROM products WHERE id = ?').get(item.product_id)
        : null
      if (item.product_id && !product) return { success: false, message: `产品 ${item.product_id} 不存在` }
      checkedItems.push({ ...item, product })
    }

    const note = cleanText(request.body?.note)
    const tx = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO material_requests (
          project_id, status, note, material_total, auxiliary_total, tool_total,
          tool_loss_total, transport_fee, total_amount, requested_by
        )
        VALUES (?, 'requested', ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        project.id,
        note,
        summary.material_total,
        summary.auxiliary_total,
        summary.tool_total,
        summary.tool_loss_total,
        summary.transport_fee,
        summary.total_amount,
        request.user.userId
      )
      const stmt = db.prepare(`
        INSERT INTO material_request_items (
          request_id, product_id, product_name, item_group, category, unit, quantity,
          out_date, out_quantity, return_quantity, usage_quantity, unit_price, amount, note, remark
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      for (const item of checkedItems) {
        stmt.run(
          result.lastInsertRowid,
          item.product?.id || 0,
          item.product?.name || item.product_name,
          item.item_group,
          item.category || item.product?.category || '',
          item.unit || item.product?.unit || '',
          item.quantity,
          item.out_date,
          item.out_quantity,
          item.return_quantity,
          item.usage_quantity,
          item.unit_price,
          item.amount,
          item.note,
          item.remark
        )
      }
      db.prepare(`
        UPDATE projects
        SET status = 'material_requested',
            material_out_status = 'requested',
            material_out_note = ?,
            updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `)
        .run(note || '已发起仓库出库申请', project.id)
      addProjectLog(db, project.id, '出库申请', request.user.username,
        `发起出库申请 #${result.lastInsertRowid}，共 ${checkedItems.length} 项，预计出库合计 ${summary.total_amount.toFixed(2)} 元`)
      return result.lastInsertRowid
    })

    return { success: true, id: tx() }
  })

  server.put('/api/material-requests/:id/confirm', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!canAccessModule(db, request.user, 'products', 'can_edit')) {
      reply.code(403).send({ success: false, message: '无权限确认出库' })
      return
    }
    const requestId = toInt(request.params.id)
    const materialRequest = db.prepare('SELECT * FROM material_requests WHERE id = ?').get(requestId)
    if (!materialRequest) return reply.code(404).send({ success: false, message: '出库申请不存在' })
    if (materialRequest.status !== 'requested') return { success: false, message: '该申请已处理' }

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(materialRequest.project_id)
    if (!project) return reply.code(404).send({ success: false, message: '关联项目不存在' })
    const items = db.prepare('SELECT * FROM material_request_items WHERE request_id = ?').all(requestId)
    if (!items.length) return { success: false, message: '出库申请没有材料明细' }

    const note = cleanText(request.body?.note)
    const productStmt = db.prepare('SELECT id, name, stock FROM products WHERE id = ?')
    const deductStockStmt = db.prepare(`
      UPDATE products
      SET stock = stock - ?, updated_at = datetime('now', 'localtime')
      WHERE id = ? AND stock >= ?
    `)
    const tx = db.transaction(() => {
      for (const item of items) {
        if (!toInt(item.product_id)) continue
        const quantity = Number(item.quantity || 0)
        const product = productStmt.get(item.product_id)
        if (!product) throw new Error(`产品「${item.product_name}」不存在`)
        const result = deductStockStmt.run(quantity, item.product_id, quantity)
        if (!result.changes) {
          const current = productStmt.get(item.product_id)
          throw new Error(`产品「${current?.name || item.product_name}」库存不足，当前 ${current?.stock ?? 0}，申请 ${quantity}`)
        }
      }
      db.prepare(`
        UPDATE material_requests
        SET status = 'confirmed', confirmed_by = ?, confirmed_at = datetime('now', 'localtime'),
            confirm_note = ?, updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `).run(request.user.userId, note, requestId)

      const currentProjectStatus = canonicalProjectStatus(project.status)
      const nextStatus = ['briefing_done', 'material_requested'].includes(currentProjectStatus) ? 'material_out' : currentProjectStatus
      db.prepare(`
        UPDATE projects
        SET status = ?, material_out_status = 'done', material_out_note = ?,
            updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `).run(nextStatus, note || `仓库已确认出库申请 #${requestId}`, project.id)
      upsertMaterialOutDocument(db, project, materialRequest, items, request.user.userId)
      addProjectLog(db, project.id, '材料出库', request.user.username,
        `仓库确认出库申请 #${requestId}，共 ${items.length} 项，出库合计 ${Number(materialRequest.total_amount || 0).toFixed(2)} 元${nextStatus !== currentProjectStatus ? '；工单进入已出库待进场' : ''}`)
    })
    try {
      tx()
    } catch (err) {
      return { success: false, message: err.message || '确认出库失败' }
    }
    return { success: true }
  })

  server.put('/api/projects/:id/material-return/confirm', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!canAccessModule(db, request.user, 'products', 'can_edit')) {
      reply.code(403).send({ success: false, message: '无权限确认材料回库' })
      return
    }
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(toInt(request.params.id))
    if (!project) return reply.code(404).send({ success: false, message: '项目不存在' })
    if (!canAccessProjectRecord(db, request.user, project)) {
      reply.code(403).send({ success: false, message: '无权限处理该项目回库' })
      return
    }
    if (canonicalProjectStatus(project.status) !== 'inspection_done') {
      return { success: false, message: '只有验收完成待回库的项目才能确认材料回库' }
    }

    const latestRequest = db.prepare(`
      SELECT *
      FROM material_requests
      WHERE project_id = ? AND status = 'confirmed'
      ORDER BY id DESC
      LIMIT 1
    `).get(project.id)
    if (!latestRequest) return { success: false, message: '未找到已确认的材料出库单，不能回库' }

    const originalItems = db.prepare('SELECT * FROM material_request_items WHERE request_id = ? ORDER BY id ASC').all(latestRequest.id)
    const returnItems = normalizeReturnItems(request.body?.items, originalItems)
    if (!returnItems.length) return { success: false, message: '请至少保留一项回库明细' }
    const note = cleanText(request.body?.note) || '材料回库已确认'

    const tx = db.transaction(() => {
      updateMaterialReturnDocument(db, project, latestRequest, returnItems, note, request.user.userId)
      const statusResult = db.prepare(`
        UPDATE projects
        SET status = 'material_returned',
            material_return_status = 'done',
            material_return_note = ?,
            updated_at = datetime('now', 'localtime')
        WHERE id = ? AND status = 'inspection_done'
      `).run(note, project.id)
      if (statusResult.changes === 0) {
        throw new Error('项目状态已变更，请刷新后重试')
      }
      addProjectLog(db, project.id, '材料回库', request.user.username,
        `仓库确认材料回库，${returnItems.length} 项；工单进入回库完成待工费结算`)
    })
    tx()
    return { success: true }
  })

  server.put('/api/material-requests/:id/cancel', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    const materialRequest = db.prepare('SELECT * FROM material_requests WHERE id = ?').get(toInt(request.params.id))
    if (!materialRequest) return reply.code(404).send({ success: false, message: '出库申请不存在' })
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(materialRequest.project_id)
    if (!project || !canAccessModule(db, request.user, 'projects', 'can_edit') || !canAccessProjectRecord(db, request.user, project)) {
      reply.code(403).send({ success: false, message: '无权限取消该申请' })
      return
    }
    if (materialRequest.status !== 'requested') return { success: false, message: '已确认或已取消的申请不能取消' }
    const note = cleanText(request.body?.note)
    const tx = db.transaction(() => {
      db.prepare("UPDATE material_requests SET status = 'cancelled', updated_at = datetime('now', 'localtime') WHERE id = ?").run(materialRequest.id)
      const remaining = db.prepare(`
        SELECT COUNT(*) as count
        FROM material_requests
        WHERE project_id = ? AND status = 'requested'
      `).get(project.id)?.count || 0
      if (!remaining) {
        const nextStatus = canonicalProjectStatus(project.status) === 'material_requested' ? 'briefing_done' : canonicalProjectStatus(project.status)
        db.prepare(`
          UPDATE projects
          SET status = ?,
              material_out_status = 'pending',
              material_out_note = ?,
              updated_at = datetime('now', 'localtime')
          WHERE id = ? AND material_out_status = 'requested'
        `).run(nextStatus, note || `出库申请 #${materialRequest.id} 已取消，暂无待确认出库申请`, project.id)
      }
      addProjectLog(db, project.id, '取消出库申请', request.user.username, `取消出库申请 #${materialRequest.id}`)
      return remaining
    })
    const remaining = tx()
    return { success: true, material_out_status: remaining ? 'requested' : 'pending' }
  })
}

function normalizeReturnItems(items, originalItems) {
  const incoming = Array.isArray(items) ? items : []
  const source = incoming.length ? incoming : originalItems
  return source.map((item, index) => {
    const sourceItem = originalItems[index] || originalItems.find(row => row.id === toInt(item.id)) || {}
    const outQuantity = toNumber(item.out_quantity ?? item.quantity ?? sourceItem.out_quantity ?? sourceItem.quantity)
    const returnQuantity = toNumber(item.return_quantity)
    const usageQuantity = item.usage_quantity === '' || item.usage_quantity === undefined
      ? Math.max(0, outQuantity - returnQuantity)
      : toNumber(item.usage_quantity)
    return {
      id: toInt(item.id || sourceItem.id),
      product_id: toInt(item.product_id || sourceItem.product_id),
      product_name: cleanText(item.product_name || sourceItem.product_name),
      item_group: normalizeGroup(item.item_group || sourceItem.item_group),
      category: cleanText(item.category || sourceItem.category),
      unit: cleanText(item.unit || sourceItem.unit),
      out_date: cleanText(item.out_date || sourceItem.out_date),
      out_quantity: outQuantity,
      usage_quantity: usageQuantity,
      return_quantity: returnQuantity,
      difference_quantity: roundMoney(outQuantity - usageQuantity - returnQuantity),
      unit_price: toNumber(item.unit_price || sourceItem.unit_price),
      amount: roundMoney(usageQuantity * toNumber(item.unit_price || sourceItem.unit_price)),
      remark: cleanText(item.remark || sourceItem.remark || sourceItem.note)
    }
  }).filter(item => item.product_name)
}

function canSeeMaterialRequest(db, user, row) {
  if (canAccessModule(db, user, 'products', 'can_view')) return true
  if (!canAccessModule(db, user, 'projects', 'can_view')) return false
  return canAccessProjectRecord(db, user, row)
}

function getItemsForRequests(db, ids) {
  if (!ids.length) return {}
  const rows = db.prepare(`
    SELECT *
    FROM material_request_items
    WHERE request_id IN (${ids.map(() => '?').join(',')})
    ORDER BY id ASC
  `).all(...ids)
  return rows.reduce((map, item) => {
    if (!map[item.request_id]) map[item.request_id] = []
    map[item.request_id].push(item)
    return map
  }, {})
}

function formatRequest(row, items) {
  return {
    ...row,
    project_raw_status: row.project_status,
    project_status: canonicalProjectStatus(row.project_status),
    status_label: STATUS_LABELS[row.status] || row.status,
    requester_name: row.requester_real_name || row.requester_username || '',
    confirmer_name: row.confirmer_real_name || row.confirmer_username || '',
    items
  }
}

function canonicalProjectStatus(status) {
  return PROJECT_STATUS_ALIASES[status] || status
}

function normalizeItems(items) {
  if (!Array.isArray(items)) return []
  return items.map(item => {
    const outQuantity = toNumber(item.out_quantity ?? item.quantity)
    const usageQuantity = toNumber(item.usage_quantity) || outQuantity
    const unitPrice = toNumber(item.unit_price)
    const amount = roundMoney(toNumber(item.amount) || usageQuantity * unitPrice)
    return {
      product_id: toInt(item.product_id),
      product_name: cleanText(item.product_name || item.material_name),
      item_group: normalizeGroup(item.item_group || item.group),
      category: cleanText(item.category),
      unit: cleanText(item.unit),
      quantity: outQuantity,
      out_date: cleanText(item.out_date),
      out_quantity: outQuantity,
      return_quantity: toNumber(item.return_quantity),
      usage_quantity: usageQuantity,
      unit_price: unitPrice,
      amount,
      note: cleanText(item.note),
      remark: cleanText(item.remark || item.note)
    }
  }).filter(item => item.product_name && item.out_quantity > 0)
}

function normalizeGroup(value) {
  const key = cleanText(value)
  if (['material', 'auxiliary', 'tool', 'transport'].includes(key)) return key
  if (/辅材|损耗/.test(key)) return 'auxiliary'
  if (/工具/.test(key)) return 'tool'
  if (/运输/.test(key)) return 'transport'
  return 'material'
}

function summarizeItems(items, incoming = {}) {
  incoming = incoming || {}
  const material = sumByGroup(items, 'material')
  const auxiliary = sumByGroup(items, 'auxiliary')
  const tool = sumByGroup(items, 'tool')
  const transport = roundMoney(toNumber(incoming.transport_fee) || sumByGroup(items, 'transport'))
  const toolLoss = roundMoney(incoming.tool_loss_total !== undefined && incoming.tool_loss_total !== null && incoming.tool_loss_total !== ''
    ? toNumber(incoming.tool_loss_total)
    : tool * 0.1)
  return {
    material_total: material,
    auxiliary_total: auxiliary,
    tool_total: tool,
    tool_loss_total: toolLoss,
    transport_fee: transport,
    total_amount: roundMoney(material + auxiliary + toolLoss + transport)
  }
}

function sumByGroup(items, group) {
  return roundMoney(items.filter(item => item.item_group === group).reduce((sum, item) => sum + Number(item.amount || 0), 0))
}

function roundMoney(value) {
  const n = Number(value || 0)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
}

function upsertMaterialOutDocument(db, project, requestRow, items, userId) {
  const toolFee = requestRow.tool_loss_total !== undefined && requestRow.tool_loss_total !== null && requestRow.tool_loss_total !== ''
    ? requestRow.tool_loss_total
    : Number(requestRow.tool_total || 0) * 0.1
  const summary = {
    material_fee: roundMoney(requestRow.material_total),
    auxiliary_fee: roundMoney(requestRow.auxiliary_total),
    tool_fee: roundMoney(toolFee),
    transport_fee: roundMoney(requestRow.transport_fee),
    total_cost: roundMoney(requestRow.total_amount)
  }
  const confirmedData = {
    project: {
      project_name: project.name || '',
      customer: project.customer || '',
      phone: project.phone || '',
      address: project.address_detail || project.address || ''
    },
    items: items.map(item => ({
      category: item.category || groupLabel(item.item_group),
      item_group: item.item_group || 'material',
      out_date: item.out_date || '',
      material_name: item.product_name || '',
      unit: item.unit || '',
      out_quantity: Number(item.out_quantity || item.quantity || 0),
      return_quantity: Number(item.return_quantity || 0),
      usage_quantity: Number(item.usage_quantity || item.quantity || 0),
      unit_price: Number(item.unit_price || 0),
      amount: Number(item.amount || 0),
      remark: item.remark || item.note || ''
    })),
    summary
  }
  const parsed = JSON.stringify({ source: 'material_request', request_id: requestRow.id })
  const confirmed = JSON.stringify(confirmedData)
  const existing = db.prepare(`
    SELECT id FROM project_documents
    WHERE project_id = ? AND document_type = 'material_io'
    ORDER BY id DESC
    LIMIT 1
  `).get(project.id)
  if (existing) {
    db.prepare(`
      UPDATE project_documents
      SET status = 'confirmed', parsed_data = ?, confirmed_data = ?, warnings = '[]',
          updated_by = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(parsed, confirmed, userId || 0, existing.id)
    return existing.id
  }
  const result = db.prepare(`
    INSERT INTO project_documents (
      project_id, document_type, source_attachment_id, status,
      parsed_data, confirmed_data, warnings, created_by, updated_by
    ) VALUES (?, 'material_io', 0, 'confirmed', ?, ?, '[]', ?, ?)
  `).run(project.id, parsed, confirmed, userId || 0, userId || 0)
  return result.lastInsertRowid
}

function updateMaterialReturnDocument(db, project, requestRow, items, note, userId) {
  const confirmedAt = new Date().toISOString()
  const summary = {
    material_fee: roundMoney(items.filter(item => item.item_group === 'material').reduce((sum, item) => sum + item.amount, 0)),
    auxiliary_fee: roundMoney(items.filter(item => item.item_group === 'auxiliary').reduce((sum, item) => sum + item.amount, 0)),
    tool_fee: roundMoney(items.filter(item => item.item_group === 'tool').reduce((sum, item) => sum + item.amount, 0)),
    transport_fee: roundMoney(requestRow.transport_fee),
    total_cost: roundMoney(items.reduce((sum, item) => sum + item.amount, 0) + Number(requestRow.transport_fee || 0))
  }
  const confirmedData = {
    project: {
      project_name: project.name || '',
      customer: project.customer || '',
      phone: project.phone || '',
      address: project.address_detail || project.address || ''
    },
    items: items.map(item => ({
      category: item.category || groupLabel(item.item_group),
      item_group: item.item_group || 'material',
      out_date: item.out_date || '',
      material_name: item.product_name || '',
      unit: item.unit || '',
      out_quantity: Number(item.out_quantity || 0),
      usage_quantity: Number(item.usage_quantity || 0),
      return_quantity: Number(item.return_quantity || 0),
      difference_quantity: Number(item.difference_quantity || 0),
      unit_price: Number(item.unit_price || 0),
      amount: Number(item.amount || 0),
      remark: item.remark || ''
    })),
    summary,
    return_note: note || '',
    step_confirmed: true,
    step_confirmed_at: confirmedAt,
    step_confirmed_by: userId || 0
  }
  const parsed = JSON.stringify({ source: 'material_return', request_id: requestRow.id })
  const confirmed = JSON.stringify(confirmedData)
  const existing = db.prepare(`
    SELECT id FROM project_documents
    WHERE project_id = ? AND document_type = 'material_io'
    ORDER BY id DESC
    LIMIT 1
  `).get(project.id)
  if (existing) {
    db.prepare(`
      UPDATE project_documents
      SET status = 'confirmed', parsed_data = ?, confirmed_data = ?, warnings = '[]',
          updated_by = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(parsed, confirmed, userId || 0, existing.id)
    return existing.id
  }
  const result = db.prepare(`
    INSERT INTO project_documents (
      project_id, document_type, source_attachment_id, status,
      parsed_data, confirmed_data, warnings, created_by, updated_by
    ) VALUES (?, 'material_io', 0, 'confirmed', ?, ?, '[]', ?, ?)
  `).run(project.id, parsed, confirmed, userId || 0, userId || 0)
  return result.lastInsertRowid
}

function groupLabel(group) {
  return { material: '材料清单', auxiliary: '辅材损耗', tool: '工具', transport: '运输费' }[group] || '材料清单'
}

function addProjectLog(db, projectId, action, operator, content) {
  db.prepare('INSERT INTO project_logs (project_id, action, operator, content) VALUES (?, ?, ?, ?)')
    .run(projectId, action, operator || '', content || '')
}

function toInt(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0
}

function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function cleanText(value) {
  return String(value || '').trim()
}
