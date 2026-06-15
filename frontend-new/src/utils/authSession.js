const TOKEN_KEY = 'token'
const USER_KEY = 'user'

export function getAuthToken() {
  return sessionStorage.getItem(TOKEN_KEY) || ''
}

export function setAuthToken(token) {
  if (token) {
    sessionStorage.setItem(TOKEN_KEY, token)
  } else {
    sessionStorage.removeItem(TOKEN_KEY)
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
  sessionStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem(USER_KEY)
  if (options.clearRemembered) clearRememberedAuth()
  purgeLegacySharedAuth()
}

export function purgeLegacySharedAuth() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
  localStorage.removeItem('remembered-auth-v1')
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
