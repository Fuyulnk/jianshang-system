import { verifyToken } from '../config.js'

let authDb = null

export function setAuthDb(db) {
  authDb = db
}

export function resolveFreshUser(decoded) {
  if (!authDb) return decoded

  const user = authDb.prepare(`
    SELECT id, username, role, role_version, employee_id, status, assignment_status
    FROM users
    WHERE id = ?
  `).get(decoded.userId)
  if (!user) throw new Error('用户不存在')
  if ((user.status || 'active') === 'disabled') throw new Error('账号已停用，请联系管理员')

  const tokenRoleVersion = decoded.roleVersion ?? decoded.role_version
  if (tokenRoleVersion !== undefined && Number(tokenRoleVersion) !== Number(user.role_version || 1)) {
    throw new Error('用户权限已变更，请重新登录')
  }

  return {
    ...decoded,
    userId: user.id,
    username: user.username,
    role: user.role,
    roleVersion: user.role_version || 1,
    employeeId: user.employee_id || 0,
    assignmentStatus: user.assignment_status || 'assigned'
  }
}

export function authMiddleware(request, reply) {
  const authHeader = request.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    reply.code(401).send({ success: false, message: '未登录或 token 已过期' })
    return false
  }

  const token = authHeader.split(' ')[1]
  try {
    const decoded = verifyToken(token)
    request.user = resolveFreshUser(decoded)
  } catch (err) {
    reply.code(401).send({ success: false, message: err.message || 'token 无效或已过期' })
    return false
  }
}
