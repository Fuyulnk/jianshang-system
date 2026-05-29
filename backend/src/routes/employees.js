import { authMiddleware } from '../middleware/auth.js'

export default function employeeRoutes(server, db) {
  // 获取员工列表
  server.get('/api/employees', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return

    const employees = db.prepare('SELECT * FROM employees ORDER BY id ASC').all()
    return { success: true, data: employees }
  })

  // 新增员工
  server.post('/api/employees', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return

    const { name, department, position, phone } = request.body
    if (!name) {
      return { success: false, message: '员工姓名不能为空' }
    }

    // 自动生成随机员工编号 JS-XX999999
    function genCode() {
      const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
      let l = ''
      for (let i = 0; i < 2; i++) l += letters[Math.floor(Math.random() * letters.length)]
      const d = String(Math.floor(Math.random() * 1000000)).padStart(6, '0')
      return `JS-${l}${d}`
    }
    let employeeCode = genCode()
    while (db.prepare('SELECT 1 FROM employees WHERE employee_code = ?').get(employeeCode)) {
      employeeCode = genCode()
    }

    const result = db.prepare(
      'INSERT INTO employees (name, department, position, phone, employee_code) VALUES (?, ?, ?, ?, ?)'
    ).run(name, department || null, position || null, phone || null, employeeCode)

    return { success: true, id: result.lastInsertRowid, employee_code: employeeCode }
  })

  // 更新员工
  server.put('/api/employees/:id', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return

    const { name, department, position, phone, status } = request.body
    db.prepare(
      'UPDATE employees SET name = ?, department = ?, position = ?, phone = ?, status = ? WHERE id = ?'
    ).run(name, department, position, phone, status, request.params.id)

    return { success: true }
  })

  // 删除员工
  server.delete('/api/employees/:id', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return

    db.prepare('DELETE FROM employees WHERE id = ?').run(request.params.id)
    return { success: true }
  })
}
