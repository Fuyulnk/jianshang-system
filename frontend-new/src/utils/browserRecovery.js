const RECOVERY_KEYS = [
  'theme',
  'theme-mode',
  'personal-appearance',
  'ai-pet-size',
  'ai-pet-pos',
  'ai-pet-hidden',
  'ai-pet-char',
  'account-summary-mode',
  'account-summary-month',
  'token',
  'user',
  'remembered-auth-v1',
  'jianshang-session'
]

let appMounted = false

export function markAppMounted() {
  appMounted = true
}

export function resetBrowserState() {
  for (const key of RECOVERY_KEYS) {
    safeRemove(localStorage, key)
    safeRemove(sessionStorage, key)
  }
}

export function installWhiteScreenRecovery() {
  if (typeof window === 'undefined') return
  window.addEventListener('error', event => {
    handleStartupError(event?.error?.message || event?.message || '页面脚本异常', event?.error)
  })
  window.addEventListener('unhandledrejection', event => {
    const reason = event?.reason
    handleStartupError(reason?.message || String(reason || '页面请求异常'), reason)
  })
}

export function handleStartupError(message = '页面启动失败', error = null) {
  const app = document.getElementById('app')
  const hasRenderedContent = Boolean(app?.children?.length && app.textContent?.trim())
  if (appMounted || hasRenderedContent) {
    console.error('[JianShang] 页面运行时异常', error || message)
    return
  }
  showRecoveryScreen(message)
}

export function showRecoveryScreen(message = '页面启动失败') {
  const app = document.getElementById('app')
  if (!app || app.dataset.recoveryShown === '1') return
  app.dataset.recoveryShown = '1'
  app.innerHTML = `
    <main style="min-height:100vh;display:grid;place-items:center;background:#f6f8fb;color:#172033;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif;padding:24px;">
      <section style="width:min(520px,100%);background:#fff;border:1px solid #e5eaf3;border-radius:14px;box-shadow:0 18px 48px rgba(15,23,42,.08);padding:28px;">
        <p style="margin:0 0 8px;color:#4f6df5;font-weight:700;font-size:13px;">简尚系统</p>
        <h1 style="margin:0 0 12px;font-size:24px;">页面启动失败，已进入恢复模式</h1>
        <p style="margin:0 0 18px;line-height:1.7;color:#64748b;">可能是浏览器里保存的主题、外观或登录状态损坏。点击下面按钮会清理本浏览器的简尚本地状态，然后回到登录页。</p>
        <pre style="white-space:pre-wrap;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px;color:#475569;max-height:120px;overflow:auto;">${escapeHtml(message)}</pre>
        <button id="jianshang-recover" style="width:100%;height:42px;margin-top:18px;border:0;border-radius:10px;background:#4f6df5;color:white;font-weight:700;cursor:pointer;">恢复并重新登录</button>
      </section>
    </main>
  `
  document.getElementById('jianshang-recover')?.addEventListener('click', () => {
    resetBrowserState()
    window.location.replace('/')
  })
}

function safeRemove(storage, key) {
  try {
    storage?.removeItem?.(key)
  } catch {}
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
