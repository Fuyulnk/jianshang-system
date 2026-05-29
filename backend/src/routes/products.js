import { authMiddleware } from '../middleware/auth.js'

export default function productRoutes(server, db) {
  // 获取产品列表
  server.get('/api/products', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return

    const products = db.prepare('SELECT * FROM products ORDER BY id ASC').all()
    return { success: true, data: products }
  })

  // 新增产品
  server.post('/api/products', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return

    const { name, category, unit, stock, min_stock } = request.body
    if (!name) {
      return { success: false, message: '产品名称不能为空' }
    }

    const result = db.prepare(
      'INSERT INTO products (name, category, unit, stock, min_stock) VALUES (?, ?, ?, ?, ?)'
    ).run(name, category || null, unit || 'kg', stock || 0, min_stock || 0)

    return { success: true, id: result.lastInsertRowid }
  })

  // 更新产品
  server.put('/api/products/:id', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return

    const { name, category, unit, stock, min_stock } = request.body
    db.prepare(
      `UPDATE products SET name = ?, category = ?, unit = ?, stock = ?, min_stock = ?, updated_at = datetime('now', 'localtime') WHERE id = ?`
    ).run(name, category, unit, stock, min_stock, request.params.id)

    return { success: true }
  })

  // 删除产品
  server.delete('/api/products/:id', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return

    db.prepare('DELETE FROM products WHERE id = ?').run(request.params.id)
    return { success: true }
  })
}
