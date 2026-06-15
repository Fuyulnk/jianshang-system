import { authMiddleware } from '../middleware/auth.js'
import { requireModuleAccess } from '../utils/permissions.js'
import { generateEmployeeCode } from '../utils/employeeCode.js'
import { departmentPositionPayload, isValidDepartmentPosition } from '../utils/orgOptions.js'

export default function employeeRoutes(server, db) {
  // 获取员工列表
  server.get('/api/employees', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireModuleAccess(db, request, reply, 'employees', 'can_view', '无权限查看员工档案')) return

    const employees = db.prepare(`
      SELECT e.*, u.id as bound_user_id, u.username as bound_username, u.role as bound_user_role
      FROM employees e
      LEFT JOIN users u ON u.employee_id = e.id
      ORDER BY e.id ASC
    `).all()
    return { success: true, data: employees }
  })

  // 已注册但还没生成员工档案的账号
  server.get('/api/employees/pending-users', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireModuleAccess(db, request, reply, 'employees', 'can_view', '无权限查看待建档账号')) return

    const users = db.prepare(`
      SELECT u.id, u.username, u.role, u.real_name, u.phone, u.department, u.position,
             u.status, u.assignment_status, u.created_at,
             r.label as role_label
      FROM users u
      LEFT JOIN roles r ON r.name = u.role
      WHERE COALESCE(u.employee_id, 0) = 0
        AND u.username != 'ai'
        AND u.role != 'super_admin'
        AND u.status != 'disabled'
      ORDER BY u.id ASC
    `).all()
    return { success: true, data: users }
  })

  // 新增员工
  server.post('/api/employees', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireModuleAccess(db, request, reply, 'employees', 'can_create', '无权限新增员工档案')) return

    const { name, department, position, phone } = request.body
    if (!name) {
      return { success: false, message: '员工姓名不能为空' }
    }
    if (!department || !position || !isValidDepartmentPosition(String(department).trim(), String(position).trim())) {
      return { success: false, message: '请选择正确的部门和职位' }
    }

    const employeeCode = generateEmployeeCode(db)

    const result = db.prepare(
      'INSERT INTO employees (name, department, position, phone, employee_code) VALUES (?, ?, ?, ?, ?)'
    ).run(name, department, position, phone || null, employeeCode)

    return { success: true, id: result.lastInsertRowid, employee_code: employeeCode }
  })

  // 从待建档账号生成员工档案，并立即绑定该账号
  server.post('/api/employees/from-user/:userId', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireModuleAccess(db, request, reply, 'employees', 'can_create', '无权限生成员工档案')) return

    const userId = Number(request.params.userId || 0)
    const user = db.prepare(`
      SELECT id, username, role, real_name, phone, department, position, employee_id
      FROM users
      WHERE id = ?
    `).get(userId)
    if (!user) {
      reply.code(404).send({ success: false, message: '账号不存在' })
      return
    }
    if (Number(user.employee_id || 0) > 0) {
      return { success: false, message: '该账号已经绑定员工档案' }
    }

    const employeeCode = generateEmployeeCode(db)
    const employeeName = String(user.real_name || user.username || '').trim()
    const result = db.transaction(() => {
      const employeeResult = db.prepare(`
        INSERT INTO employees (name, department, position, phone, employee_code)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        employeeName,
        user.department || null,
        user.position || roleToPosition(user.role),
        user.phone || null,
        employeeCode
      )
      db.prepare(`
        UPDATE users
        SET employee_id = ?,
            assignment_status = 'assigned',
            role_version = CASE WHEN role != 'employee' THEN COALESCE(role_version, 1) + 1 ELSE COALESCE(role_version, 1) END
        WHERE id = ?
      `).run(employeeResult.lastInsertRowid, user.id)
      return { id: employeeResult.lastInsertRowid }
    })()

    return { success: true, id: result.id, employee_code: employeeCode }
  })

  // 更新员工
  server.put('/api/employees/:id', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireModuleAccess(db, request, reply, 'employees', 'can_edit', '无权限编辑员工档案')) return

    const { name, department, position, phone, status } = request.body
    if (!name) {
      return { success: false, message: '员工姓名不能为空' }
    }
    if (!department || !position || !isValidDepartmentPosition(String(department).trim(), String(position).trim())) {
      return { success: false, message: '请选择正确的部门和职位' }
    }
    db.transaction(() => {
      db.prepare(
        'UPDATE employees SET name = ?, department = ?, position = ?, phone = ?, status = ? WHERE id = ?'
      ).run(name, department, position, phone, status || 'active', request.params.id)
      db.prepare(`
        UPDATE users
        SET real_name = ?, department = ?, position = ?, phone = ?,
            role_version = COALESCE(role_version, 1) + 1
        WHERE employee_id = ?
      `).run(name, department, position, phone || '', request.params.id)
    })()

    return { success: true }
  })

  server.get('/api/employees/org-options', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    return { success: true, data: departmentPositionPayload() }
  })

  // 删除员工
  server.delete('/api/employees/:id', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireModuleAccess(db, request, reply, 'employees', 'can_delete', '无权限删除员工档案')) return
    const boundUser = db.prepare('SELECT username FROM users WHERE employee_id = ?').get(request.params.id)
    if (boundUser) {
      return { success: false, message: `员工档案已绑定账号 ${boundUser.username}，请先在用户管理中解绑` }
    }

    db.prepare('DELETE FROM employees WHERE id = ?').run(request.params.id)
    return { success: true }
  })
}

function roleToPosition(role) {
  const labels = {
    super_admin: '超级管理员',
    admin: '管理员',
    finance: '财务',
    warehouse: '仓管',
    engineering: '工程部',
    employee: '普通员工'
  }
  return labels[role] || '未设置职位'
}
