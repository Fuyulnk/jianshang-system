import { authMiddleware } from '../middleware/auth.js'
import { isPendingAssignmentUser } from '../utils/permissions.js'

export default function roleRoutes(server, db) {
  // 获取角色列表
  server.get('/api/roles', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (request.user.role !== 'super_admin') {
      reply.code(403).send({ success: false, message: '无权限' })
      return
    }
    const roles = db.prepare('SELECT * FROM roles ORDER BY id ASC').all()
    return { success: true, data: roles }
  })

  // 获取所有角色的权限配置（按角色分组）
  server.get('/api/role-permissions', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (request.user.role !== 'super_admin') {
      reply.code(403).send({ success: false, message: '无权限' })
      return
    }
    const rows = db.prepare(`
      SELECT rp.*, r.label as role_label, r.name as role_name
      FROM role_permissions rp
      JOIN roles r ON rp.role_id = r.id
      ORDER BY rp.role_id, rp.id
    `).all()
    return { success: true, data: rows }
  })

  // 更新某个角色对某个模块的权限
  server.put('/api/role-permissions/:id', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (request.user.role !== 'super_admin') {
      reply.code(403).send({ success: false, message: '无权限' })
      return
    }
    const { can_view, can_create, can_edit, can_delete, data_scope } = request.body
    const current = db.prepare('SELECT data_scope FROM role_permissions WHERE id = ?').get(request.params.id)
    const scope = data_scope === undefined
      ? normalizeDataScope(current?.data_scope)
      : normalizeDataScope(data_scope)
    db.prepare(
      'UPDATE role_permissions SET can_view = ?, can_create = ?, can_edit = ?, can_delete = ?, data_scope = ? WHERE id = ?'
    ).run(
      can_view ? 1 : 0,
      can_create ? 1 : 0,
      can_edit ? 1 : 0,
      can_delete ? 1 : 0,
      scope,
      request.params.id
    )
    return { success: true }
  })

  // 获取当前用户可访问的菜单
  server.get('/api/user-menu', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return

    if (isPendingAssignmentUser(request.user)) {
      return { success: true, data: [] }
    }

    const role = db.prepare('SELECT * FROM roles WHERE name = ?').get(request.user.role)
    if (!role) {
      return { success: true, data: [] }
    }

    const perms = db.prepare(
      'SELECT * FROM role_permissions WHERE role_id = ? AND can_view = 1'
    ).all(role.id)

    return { success: true, data: perms.map(p => p.module) }
  })
}

function normalizeDataScope(value) {
  const allowed = new Set(['all', 'department', 'self', 'project_related', 'private_grant', 'none'])
  return allowed.has(value) ? value : 'all'
}
