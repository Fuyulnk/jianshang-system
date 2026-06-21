import { authMiddleware } from '../middleware/auth.js'
import { requireModuleAccess } from '../utils/permissions.js'
import { inventoryFacts } from '../services/businessFacts.js'

export default function productRoutes(server, db) {
  // 获取产品列表
  server.get('/api/products', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireModuleAccess(db, request, reply, 'products', 'can_view', '无权限查看产品库存')) return

    return inventoryFacts(db, request.user, request.query)
  })

  // 新增产品
  server.post('/api/products', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireModuleAccess(db, request, reply, 'products', 'can_create', '无权限新增产品')) return

    const { name, category, unit, spec, unit_price, price_unit, stock, min_stock, is_test } = request.body
    const cleanName = String(name || '').trim()
    const cleanSpec = String(spec || '').trim()
    const cleanUnit = String(unit || '桶').trim() || '桶'
    const cleanStock = toNumber(stock)
    if (!cleanName) {
      return { success: false, message: '产品名称不能为空' }
    }
    const duplicate = findDuplicateProduct(db, { name: cleanName, spec: cleanSpec, unit: cleanUnit })
    if (duplicate) {
      return { success: false, message: `已存在「${displayProductSku(duplicate)}」，请直接调整已有库存，不要重复新增` }
    }

    const tx = db.transaction(() => {
      const result = db.prepare(
        'INSERT INTO products (name, category, unit, spec, unit_price, price_unit, stock, min_stock, is_test) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(cleanName, category || null, cleanUnit, cleanSpec, toNumber(unit_price), price_unit || cleanUnit, cleanStock, toNumber(min_stock), boolFlag(is_test))
      if (cleanStock > 0) {
        recordInventoryMovement(db, {
          product_id: result.lastInsertRowid,
          movement_type: 'initial',
          quantity_delta: cleanStock,
          quantity_before: 0,
          quantity_after: cleanStock,
          unit: cleanUnit,
          reason: '初始入库',
          note: '新增产品时录入库存',
          created_by: request.user.userId
        })
      }
      return result.lastInsertRowid
    })

    return { success: true, id: tx() }
  })

  // 更新产品
  server.put('/api/products/:id', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireModuleAccess(db, request, reply, 'products', 'can_edit', '无权限编辑产品')) return

    const { name, category, unit, spec, unit_price, price_unit, stock, min_stock, is_test } = request.body
    const cleanName = String(name || '').trim()
    const cleanSpec = String(spec || '').trim()
    const cleanUnit = String(unit || '桶').trim() || '桶'
    const cleanStock = toNumber(stock)
    if (!cleanName) {
      return { success: false, message: '产品名称不能为空' }
    }
    const current = db.prepare('SELECT * FROM products WHERE id = ?').get(request.params.id)
    if (!current) {
      reply.code(404).send({ success: false, message: '产品不存在' })
      return
    }
    const duplicate = findDuplicateProduct(db, { name: cleanName, spec: cleanSpec, unit: cleanUnit, excludeId: request.params.id })
    if (duplicate) {
      return { success: false, message: `已存在「${displayProductSku(duplicate)}」，不能改成重复库存项` }
    }
    const tx = db.transaction(() => {
      const result = db.prepare(
        `UPDATE products
         SET name = ?, category = ?, unit = ?, spec = ?, unit_price = ?, price_unit = ?,
             stock = ?, min_stock = ?, is_test = ?, updated_at = datetime('now', 'localtime')
         WHERE id = ?`
      ).run(cleanName, category, cleanUnit, cleanSpec, toNumber(unit_price), price_unit || cleanUnit, cleanStock, toNumber(min_stock), boolFlag(is_test), request.params.id)
      const before = toNumber(current.stock)
      const delta = roundQty(cleanStock - before)
      if (delta !== 0) {
        recordInventoryMovement(db, {
          product_id: current.id,
          movement_type: 'adjust',
          quantity_delta: delta,
          quantity_before: before,
          quantity_after: cleanStock,
          unit: cleanUnit,
          reason: '手动调整库存',
          note: `从 ${formatQty(before)} 调整为 ${formatQty(cleanStock)}`,
          created_by: request.user.userId
        })
      }
      return result.changes
    })
    tx()

    return { success: true }
  })

  server.post('/api/products/:id/stock-adjustment', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireModuleAccess(db, request, reply, 'products', 'can_edit', '无权限调整库存')) return

    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(request.params.id)
    if (!product) return reply.code(404).send({ success: false, message: '产品不存在' })
    const quantity = toNumber(request.body?.quantity)
    const direction = String(request.body?.direction || '').trim()
    const note = String(request.body?.note || '').trim()
    if (!quantity) return { success: false, message: '调整数量必须大于 0' }
    if (!['in', 'out'].includes(direction)) return { success: false, message: '请选择入库或扣减' }
    const delta = direction === 'in' ? quantity : -quantity
    const before = toNumber(product.stock)
    const after = roundQty(before + delta)
    if (after < 0) return { success: false, message: `库存不足，当前 ${formatQty(before)}，不能扣减 ${formatQty(quantity)}` }

    const tx = db.transaction(() => {
      db.prepare('UPDATE products SET stock = ?, updated_at = datetime(\'now\', \'localtime\') WHERE id = ?')
        .run(after, product.id)
      recordInventoryMovement(db, {
        product_id: product.id,
        movement_type: direction === 'in' ? 'manual_in' : 'manual_out',
        quantity_delta: delta,
        quantity_before: before,
        quantity_after: after,
        unit: product.unit || '',
        reason: direction === 'in' ? '手动入库' : '手动扣减',
        note,
        created_by: request.user.userId
      })
    })
    tx()
    return { success: true, stock: after }
  })

  server.get('/api/products/:id/movements', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireModuleAccess(db, request, reply, 'products', 'can_view', '无权限查看库存流水')) return

    const productId = Number(request.params.id)
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId)
    if (!product) return reply.code(404).send({ success: false, message: '产品不存在' })
    const rows = db.prepare(`
      SELECT im.*, p.name as product_name, p.spec as product_spec, p.unit as product_unit,
             pr.name as project_name, u.username as operator_username, u.real_name as operator_real_name
      FROM inventory_movements im
      LEFT JOIN products p ON im.product_id = p.id
      LEFT JOIN projects pr ON im.project_id = pr.id
      LEFT JOIN users u ON im.created_by = u.id
      WHERE im.product_id = ?
      ORDER BY im.id DESC
      LIMIT 200
    `).all(productId)
    return {
      success: true,
      data: rows.map(formatMovement)
    }
  })

  server.get('/api/inventory-movements', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireModuleAccess(db, request, reply, 'products', 'can_view', '无权限查看库存流水')) return

    const rows = db.prepare(`
      SELECT im.*, p.name as product_name, p.spec as product_spec, p.unit as product_unit,
             pr.name as project_name, u.username as operator_username, u.real_name as operator_real_name
      FROM inventory_movements im
      LEFT JOIN products p ON im.product_id = p.id
      LEFT JOIN projects pr ON im.project_id = pr.id
      LEFT JOIN users u ON im.created_by = u.id
      ORDER BY im.id DESC
      LIMIT 300
    `).all()
    return { success: true, data: rows.map(formatMovement) }
  })

  // 删除产品
  server.delete('/api/products/:id', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireModuleAccess(db, request, reply, 'products', 'can_delete', '无权限删除产品')) return

    const result = db.prepare('DELETE FROM products WHERE id = ?').run(request.params.id)
    if (result.changes === 0) {
      reply.code(404).send({ success: false, message: '产品不存在' })
      return
    }
    return { success: true }
  })
}

function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function boolFlag(value) {
  return value === true || value === 1 || value === '1' ? 1 : 0
}

function roundQty(value) {
  const n = Number(value || 0)
  return Number.isFinite(n) ? Math.round(n * 10000) / 10000 : 0
}

function findDuplicateProduct(db, { name, spec, unit, excludeId = 0 }) {
  const rows = db.prepare('SELECT id, name, spec, unit FROM products').all()
  const target = skuKey({ name, spec, unit })
  return rows.find(row => Number(row.id) !== Number(excludeId || 0) && skuKey(row) === target) || null
}

function skuKey(item) {
  return [item.name, item.spec, item.unit].map(value => String(value || '').trim().toLowerCase()).join('|')
}

function displayProductSku(item) {
  const name = String(item?.name || '').trim()
  const spec = String(item?.spec || '').trim()
  const unit = String(item?.unit || '').trim()
  return `${name}${spec && !name.includes(spec) ? spec : ''}${unit ? `｜${unit}` : ''}`
}

function displayProductName(item) {
  const name = String(item?.name || '').trim()
  const spec = String(item?.spec || '').trim()
  if (!spec || name.includes(spec)) return name
  return `${name}${spec}`
}

function formatQty(value) {
  const n = Number(value || 0)
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

function recordInventoryMovement(db, movement) {
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

function formatMovement(row) {
  return {
    ...row,
    movement_label: {
      initial: '初始入库',
      adjust: '库存调整',
      manual_in: '手动入库',
      manual_out: '手动扣减',
      out: '项目出库',
      return: '项目回库',
      loss: '损耗记录'
    }[row.movement_type] || row.movement_type,
    product_display_name: displayProductName({ name: row.product_name, spec: row.product_spec }),
    operator_name: row.operator_real_name || row.operator_username || ''
  }
}
