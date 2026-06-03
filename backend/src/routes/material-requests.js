import { authMiddleware } from '../middleware/auth.js'
import { canAccessModule, canAccessProjectRecord } from '../utils/permissions.js'

const STATUS_LABELS = {
  requested: '待仓库确认',
  confirmed: '已出库',
  cancelled: '已取消'
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
    if (!canAccessModule(db, request.user, 'projects', 'can_edit') || !canAccessProjectRecord(db, request.user, project)) {
      reply.code(403).send({ success: false, message: '无权限为该工单申请出库' })
      return
    }

    const items = normalizeItems(request.body?.items)
    if (!items.length) return { success: false, message: '请至少添加一项出库材料' }
    const checkedItems = []
    for (const item of items) {
      const product = db.prepare('SELECT id, name, category, unit, stock FROM products WHERE id = ?').get(item.product_id)
      if (!product) return { success: false, message: `产品 ${item.product_id} 不存在` }
      checkedItems.push({ ...item, product })
    }

    const note = cleanText(request.body?.note)
    const tx = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO material_requests (project_id, status, note, requested_by)
        VALUES (?, 'requested', ?, ?)
      `).run(project.id, note, request.user.userId)
      const stmt = db.prepare(`
        INSERT INTO material_request_items (
          request_id, product_id, product_name, category, unit, quantity, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      for (const item of checkedItems) {
        stmt.run(result.lastInsertRowid, item.product.id, item.product.name, item.product.category || '', item.product.unit || '', item.quantity, item.note)
      }
      db.prepare("UPDATE projects SET material_out_status = 'requested', material_out_note = ?, updated_at = datetime('now', 'localtime') WHERE id = ?")
        .run(note || '已发起仓库出库申请', project.id)
      addProjectLog(db, project.id, '出库申请', request.user.username, `发起出库申请 #${result.lastInsertRowid}，共 ${checkedItems.length} 项材料`)
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

      const nextStatus = project.status === 'briefing_done' ? 'material_out' : project.status
      db.prepare(`
        UPDATE projects
        SET status = ?, material_out_status = 'done', material_out_note = ?,
            updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `).run(nextStatus, note || `仓库已确认出库申请 #${requestId}`, project.id)
      addProjectLog(db, project.id, '材料出库', request.user.username,
        `仓库确认出库申请 #${requestId}，共 ${items.length} 项材料${nextStatus !== project.status ? '；工单进入待进场' : ''}`)
    })
    try {
      tx()
    } catch (err) {
      return { success: false, message: err.message || '确认出库失败' }
    }
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
        db.prepare(`
          UPDATE projects
          SET material_out_status = 'pending',
              material_out_note = ?,
              updated_at = datetime('now', 'localtime')
          WHERE id = ? AND material_out_status = 'requested'
        `).run(note || `出库申请 #${materialRequest.id} 已取消，暂无待确认出库申请`, project.id)
      }
      addProjectLog(db, project.id, '取消出库申请', request.user.username, `取消出库申请 #${materialRequest.id}`)
      return remaining
    })
    const remaining = tx()
    return { success: true, material_out_status: remaining ? 'requested' : 'pending' }
  })
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
    status_label: STATUS_LABELS[row.status] || row.status,
    requester_name: row.requester_real_name || row.requester_username || '',
    confirmer_name: row.confirmer_real_name || row.confirmer_username || '',
    items
  }
}

function normalizeItems(items) {
  if (!Array.isArray(items)) return []
  return items.map(item => ({
    product_id: toInt(item.product_id),
    quantity: toNumber(item.quantity),
    note: cleanText(item.note)
  })).filter(item => item.product_id && item.quantity > 0)
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
