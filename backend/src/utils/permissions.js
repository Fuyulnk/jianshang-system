export function canAccessModule(db, user, module, permission = 'can_view') {
  if (!user) return false
  if (isPendingAssignmentUser(user)) return false
  if (['super_admin', 'admin'].includes(user.role)) return true

  const row = getModulePermission(db, user, module)
  return !!row?.[permission]
}

export function getModulePermission(db, user, module) {
  if (!user) return null
  if (isPendingAssignmentUser(user)) {
    return {
      module,
      can_view: 0,
      can_create: 0,
      can_edit: 0,
      can_delete: 0,
      data_scope: 'none'
    }
  }
  if (user.role === 'super_admin') {
    return {
      module,
      can_view: 1,
      can_create: 1,
      can_edit: 1,
      can_delete: 1,
      data_scope: 'all'
    }
  }

  const row = db.prepare(`
    SELECT rp.*
    FROM role_permissions rp
    JOIN roles r ON rp.role_id = r.id
    WHERE r.name = ? AND rp.module = ?
  `).get(user.role, module)
  if (row) return row

  if (user.role === 'admin') {
    return {
      module,
      can_view: 1,
      can_create: 1,
      can_edit: 1,
      can_delete: 1,
      data_scope: 'all'
    }
  }

  return null
}

export function requireModuleAccess(db, request, reply, module, permission = 'can_view', message = '无权限') {
  if (canAccessModule(db, request.user, module, permission)) return true
  const pendingMessage = isPendingAssignmentUser(request.user) ? '账号等待管理员建档和岗位分配，暂不能访问业务数据' : message
  reply.code(403).send({ success: false, message: pendingMessage })
  return false
}

export function getDataScope(db, user, module) {
  if (isPendingAssignmentUser(user)) return 'none'
  return getModulePermission(db, user, module)?.data_scope || 'none'
}

export function canAccessProjectRecord(db, user, project) {
  if (!user || !project) return false
  if (isPendingAssignmentUser(user)) return false
  const scope = getDataScope(db, user, 'projects')
  if (scope === 'all') return true
  if (scope === 'none' || scope === 'private_grant') return false
  if (['self', 'department', 'project_related'].includes(scope)) {
    return isUserLinkedToProject(user.userId, project)
  }
  return false
}

export function isPendingAssignmentUser(user) {
  return (user?.assignmentStatus || user?.assignment_status || 'assigned') === 'pending'
}

export function requireAssignedAccount(request, reply, message = '账号等待管理员建档和岗位分配，暂不能访问该功能') {
  if (!isPendingAssignmentUser(request.user)) return true
  reply.code(403).send({ success: false, message })
  return false
}

export function isUserLinkedToProject(userId, project) {
  const id = Number(userId || 0)
  return [
    project.created_by,
    project.manager_user_id,
    project.assignee_user_id,
    project.survey_user_id,
    project.recheck_user_id,
    project.final_inspection_user_id
  ].includes(id)
    || parseIdList(project.crew_member_user_ids).includes(id)
}

export function canAccessPrivateResource(db, user, resourceType, resourceId, permission = 'can_view') {
  if (!user || !resourceType || !resourceId) return false

  const directOwner = getPrivateResourceOwner(db, resourceType, resourceId)
  if (directOwner && directOwner === user.userId) return true

  const grant = db.prepare(`
    SELECT *
    FROM resource_access_grants
    WHERE resource_type = ?
      AND resource_id = ?
      AND user_id = ?
      AND revoked_at = ''
    ORDER BY id DESC
    LIMIT 1
  `).get(resourceType, resourceId, user.userId)

  if (!grant) return false
  if (permission === 'can_view') return !!grant.can_view
  if (permission === 'can_create') return !!grant.can_create
  if (permission === 'can_edit') return !!grant.can_edit
  if (permission === 'can_delete') return !!grant.can_delete
  return false
}

export function grantPrivateResourceAccess(db, {
  resourceType,
  resourceId,
  userId,
  grantedBy,
  canView = 1,
  canCreate = 0,
  canEdit = 0,
  canDelete = 0
}) {
  return db.prepare(`
    INSERT INTO resource_access_grants (
      resource_type, resource_id, user_id, granted_by,
      can_view, can_create, can_edit, can_delete
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    resourceType,
    resourceId,
    userId,
    grantedBy || 0,
    canView ? 1 : 0,
    canCreate ? 1 : 0,
    canEdit ? 1 : 0,
    canDelete ? 1 : 0
  )
}

export function logAccessAudit(db, user, {
  action,
  resourceType = '',
  resourceId = 0,
  module = '',
  status = 'ok',
  summary = ''
}) {
  try {
    db.prepare(`
      INSERT INTO access_audit_logs (
        user_id, employee_id, role, action, resource_type, resource_id, module, status, summary
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      user?.userId || 0,
      user?.employeeId || 0,
      user?.role || '',
      action || '',
      resourceType || '',
      Number(resourceId || 0),
      module || '',
      status || 'ok',
      summarizeAudit(summary || '')
    )
  } catch {}
}

function getPrivateResourceOwner(db, resourceType, resourceId) {
  if (resourceType === 'private_workspace') {
    const row = db.prepare("SELECT owner_user_id FROM private_workspaces WHERE id = ? AND COALESCE(archived_at, '') = ''").get(resourceId)
    return row?.owner_user_id || 0
  }
  return 0
}

function parseIdList(value) {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed.map(item => Number(item || 0)).filter(Boolean) : []
  } catch {
    return []
  }
}

function summarizeAudit(value, limit = 300) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > limit ? `${text.slice(0, limit)}...` : text
}
