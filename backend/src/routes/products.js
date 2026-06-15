import { authMiddleware } from '../middleware/auth.js'
import { requireModuleAccess } from '../utils/permissions.js'

export default function productRoutes(server, db) {
  // 获取产品列表
  server.get('/api/products', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireModuleAccess(db, request, reply, 'products', 'can_view', '无权限查看产品库存')) return

    const products = db.prepare('SELECT * FROM products ORDER BY name ASC, spec ASC, id ASC').all()
    return { success: true, data: products.map(enrichProductSku) }
  })

  // 新增产品
  server.post('/api/products', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireModuleAccess(db, request, reply, 'products', 'can_create', '无权限新增产品')) return

    const { name, category, unit, spec, unit_price, price_unit, stock, min_stock } = request.body
    const cleanName = String(name || '').trim()
    const cleanSpec = String(spec || '').trim()
    const cleanUnit = String(unit || '桶').trim() || '桶'
    if (!cleanName) {
      return { success: false, message: '产品名称不能为空' }
    }
    const duplicate = findDuplicateProduct(db, { name: cleanName, spec: cleanSpec, unit: cleanUnit })
    if (duplicate) {
      return { success: false, message: `已存在「${displayProductSku(duplicate)}」，请直接调整已有库存，不要重复新增` }
    }

    const result = db.prepare(
      'INSERT INTO products (name, category, unit, spec, unit_price, price_unit, stock, min_stock) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(cleanName, category || null, cleanUnit, cleanSpec, toNumber(unit_price), price_unit || cleanUnit, toNumber(stock), toNumber(min_stock))

    return { success: true, id: result.lastInsertRowid }
  })

  // 更新产品
  server.put('/api/products/:id', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireModuleAccess(db, request, reply, 'products', 'can_edit', '无权限编辑产品')) return

    const { name, category, unit, spec, unit_price, price_unit, stock, min_stock } = request.body
    const cleanName = String(name || '').trim()
    const cleanSpec = String(spec || '').trim()
    const cleanUnit = String(unit || '桶').trim() || '桶'
    if (!cleanName) {
      return { success: false, message: '产品名称不能为空' }
    }
    const duplicate = findDuplicateProduct(db, { name: cleanName, spec: cleanSpec, unit: cleanUnit, excludeId: request.params.id })
    if (duplicate) {
      return { success: false, message: `已存在「${displayProductSku(duplicate)}」，不能改成重复库存项` }
    }
    const result = db.prepare(
      `UPDATE products SET name = ?, category = ?, unit = ?, spec = ?, unit_price = ?, price_unit = ?, stock = ?, min_stock = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(cleanName, category, cleanUnit, cleanSpec, toNumber(unit_price), price_unit || cleanUnit, toNumber(stock), toNumber(min_stock), request.params.id)
    if (result.changes === 0) {
      reply.code(404).send({ success: false, message: '产品不存在' })
      return
    }

    return { success: true }
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

function enrichProductSku(item) {
  const displayName = displayProductName(item)
  const unit = String(item?.unit || '').trim()
  const stock = Number(item?.stock || 0)
  const skuLabel = `${displayName}${unit ? `｜${unit}` : ''}｜${formatQty(stock)}`
  return {
    ...item,
    display_name: displayName,
    sku_label: skuLabel,
    search_text: [displayName, item.name, item.spec, item.category, item.unit, skuLabel]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
  }
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
