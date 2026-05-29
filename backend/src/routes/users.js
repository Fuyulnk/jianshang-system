import { authMiddleware } from '../middleware/auth.js'
import bcrypt from 'bcryptjs'
import { writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import crypto from 'crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const AVATAR_DIR = join(__dirname, '../../public/avatars')

function ensureAvatarDir() {
  if (!existsSync(AVATAR_DIR)) mkdirSync(AVATAR_DIR, { recursive: true })
}

export default function userRoutes(server, db) {
  // 用户列表
  server.get('/api/users', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (request.user.role !== 'super_admin') {
      reply.code(403).send({ success: false, message: '无权限' })
      return
    }
    const users = db.prepare(`
      SELECT u.id, u.username, u.role, u.avatar_url, u.real_name, u.phone, u.department,
             r.label as role_label, u.created_at
      FROM users u LEFT JOIN roles r ON u.role = r.name
      ORDER BY u.id ASC
    `).all()
    return { success: true, data: users }
  })

  // 创建用户
  server.post('/api/users', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (request.user.role !== 'super_admin') {
      reply.code(403).send({ success: false, message: '无权限' })
      return
    }
    const { username, password, role } = request.body
    if (!username || !password) {
      return { success: false, message: '账号和密码不能为空' }
    }
    const targetRole = role || 'employee'
    if (!isValidRole(db, targetRole)) {
      return { success: false, message: '角色不存在' }
    }
    const hashed = bcrypt.hashSync(password, 10)
    try {
      const result = db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run(username, hashed, targetRole)
      return { success: true, id: result.lastInsertRowid }
    } catch {
      return { success: false, message: '账号已存在' }
    }
  })

  // 更新用户角色
  server.put('/api/users/:id/role', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (request.user.role !== 'super_admin') {
      reply.code(403).send({ success: false, message: '无权限' })
      return
    }
    const target = db.prepare('SELECT username, role FROM users WHERE id = ?').get(request.params.id)
    if (!target) {
      reply.code(404).send({ success: false, message: '用户不存在' })
      return
    }
    const { role } = request.body
    if (!isValidRole(db, role)) {
      return { success: false, message: '角色不存在' }
    }
    if (target.username === 'fuyulnk' && role !== 'super_admin') {
      reply.code(403).send({ success: false, message: '系统所有者账号不能降权' })
      return
    }
    db.prepare('UPDATE users SET role = ?, role_version = COALESCE(role_version, 1) + 1 WHERE id = ?').run(role, request.params.id)
    return { success: true }
  })

  // 删除用户
  server.delete('/api/users/:id', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (request.user.role !== 'super_admin') {
      reply.code(403).send({ success: false, message: '无权限' })
      return
    }
    const target = db.prepare('SELECT username FROM users WHERE id = ?').get(request.params.id)
    if (target?.username === 'fuyulnk') {
      reply.code(403).send({ success: false, message: '系统所有者账号不能删除' })
      return
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(request.params.id)
    return { success: true }
  })

  // 更新个人信息
  server.put('/api/profile', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    const { avatar_url } = request.body
    db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(avatar_url || '', request.user.userId)
    return { success: true }
  })

  // 修改密码
  server.put('/api/profile/password', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    const { old_password, new_password } = request.body
    if (!old_password || !new_password) return { success: false, message: '请填写旧密码和新密码' }
    if (new_password.length < 6) return { success: false, message: '新密码至少6位' }

    const user = db.prepare('SELECT password FROM users WHERE id = ?').get(request.user.userId)
    if (!bcrypt.compareSync(old_password, user.password)) {
      return { success: false, message: '旧密码错误' }
    }
    const hashed = bcrypt.hashSync(new_password, 10)
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashed, request.user.userId)
    return { success: true, message: '密码已修改' }
  })

  // 上传头像
  server.post('/api/profile/avatar', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    const { image } = request.body
    if (!image || typeof image !== 'string') {
      return { success: false, message: '请选择图片' }
    }

    try {
      const matches = image.match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/)
      if (!matches) return { success: false, message: '图片格式不支持，请使用 PNG/JPG/WebP' }

      ensureAvatarDir()
      const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1]
      const filename = `avatar_${request.user.userId}_${crypto.randomBytes(4).toString('hex')}.${ext}`
      writeFileSync(join(AVATAR_DIR, filename), matches[2], 'base64')

      const avatarUrl = `/avatars/${filename}`
      db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(avatarUrl, request.user.userId)
      return { success: true, avatar_url: avatarUrl, message: '头像已更新' }
    } catch (err) {
      return { success: false, message: '头像上传失败: ' + err.message }
    }
  })

  // 入职向导 - 保存资料并标记完成
  server.put('/api/profile/onboarding', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    const { profile = {}, prefs = {}, role } = request.body || {}
    const realName = String(profile.name || '').trim().slice(0, 20)
    const phone = String(profile.phone || '').trim().slice(0, 20)
    const department = String(profile.department || '').trim().slice(0, 30)
    const aiName = String(prefs.ai_name || '简尚小助手').trim().slice(0, 20) || '简尚小助手'
    if (role && role !== request.user.role) {
      return { success: false, message: '岗位由超级管理员分配，入职向导只保存个人资料和 AI 偏好' }
    }

    db.prepare(`
      UPDATE users
      SET real_name = ?, phone = ?, department = ?,
          ai_pet_enabled = ?, ai_auto_query = ?, ai_name = ?,
          onboarding_done = 1
      WHERE id = ?
    `).run(
      realName,
      phone,
      department,
      prefs.pet_enabled === false ? 0 : 1,
      prefs.auto_query === false ? 0 : 1,
      aiName,
      request.user.userId
    )

    return { success: true, message: '入职向导已完成' }
  })
}

function isValidRole(db, role) {
  if (!role) return false
  return !!db.prepare('SELECT 1 FROM roles WHERE name = ?').get(role)
}
