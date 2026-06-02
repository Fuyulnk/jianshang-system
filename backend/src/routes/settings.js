// 系统设置接口
import { authMiddleware } from '../middleware/auth.js'
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

const KB_SERVER = 'http://127.0.0.1:18790'

export default function settingsRoutes(server, db) {
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

    const apiKey = process.env.AI_API_KEY
    if (!apiKey) {
      return { success: false, message: '未配置 AI_API_KEY' }
    }
    const settings = getSettings(db)

    try {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
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
}

function getSettings(db) {
  try {
    const rows = db.prepare('SELECT key, value FROM system_settings').all()
    return Object.fromEntries(rows.map(r => [r.key, r.value]))
  } catch {
    return {}
  }
}
