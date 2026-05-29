import { authMiddleware } from '../middleware/auth.js'

export default function chatRoutes(server, db) {
  // 获取会话列表（带最后一条消息）
  server.get('/api/conversations', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return

    const userId = request.user.userId
    const list = db.prepare(`
      SELECT c.*,
        (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) as last_message,
        (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) as last_time,
        (SELECT COUNT(*) FROM conversation_participants WHERE conversation_id = c.id) as member_count
      FROM conversations c
      WHERE c.id IN (SELECT conversation_id FROM conversation_participants WHERE user_id = ?)
      ORDER BY last_time DESC
    `).all(userId)

    // 补充私聊的对方信息
    const enriched = list.map(c => {
      if (c.type === 'private') {
        const other = db.prepare(`
          SELECT u.id, u.username, u.avatar_url, r.label as role_label
          FROM conversation_participants cp
          JOIN users u ON cp.user_id = u.id
          LEFT JOIN roles r ON u.role = r.name
          WHERE cp.conversation_id = ? AND cp.user_id != ?
        `).get(c.id, userId)
        return { ...c, other_user: other || null }
      }
      return c
    })

    return { success: true, data: enriched }
  })

  // 创建会话
  server.post('/api/conversations', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return

    const { type, name, participant_ids } = request.body
    const creatorId = request.user.userId

    if (type === 'private') {
      const otherId = participant_ids?.[0]
      if (!otherId) return { success: false, message: '请选择聊天对象' }

      // 检查是否已有私聊
      const existing = db.prepare(`
        SELECT c.id FROM conversations c
        WHERE c.type = 'private'
        AND (SELECT COUNT(*) FROM conversation_participants WHERE conversation_id = c.id) = 2
        AND EXISTS (SELECT 1 FROM conversation_participants WHERE conversation_id = c.id AND user_id = ?)
        AND EXISTS (SELECT 1 FROM conversation_participants WHERE conversation_id = c.id AND user_id = ?)
      `).get(creatorId, otherId)

      if (existing) return { success: true, id: existing.id, exists: true }

      const result = db.prepare('INSERT INTO conversations (type, created_by) VALUES (?, ?)').run('private', creatorId)
      const convId = result.lastInsertRowid
      db.prepare('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)').run(convId, creatorId)
      db.prepare('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)').run(convId, otherId)
      return { success: true, id: convId }
    }

    if (type === 'group') {
      if (!name) return { success: false, message: '群聊名称不能为空' }
      if (!participant_ids?.length) return { success: false, message: '请选择成员' }

      const result = db.prepare('INSERT INTO conversations (type, name, created_by) VALUES (?, ?, ?)').run('group', name, creatorId)
      const convId = result.lastInsertRowid
      db.prepare('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)').run(convId, creatorId)
      const ids = [...new Set([creatorId, ...participant_ids])]
      const stmt = db.prepare('INSERT OR IGNORE INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)')
      for (const uid of ids) stmt.run(convId, uid)
      return { success: true, id: convId }
    }
  })

  // 获取会话消息
  server.get('/api/conversations/:id/messages', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return

    const userId = request.user.userId
    const convId = request.params.id

    // 检查是否有权限
    const isMember = db.prepare('SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?').get(convId, userId)
    if (!isMember) {
      reply.code(403).send({ success: false, message: '不在该会话中' })
      return
    }

    const messages = db.prepare(`
      SELECT m.*, u.username, u.avatar_url
      FROM messages m
      JOIN users u ON m.user_id = u.id
      WHERE m.conversation_id = ?
      ORDER BY m.id ASC
      LIMIT 100
    `).all(convId)

    return { success: true, data: messages }
  })

  // 获取用户列表（用于选择聊天对象）
  server.get('/api/users/chat', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return

    const users = db.prepare(`
      SELECT u.id, u.username, r.label as role_label
      FROM users u
      LEFT JOIN roles r ON u.role = r.name
      WHERE u.role != 'ai'
      ORDER BY u.id ASC
    `).all()

    return { success: true, data: users }
  })
}
