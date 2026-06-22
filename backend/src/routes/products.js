import { authMiddleware } from '../middleware/auth.js'
import { requireModuleAccess } from '../utils/permissions.js'
import { inventoryFacts } from '../services/businessFacts.js'
import {
  cleanText,
  ensureProductCategory,
  ensureWarehouseLocation,
  listWarehouseOptions,
  normalizeWarehouseCode,
  upsertProductAliases
} from '../services/warehouseCatalog.js'
import * as XLSX from 'xlsx'

export default function productRoutes(server, db) {
  // 获取产品列表
  server.get('/api/products', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireModuleAccess(db, request, reply, 'products', 'can_view', '无权限查看产品库存')) return

    return inventoryFacts(db, request.user, request.query)
  })

  server.get('/api/warehouse/options', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireModuleAccess(db, request, reply, 'products', 'can_view', '无权限查看仓库选项')) return

    return { success: true, data: listWarehouseOptions(db) }
  })

  // 新增产品
  server.post('/api/products', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireModuleAccess(db, request, reply, 'products', 'can_create', '无权限新增产品')) return

    const { name, category, unit, spec, warehouse_code, unit_price, price_unit, stock, min_stock, is_test, aliases } = request.body
    const cleanName = String(name || '').trim()
    const cleanSpec = String(spec || '').trim()
    const cleanWarehouseCode = normalizeWarehouseCode(warehouse_code)
    const cleanUnit = String(unit || '桶').trim() || '桶'
    const cleanCategory = cleanText(category)
    const cleanStock = toNumber(stock)
    if (!cleanName) {
      return { success: false, message: '产品名称不能为空' }
    }
    const duplicate = findDuplicateProduct(db, { name: cleanName, spec: cleanSpec, unit: cleanUnit })
    if (duplicate) {
      return { success: false, message: `已存在「${displayProductSku(duplicate)}」，请直接调整已有库存，不要重复新增` }
    }

    const tx = db.transaction(() => {
      const categoryId = ensureProductCategory(db, cleanCategory)
      const locationId = ensureWarehouseLocation(db, cleanWarehouseCode, { category_hint: cleanCategory })
      const result = db.prepare(
        `INSERT INTO products (
          name, category, category_id, unit, spec, warehouse_code, location_id,
          unit_price, price_unit, stock, min_stock, is_test
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(cleanName, cleanCategory || null, categoryId, cleanUnit, cleanSpec, cleanWarehouseCode, locationId, toNumber(unit_price), price_unit || cleanUnit, cleanStock, toNumber(min_stock), boolFlag(is_test))
      upsertProductAliases(db, result.lastInsertRowid, aliases)
      if (locationId && cleanStock > 0) {
        upsertProductLocationBalance(db, result.lastInsertRowid, locationId, cleanStock, toNumber(min_stock), 1)
      }
      if (cleanStock > 0) {
        recordInventoryMovement(db, {
          product_id: result.lastInsertRowid,
          location_id: locationId,
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

    const { name, category, unit, spec, warehouse_code, unit_price, price_unit, stock, min_stock, is_test, aliases } = request.body
    const cleanName = String(name || '').trim()
    const cleanSpec = String(spec || '').trim()
    const cleanWarehouseCode = normalizeWarehouseCode(warehouse_code)
    const cleanUnit = String(unit || '桶').trim() || '桶'
    const cleanCategory = cleanText(category)
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
      const categoryId = ensureProductCategory(db, cleanCategory)
      const locationId = ensureWarehouseLocation(db, cleanWarehouseCode, { category_hint: cleanCategory })
      const result = db.prepare(
        `UPDATE products
         SET name = ?, category = ?, category_id = ?, unit = ?, spec = ?, warehouse_code = ?, location_id = ?, unit_price = ?, price_unit = ?,
             stock = ?, min_stock = ?, is_test = ?, updated_at = datetime('now', 'localtime')
         WHERE id = ?`
      ).run(cleanName, cleanCategory, categoryId, cleanUnit, cleanSpec, cleanWarehouseCode, locationId, toNumber(unit_price), price_unit || cleanUnit, cleanStock, toNumber(min_stock), boolFlag(is_test), request.params.id)
      upsertProductAliases(db, current.id, aliases)
      if (locationId) upsertProductLocationBalance(db, current.id, locationId, cleanStock, toNumber(min_stock), 1)
      const before = toNumber(current.stock)
      const delta = roundQty(cleanStock - before)
      if (delta !== 0) {
        recordInventoryMovement(db, {
          product_id: current.id,
          location_id: locationId,
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
        location_id: product.location_id || 0,
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
             wl.code as location_code, wl.label as location_label,
             pr.name as project_name, u.username as operator_username, u.real_name as operator_real_name
      FROM inventory_movements im
      LEFT JOIN products p ON im.product_id = p.id
      LEFT JOIN warehouse_locations wl ON im.location_id = wl.id
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
             wl.code as location_code, wl.label as location_label,
             pr.name as project_name, u.username as operator_username, u.real_name as operator_real_name
      FROM inventory_movements im
      LEFT JOIN products p ON im.product_id = p.id
      LEFT JOIN warehouse_locations wl ON im.location_id = wl.id
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

  server.post('/api/stocktaking/import-draft', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireModuleAccess(db, request, reply, 'products', 'can_edit', '无权限导入仓库盘点')) return

    const rows = parseStocktakingRows(request.body || {})
    if (!rows.length) return { success: false, message: '没有识别到盘点明细' }
    const title = cleanText(request.body?.title) || '仓库盘点草稿'
    const sourceFileName = cleanText(request.body?.file_name)
    const batchNo = `PD-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${Date.now().toString().slice(-6)}`
    const tx = db.transaction(() => {
      const batch = db.prepare(`
        INSERT INTO stocktaking_batches (batch_no, title, source_file_name, created_by)
        VALUES (?, ?, ?, ?)
      `).run(batchNo, title, sourceFileName, request.user.userId)
      const stmt = db.prepare(`
        INSERT INTO stocktaking_items (
          batch_id, product_id, product_name, category, spec, warehouse_code,
          unit, book_quantity, actual_quantity, difference_quantity,
          min_stock, unit_price, note, row_index, match_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      rows.forEach((row, index) => {
        const match = matchStocktakingProduct(db, row)
        const isAmbiguous = match?.match_status === 'ambiguous'
        const matchedProductId = match && !isAmbiguous ? match.id : 0
        const matchStatus = isAmbiguous ? 'ambiguous' : match ? 'matched' : 'unmatched'
        const book = matchedProductId ? toNumber(match.stock) : 0
        const note = isAmbiguous
          ? [row.note, `存在 ${match.match_count || 2} 个相似产品，请手动指定后再确认`].filter(Boolean).join('；')
          : row.note
        const actual = toNumber(row.actual_quantity)
        stmt.run(
          batch.lastInsertRowid,
          matchedProductId,
          row.product_name,
          row.category,
          row.spec,
          row.warehouse_code,
          row.unit,
          book,
          actual,
          roundQty(actual - book),
          toNumber(row.min_stock),
          toNumber(row.unit_price),
          note,
          index + 1,
          matchStatus
        )
      })
      return batch.lastInsertRowid
    })
    const id = tx()
    return { success: true, id, batch_no: batchNo, data: getStocktakingBatch(db, id) }
  })

  server.get('/api/stocktaking/batches/:id', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireModuleAccess(db, request, reply, 'products', 'can_view', '无权限查看仓库盘点')) return

    const data = getStocktakingBatch(db, request.params.id)
    if (!data) return reply.code(404).send({ success: false, message: '盘点批次不存在' })
    return { success: true, data }
  })

  server.post('/api/stocktaking/batches/:id/confirm', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireModuleAccess(db, request, reply, 'products', 'can_edit', '无权限确认仓库盘点')) return

    const batch = db.prepare('SELECT * FROM stocktaking_batches WHERE id = ?').get(request.params.id)
    if (!batch) return reply.code(404).send({ success: false, message: '盘点批次不存在' })
    if (batch.status === 'confirmed') return { success: false, message: '该盘点批次已确认' }
    const items = db.prepare('SELECT * FROM stocktaking_items WHERE batch_id = ? ORDER BY row_index ASC').all(batch.id)
    const ambiguous = items.filter(item => item.match_status === 'ambiguous')
    if (ambiguous.length) return { success: false, message: `还有 ${ambiguous.length} 条盘点明细存在歧义，请先手动指定产品` }
    const unmatched = items.filter(item => !toNumber(item.product_id))
    if (unmatched.length) return { success: false, message: `还有 ${unmatched.length} 条盘点明细未匹配产品，请先处理` }

    const tx = db.transaction(() => {
      for (const item of items) {
        const product = db.prepare('SELECT * FROM products WHERE id = ?').get(item.product_id)
        if (!product) throw new Error(`产品 ${item.product_id} 不存在`)
        const before = toNumber(product.stock)
        const after = toNumber(item.actual_quantity)
        const delta = roundQty(after - before)
        const nextMinStock = item.min_stock === null || item.min_stock === undefined || item.min_stock === ''
          ? product.min_stock
          : toNumber(item.min_stock)
        db.prepare('UPDATE products SET stock = ?, min_stock = ?, updated_at = datetime(\'now\', \'localtime\') WHERE id = ?').run(after, nextMinStock, product.id)
        if (product.location_id) upsertProductLocationBalance(db, product.id, product.location_id, after, nextMinStock, 1)
        if (delta === 0) continue
        recordInventoryMovement(db, {
          product_id: product.id,
          location_id: product.location_id || 0,
          stocktaking_batch_id: batch.id,
          movement_type: 'stocktaking_adjust',
          quantity_delta: delta,
          quantity_before: before,
          quantity_after: after,
          unit: product.unit || item.unit || '',
          reason: '盘点调整',
          note: `盘点批次 ${batch.batch_no}`,
          created_by: request.user.userId
        })
      }
      db.prepare("UPDATE stocktaking_batches SET status = 'confirmed', confirmed_by = ?, confirmed_at = datetime('now', 'localtime') WHERE id = ?")
        .run(request.user.userId, batch.id)
    })
    tx()
    return { success: true, data: getStocktakingBatch(db, batch.id) }
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
      quantity_delta, quantity_before, quantity_after, unit, reason, note, created_by,
      location_id, stocktaking_batch_id, reference_type, reference_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    movement.created_by || 0,
    movement.location_id || 0,
    movement.stocktaking_batch_id || 0,
    movement.reference_type || '',
    movement.reference_id || 0
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
    location_display: row.location_label || row.location_code || '',
    operator_name: row.operator_real_name || row.operator_username || ''
  }
}

function upsertProductLocationBalance(db, productId, locationId, quantity, minStock = 0, isPrimary = 0) {
  db.prepare(`
    INSERT INTO product_location_balances (product_id, location_id, quantity, min_stock, is_primary)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(product_id, location_id) DO UPDATE SET
      quantity = excluded.quantity,
      min_stock = excluded.min_stock,
      is_primary = excluded.is_primary,
      updated_at = datetime('now', 'localtime')
  `).run(productId, locationId, roundQty(quantity), roundQty(minStock), boolFlag(isPrimary))
}

function parseStocktakingRows(body) {
  if (Array.isArray(body.rows)) return normalizeStocktakingRows(body.rows)
  if (!body.file_data) return []
  const buffer = decodeDataUrl(body.file_data)
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, cellNF: true })
  const rows = []
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })
    rows.push(...extractRowsFromMatrix(matrix))
  }
  return normalizeStocktakingRows(rows)
}

function extractRowsFromMatrix(matrix) {
  const headerIndex = matrix.findIndex(row => row.some(cell => /款式|材料|产品|名称/.test(String(cell || ''))) && row.some(cell => /库存|数量|单位|位置/.test(String(cell || ''))))
  if (headerIndex < 0) return []
  const headers = matrix[headerIndex].map(cell => cleanText(cell))
  return matrix.slice(headerIndex + 1).map((row, index) => {
    const obj = { row_index: headerIndex + index + 2 }
    headers.forEach((header, col) => { obj[header] = row[col] })
    return obj
  })
}

function normalizeStocktakingRows(rows) {
  return rows.map((row, index) => {
    const rawName = pick(row, ['产品名称', '材料名称', '款式 规格', '款式  规格', '款式规格', '名称', '产品/材料'])
    const rawSpec = pick(row, ['规格', '规格说明', '色号'])
    const productName = cleanText(rawName).replace(/\s+/g, '')
    const unit = cleanText(pick(row, ['单位', '仓库单位']))
    const stock = pick(row, ['仓库库存数量', '库存数量', '当前库存', '盘点数量', '实际库存', '数量'])
    return {
      product_name: productName,
      category: cleanText(pick(row, ['分类', '功能名称', '类别'])),
      spec: cleanText(rawSpec),
      warehouse_code: normalizeWarehouseCode(pick(row, ['仓库编码', '存放位置', '库位', '位置'])),
      unit,
      actual_quantity: toNumber(stock),
      min_stock: parseNumber(pick(row, ['阀值', '阈值', '低库存提醒', '最低库存', 'min_stock'])),
      unit_price: toNumber(pick(row, ['单价（元）', '单价', '参考单价'])),
      note: cleanText(pick(row, ['备注', '说明'])),
      row_index: toNumber(row.row_index) || index + 1
    }
  }).filter(row => row.product_name && row.unit)
}

function matchStocktakingProduct(db, row) {
  const byNameSpecUnit = db.prepare(`
    SELECT * FROM products
    WHERE name = ? AND COALESCE(spec, '') = ? AND unit = ?
    ORDER BY id ASC LIMIT 1
  `).get(row.product_name, row.spec || '', row.unit || '')
  if (byNameSpecUnit) return byNameSpecUnit
  const byDisplay = db.prepare(`
    SELECT * FROM products
    WHERE (name || COALESCE(spec, '')) = ? AND unit = ?
    ORDER BY id ASC LIMIT 1
  `).get(row.product_name, row.unit || '')
  if (byDisplay) return byDisplay
  const aliasMatches = db.prepare(`
    SELECT p.*
    FROM products p
    JOIN product_aliases a ON a.product_id = p.id
    WHERE a.alias = ?
    ORDER BY p.id ASC
  `).all(row.product_name)
  if (!aliasMatches.length) return null
  if (aliasMatches.length > 1) {
    return { ...aliasMatches[0], match_status: 'ambiguous', match_count: aliasMatches.length }
  }
  return aliasMatches[0]
}

function getStocktakingBatch(db, id) {
  const batch = db.prepare('SELECT * FROM stocktaking_batches WHERE id = ?').get(id)
  if (!batch) return null
  const items = db.prepare(`
    SELECT si.*, p.name as matched_product_name, p.spec as matched_product_spec, p.unit as matched_product_unit
    FROM stocktaking_items si
    LEFT JOIN products p ON p.id = si.product_id
    WHERE si.batch_id = ?
    ORDER BY si.row_index ASC, si.id ASC
  `).all(batch.id)
  return {
    ...batch,
    items,
    metrics: {
      total: items.length,
      matched: items.filter(item => item.match_status === 'matched').length,
      unmatched: items.filter(item => item.match_status !== 'matched').length,
      diff_count: items.filter(item => Number(item.difference_quantity || 0) !== 0).length
    }
  }
}

function pick(row, names) {
  for (const name of names) {
    if (row?.[name] !== undefined && row?.[name] !== null && String(row[name]).trim() !== '') return row[name]
  }
  return ''
}

function decodeDataUrl(value) {
  const text = String(value || '')
  const base64 = text.includes(',') ? text.split(',').pop() : text
  return Buffer.from(base64, 'base64')
}

function parseNumber(value) {
  const text = String(value ?? '').replace(/,/g, '')
  const match = text.match(/-?\d+(?:\.\d+)?/)
  return match ? toNumber(match[0]) : 0
}
