const SESSION_KEY = 'jianshang-session'

function readSession() {
  if (typeof sessionStorage === 'undefined') return {}
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    if (!raw) return {}
    return JSON.parse(raw) || {}
  } catch {
    sessionStorage.removeItem(SESSION_KEY)
    return {}
  }
}

function writeSession(value = {}) {
  if (typeof sessionStorage === 'undefined') return
  if (!value.token) {
    sessionStorage.removeItem(SESSION_KEY)
    return
  }
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: value.token }))
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
  if (username) localStorage.setItem('saved-username', username)
  purgeLegacySharedAuth()
}

export function clearRememberedAuth() {
  localStorage.removeItem('remember-login')
}

export function clearAuthSession(options = {}) {
  writeSession({})
  if (options.clearRemembered) clearRememberedAuth()
  purgeLegacySharedAuth()
}

export function purgeLegacySharedAuth() {
  sessionStorage.removeItem('token')
  sessionStorage.removeItem('user')
  localStorage.removeItem('token')
  localStorage.removeItem('user')
  localStorage.removeItem('remembered-auth-v1')
  if (String(window.name || '').startsWith('jianshang-auth:')) window.name = ''
}

export function getTokenPayload(token = getAuthToken()) {
  if (!token) return null
  try {
    const base64Payload = token.split('.')[1]
    if (!base64Payload) return null
    return JSON.parse(atob(base64Payload))
  } catch {
    return null
  }
}

export function isAuthTokenExpired(token = getAuthToken()) {
  const payload = getTokenPayload(token)
  if (!payload?.exp) return !token
  return payload.exp * 1000 < Date.now()
}
