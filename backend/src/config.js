import crypto from 'crypto'
import jwt from 'jsonwebtoken'

let currentSecret = null
let previousSecret = null

export function initJwtConfig(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`)

  const row = db.prepare("SELECT value, updated_at FROM app_config WHERE key = 'jwt_secret'").get()
  const weekMs = 7 * 24 * 60 * 60 * 1000

  if (row) {
    const age = Date.now() - parseInt(row.updated_at)
    if (age < weekMs) {
      currentSecret = row.value
      return
    }
    previousSecret = row.value
  }

  const newSecret = crypto.randomBytes(32).toString('hex')
  db.prepare(
    'INSERT OR REPLACE INTO app_config (key, value, updated_at) VALUES (?, ?, ?)'
  ).run('jwt_secret', newSecret, String(Date.now()))
  currentSecret = newSecret
}

export function getJwtSecret() {
  return currentSecret
}

export function verifyToken(token) {
  if (currentSecret) {
    try { return jwt.verify(token, currentSecret) } catch {}
  }
  if (previousSecret) {
    try { return jwt.verify(token, previousSecret) } catch {}
  }
  throw new Error('token 无效')
}
