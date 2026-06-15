import { authMiddleware } from '../middleware/auth.js'
import { AI_TOOL_REGISTRY } from '../ai/toolRegistry.js'
import { requireAssignedAccount } from '../utils/permissions.js'

const TOOL_LABELS = AI_TOOL_REGISTRY.map(tool => ({
  name: tool.name,
  label: tool.label,
  desc: tool.desc,
  tier: tool.tier,
  risk_level: tool.risk_level,
  requires_confirmation: !!tool.requires_confirmation
}))

export default function aiPermissionsRoutes(server, db) {
  // 获取工具列表（含中文名）
  server.get('/api/ai-tools/list', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireAssignedAccount(request, reply, '账号等待管理员建档和岗位分配，暂不能查看 AI 工具目录')) return
    return { success: true, data: TOOL_LABELS }
  })

  // 获取所有角色的工具权限
  server.get('/api/ai-tools/roles', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (request.user.role !== 'super_admin') {
      reply.code(403).send({ success: false, message: '无权限' })
      return
    }
    const rows = db.prepare(`
      SELECT art.*, r.name as role_name, r.label as role_label
      FROM ai_role_tools art
      JOIN roles r ON art.role_id = r.id
      ORDER BY art.role_id, art.id
    `).all()

    return { success: true, data: rows }
  })

  // 更新某角色对某工具的权限
  server.put('/api/ai-tools/roles/:id', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (request.user.role !== 'super_admin') {
      reply.code(403).send({ success: false, message: '无权限' })
      return
    }
    const { allowed } = request.body
    db.prepare('UPDATE ai_role_tools SET allowed = ? WHERE id = ?').run(allowed ? 1 : 0, request.params.id)
    return { success: true }
  })

  // 获取某用户的个人工具覆盖
  server.get('/api/ai-tools/users/:id', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (request.user.role !== 'super_admin') {
      reply.code(403).send({ success: false, message: '无权限' })
      return
    }
    const overrides = db.prepare(
      'SELECT * FROM ai_user_tools WHERE user_id = ?'
    ).all(request.params.id)
    return { success: true, data: overrides }
  })

  // 设置某用户的工具权限覆盖
  server.put('/api/ai-tools/users/:id', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (request.user.role !== 'super_admin') {
      reply.code(403).send({ success: false, message: '无权限' })
      return
    }
    const { tool_name, allowed } = request.body
    if (!tool_name) return { success: false, message: '缺少 tool_name' }

    db.prepare(`
      INSERT INTO ai_user_tools (user_id, tool_name, allowed)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, tool_name) DO UPDATE SET allowed = excluded.allowed
    `).run(request.params.id, tool_name, allowed ? 1 : 0)

    return { success: true }
  })
}
