import { authMiddleware } from '../middleware/auth.js'
import { requireAssignedAccount } from '../utils/permissions.js'
import { fileURLToPath } from 'url'
import { dirname, extname, join } from 'path'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import crypto from 'crypto'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const CHAT_UPLOAD_DIR = join(__dirname, '../../data/chat_uploads')
const MAX_CHAT_FILE_SIZE = 8 * 1024 * 1024
const BLOCKED_EXTS = new Set(['.exe', '.sh', '.bat', '.cmd', '.app', '.dmg', '.pkg'])

const DEFAULT_GROUPS = [
  { name: '财务群', roles: ['super_admin', 'admin', 'finance'] },
  { name: '仓库群', roles: ['super_admin', 'admin', 'warehouse'] },
  { name: '工程群', roles: ['super_admin', 'admin', 'engineering', 'employee'] },
  { name: '总群', roles: ['super_admin', 'admin', 'finance', 'warehouse', 'engineering', 'employee'] },
]

export default function chatRoutes(server, db, realtime = {}) {
  // 获取会话列表（带最后一条消息）
  server.get('/api/conversations', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireAssignedAccount(request, reply, '账号等待管理员建档和岗位分配，暂不能访问聊天')) return

    const userId = request.user.userId
    ensureDefaultGroups(db)
    const list = db.prepare(`
      SELECT c.*,
        cp.is_pinned,
        cp.muted,
        cp.group_nickname,
        (SELECT CASE WHEN message_type = 'file' THEN '[文件] ' || content ELSE content END FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) as last_message,
        COALESCE((SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1), NULLIF(c.updated_at, ''), c.created_at) as last_time,
        (SELECT COUNT(DISTINCT user_id) FROM conversation_participants WHERE conversation_id = c.id) as member_count
      FROM conversations c
      JOIN conversation_participants cp ON cp.conversation_id = c.id AND cp.user_id = ?
      ORDER BY COALESCE(cp.is_pinned, 0) DESC,
        datetime(COALESCE((SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1), NULLIF(c.updated_at, ''), c.created_at)) DESC,
        c.id DESC
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
    if (!requireAssignedAccount(request, reply, '账号等待管理员建档和岗位分配，暂不能创建聊天')) return

    const { type = 'group', name, participant_ids = [] } = request.body
    const creatorId = request.user.userId

    if (type === 'private') {
      return { success: false, message: '当前系统只开放群聊，私聊入口已关闭' }
    }

    if (type === 'group') {
      if (!name) return { success: false, message: '群聊名称不能为空' }

      const result = db.prepare('INSERT INTO conversations (type, name, created_by) VALUES (?, ?, ?)').run('group', name, creatorId)
      const convId = result.lastInsertRowid
      db.prepare('INSERT INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)').run(convId, creatorId)
      const ids = [...new Set([creatorId, ...participant_ids])]
      const stmt = db.prepare('INSERT OR IGNORE INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)')
      for (const uid of ids) stmt.run(convId, uid)
      return { success: true, id: convId }
    }
  })

  // 更新群资料：群名和头像只允许管理员或群创建人修改。
  server.put('/api/conversations/:id', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireAssignedAccount(request, reply, '账号等待管理员建档和岗位分配，暂不能修改群资料')) return

    const convId = Number(request.params.id)
    const conv = getConversationForMember(db, convId, request.user.userId)
    if (!conv) return reply.code(404).send({ success: false, message: '群聊不存在或无权限' })
    if (conv.type !== 'group') return reply.code(400).send({ success: false, message: '当前只支持修改群聊资料' })
    if (!canManageConversation(conv, request.user)) return reply.code(403).send({ success: false, message: '只有管理员或群创建人可以修改群资料' })

    const name = String(request.body?.name ?? conv.name ?? '').trim().slice(0, 40)
    const avatarUrl = String(request.body?.avatar_url ?? conv.avatar_url ?? '').trim().slice(0, 500)
    if (!name) return reply.code(400).send({ success: false, message: '群聊名称不能为空' })

    db.prepare(`
      UPDATE conversations
      SET name = ?, avatar_url = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(name, avatarUrl, convId)

    const updated = db.prepare('SELECT * FROM conversations WHERE id = ?').get(convId)
    realtime.io?.to(`conv:${convId}`).emit('conversation:updated', {
      conversation_id: convId,
      name: updated.name,
      avatar_url: updated.avatar_url || ''
    })
    return { success: true, data: updated, message: '群资料已更新' }
  })

  // 当前用户在本群的个人设置：群昵称、置顶、免打扰。
  server.put('/api/conversations/:id/preferences', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireAssignedAccount(request, reply, '账号等待管理员建档和岗位分配，暂不能修改群设置')) return

    const convId = Number(request.params.id)
    const userId = Number(request.user.userId)
    const conv = getConversationForMember(db, convId, userId)
    if (!conv) return reply.code(404).send({ success: false, message: '群聊不存在或无权限' })
    if (conv.type !== 'group') return reply.code(400).send({ success: false, message: '当前只支持群聊设置' })

    const isPinned = request.body?.is_pinned ? 1 : 0
    const muted = request.body?.muted ? 1 : 0
    const groupNickname = String(request.body?.group_nickname ?? '').trim().slice(0, 30)
    db.prepare(`
      UPDATE conversation_participants
      SET is_pinned = ?, muted = ?, group_nickname = ?
      WHERE conversation_id = ? AND user_id = ?
    `).run(isPinned, muted, groupNickname, convId, userId)

    return {
      success: true,
      data: { is_pinned: isPinned, muted, group_nickname: groupNickname },
      message: '群设置已保存'
    }
  })

  // 获取群成员
  server.get('/api/conversations/:id/members', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireAssignedAccount(request, reply, '账号等待管理员建档和岗位分配，暂不能查看群成员')) return

    const convId = Number(request.params.id)
    const conv = getConversationForMember(db, convId, request.user.userId)
    if (!conv) return reply.code(404).send({ success: false, message: '群聊不存在或无权限' })
    if (conv.type !== 'group') return reply.code(400).send({ success: false, message: '当前只支持群聊成员管理' })

    const members = db.prepare(`
      SELECT u.id, u.username, u.real_name, u.department, u.position, u.avatar_url,
        r.label as role_label, cp.joined_at, cp.group_nickname,
        COALESCE(NULLIF(cp.group_nickname, ''), NULLIF(u.real_name, ''), u.username) as display_name
      FROM conversation_participants cp
      JOIN users u ON cp.user_id = u.id
      LEFT JOIN roles r ON u.role = r.name
      WHERE cp.conversation_id = ?
      ORDER BY cp.id ASC
    `).all(convId)
    const preferences = db.prepare(`
      SELECT is_pinned, muted, group_nickname
      FROM conversation_participants
      WHERE conversation_id = ? AND user_id = ?
    `).get(convId, request.user.userId) || {}

    return {
      success: true,
      data: {
        conversation: {
          id: conv.id,
          name: conv.name,
          avatar_url: conv.avatar_url || '',
          type: conv.type,
          created_by: conv.created_by,
          can_manage: canManageConversation(conv, request.user)
        },
        current_preferences: {
          is_pinned: preferences.is_pinned ? 1 : 0,
          muted: preferences.muted ? 1 : 0,
          group_nickname: preferences.group_nickname || ''
        },
        members
      }
    }
  })

  // 邀请群成员
  server.post('/api/conversations/:id/members', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireAssignedAccount(request, reply, '账号等待管理员建档和岗位分配，暂不能邀请群成员')) return

    const convId = Number(request.params.id)
    const conv = getConversationForMember(db, convId, request.user.userId)
    if (!conv) return reply.code(404).send({ success: false, message: '群聊不存在或无权限' })
    if (conv.type !== 'group') return reply.code(400).send({ success: false, message: '当前只支持群聊成员管理' })
    if (!canManageConversation(conv, request.user)) return reply.code(403).send({ success: false, message: '只有管理员或群创建人可以邀请成员' })

    const ids = Array.isArray(request.body?.user_ids) ? request.body.user_ids : []
    const userIds = [...new Set(ids.map(id => Number(id)).filter(id => Number.isInteger(id) && id > 0))]
    if (!userIds.length) return reply.code(400).send({ success: false, message: '请选择要邀请的成员' })

    const placeholders = userIds.map(() => '?').join(',')
    const users = db.prepare(`
      SELECT id FROM users
      WHERE id IN (${placeholders})
        AND role != 'ai'
        AND COALESCE(status, 'active') = 'active'
        AND COALESCE(assignment_status, 'assigned') = 'assigned'
    `).all(...userIds)
    if (!users.length) return reply.code(400).send({ success: false, message: '没有可邀请的有效账号' })

    const stmt = db.prepare('INSERT OR IGNORE INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)')
    const tx = db.transaction((rows) => {
      let added = 0
      for (const row of rows) added += stmt.run(convId, row.id).changes
      return added
    })
    const added = tx(users)
    if (added) db.prepare("UPDATE conversations SET updated_at = datetime('now', 'localtime') WHERE id = ?").run(convId)
    const memberCount = countConversationMembers(db, convId)
    realtime.io?.to(`conv:${convId}`).emit('conversation:members_changed', { conversation_id: convId, member_count: memberCount })
    return { success: true, data: { added, member_count: memberCount }, message: added ? `已邀请 ${added} 人` : '所选成员已在群里' }
  })

  // 移除群成员
  server.delete('/api/conversations/:id/members/:userId', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireAssignedAccount(request, reply, '账号等待管理员建档和岗位分配，暂不能移除群成员')) return

    const convId = Number(request.params.id)
    const targetUserId = Number(request.params.userId)
    const conv = getConversationForMember(db, convId, request.user.userId)
    if (!conv) return reply.code(404).send({ success: false, message: '群聊不存在或无权限' })
    if (conv.type !== 'group') return reply.code(400).send({ success: false, message: '当前只支持群聊成员管理' })
    if (!canManageConversation(conv, request.user)) return reply.code(403).send({ success: false, message: '只有管理员或群创建人可以移除成员' })
    if (targetUserId === request.user.userId) return reply.code(400).send({ success: false, message: '暂不支持在这里移除自己' })

    const result = db.prepare('DELETE FROM conversation_participants WHERE conversation_id = ? AND user_id = ?').run(convId, targetUserId)
    if (!result.changes) return reply.code(404).send({ success: false, message: '该成员不在群里' })

    db.prepare("UPDATE conversations SET updated_at = datetime('now', 'localtime') WHERE id = ?").run(convId)
    const memberCount = countConversationMembers(db, convId)
    realtime.io?.to(`conv:${convId}`).emit('conversation:member_removed', { conversation_id: convId, user_id: targetUserId, member_count: memberCount })
    realtime.io?.to(`conv:${convId}`).emit('conversation:members_changed', { conversation_id: convId, member_count: memberCount })
    return { success: true, data: { member_count: memberCount }, message: '已移除成员' }
  })

  // 清空群聊消息：高风险动作，仅管理员或群创建人可操作。
  server.delete('/api/conversations/:id/messages', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireAssignedAccount(request, reply, '账号等待管理员建档和岗位分配，暂不能清空群消息')) return

    const convId = Number(request.params.id)
    const conv = getConversationForMember(db, convId, request.user.userId)
    if (!conv) return reply.code(404).send({ success: false, message: '群聊不存在或无权限' })
    if (conv.type !== 'group') return reply.code(400).send({ success: false, message: '当前只支持清空群聊消息' })
    if (!canManageConversation(conv, request.user)) return reply.code(403).send({ success: false, message: '只有管理员或群创建人可以清空消息' })

    const files = db.prepare('SELECT stored_name FROM chat_files WHERE conversation_id = ?').all(convId)
    const deleted = db.transaction(() => {
      const messageChanges = db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(convId).changes
      db.prepare('DELETE FROM chat_files WHERE conversation_id = ?').run(convId)
      return messageChanges
    })()

    for (const file of files) {
      const filePath = join(CHAT_UPLOAD_DIR, file.stored_name)
      try { if (existsSync(filePath)) unlinkSync(filePath) } catch {}
    }

    realtime.io?.to(`conv:${convId}`).emit('conversation:messages_cleared', { conversation_id: convId })
    return { success: true, data: { deleted }, message: deleted ? `已清空 ${deleted} 条消息` : '群里暂无消息' }
  })

  // 获取会话消息
  server.get('/api/conversations/:id/messages', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireAssignedAccount(request, reply, '账号等待管理员建档和岗位分配，暂不能查看聊天消息')) return

    const userId = request.user.userId
    const convId = request.params.id

    // 检查是否有权限
    const isMember = db.prepare('SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?').get(convId, userId)
    if (!isMember) {
      reply.code(403).send({ success: false, message: '不在该会话中' })
      return
    }

    const messages = db.prepare(`
      SELECT m.*, u.username, u.avatar_url,
        COALESCE(NULLIF(cp.group_nickname, ''), NULLIF(u.real_name, ''), u.username) as display_name,
        f.original_name as file_name,
        f.mime_type as file_mime_type,
        f.size as file_size
      FROM messages m
      JOIN users u ON m.user_id = u.id
      LEFT JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id AND cp.user_id = m.user_id
      LEFT JOIN chat_files f ON m.file_id = f.id
      WHERE m.conversation_id = ?
      ORDER BY m.id ASC
      LIMIT 100
    `).all(convId)

    return { success: true, data: messages }
  })

  // 群聊文件上传：当前用 base64 JSON，后续统一文件中心再升级 multipart。
  server.post('/api/conversations/:id/files', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireAssignedAccount(request, reply, '账号等待管理员建档和岗位分配，暂不能上传聊天文件')) return

    const userId = request.user.userId
    const convId = Number(request.params.id)
    const isMember = db.prepare('SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?').get(convId, userId)
    if (!isMember) {
      reply.code(403).send({ success: false, message: '不在该会话中' })
      return
    }

    const conv = db.prepare('SELECT type FROM conversations WHERE id = ?').get(convId)
    if (conv?.type !== 'group') return { success: false, message: '当前只支持群聊上传文件' }

    const { name, mime_type = 'application/octet-stream', size = 0, data } = request.body || {}
    const originalName = safeFileName(name || '未命名文件')
    const ext = extname(originalName).toLowerCase()
    if (BLOCKED_EXTS.has(ext)) return { success: false, message: '该文件类型暂不支持上传' }
    if (!data || typeof data !== 'string') return { success: false, message: '请选择文件' }

    const match = data.match(/^data:([^;]+);base64,(.+)$/)
    const base64 = match ? match[2] : data
    const buffer = Buffer.from(base64, 'base64')
    if (!buffer.length) return { success: false, message: '文件内容为空' }
    if (buffer.length > MAX_CHAT_FILE_SIZE || Number(size || 0) > MAX_CHAT_FILE_SIZE) {
      return { success: false, message: '单个文件不能超过 8MB' }
    }

    ensureUploadDir()
    const storedName = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext || ''}`
    writeFileSync(join(CHAT_UPLOAD_DIR, storedName), buffer)

    const fileResult = db.prepare(`
      INSERT INTO chat_files (conversation_id, uploaded_by, original_name, stored_name, mime_type, size)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(convId, userId, originalName, storedName, mime_type, buffer.length)

    const messageResult = db.prepare(`
      INSERT INTO messages (conversation_id, user_id, content, message_type, file_id)
      VALUES (?, ?, ?, 'file', ?)
    `).run(convId, userId, originalName, fileResult.lastInsertRowid)
    db.prepare("UPDATE conversations SET updated_at = datetime('now', 'localtime') WHERE id = ?").run(convId)

    db.prepare('UPDATE chat_files SET message_id = ? WHERE id = ?').run(messageResult.lastInsertRowid, fileResult.lastInsertRowid)

    const msg = db.prepare(`
      SELECT m.*, u.username, u.avatar_url,
        COALESCE(NULLIF(cp.group_nickname, ''), NULLIF(u.real_name, ''), u.username) as display_name,
        f.original_name as file_name,
        f.mime_type as file_mime_type,
        f.size as file_size
      FROM messages m
      JOIN users u ON m.user_id = u.id
      LEFT JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id AND cp.user_id = m.user_id
      LEFT JOIN chat_files f ON m.file_id = f.id
      WHERE m.id = ?
    `).get(messageResult.lastInsertRowid)

    realtime.io?.to(`conv:${convId}`).emit('message:new', msg)
    return { success: true, data: msg }
  })

  // 群聊文件下载：必须是会话成员才能下载，避免 data 文件被路径直出。
  server.get('/api/chat/files/:id/download', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireAssignedAccount(request, reply, '账号等待管理员建档和岗位分配，暂不能下载聊天文件')) return

    const userId = request.user.userId
    const fileId = Number(request.params.id)
    const file = db.prepare(`
      SELECT f.*
      FROM chat_files f
      JOIN conversation_participants cp ON cp.conversation_id = f.conversation_id
      WHERE f.id = ? AND cp.user_id = ?
    `).get(fileId, userId)

    if (!file) {
      reply.code(404).send({ success: false, message: '文件不存在或无权限下载' })
      return
    }

    const filePath = join(CHAT_UPLOAD_DIR, file.stored_name)
    if (!existsSync(filePath)) {
      reply.code(404).send({ success: false, message: '文件已丢失' })
      return
    }

    const buffer = readFileSync(filePath)
    reply
      .header('Content-Type', file.mime_type || 'application/octet-stream')
      .header('Content-Disposition', `attachment; filename="${encodeURIComponent(file.original_name)}"; filename*=UTF-8''${encodeURIComponent(file.original_name)}`)
      .header('Content-Length', buffer.length)
      .send(buffer)
  })

  // 获取用户列表（用于选择聊天对象）
  server.get('/api/users/chat', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireAssignedAccount(request, reply, '账号等待管理员建档和岗位分配，暂不能查看聊天用户')) return

    const users = db.prepare(`
      SELECT u.id, u.username, u.real_name, u.department, u.position, r.label as role_label
      FROM users u
      LEFT JOIN roles r ON u.role = r.name
      WHERE u.role != 'ai'
        AND COALESCE(u.status, 'active') = 'active'
        AND COALESCE(u.assignment_status, 'assigned') = 'assigned'
      ORDER BY u.id ASC
    `).all()

    return { success: true, data: users }
  })
}

function getConversationForMember(db, convId, userId) {
  if (!Number.isInteger(Number(convId)) || Number(convId) <= 0) return null
  return db.prepare(`
    SELECT c.*
    FROM conversations c
    JOIN conversation_participants cp ON cp.conversation_id = c.id
    WHERE c.id = ? AND cp.user_id = ?
  `).get(Number(convId), Number(userId))
}

function canManageConversation(conv, user) {
  return ['super_admin', 'admin'].includes(user?.role) || Number(conv?.created_by || 0) === Number(user?.userId || 0)
}

function countConversationMembers(db, convId) {
  return db.prepare('SELECT COUNT(*) as count FROM conversation_participants WHERE conversation_id = ?').get(convId)?.count || 0
}

function ensureUploadDir() {
  if (!existsSync(CHAT_UPLOAD_DIR)) mkdirSync(CHAT_UPLOAD_DIR, { recursive: true })
}

function safeFileName(name) {
  return String(name)
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || '未命名文件'
}

function ensureDefaultGroups(db) {
  const findGroup = db.prepare("SELECT id FROM conversations WHERE type = 'group' AND name = ?")
  const createGroup = db.prepare("INSERT INTO conversations (type, name, created_by) VALUES ('group', ?, ?)")
  const addMember = db.prepare('INSERT OR IGNORE INTO conversation_participants (conversation_id, user_id) VALUES (?, ?)')
  const firstAdmin = db.prepare("SELECT id FROM users WHERE role IN ('super_admin', 'admin') ORDER BY id ASC LIMIT 1").get()

  for (const group of DEFAULT_GROUPS) {
    let row = findGroup.get(group.name)
    if (!row) {
      const creator = firstAdmin?.id || db.prepare('SELECT id FROM users ORDER BY id ASC LIMIT 1').get()?.id || 0
      row = { id: createGroup.run(group.name, creator).lastInsertRowid }
    }
    const placeholders = group.roles.map(() => '?').join(',')
    const users = db.prepare(`SELECT id FROM users WHERE role IN (${placeholders})`).all(...group.roles)
    for (const user of users) addMember.run(row.id, user.id)
  }
}
