import { authMiddleware } from '../middleware/auth.js'

function requireAdmin(request, reply) {
  if (authMiddleware(request, reply) === false) return false
  if (request.user.role !== 'admin' && request.user.role !== 'super_admin') {
    reply.code(403).send({ success: false, message: '无权限，仅管理员可操作' })
    return false
  }
  return true
}

export default function accountRoutes(server, db) {
  // 获取账户列表 — 登录用户均可查看
  server.get('/api/accounts', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return

    const accounts = db.prepare('SELECT * FROM accounts ORDER BY id ASC').all()
    return { success: true, data: accounts }
  })

  // 获取单个账户 — 登录用户均可查看
  server.get('/api/accounts/:id', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return

    const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(request.params.id)
    if (!account) {
      reply.code(404).send({ success: false, message: '账户不存在' })
      return
    }
    return { success: true, data: account }
  })

  // 新增账户 — 仅管理员
  server.post('/api/accounts', async (request, reply) => {
    if (!requireAdmin(request, reply)) return

    const { name, type } = request.body
    if (!name) {
      return { success: false, message: '账户名称不能为空' }
    }

    const result = db.prepare(
      'INSERT INTO accounts (name, type) VALUES (?, ?)'
    ).run(name, type || 'personal')

    return { success: true, id: result.lastInsertRowid }
  })

  // 更新账户 — 仅管理员
  server.put('/api/accounts/:id', async (request, reply) => {
    if (!requireAdmin(request, reply)) return

    const { name, type } = request.body
    db.prepare(
      "UPDATE accounts SET name = ?, type = ?, updated_at = datetime('now', 'localtime') WHERE id = ?"
    ).run(name, type, request.params.id)

    return { success: true }
  })

  // 删除账户 — 仅管理员
  server.delete('/api/accounts/:id', async (request, reply) => {
    if (!requireAdmin(request, reply)) return

    db.prepare('DELETE FROM accounts WHERE id = ?').run(request.params.id)
    return { success: true }
  })
}
