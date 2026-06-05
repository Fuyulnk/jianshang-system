import { authMiddleware } from '../middleware/auth.js'
import { requireModuleAccess } from '../utils/permissions.js'

export default function productRoutes(server, db) {
  // 获取产品列表
  server.get('/api/products', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireModuleAccess(db, request, reply, 'products', 'can_view', '无权限查看产品库存')) return

    const products = db.prepare('SELECT * FROM products ORDER BY id ASC').all()
    return { success: true, data: products }
  })

  // 新增产品
  server.post('/api/products', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireModuleAccess(db, request, reply, 'products', 'can_create', '无权限新增产品')) return

    const { name, category, unit, spec, unit_price, price_unit, stock, min_stock } = request.body
    if (!name) {
      return { success: false, message: '产品名称不能为空' }
    }

    const result = db.prepare(
      'INSERT INTO products (name, category, unit, spec, unit_price, price_unit, stock, min_stock) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(name, category || null, unit || 'kg', spec || '', toNumber(unit_price), price_unit || unit || 'kg', toNumber(stock), toNumber(min_stock))

    return { success: true, id: result.lastInsertRowid }
  })

  // 更新产品
  server.put('/api/products/:id', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireModuleAccess(db, request, reply, 'products', 'can_edit', '无权限编辑产品')) return

    const { name, category, unit, spec, unit_price, price_unit, stock, min_stock } = request.body
    if (!String(name || '').trim()) {
      return { success: false, message: '产品名称不能为空' }
    }
    const result = db.prepare(
      `UPDATE products SET name = ?, category = ?, unit = ?, spec = ?, unit_price = ?, price_unit = ?, stock = ?, min_stock = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(String(name).trim(), category, unit, spec || '', toNumber(unit_price), price_unit || unit || 'kg', toNumber(stock), toNumber(min_stock), request.params.id)
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
