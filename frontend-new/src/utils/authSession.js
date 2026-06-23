const SESSION_KEY = 'jianshang-session'

function readSession() {
  if (typeof sessionStorage === 'undefined') return {}
  try {
    const raw = safeStorageGet(sessionStorage, SESSION_KEY)
    if (!raw) return {}
    return JSON.parse(raw) || {}
  } catch {
    safeStorageRemove(sessionStorage, SESSION_KEY)
    return {}
  }
}

function writeSession(value = {}) {
  if (typeof sessionStorage === 'undefined') return
  if (!value.token) {
    safeStorageRemove(sessionStorage, SESSION_KEY)
    return
  }
  safeStorageSet(sessionStorage, SESSION_KEY, JSON.stringify({ token: value.token }))
}

export function getAuthToken() {
  return readSession().token || ''
}

export function setAuthToken(token) {
  if (token) {
    writeSession({ token })
  } else {
    writeSession({})
  }
  purgeLegacySharedAuth()
}

export function rememberAuthToken(token, username = '') {
  if (username && typeof localStorage !== 'undefined') safeStorageSet(localStorage, 'saved-username', username)
  purgeLegacySharedAuth()
}

export function clearRememberedAuth() {
  if (typeof localStorage !== 'undefined') safeStorageRemove(localStorage, 'remember-login')
}

export function clearAuthSession(options = {}) {
  writeSession({})
  if (options.clearRemembered) clearRememberedAuth()
  purgeLegacySharedAuth()
}

export function purgeLegacySharedAuth() {
  if (typeof sessionStorage !== 'undefined') {
    safeStorageRemove(sessionStorage, 'token')
    safeStorageRemove(sessionStorage, 'user')
  }
  if (typeof localStorage !== 'undefined') {
    safeStorageRemove(localStorage, 'token')
    safeStorageRemove(localStorage, 'user')
    safeStorageRemove(localStorage, 'remembered-auth-v1')
  }
  if (typeof window !== 'undefined' && String(window.name || '').startsWith('jianshang-auth:')) window.name = ''
}

export function getTokenPayload(token = getAuthToken()) {
  if (!token) return null
  try {
    const base64Payload = token.split('.')[1]
    if (!base64Payload) return null
    return JSON.parse(decodeBase64Url(base64Payload))
  } catch {
    return null
  }
}

export function isAuthTokenExpired(token = getAuthToken()) {
  const payload = getTokenPayload(token)
  if (!payload?.exp) return !token
  return payload.exp * 1000 < Date.now()
}

function decodeBase64Url(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  try {
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return binary
  }
}

function safeStorageGet(storage, key) {
  try {
    return storage.getItem(key)
  } catch {
    return null
  }
}

function safeStorageSet(storage, key, value) {
  try {
    storage.setItem(key, value)
  } catch {}
}

function safeStorageRemove(storage, key) {
  try {
    storage.removeItem(key)
  } catch {}
}
