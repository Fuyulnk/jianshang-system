// 系统设置接口
import { authMiddleware } from '../middleware/auth.js'

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
}

function getSettings(db) {
  try {
    const rows = db.prepare('SELECT key, value FROM system_settings').all()
    return Object.fromEntries(rows.map(r => [r.key, r.value]))
  } catch {
    return {}
  }
}
