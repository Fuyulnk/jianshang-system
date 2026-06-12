import { authMiddleware } from '../middleware/auth.js'
import { canAccessModule, canAccessPrivateResource, canAccessProjectRecord, logAccessAudit } from '../utils/permissions.js'
import { fileURLToPath } from 'url'
import { dirname, extname, join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import crypto from 'crypto'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const UPLOAD_DIR = join(__dirname, '../../data/uploads')
const MAX_FILE_SIZE = 50 * 1024 * 1024
const LARGE_UPLOAD_LIMIT = 80 * 1024 * 1024
const BLOCKED_EXTS = new Set(['.exe', '.sh', '.bat', '.cmd', '.app', '.dmg', '.pkg'])
const ENTITY_MODULES = {
  project: 'projects',
  transaction: 'transactions',
  product: 'products',
  private_workspace: ''
}

export default function fileRoutes(server, db) {
  server.get('/api/files/recent', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return

    const entityType = normalizeEntityType(request.query.entity_type)
    const keyword = cleanText(request.query.keyword)
    const limit = Math.min(Math.max(parseInt(request.query.limit || '100'), 20), 300)
    const conditions = ["COALESCE(a.deleted_at, '') = ''"]
    const params = []

    if (entityType) {
      conditions.push('a.entity_type = ?')
      params.push(entityType)
    }
    if (keyword) {
      conditions.push('(a.original_name LIKE ? OR p.name LIKE ? OR p.customer LIKE ? OR t.description LIKE ? OR t.party LIKE ? OR w.name LIKE ?)')
      const like = `%${keyword}%`
      params.push(like, like, like, like, like, like)
    }

    const rows = db.prepare(`
      SELECT a.id, a.entity_type, a.entity_id, a.original_name, a.mime_type, a.size,
             a.uploaded_by, a.created_at, u.username as uploader_name, u.real_name as uploader_real_name,
             p.name as project_name, p.customer as project_customer,
             t.description as transaction_description, t.party as transaction_party,
             t.amount as transaction_amount, t.type as transaction_type,
             w.name as workspace_name, w.workspace_type as workspace_type
      FROM attachments a
      LEFT JOIN users u ON a.uploaded_by = u.id
      LEFT JOIN projects p ON a.entity_type = 'project' AND a.entity_id = p.id
      LEFT JOIN transactions t ON a.entity_type = 'transaction' AND a.entity_id = t.id
      LEFT JOIN private_workspaces w ON a.entity_type = 'private_workspace' AND a.entity_id = w.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY a.id DESC
      LIMIT ?
    `).all(...params, limit)

    const visible = rows.filter(row => canAccessEntity(db, request.user, row.entity_type, row.entity_id, 'can_view'))
    // 按文件名去重：同一归属下同名文件只保留最新的
    const seen = new Map()
    const deduped = []
    for (const file of visible) {
      const key = `${file.entity_type}:${file.entity_id}:${file.original_name || 'unnamed'}`
      if (seen.has(key)) continue
      seen.set(key, true)
      deduped.push(file)
    }
    return { success: true, data: deduped }
  })

  server.get('/api/files', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    const entityType = normalizeEntityType(request.query.entity_type)
    const entityId = toInt(request.query.entity_id)
    if (!entityType || !entityId) return { success: false, message: '缺少附件归属' }
    if (!canAccessEntity(db, request.user, entityType, entityId, 'can_view')) {
      reply.code(403).send({ success: false, message: '无权限查看附件' })
      return
    }

    const rows = db.prepare(`
      SELECT a.id, a.entity_type, a.entity_id, a.original_name, a.mime_type, a.size,
             a.uploaded_by, a.created_at, u.username as uploader_name, u.real_name as uploader_real_name
      FROM attachments a
      LEFT JOIN users u ON a.uploaded_by = u.id
      WHERE a.entity_type = ? AND a.entity_id = ? AND COALESCE(a.deleted_at, '') = ''
      ORDER BY a.id DESC
    `).all(entityType, entityId)
    return { success: true, data: rows }
  })

  server.post('/api/files/upload', { bodyLimit: LARGE_UPLOAD_LIMIT }, async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    const entityType = normalizeEntityType(request.body?.entity_type)
    const entityId = toInt(request.body?.entity_id)
    if (!entityType || !entityId) return { success: false, message: '缺少附件归属' }
    if (!canAccessEntity(db, request.user, entityType, entityId, 'can_edit')) {
      reply.code(403).send({ success: false, message: '无权限上传附件' })
      return
    }

    const { name, mime_type = 'application/octet-stream', size = 0, data } = request.body || {}
    const originalName = safeFileName(name || '未命名文件')
    const ext = extname(originalName).toLowerCase()
    if (BLOCKED_EXTS.has(ext)) return { success: false, message: '该文件类型暂不支持上传' }
    if (!data || typeof data !== 'string') return { success: false, message: '请选择文件' }

    const match = data.match(/^data:([^;]+);base64,(.+)$/)
    const base64 = match ? match[2] : data
    const buffer = Buffer.from(base64, 'base64')
    if (!buffer.length) return { success: false, message: '文件内容为空' }
    if (buffer.length > MAX_FILE_SIZE || Number(size || 0) > MAX_FILE_SIZE) {
      return { success: false, message: '单个文件不能超过 50MB' }
    }

    ensureUploadDir()
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex')
    const storedName = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext || ''}`
    writeFileSync(join(UPLOAD_DIR, storedName), buffer)

    // 去重：同一归属下同名文件直接覆盖
    const existing = db.prepare('SELECT id, stored_name FROM attachments WHERE entity_type = ? AND entity_id = ? AND original_name = ? AND COALESCE(deleted_at, \'\') = \'\'').get(entityType, entityId, originalName)
    if (existing) {
      const oldPath = join(UPLOAD_DIR, existing.stored_name)
      try { unlinkSync(oldPath) } catch {}
      db.prepare('UPDATE attachments SET stored_name = ?, mime_type = ?, size = ?, checksum = ?, uploaded_by = ?, created_at = datetime(\'now\', \'localtime\') WHERE id = ?').run(storedName, mime_type, buffer.length, checksum, request.user.userId, existing.id)
      return { success: true, id: existing.id, replaced: true }
    }
    const result = db.prepare(`
      INSERT INTO attachments (
        entity_type, entity_id, original_name, stored_name, mime_type, size, checksum, uploaded_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(entityType, entityId, originalName, storedName, mime_type, buffer.length, checksum, request.user.userId)

    const row = db.prepare(`
      SELECT a.id, a.entity_type, a.entity_id, a.original_name, a.mime_type, a.size,
             a.uploaded_by, a.created_at, u.username as uploader_name, u.real_name as uploader_real_name
      FROM attachments a
      LEFT JOIN users u ON a.uploaded_by = u.id
      WHERE a.id = ?
    `).get(result.lastInsertRowid)

    logAccessAudit(db, request.user, {
      action: 'file_upload',
      resourceType: entityType,
      resourceId: entityId,
      module: ENTITY_MODULES[entityType] || '',
      summary: originalName
    })
    return { success: true, data: row }
  })

  server.get('/api/files/:id/download', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    const file = db.prepare(`
      SELECT * FROM attachments
      WHERE id = ? AND COALESCE(deleted_at, '') = ''
    `).get(toInt(request.params.id))
    if (!file || !canAccessEntity(db, request.user, file.entity_type, file.entity_id, 'can_view')) {
      reply.code(404).send({ success: false, message: '文件不存在或无权限下载' })
      return
    }

    const filePath = join(UPLOAD_DIR, file.stored_name)
    if (!existsSync(filePath)) {
      reply.code(404).send({ success: false, message: '文件已丢失' })
      return
    }

    const buffer = readFileSync(filePath)
    logAccessAudit(db, request.user, {
      action: 'file_download',
      resourceType: file.entity_type,
      resourceId: file.entity_id,
      module: ENTITY_MODULES[file.entity_type] || '',
      summary: file.original_name
    })
    reply
      .header('Content-Type', file.mime_type || 'application/octet-stream')
      .header('Content-Disposition', `attachment; filename="${encodeURIComponent(file.original_name)}"; filename*=UTF-8''${encodeURIComponent(file.original_name)}`)
      .header('Content-Length', buffer.length)
      .send(buffer)
  })

  server.delete('/api/files/:id', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    const file = db.prepare(`
      SELECT * FROM attachments
      WHERE id = ? AND COALESCE(deleted_at, '') = ''
    `).get(toInt(request.params.id))
    if (!file) return { success: true }

    const canEditEntity = canAccessEntity(db, request.user, file.entity_type, file.entity_id, 'can_edit')
    const isOwner = file.uploaded_by === request.user.userId
    if (!canEditEntity && !isOwner) {
      reply.code(403).send({ success: false, message: '无权限删除附件' })
      return
    }

    db.prepare("UPDATE attachments SET deleted_at = datetime('now', 'localtime') WHERE id = ?").run(file.id)
    logAccessAudit(db, request.user, {
      action: 'file_delete',
      resourceType: file.entity_type,
      resourceId: file.entity_id,
      module: ENTITY_MODULES[file.entity_type] || '',
      summary: file.original_name
    })
    return { success: true }
  })
}

function ensureUploadDir() {
  if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true })
}

function normalizeEntityType(value) {
  const text = String(value || '').trim()
  return Object.prototype.hasOwnProperty.call(ENTITY_MODULES, text) ? text : ''
}

function safeFileName(name) {
  return String(name)
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || '未命名文件'
}

function toInt(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function canAccessEntity(db, user, entityType, entityId, permission) {
  if (entityType === 'private_workspace') {
    if (permission === 'can_edit') {
      return canAccessPrivateResource(db, user, entityType, entityId, 'can_edit')
        || canAccessPrivateResource(db, user, entityType, entityId, 'can_create')
    }
    return canAccessPrivateResource(db, user, entityType, entityId, permission)
  }

  const module = ENTITY_MODULES[entityType]
  if (!module || !canAccessModule(db, user, module, permission)) return false
  if (entityType === 'project') return canAccessProjectEntity(db, user, entityId)
  return !!entityId
}

function canAccessProjectEntity(db, user, projectId) {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId)
  if (!project) return false
  return canAccessProjectRecord(db, user, project)
}
