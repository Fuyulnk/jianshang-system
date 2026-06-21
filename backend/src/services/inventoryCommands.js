/**
 * Inventory write commands — material out / return / adjust.
 * Pure DB operations, no auth/HTTP concerns.
 * Routes orchestrate project state transitions around these.
 */

export function recordInventoryMovement(db, movement) {
  db.prepare(`
    INSERT INTO inventory_movements (
      product_id, project_id, material_request_id, movement_type,
      quantity_delta, quantity_before, quantity_after, unit, reason, note, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    movement.product_id,
    movement.project_id || 0,
    movement.material_request_id || 0,
    movement.movement_type,
    roundQty(movement.quantity_delta),
    roundQty(movement.quantity_before),
    roundQty(movement.quantity_after),
    movement.unit || '',
    movement.reason || '',
    movement.note || '',
    movement.created_by || 0
  )
}

export function deductStock(db, productId, quantity) {
  const product = db.prepare('SELECT id, name, unit, stock FROM products WHERE id = ?').get(productId)
  if (!product) throw new Error(`产品不存在`)
  const result = db.prepare(`
    UPDATE products SET stock = stock - ?, updated_at = datetime('now', 'localtime')
    WHERE id = ? AND stock >= ?
  `).run(quantity, productId, quantity)
  if (!result.changes) {
    throw new Error(`产品「${product.name}」库存不足，当前 ${product.stock ?? 0}，需扣 ${quantity}`)
  }
  return product
}

export function addStock(db, productId, quantity, fallbackProductName = '') {
  const product = db.prepare('SELECT id, name, unit, stock FROM products WHERE id = ?').get(productId)
  if (!product) throw new Error(`产品「${fallbackProductName || productId}」不存在，不能回库`)
  const before = toNumber(product.stock)
  const after = roundQty(before + quantity)
  db.prepare(`UPDATE products SET stock = stock + ?, updated_at = datetime('now', 'localtime') WHERE id = ?`)
    .run(quantity, productId)
  return { ...product, stock_before: before, stock_after: after }
}

export function updateMaterialRequestStatus(db, requestId, status, userId, note) {
  if (status === 'confirmed') {
    db.prepare(`
      UPDATE material_requests SET status = 'confirmed', confirmed_by = ?,
        confirmed_at = datetime('now', 'localtime'), confirm_note = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(userId, note, requestId)
  } else if (status === 'cancelled') {
    db.prepare(`
      UPDATE material_requests SET status = 'cancelled', updated_at = datetime('now', 'localtime') WHERE id = ?
    `).run(requestId)
  }
}

export function recordMaterialLoss(db, { projectId, requestId, productId, productName, quantity, unit, reason, note, userId }) {
  db.prepare(`
    INSERT INTO material_losses (project_id, material_request_id, product_id, product_name,
      quantity, unit, reason, note, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(projectId, requestId, productId || 0, productName || '', quantity, unit || '', reason, note || '', userId || 0)
}

export function upsertMaterialIoDocument(db, project, requestRow, items, userId) {
  const toolFee = requestRow.tool_loss_total !== undefined && requestRow.tool_loss_total !== null && requestRow.tool_loss_total !== ''
    ? requestRow.tool_loss_total : Number(requestRow.tool_total || 0) * 0.1
  const summary = {
    material_fee: roundMoney(requestRow.material_total),
    auxiliary_fee: roundMoney(requestRow.auxiliary_total),
    tool_fee: roundMoney(toolFee),
    transport_fee: roundMoney(requestRow.transport_fee),
    total_cost: roundMoney(requestRow.total_amount)
  }
  const confirmedData = {
    project: { project_name: project.name || '', customer: project.customer || '' },
    summary,
    items: items.map(item => ({
      product_name: item.product_name, category: item.category, unit: item.unit,
      out_quantity: item.out_quantity, return_quantity: item.return_quantity,
      usage_quantity: item.usage_quantity, difference_quantity: item.difference_quantity,
      unit_price: item.unit_price, amount: item.amount, remark: item.remark
    }))
  }
  const existing = db.prepare(`
    SELECT id FROM project_documents
    WHERE project_id = ? AND document_type = 'material_io' AND status = 'confirmed'
    ORDER BY id DESC LIMIT 1
  `).get(project.id)
  const data = JSON.stringify(confirmedData)
  if (existing) {
    db.prepare(`UPDATE project_documents SET confirmed_data = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`)
      .run(data, existing.id)
  } else {
    db.prepare(`INSERT INTO project_documents (project_id, document_type, status, confirmed_data, created_by) VALUES (?, 'material_io', 'confirmed', ?, ?)`)
      .run(project.id, data, userId)
  }
}

export function applyMaterialReturnInventory(db, { project, requestRow, items, note, userId }) {
  const productStmt = db.prepare('SELECT id, name, unit, stock FROM products WHERE id = ?')
  const updateItemStmt = db.prepare(`
    UPDATE material_request_items
    SET usage_quantity = ?, return_quantity = ?, amount = ?, remark = ?
    WHERE id = ?
  `)

  for (const item of items) {
    if (item.id) {
      updateItemStmt.run(item.usage_quantity, item.return_quantity, item.amount, item.remark || '', item.id)
    }

    let returnedProduct = null
    if (item.product_id && item.return_quantity > 0) {
      returnedProduct = addStock(db, item.product_id, item.return_quantity, item.product_name)
      recordInventoryMovement(db, {
        product_id: item.product_id,
        project_id: project.id,
        material_request_id: requestRow.id,
        movement_type: 'return',
        quantity_delta: item.return_quantity,
        quantity_before: returnedProduct.stock_before,
        quantity_after: returnedProduct.stock_after,
        unit: returnedProduct.unit || item.unit || '',
        reason: '项目回库',
        note: note || `${project.name || '项目'} 回库：${item.product_name}`,
        created_by: userId
      })
    }

    if (item.difference_quantity > 0) {
      recordMaterialLoss(db, {
        projectId: project.id,
        requestId: requestRow.id,
        productId: item.product_id || 0,
        productName: item.product_name || '',
        quantity: item.difference_quantity,
        unit: item.unit || '',
        reason: '回库差异',
        note: item.remark || note || '',
        userId
      })
      if (item.product_id) {
        const product = returnedProduct || productStmt.get(item.product_id)
        recordInventoryMovement(db, {
          product_id: item.product_id,
          project_id: project.id,
          material_request_id: requestRow.id,
          movement_type: 'loss',
          quantity_delta: 0,
          quantity_before: product?.stock_after ?? product?.stock ?? 0,
          quantity_after: product?.stock_after ?? product?.stock ?? 0,
          unit: product?.unit || item.unit || '',
          reason: '损耗记录',
          note: `损耗 ${formatQty(item.difference_quantity)} ${item.unit || ''}：${item.product_name}`,
          created_by: userId
        })
      }
    }
  }
}

// ── helpers ──
function roundQty(value) {
  const n = Number(value || 0)
  return Number.isFinite(n) ? Math.round(n * 10000) / 10000 : 0
}
function roundMoney(value) {
  const n = Number(value || 0)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
}
function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}
function formatQty(value) {
  const n = Number(value || 0)
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}
