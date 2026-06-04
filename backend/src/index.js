import { fileURLToPath } from 'url'
import { dirname, join, resolve } from 'path'
import { spawn } from 'child_process'
import dotenv from 'dotenv'
import fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import Database from 'better-sqlite3'
import fs from 'fs'
import { Server as SocketIOServer } from 'socket.io'
import bcrypt from 'bcryptjs'

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
import projectImportRoutes from './routes/project-imports.js'
import materialRequestRoutes from './routes/material-requests.js'
import settingsRoutes from './routes/settings.js'
import financeRoutes from './routes/finance.js'
import employeeDashboardRoutes from './routes/employee-dashboard.js'
import fileRoutes from './routes/files.js'
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
ensureCoreTables(db)
ensureProjectTables(db)

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
try { db.exec('ALTER TABLE employees ADD COLUMN employee_code TEXT') } catch {}
try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_employee_id_unique ON users(employee_id) WHERE employee_id > 0') } catch {}
try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_code_unique ON employees(employee_code) WHERE employee_code IS NOT NULL AND employee_code != ''") } catch {}
try {
  const employeesWithoutCode = db.prepare(`
    SELECT id FROM employees
    WHERE employee_code IS NULL OR employee_code = ''
  `).all()
  const updateEmployeeCode = db.prepare('UPDATE employees SET employee_code = ? WHERE id = ?')
  for (const employee of employeesWithoutCode) {
    updateEmployeeCode.run(generateEmployeeCode(db), employee.id)
  }
} catch {}
// 项目工单分配字段：先以系统用户为责任主体，后续可再和员工档案强绑定。
try { db.exec('ALTER TABLE projects ADD COLUMN manager_user_id INTEGER DEFAULT 0') } catch {}
try { db.exec('ALTER TABLE projects ADD COLUMN assignee_user_id INTEGER DEFAULT 0') } catch {}
try { db.exec("ALTER TABLE projects ADD COLUMN address_province TEXT DEFAULT ''") } catch {}
try { db.exec("ALTER TABLE projects ADD COLUMN address_city TEXT DEFAULT ''") } catch {}
try { db.exec("ALTER TABLE projects ADD COLUMN address_detail TEXT DEFAULT ''") } catch {}
try { db.exec("ALTER TABLE projects ADD COLUMN order_taker TEXT DEFAULT ''") } catch {}
try { db.exec("ALTER TABLE projects ADD COLUMN order_date TEXT DEFAULT ''") } catch {}
try { db.exec("ALTER TABLE projects ADD COLUMN external_order_no TEXT DEFAULT ''") } catch {}
try { db.exec("ALTER TABLE projects ADD COLUMN handover_note TEXT DEFAULT ''") } catch {}
try { db.exec('ALTER TABLE projects ADD COLUMN created_by INTEGER DEFAULT 0') } catch {}
try { db.exec("ALTER TABLE projects ADD COLUMN crew_member_user_ids TEXT DEFAULT '[]'") } catch {}
try { db.exec("ALTER TABLE projects ADD COLUMN crew_status TEXT DEFAULT 'pending'") } catch {}
try { db.exec("ALTER TABLE projects ADD COLUMN material_out_status TEXT DEFAULT 'pending'") } catch {}
try { db.exec("ALTER TABLE projects ADD COLUMN material_out_note TEXT DEFAULT ''") } catch {}
try { db.exec("ALTER TABLE projects ADD COLUMN material_return_status TEXT DEFAULT 'pending'") } catch {}
try { db.exec("ALTER TABLE projects ADD COLUMN material_return_note TEXT DEFAULT ''") } catch {}
try { db.exec("UPDATE projects SET address_detail = address WHERE COALESCE(address_detail, '') = '' AND COALESCE(address, '') != ''") } catch {}
try {
  const owner = db.prepare("SELECT id FROM users WHERE username = 'fuyulnk'").get()
  if (owner) db.prepare('UPDATE projects SET created_by = ? WHERE COALESCE(created_by, 0) = 0').run(owner.id)
} catch {}
try { db.exec('ALTER TABLE chat_history ADD COLUMN user_id INTEGER DEFAULT 0') } catch {}
try {
  const owner = db.prepare("SELECT id FROM users WHERE username = 'fuyulnk'").get()
  if (owner) db.prepare('UPDATE chat_history SET user_id = ? WHERE COALESCE(user_id, 0) = 0').run(owner.id)
} catch {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_chat_history_user_session ON chat_history(user_id, session_id, id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_projects_assignee ON projects(assignee_user_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_projects_manager ON projects(manager_user_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_projects_created_by ON projects(created_by)') } catch {}
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_import_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type TEXT NOT NULL DEFAULT 'text',
      file_name TEXT DEFAULT '',
      raw_summary TEXT DEFAULT '',
      raw_content TEXT DEFAULT '',
      item_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'parsed',
      created_by INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );
    CREATE TABLE IF NOT EXISTS project_import_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL,
      item_index INTEGER DEFAULT 0,
      ai_draft TEXT DEFAULT '{}',
      confirmed_draft TEXT DEFAULT '{}',
      field_diff TEXT DEFAULT '{}',
      missing_fields TEXT DEFAULT '[]',
      duplicate_matches TEXT DEFAULT '[]',
      status TEXT DEFAULT 'draft',
      project_id INTEGER DEFAULT 0,
      error_message TEXT DEFAULT '',
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );
    CREATE TABLE IF NOT EXISTS project_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      document_type TEXT NOT NULL DEFAULT 'briefing',
      source_attachment_id INTEGER DEFAULT 0,
      status TEXT DEFAULT 'draft',
      parsed_data TEXT DEFAULT '{}',
      confirmed_data TEXT DEFAULT '{}',
      warnings TEXT DEFAULT '[]',
      created_by INTEGER DEFAULT 0,
      updated_by INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_project_import_batches_created_by ON project_import_batches(created_by, created_at);
    CREATE INDEX IF NOT EXISTS idx_project_import_items_batch ON project_import_items(batch_id, status);
    CREATE INDEX IF NOT EXISTS idx_project_documents_project_type ON project_documents(project_id, document_type, updated_at);
  `)
} catch {}
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
    'get_employees', 'get_projects', 'get_system_stats', 'create_transaction', 'create_account',
    'parse_project_handover', 'create_project_workorder'
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
ensureAiToolPermissionRows(db)

const server = fastify({
  logger: true,
  bodyLimit: 1048576 * 20
})
const realtime = { io: null }

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

// CORS — 只允许前端来源
const ALLOWED_ORIGINS = ['http://127.0.0.1:5173', 'http://localhost:5173', 'http://8.135.8.37:3000']
server.addHook('onRequest', (request, reply, done) => {
  const origin = request.headers.origin
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    reply.header('Access-Control-Allow-Origin', origin)
  } else if (!origin) {
    // 同源请求或无 origin（如 curl）放行
    reply.header('Access-Control-Allow-Origin', '*')
  }
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
chatRoutes(server, db, realtime)
projectRoutes(server, db)
projectImportRoutes(server, db)
materialRequestRoutes(server, db)
settingsRoutes(server, db)
financeRoutes(server, db)
employeeDashboardRoutes(server, db)
fileRoutes(server, db)

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
    realtime.io = io

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
        // 校验用户是否为会话参与者
        const participant = db.prepare(
          'SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND user_id = ?'
        ).get(convId, socket.user.userId)
        if (participant) {
          socket.join(`conv:${convId}`)
        }
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

function generateEmployeeCode(db) {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  for (let attempt = 0; attempt < 100; attempt++) {
    let prefix = ''
    for (let i = 0; i < 2; i++) prefix += letters[Math.floor(Math.random() * letters.length)]
    const digits = String(Math.floor(Math.random() * 1000000)).padStart(6, '0')
    const code = `JS-${prefix}${digits}`
    if (!db.prepare('SELECT 1 FROM employees WHERE employee_code = ?').get(code)) return code
  }
  return `JS-${Date.now()}`
}

start()

function ensureProjectTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      customer TEXT NOT NULL,
      phone TEXT DEFAULT '',
      address TEXT DEFAULT '',
      address_province TEXT DEFAULT '',
      address_city TEXT DEFAULT '',
      address_detail TEXT DEFAULT '',
      source TEXT DEFAULT '',
      order_taker TEXT DEFAULT '',
      order_date TEXT DEFAULT '',
      external_order_no TEXT DEFAULT '',
      handover_note TEXT DEFAULT '',
      status TEXT DEFAULT 'handover_received',
      manager_user_id INTEGER DEFAULT 0,
      assignee_user_id INTEGER DEFAULT 0,
      crew_member_user_ids TEXT DEFAULT '[]',
      crew_status TEXT DEFAULT 'pending',
      material_out_status TEXT DEFAULT 'pending',
      material_out_note TEXT DEFAULT '',
      material_return_status TEXT DEFAULT 'pending',
      material_return_note TEXT DEFAULT '',
      survey_report TEXT DEFAULT '',
      survey_date TEXT DEFAULT '',
      team_leader TEXT DEFAULT '',
      briefing_date TEXT DEFAULT '',
      condition_note TEXT DEFAULT '',
      start_date TEXT DEFAULT '',
      expected_end_date TEXT DEFAULT '',
      construction_note TEXT DEFAULT '',
      end_date TEXT DEFAULT '',
      acceptance_date TEXT DEFAULT '',
      total_amount REAL DEFAULT 0,
      deposit_amount REAL DEFAULT 0,
      settlement_amount REAL DEFAULT 0,
      created_by INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS project_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      operator TEXT DEFAULT '',
      content TEXT DEFAULT '',
      created_at DATETIME DEFAULT (datetime('now', 'localtime'))
    )
  `)
}

function ensureCoreTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'employee',
      avatar_url TEXT DEFAULT '',
      onboarding_done INTEGER DEFAULT 0,
      real_name TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      department TEXT DEFAULT '',
      ai_pet_enabled INTEGER DEFAULT 1,
      ai_auto_query INTEGER DEFAULT 1,
      ai_name TEXT DEFAULT '简尚小助手',
      role_version INTEGER DEFAULT 1,
      employee_id INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT DEFAULT 'personal',
      initial_balance REAL DEFAULT 0,
      current_balance REAL DEFAULT 0,
      updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      category TEXT,
      description TEXT,
      party TEXT,
      proxy TEXT,
      status TEXT DEFAULT 'approved',
      created_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT,
      unit TEXT DEFAULT 'kg',
      stock REAL DEFAULT 0,
      min_stock REAL DEFAULT 0,
      updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS material_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      status TEXT DEFAULT 'requested',
      note TEXT DEFAULT '',
      requested_by INTEGER DEFAULT 0,
      confirmed_by INTEGER DEFAULT 0,
      confirmed_at TEXT DEFAULT '',
      confirm_note TEXT DEFAULT '',
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS material_request_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      category TEXT DEFAULT '',
      unit TEXT DEFAULT '',
      quantity REAL DEFAULT 0,
      note TEXT DEFAULT '',
      created_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_code TEXT UNIQUE,
      name TEXT NOT NULL,
      department TEXT,
      position TEXT,
      phone TEXT,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS chat_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER DEFAULT 0,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      session_id TEXT NOT NULL,
      created_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      label TEXT NOT NULL,
      description TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS role_permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role_id INTEGER NOT NULL,
      module TEXT NOT NULL,
      can_view INTEGER DEFAULT 1,
      can_create INTEGER DEFAULT 0,
      can_edit INTEGER DEFAULT 0,
      can_delete INTEGER DEFAULT 0,
      data_scope TEXT DEFAULT 'all',
      UNIQUE(role_id, module)
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      name TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS conversation_participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(conversation_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      message_type TEXT DEFAULT 'text',
      file_id INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS chat_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      message_id INTEGER DEFAULT 0,
      uploaded_by INTEGER NOT NULL,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      mime_type TEXT DEFAULT 'application/octet-stream',
      size INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      mime_type TEXT DEFAULT 'application/octet-stream',
      size INTEGER DEFAULT 0,
      checksum TEXT DEFAULT '',
      uploaded_by INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      deleted_at TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS private_workspaces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      owner_user_id INTEGER NOT NULL,
      description TEXT DEFAULT '',
      workspace_type TEXT DEFAULT 'director',
      created_by INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      archived_at TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS resource_access_grants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      resource_type TEXT NOT NULL,
      resource_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      granted_by INTEGER DEFAULT 0,
      can_view INTEGER DEFAULT 1,
      can_create INTEGER DEFAULT 0,
      can_edit INTEGER DEFAULT 0,
      can_delete INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      revoked_at TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS access_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER DEFAULT 0,
      employee_id INTEGER DEFAULT 0,
      role TEXT DEFAULT '',
      action TEXT NOT NULL,
      resource_type TEXT DEFAULT '',
      resource_id INTEGER DEFAULT 0,
      module TEXT DEFAULT '',
      status TEXT DEFAULT 'ok',
      summary TEXT DEFAULT '',
      created_at DATETIME DEFAULT (datetime('now', 'localtime'))
    )
  `)

  try { db.exec('ALTER TABLE conversations ADD COLUMN created_by INTEGER DEFAULT 0') } catch {}
  try { db.exec("ALTER TABLE messages ADD COLUMN message_type TEXT DEFAULT 'text'") } catch {}
  try { db.exec('ALTER TABLE messages ADD COLUMN file_id INTEGER DEFAULT 0') } catch {}
  try { db.exec("ALTER TABLE users ADD COLUMN avatar_url TEXT DEFAULT ''") } catch {}
  try { db.exec("ALTER TABLE role_permissions ADD COLUMN data_scope TEXT DEFAULT 'all'") } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_attachments_entity ON attachments(entity_type, entity_id, deleted_at)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_attachments_uploaded_by ON attachments(uploaded_by, created_at)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_material_requests_project ON material_requests(project_id, status, created_at)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_material_requests_status ON material_requests(status, created_at)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_material_request_items_request ON material_request_items(request_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_private_workspaces_owner ON private_workspaces(owner_user_id, archived_at)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_resource_access_grants_resource ON resource_access_grants(resource_type, resource_id, user_id, revoked_at)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_access_audit_user_time ON access_audit_logs(user_id, created_at)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_access_audit_resource_time ON access_audit_logs(resource_type, resource_id, created_at)') } catch {}

  const roles = [
    ['super_admin', '超级管理员', '系统所有权限'],
    ['admin', '管理员', '日常管理权限'],
    ['finance', '财务部', '账户、流水、结算相关权限'],
    ['warehouse', '仓库部', '产品库存、材料出入库相关权限'],
    ['engineering', '工程部', '项目工单、施工班组相关权限'],
    ['employee', '员工', '普通员工工作台权限'],
  ]
  const roleStmt = db.prepare('INSERT OR IGNORE INTO roles (name, label, description) VALUES (?, ?, ?)')
  for (const role of roles) roleStmt.run(...role)

  const ownerPassword = bcrypt.hashSync('123456', 10)
  db.prepare(`
    INSERT OR IGNORE INTO users (username, password, role, onboarding_done)
    VALUES ('fuyulnk', ?, 'super_admin', 1)
  `).run(ownerPassword)
  db.prepare("UPDATE users SET role = 'super_admin', onboarding_done = 1 WHERE username = 'fuyulnk'").run()

  const modules = ['dashboard', 'accounts', 'transactions', 'products', 'employees', 'users', 'roles', 'projects', 'chat', 'finance']
  const roleRows = db.prepare('SELECT id, name FROM roles').all()
  const permStmt = db.prepare(`
    INSERT OR IGNORE INTO role_permissions
      (role_id, module, can_view, can_create, can_edit, can_delete, data_scope)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  for (const role of roleRows) {
    for (const module of modules) {
      const perm = defaultPermission(role.name, module)
      permStmt.run(role.id, module, perm.view, perm.create, perm.edit, perm.delete, perm.scope)
    }
  }
  try { db.prepare("DELETE FROM role_permissions WHERE module = 'orders'").run() } catch {}
  migrateRolePermissionScopes(db)
}

function migrateRolePermissionScopes(db) {
  const key = 'migrate_role_permission_scopes_20260602'
  if (db.prepare('SELECT value FROM app_config WHERE key = ?').get(key)) return

  const rows = db.prepare(`
    SELECT rp.id, rp.module, r.name as role_name
    FROM role_permissions rp
    JOIN roles r ON rp.role_id = r.id
  `).all()
  const updateScope = db.prepare('UPDATE role_permissions SET data_scope = ? WHERE id = ?')
  for (const row of rows) {
    updateScope.run(defaultPermission(row.role_name, row.module).scope, row.id)
  }
  db.prepare('INSERT OR REPLACE INTO app_config (key, value, updated_at) VALUES (?, ?, ?)')
    .run(key, '1', String(Date.now()))
}

function defaultPermission(role, module) {
  if (role === 'super_admin' || role === 'admin') return { view: 1, create: 1, edit: 1, delete: 1, scope: 'all' }
  if (role === 'finance') {
    return {
      view: ['dashboard', 'accounts', 'transactions', 'projects', 'chat', 'finance'].includes(module) ? 1 : 0,
      create: ['transactions', 'chat'].includes(module) ? 1 : 0,
      edit: ['transactions', 'projects', 'chat'].includes(module) ? 1 : 0,
      delete: 0,
      scope: ['accounts', 'transactions', 'finance'].includes(module) ? 'all' : 'project_related'
    }
  }
  if (role === 'warehouse') {
    return {
      view: ['dashboard', 'products', 'projects', 'chat'].includes(module) ? 1 : 0,
      create: ['products', 'chat'].includes(module) ? 1 : 0,
      edit: ['products', 'projects', 'chat'].includes(module) ? 1 : 0,
      delete: 0,
      scope: ['products'].includes(module) ? 'all' : 'project_related'
    }
  }
  if (role === 'engineering') {
    return {
      view: ['dashboard', 'projects', 'products', 'chat'].includes(module) ? 1 : 0,
      create: ['projects', 'chat'].includes(module) ? 1 : 0,
      edit: ['projects', 'chat'].includes(module) ? 1 : 0,
      delete: 0,
      scope: module === 'projects' ? 'all' : 'project_related'
    }
  }
  return {
    view: ['dashboard', 'projects', 'chat'].includes(module) ? 1 : 0,
    create: module === 'chat' ? 1 : 0,
    edit: ['projects', 'chat'].includes(module) ? 1 : 0,
    delete: 0,
    scope: module === 'projects' ? 'project_related' : 'self'
  }
}

function ensureAiToolPermissionRows(db) {
  const allTools = [
    'get_accounts', 'get_transactions', 'get_today_summary', 'get_products',
    'get_employees', 'get_projects', 'get_system_stats', 'create_transaction', 'create_account',
    'parse_project_handover', 'create_project_workorder'
  ]
  const roles = db.prepare('SELECT id, name FROM roles').all()
  const stmt = db.prepare('INSERT OR IGNORE INTO ai_role_tools (role_id, tool_name, allowed) VALUES (?, ?, ?)')
  for (const role of roles) {
    for (const tool of allTools) {
      const allowed = defaultAiToolAllowed(role.name, tool)
      stmt.run(role.id, tool, allowed)
    }
  }
}

function defaultAiToolAllowed(role, tool) {
  if (role === 'super_admin') return 1
  if (role === 'admin') return ['get_accounts', 'get_transactions', 'get_today_summary', 'get_products', 'get_employees', 'get_projects', 'get_system_stats', 'parse_project_handover', 'create_project_workorder'].includes(tool) ? 1 : 0
  if (role === 'finance') return ['get_accounts', 'get_transactions', 'get_today_summary', 'get_system_stats'].includes(tool) ? 1 : 0
  if (role === 'warehouse') return ['get_products', 'get_system_stats'].includes(tool) ? 1 : 0
  if (role === 'engineering') return ['get_projects', 'get_products', 'get_system_stats', 'parse_project_handover', 'create_project_workorder'].includes(tool) ? 1 : 0
  return ['get_system_stats', 'get_projects'].includes(tool) ? 1 : 0
}
