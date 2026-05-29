import { fileURLToPath } from 'url'
import { dirname, join, resolve } from 'path'
import { spawn } from 'child_process'
import dotenv from 'dotenv'
import fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import Database from 'better-sqlite3'
import fs from 'fs'
import { Server as SocketIOServer } from 'socket.io'

import authRoutes from './routes/auth.js'
import accountRoutes from './routes/accounts.js'
import transactionRoutes from './routes/transactions.js'
import productRoutes from './routes/products.js'
import employeeRoutes from './routes/employees.js'
import aiRoutes from './routes/ai.js'
import aiPermissionsRoutes from './routes/ai-permissions.js'
import kbRoutes from './routes/knowledge-base.js'
import userRoutes from './routes/users.js'
import roleRoutes from './routes/roles.js'
import chatRoutes from './routes/chat.js'
import projectRoutes from './routes/projects.js'
import settingsRoutes from './routes/settings.js'
import financeRoutes from './routes/finance.js'
import employeeDashboardRoutes from './routes/employee-dashboard.js'
import { setAuthDb, resolveFreshUser } from './middleware/auth.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

import { initJwtConfig, verifyToken } from './config.js'

// 加载 .env
dotenv.config({ path: resolve(__dirname, '../.env') })

// 确保数据库目录存在
const dbPath = join(process.env.HOME, 'fuyulnk', 'jianshang.db')
const dbDir = dirname(dbPath)
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true })
}

const db = new Database(dbPath)
setAuthDb(db)

// 初始化 JWT 配置（自动轮换密钥）
initJwtConfig(db)

// 添加入职向导字段
try { db.exec('ALTER TABLE users ADD COLUMN onboarding_done INTEGER DEFAULT 0') } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN real_name TEXT DEFAULT ''") } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN phone TEXT DEFAULT ''") } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN department TEXT DEFAULT ''") } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN ai_pet_enabled INTEGER DEFAULT 1') } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN ai_auto_query INTEGER DEFAULT 1') } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN ai_name TEXT DEFAULT '简尚小助手'") } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN role_version INTEGER DEFAULT 1') } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN employee_id INTEGER DEFAULT 0') } catch {}
try { db.prepare("UPDATE users SET role = 'super_admin' WHERE username = 'fuyulnk'").run() } catch {}
// 工程订单分配字段：先以系统用户为责任主体，后续可再和员工档案强绑定。
try { db.exec('ALTER TABLE projects ADD COLUMN manager_user_id INTEGER DEFAULT 0') } catch {}
try { db.exec('ALTER TABLE projects ADD COLUMN assignee_user_id INTEGER DEFAULT 0') } catch {}
try { db.exec('ALTER TABLE chat_history ADD COLUMN user_id INTEGER DEFAULT 0') } catch {}
try {
  const owner = db.prepare("SELECT id FROM users WHERE username = 'fuyulnk'").get()
  if (owner) db.prepare('UPDATE chat_history SET user_id = ? WHERE COALESCE(user_id, 0) = 0').run(owner.id)
} catch {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_chat_history_user_session ON chat_history(user_id, session_id, id)') } catch {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_projects_assignee ON projects(assignee_user_id)') } catch {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_projects_manager ON projects(manager_user_id)') } catch {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_projects_created_by ON projects(created_by)') } catch {}
// 升级上来的老用户标记已完成（仅一次）
const migrated = db.prepare("SELECT value FROM app_config WHERE key = 'migrate_onboarding'").get()
if (!migrated) {
  db.prepare('UPDATE users SET onboarding_done = 1').run()
  db.prepare("INSERT OR IGNORE INTO app_config (key, value, updated_at) VALUES ('migrate_onboarding', '1', ?)").run(String(Date.now()))
}

// 创建 AI 工具权限表
db.exec(`
  CREATE TABLE IF NOT EXISTS ai_role_tools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role_id INTEGER NOT NULL REFERENCES roles(id),
    tool_name TEXT NOT NULL,
    allowed INTEGER DEFAULT 0,
    UNIQUE(role_id, tool_name)
  );
  CREATE TABLE IF NOT EXISTS ai_user_tools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    tool_name TEXT NOT NULL,
    allowed INTEGER DEFAULT 0,
    UNIQUE(user_id, tool_name)
  )
`)

db.exec(`
  CREATE TABLE IF NOT EXISTS ai_audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER DEFAULT 0,
    employee_id INTEGER DEFAULT 0,
    role TEXT DEFAULT '',
    action_type TEXT NOT NULL,
    tool_name TEXT DEFAULT '',
    request_summary TEXT DEFAULT '',
    result_summary TEXT DEFAULT '',
    status TEXT DEFAULT 'ok',
    error_message TEXT DEFAULT '',
    model TEXT DEFAULT '',
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    duration_ms INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now', 'localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_ai_audit_user_time ON ai_audit_logs(user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_ai_audit_action_time ON ai_audit_logs(action_type, created_at)
`)

// 种子 AI 工具权限（仅首次）
const toolCount = db.prepare('SELECT COUNT(*) as c FROM ai_role_tools').get().c
if (toolCount === 0) {
  const allTools = [
    'get_accounts', 'get_transactions', 'get_today_summary', 'get_products',
    'get_employees', 'get_projects', 'get_system_stats', 'create_transaction', 'create_account'
  ]
  const roles = db.prepare('SELECT id, name FROM roles').all()
  const stmt = db.prepare('INSERT OR IGNORE INTO ai_role_tools (role_id, tool_name, allowed) VALUES (?, ?, ?)')

  for (const role of roles) {
    if (role.name === 'super_admin') {
      for (const t of allTools) stmt.run(role.id, t, 1)
    } else if (role.name === 'finance') {
      for (const t of allTools) stmt.run(role.id, t, ['get_accounts','get_transactions','get_today_summary','get_system_stats'].includes(t) ? 1 : 0)
    } else if (role.name === 'warehouse') {
      for (const t of allTools) stmt.run(role.id, t, ['get_products','get_system_stats'].includes(t) ? 1 : 0)
    } else {
      for (const t of allTools) stmt.run(role.id, t, ['get_system_stats','get_projects'].includes(t) ? 1 : 0)
    }
  }
}

const server = fastify({
  logger: true,
  bodyLimit: 1048576 * 10
})

// 静态文件
server.register(fastifyStatic, {
  root: join(__dirname, '../public'),
  prefix: '/',
  wildcard: false,
  setHeaders: (res, path) => {
    if (path.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript')
    else if (path.endsWith('.css')) res.setHeader('Content-Type', 'text/css')
  }
})

server.get('/health', async () => ({
  status: 'ok', message: '简尚系统运行中', time: new Date().toISOString()
}))

server.get('/api', async () => ({
  name: '简尚系统', version: '1.0.0', message: '欢迎使用简尚系统 API'
}))

// CORS
server.addHook('onRequest', (request, reply, done) => {
  reply.header('Access-Control-Allow-Origin', '*')
  reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (request.method === 'OPTIONS') { reply.code(204).send(); return }
  done()
})

// 注册路由
authRoutes(server, db)
accountRoutes(server, db)
transactionRoutes(server, db)
productRoutes(server, db)
employeeRoutes(server, db)
aiRoutes(server, db)
aiPermissionsRoutes(server, db)
kbRoutes(server, db)
userRoutes(server, db)
roleRoutes(server, db)
chatRoutes(server, db)
projectRoutes(server, db)
settingsRoutes(server, db)
financeRoutes(server, db)
employeeDashboardRoutes(server, db)

// SPA 回退
server.setNotFoundHandler((request, reply) => {
  if (!request.url.startsWith('/api') && !request.url.startsWith('/health')) {
    reply.sendFile('index.html')
  } else {
    reply.code(404).send({ error: 'Not found' })
  }
})

// 启动
const start = async () => {
  try {
    // 启动知识库搜索服务器
    const kbScript = join(process.env.HOME, '.openclaw/workspace/scripts/search-server.py')
    if (fs.existsSync(kbScript)) {
      const kbProcess = spawn('python3', [kbScript], {
        stdio: 'pipe',
        detached: false,
      })
      kbProcess.stdout.on('data', (d) => process.stdout.write(d))
      kbProcess.stderr.on('data', (d) => process.stderr.write(d))
      kbProcess.on('error', (err) => console.error('知识库服务启动失败:', err.message))
      kbProcess.on('exit', (code) => console.log(`知识库服务退出 (code: ${code})`))
      // 等一会儿让服务器启动
      await new Promise(r => setTimeout(r, 3000))
    }

    const port = parseInt(process.env.PORT || '3000')
    await server.listen({ port, host: '0.0.0.0' })
    console.log(`简尚系统后端启动成功！地址：http://localhost:${port}`)

    // Socket.io 实时通信
    const io = new SocketIOServer(server.server, {
      cors: { origin: '*', methods: ['GET', 'POST'] }
    })

    io.use((socket, next) => {
      const token = socket.handshake.auth?.token
      if (!token) return next(new Error('未登录'))
      try {
        const decoded = verifyToken(token)
        socket.user = resolveFreshUser(decoded)
        next()
      } catch (err) {
        next(new Error(err.message || 'token 无效'))
      }
    })

    io.on('connection', (socket) => {
      console.log(`用户 ${socket.user.username} 已连接`)

      socket.on('join:conversation', (convId) => {
        socket.join(`conv:${convId}`)
      })

      socket.on('leave:conversation', (convId) => {
        socket.leave(`conv:${convId}`)
      })

      socket.on('message:send', async ({ conversation_id, content }) => {
        if (!content?.trim()) return

        // Verify user is a participant of this conversation
        const participant = db.prepare(
          'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
        ).get(conversation_id, socket.user.userId)
        if (!participant) return

        const result = db.prepare(
          'INSERT INTO messages (conversation_id, user_id, content) VALUES (?, ?, ?)'
        ).run(conversation_id, socket.user.userId, content.trim())

        const msg = db.prepare(`
          SELECT m.*, u.username, u.avatar_url FROM messages m
          JOIN users u ON m.user_id = u.id WHERE m.id = ?
        `).get(result.lastInsertRowid)

        io.to(`conv:${conversation_id}`).emit('message:new', msg)

        // 群聊 @AI 自动回复
        const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversation_id)
        if (conv?.type === 'group' && /@(AI|小助手|ai)/.test(content)) {
          const question = content.replace(/@(AI|小助手|ai)\s*/g, '').trim() || content
          try {
            const aiUser = db.prepare("SELECT id FROM users WHERE username = 'ai'").get()
            if (!aiUser) return

            const settings = getSystemSettings(db)
            const config = {
              apiKey: process.env.AI_API_KEY || '',
              model: settings.ai_model || process.env.AI_MODEL || 'deepseek-chat',
              maxTokens: parseInt(settings.ai_max_tokens || process.env.AI_MAX_TOKENS || '1024'),
              temperature: parseFloat(settings.ai_temperature || process.env.AI_TEMPERATURE || '0.7')
            }
            if (!config.apiKey) return

            // 搜索知识库
            let kbContext = ''
            try {
              const kbRes = await fetch('http://127.0.0.1:18790/search', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: question, top_k: 3, threshold: 0.25, allow_categories: true }),
                signal: AbortSignal.timeout(5000),
              })
              if (kbRes.ok) {
                const kbData = await kbRes.json()
                if (kbData.length > 0) {
                  kbContext = '\n\n参考资料：\n' + kbData.map((r, i) =>
                    `[${i + 1}] ${r.source}\n${r.content}`
                  ).join('\n\n')
                }
              }
            } catch {}

            const response = await fetch('https://api.deepseek.com/chat/completions', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey}`
              },
              body: JSON.stringify({
                model: config.model,
                messages: [
                  { role: 'system', content: `你叫"简尚小助手"，是简尚系统的智能助手。你在群聊中被 @ 了，请简洁回答问题。当前提问者：${socket.user.username}${kbContext}` },
                  { role: 'user', content: question }
                ],
                max_tokens: config.maxTokens,
                temperature: config.temperature,
                stream: false
              })
            })

            if (!response.ok) return
            const json = await response.json()
            const reply = json.choices?.[0]?.message?.content
            if (!reply) return

            // 发送 AI 回复到群聊，带上 @ 提问者
            const aiResult = db.prepare(
              'INSERT INTO messages (conversation_id, user_id, content) VALUES (?, ?, ?)'
            ).run(conversation_id, aiUser.id, `@${socket.user.username} ${reply}`)

            const aiMsg = db.prepare(`
              SELECT m.*, u.username, u.avatar_url FROM messages m
              JOIN users u ON m.user_id = u.id WHERE m.id = ?
            `).get(aiResult.lastInsertRowid)

            io.to(`conv:${conversation_id}`).emit('message:new', aiMsg)
          } catch (err) {
            console.error('AI 回复失败:', err.message)
          }
        }
      })

      socket.on('disconnect', () => {
        console.log(`用户 ${socket.user.username} 已断开`)
      })
    })
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }
}

function getSystemSettings(db) {
  try {
    const rows = db.prepare('SELECT key, value FROM system_settings').all()
    return Object.fromEntries(rows.map(r => [r.key, r.value]))
  } catch {
    return {}
  }
}

start()
