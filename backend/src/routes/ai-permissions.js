import { authMiddleware } from '../middleware/auth.js'

const TOOL_LABELS = [
  { name: 'get_accounts', label: '查看账户列表', desc: '获取所有账户名称、类型、余额' },
  { name: 'get_transactions', label: '查看交易记录', desc: '按时间范围、类型筛选交易流水' },
  { name: 'get_today_summary', label: '今日交易汇总', desc: '今日收入总额、支出总额、笔数' },
  { name: 'get_products', label: '查看产品库存', desc: '产品名称、分类、库存数量' },
  { name: 'get_employees', label: '查看员工信息', desc: '员工列表、部门、职位、状态' },
  { name: 'get_projects', label: '查看工程订单', desc: '订单列表、阶段筛选' },
  { name: 'get_system_stats', label: '系统概况统计', desc: '账户数、今日交易额、产品种类、员工数' },
  { name: 'create_transaction', label: '新增交易记录', desc: '创建一笔收入或支出记录' },
  { name: 'create_account', label: '新增账户', desc: '创建公司或个人账户' },
]

export default function aiPermissionsRoutes(server, db) {
  // 获取工具列表（含中文名）
  server.get('/api/ai-tools/list', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
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
