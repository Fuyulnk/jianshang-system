// 系统设置接口
import { authMiddleware } from '../middleware/auth.js'
import { spawn } from 'child_process'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { basename, join } from 'path'
import { requireAssignedAccount } from '../utils/permissions.js'
import { ensureDocumentTemplateTables } from '../db/documentTemplates.js'
import { SYSTEM_DOCUMENT_TEMPLATES } from '../domain/documentTemplateConfig.js'

const KB_SERVER = 'http://127.0.0.1:18790'
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export default function settingsRoutes(server, db) {
  const documentTemplateDir = join(__dirname, '../../data/document-templates')
  ensureDocumentTemplateTables(db)

  // 确保设置表存在
  db.exec(`CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
  )`)

  // 插入默认值（如果不存在）
  const defaults = {
    company_name: '简尚',
    system_title: '简尚装饰工程管理系统',
    ai_model: 'deepseek-chat',
    ai_temperature: '0.7',
    ai_max_tokens: '2048',
  }
  const insertDefault = db.prepare(
    'INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)'
  )
  for (const [k, v] of Object.entries(defaults)) {
    insertDefault.run(k, v)
  }

  // 获取所有设置
  server.get('/api/settings', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (request.user.role !== 'super_admin' && request.user.role !== 'admin') {
      reply.code(403).send({ success: false, message: '无权限' })
      return
    }

    const rows = db.prepare('SELECT key, value FROM system_settings').all()
    const settings = {}
    for (const r of rows) settings[r.key] = r.value

    return { success: true, data: settings }
  })

  // 更新设置
  server.put('/api/settings', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (request.user.role !== 'super_admin' && request.user.role !== 'admin') {
      reply.code(403).send({ success: false, message: '无权限' })
      return
    }

    const updates = request.body || {}
    const allowedKeys = ['company_name', 'system_title', 'ai_model', 'ai_temperature', 'ai_max_tokens']

    const stmt = db.prepare(
      "INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, datetime('now', 'localtime')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now', 'localtime')"
    )

    for (const key of allowedKeys) {
      if (updates[key] !== undefined) {
        stmt.run(key, String(updates[key]))
      }
    }

    return { success: true, message: '设置已保存' }
  })

  // 测试 AI 连接
  server.post('/api/settings/test-ai', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireAssignedAccount(request, reply, '账号等待管理员建档和岗位分配，暂不能测试 AI 连接')) return

    const apiKey = process.env.AI_API_KEY
    if (!apiKey) {
      return { success: false, message: '未配置 AI_API_KEY' }
    }
    const settings = getSettings(db)

    try {
      const res = await fetch(process.env.AI_ENDPOINT || 'https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: settings.ai_model || process.env.AI_MODEL || 'deepseek-chat',
          messages: [{ role: 'user', content: '回复"ok"即可' }],
          max_tokens: 10,
          temperature: 0,
        }),
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) {
        return { success: false, message: `API 返回 ${res.status}: ${await res.text()}` }
      }
      const json = await res.json()
      const replyText = json?.choices?.[0]?.message?.content || ''
      return { success: true, message: 'AI 连接正常', reply: replyText }
    } catch (err) {
      return { success: false, message: `连接失败: ${err.message}` }
    }
  })

  // 知识库状态
  server.get('/api/settings/knowledge-base', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireAssignedAccount(request, reply, '账号等待管理员建档和岗位分配，暂不能查看知识库状态')) return

    try {
      const res = await fetch(`${KB_SERVER}/health`, { signal: AbortSignal.timeout(3000) })
      const data = await res.json()
      return { success: true, data }
    } catch {
      return { success: false, message: '知识库服务未运行', data: null }
    }
  })

  server.post('/api/settings/knowledge-base/reindex', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireAssignedAccount(request, reply, '账号等待管理员建档和岗位分配，暂不能重建知识库索引')) return
    if (!['super_admin', 'admin'].includes(request.user.role)) {
      reply.code(403).send({ success: false, message: '无权限' })
      return
    }

    const candidates = [
      join(process.env.HOME, '.openclaw/workspace/scripts/ingest-jianshang-docs.py'),
      join(process.env.HOME, '.openclaw/workspace/scripts/ingest-docs.py'),
    ]
    const script = candidates.find(path => existsSync(path))
    if (!script) {
      return {
        success: false,
        message: '未找到知识库索引脚本；当前只能刷新状态，不能自动重建索引'
      }
    }

    try {
      const child = spawn('python3', [script], {
        cwd: join(process.env.HOME, '.openclaw/workspace'),
        detached: true,
        stdio: 'ignore'
      })
      child.unref()
      return { success: true, message: '已触发知识库索引任务，请稍后刷新状态' }
    } catch (err) {
      return { success: false, message: `索引任务启动失败: ${err.message}` }
    }
  })

  server.get('/api/settings/ai-audit', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!['super_admin', 'admin'].includes(request.user.role)) {
      reply.code(403).send({ success: false, message: '无权限' })
      return
    }

    const { user_id, role, tool_name, status, action_type, start_date, end_date } = request.query || {}
    const limit = Math.min(Math.max(parseInt(request.query?.limit || '100'), 20), 300)
    const conditions = []
    const params = []

    if (user_id) {
      conditions.push('l.user_id = ?')
      params.push(Number(user_id))
    }
    if (role) {
      conditions.push('l.role = ?')
      params.push(String(role))
    }
    if (tool_name) {
      conditions.push('l.tool_name = ?')
      params.push(String(tool_name))
    }
    if (status) {
      conditions.push('l.status = ?')
      params.push(String(status))
    }
    if (action_type) {
      conditions.push('l.action_type = ?')
      params.push(String(action_type))
    }
    if (start_date) {
      conditions.push('l.created_at >= ?')
      params.push(String(start_date))
    }
    if (end_date) {
      conditions.push('l.created_at <= ?')
      params.push(`${end_date} 23:59:59`)
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const rows = db.prepare(`
      SELECT l.id, l.user_id, l.employee_id, l.role, l.action_type, l.tool_name,
             l.request_summary, l.result_summary, l.status, l.error_message,
             l.model, l.input_tokens, l.output_tokens, l.duration_ms, l.created_at,
             u.username, u.real_name, e.name as employee_name, e.employee_code
      FROM ai_audit_logs l
      LEFT JOIN users u ON l.user_id = u.id
      LEFT JOIN employees e ON l.employee_id = e.id
      ${where}
      ORDER BY l.id DESC
      LIMIT ?
    `).all(...params, limit)

    const summary = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) as ok_count,
        SUM(CASE WHEN status != 'ok' THEN 1 ELSE 0 END) as risk_count,
        SUM(CASE WHEN tool_name != '' THEN 1 ELSE 0 END) as tool_count,
        SUM(input_tokens) as input_tokens,
        SUM(output_tokens) as output_tokens
      FROM ai_audit_logs
      WHERE created_at >= datetime('now', 'localtime', '-1 day')
    `).get()

    return { success: true, data: rows, summary }
  })

  server.get('/api/settings/document-templates', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!['super_admin', 'admin'].includes(request.user.role)) {
      reply.code(403).send({ success: false, message: '无权限' })
      return
    }

    const rows = db.prepare(`
      SELECT dt.*,
             (SELECT COUNT(*) FROM document_template_mappings m WHERE m.template_id = dt.id) as mapping_count
      FROM document_templates dt
      ORDER BY dt.document_type ASC, dt.updated_at DESC, dt.id DESC
    `).all()
    const configMap = new Map(SYSTEM_DOCUMENT_TEMPLATES.map(item => [item.document_type, item]))
    return {
      success: true,
      data: rows.map(row => ({
        ...row,
        configured_title: configMap.get(row.document_type)?.title || row.title,
        file_exists: row.source_file_path ? existsSync(row.source_file_path) : false
      })),
      supported: SYSTEM_DOCUMENT_TEMPLATES.map(item => ({
        document_type: item.document_type,
        title: item.title,
        mapping_count: item.mappings?.length || 0
      }))
    }
  })

  server.post('/api/settings/document-templates/:documentType/upload', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!['super_admin', 'admin'].includes(request.user.role)) {
      reply.code(403).send({ success: false, message: '无权限' })
      return
    }
    const documentType = cleanText(request.params.documentType)
    const config = SYSTEM_DOCUMENT_TEMPLATES.find(item => item.document_type === documentType)
    if (!config) return { success: false, message: '不支持的模板类型' }
    const fileName = safeFileName(request.body?.file_name || config.file_name)
    if (!/\.(xlsx|xlsm|xls)$/i.test(fileName)) return { success: false, message: '模板必须是 Excel 文件' }
    const fileData = String(request.body?.file_data || '')
    if (!fileData) return { success: false, message: '请上传模板文件' }
    const buffer = decodeDataUrl(fileData)
    if (!buffer.length) return { success: false, message: '模板文件内容为空' }
    if (buffer.length > 20 * 1024 * 1024) return { success: false, message: '模板文件不能超过 20MB' }

    mkdirSync(documentTemplateDir, { recursive: true })
    const version = `manual_${new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14)}`
    const storedName = `${documentType}_${version}.xlsx`
    const storedPath = join(documentTemplateDir, storedName)
    writeFileSync(storedPath, buffer)

    const tx = db.transaction(() => {
      db.prepare("UPDATE document_templates SET status = 'inactive', updated_at = datetime('now', 'localtime') WHERE document_type = ? AND status = 'active'")
        .run(documentType)
      const inserted = db.prepare(`
        INSERT INTO document_templates (
          document_type, title, template_version, source_file_name, source_file_path, status, created_by
        ) VALUES (?, ?, ?, ?, ?, 'active', ?)
      `).run(documentType, cleanText(request.body?.title) || config.title, version, fileName, storedPath, request.user.userId)
      upsertTemplateMappings(db, inserted.lastInsertRowid, config.mappings || [])
      return inserted.lastInsertRowid
    })
    const id = tx()
    return { success: true, id, message: '模板已上传并设为当前版本' }
  })
}

function getSettings(db) {
  try {
    const rows = db.prepare('SELECT key, value FROM system_settings').all()
    return Object.fromEntries(rows.map(r => [r.key, r.value]))
  } catch {
    return {}
  }
}

function upsertTemplateMappings(db, templateId, mappings) {
  const stmt = db.prepare(`
    INSERT INTO document_template_mappings (
      template_id, field_key, field_label, sheet_name, cell_address, value_type, required
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(template_id, field_key) DO UPDATE SET
      field_label = excluded.field_label,
      sheet_name = excluded.sheet_name,
      cell_address = excluded.cell_address,
      value_type = excluded.value_type,
      required = excluded.required,
      updated_at = datetime('now', 'localtime')
  `)
  for (const mapping of mappings) {
    stmt.run(
      templateId,
      mapping.field_key,
      mapping.field_label || '',
      mapping.sheet_name || '',
      mapping.cell_address,
      mapping.value_type || 'text',
      mapping.required ? 1 : 0
    )
  }
}

function decodeDataUrl(value) {
  const text = String(value || '')
  const base64 = text.includes(',') ? text.split(',').pop() : text
  return Buffer.from(base64, 'base64')
}

function safeFileName(value) {
  return basename(String(value || 'template.xlsx')).replace(/[\\/:*?"<>|]/g, '_').slice(0, 120)
}

function cleanText(value) {
  return String(value || '').trim()
}
