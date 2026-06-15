import { authMiddleware } from '../middleware/auth.js'
import { requireAssignedAccount } from '../utils/permissions.js'
import { fileURLToPath } from 'url'
import { dirname, extname, join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
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
        (SELECT CASE WHEN message_type = 'file' THEN '[文件] ' || content ELSE content END FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) as last_message,
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
        f.original_name as file_name,
        f.mime_type as file_mime_type,
        f.size as file_size
      FROM messages m
      JOIN users u ON m.user_id = u.id
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

    db.prepare('UPDATE chat_files SET message_id = ? WHERE id = ?').run(messageResult.lastInsertRowid, fileResult.lastInsertRowid)

    const msg = db.prepare(`
      SELECT m.*, u.username, u.avatar_url,
        f.original_name as file_name,
        f.mime_type as file_mime_type,
        f.size as file_size
      FROM messages m
      JOIN users u ON m.user_id = u.id
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
      SELECT u.id, u.username, r.label as role_label
      FROM users u
      LEFT JOIN roles r ON u.role = r.name
      WHERE u.role != 'ai'
      ORDER BY u.id ASC
    `).all()

    return { success: true, data: users }
  })
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
