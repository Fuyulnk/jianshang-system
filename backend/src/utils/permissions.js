export function canAccessModule(db, user, module, permission = 'can_view') {
  if (!user) return false
  if (['super_admin', 'admin'].includes(user.role)) return true

  const row = db.prepare(`
    SELECT rp.*
    FROM role_permissions rp
    JOIN roles r ON rp.role_id = r.id
    WHERE r.name = ? AND rp.module = ?
  `).get(user.role, module)

  return !!row?.[permission]
}

export function requireModuleAccess(db, request, reply, module, permission = 'can_view', message = '无权限') {
  if (canAccessModule(db, request.user, module, permission)) return true
  reply.code(403).send({ success: false, message })
  return false
}
