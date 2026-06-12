import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { getJwtSecret } from '../config.js'
import { authMiddleware } from '../middleware/auth.js'
import { generateEmployeeCode } from '../utils/employeeCode.js'

// 登录失败计数（内存），IP → { count, lockUntil }
const loginAttempts = new Map()

function checkLoginLimit(request) {
  const ip = request.ip || 'unknown'
  const record = loginAttempts.get(ip)
  if (record && record.lockUntil > Date.now()) {
    return {
      blocked: true,
      retryAfter: Math.ceil((record.lockUntil - Date.now()) / 1000)
    }
  }
  return { blocked: false, ip }
}

function recordFailedLogin(ip) {
  // 清理过期记录（防止内存泄漏）
  if (loginAttempts.size > 5000) {
    const now = Date.now()
    for (const [k, v] of loginAttempts) {
      if (v.lockUntil && v.lockUntil < now) loginAttempts.delete(k)
    }
  }
  const record = loginAttempts.get(ip) || { count: 0 }
  record.count++
  if (record.count >= 5) {
    record.lockUntil = Date.now() + 30000 // 锁30秒
    record.count = 0
  }
  loginAttempts.set(ip, record)
}

export default function authRoutes(server, db) {
  // 登录
  server.post('/api/login', async (request, reply) => {
    const { username, password, remember_me } = request.body

    if (!username || !password) {
      return { success: false, message: '请输入账号和密码' }
    }

    // rate-limit 检查
    const limit = checkLoginLimit(request)
    if (limit.blocked) {
      return { success: false, message: `登录过于频繁，请 ${limit.retryAfter} 秒后再试` }
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username)

    if (!user) {
      recordFailedLogin(limit.ip)
      return { success: false, message: '用户名或密码错误' }
    }

    const valid = bcrypt.compareSync(password, user.password)
    if (!valid) {
      recordFailedLogin(limit.ip)
      return { success: false, message: '用户名或密码错误' }
    }

    // 登录成功，清除失败记录
    loginAttempts.delete(limit.ip)

    const secret = getJwtSecret()
    const expiresIn = remember_me ? '7d' : '1d'
    const token = jwt.sign(
      {
        userId: user.id,
        username: user.username,
        role: user.role,
        roleVersion: user.role_version || 1,
        employeeId: user.employee_id || 0
      },
      secret,
      { expiresIn }
    )

    return {
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        onboarding_done: user.onboarding_done || 0,
        real_name: user.real_name || '',
        phone: user.phone || '',
        department: user.department || '',
        employee_id: user.employee_id || 0,
        role_version: user.role_version || 1,
        ai_pet_enabled: user.ai_pet_enabled ?? 1,
        ai_auto_query: user.ai_auto_query ?? 1,
        ai_name: user.ai_name || '简尚小助手'
      }
    }
  })

  // 注册（限制每IP每天最多10次）
  const registerAttempts = new Map()
  server.post('/api/register', async (request, reply) => {
    const ip = request.ip || 'unknown'
    const regRecord = registerAttempts.get(ip) || { count: 0, date: '' }
    const today = new Date().toISOString().split('T')[0]
    if (regRecord.date !== today) {
      regRecord.count = 0
      regRecord.date = today
    }
    regRecord.count++
    registerAttempts.set(ip, regRecord)
    if (regRecord.count > 10) {
      return { success: false, message: '注册过于频繁，请明天再试' }
    }
    const { username, password, name, phone, department } = request.body
    if (!username || !password) {
      return { success: false, message: '账号和密码不能为空' }
    }
    if (password.length < 6) {
      return { success: false, message: '密码至少6位' }
    }
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username)
    if (existing) {
      return { success: false, message: '账号已存在' }
    }

    const hashed = bcrypt.hashSync(password, 10)
    const displayName = String(name || username).trim()
    const safePhone = String(phone || '').trim()
    const safeDepartment = String(department || '').trim()
    const createAccount = db.transaction(() => {
      const userResult = db.prepare(
        'INSERT INTO users (username, password, role, real_name, phone, department) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(username, hashed, 'employee', displayName, safePhone, safeDepartment)
      const employeeCode = generateEmployeeCode(db)
      const employeeResult = db.prepare(
        'INSERT INTO employees (name, department, position, phone, employee_code) VALUES (?, ?, ?, ?, ?)'
      ).run(displayName, safeDepartment || null, '新注册账号', safePhone || null, employeeCode)
      db.prepare('UPDATE users SET employee_id = ? WHERE id = ?').run(employeeResult.lastInsertRowid, userResult.lastInsertRowid)
      return {
        userId: userResult.lastInsertRowid,
        employeeId: employeeResult.lastInsertRowid,
        employeeCode
      }
    })
    const result = createAccount()

    const secret = getJwtSecret()
    const token = jwt.sign(
      { userId: result.userId, username, role: 'employee', roleVersion: 1, employeeId: result.employeeId },
      secret,
      { expiresIn: '1d' }
    )

    return {
      success: true,
      token,
      user: {
        id: result.userId,
        username,
        role: 'employee',
        onboarding_done: 0,
        real_name: displayName,
        phone: safePhone,
        department: safeDepartment,
        employee_id: result.employeeId,
        role_version: 1,
        employee_code: result.employeeCode
      }
    }
  })

  // 获取当前用户信息
  server.get('/api/me', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    try {
      const user = db.prepare(`
        SELECT id, username, role, role_version, employee_id, avatar_url, onboarding_done,
               real_name, phone, department, ai_pet_enabled, ai_auto_query, ai_name, created_at
        FROM users WHERE id = ?
      `).get(request.user.userId)
      if (!user) {
        reply.code(404).send({ success: false, message: '用户不存在' })
        return
      }
      const role = db.prepare('SELECT label FROM roles WHERE name = ?').get(user.role)
      return { success: true, user: { ...user, role_label: role?.label || user.role } }
    } catch {
      reply.code(401).send({ success: false, message: 'token 无效' })
    }
  })
}
