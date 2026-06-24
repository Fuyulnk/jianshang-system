import { fileURLToPath } from 'url'
import { dirname, join, resolve } from 'path'
import { homedir } from 'os'
import { spawn } from 'child_process'
import dotenv from 'dotenv'
import fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import zlib from 'zlib'
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
import supplyOrderRoutes from './routes/supply-orders.js'
import settingsRoutes from './routes/settings.js'
import financeRoutes from './routes/finance.js'
import employeeDashboardRoutes from './routes/employee-dashboard.js'
import fileRoutes from './routes/files.js'
import { setAuthDb, resolveFreshUser } from './middleware/auth.js'
import { AI_TOOL_REGISTRY, DEFAULT_AI_AGENTS } from './ai/toolRegistry.js'
import { ensureSchemaVersions, recordFrameworkBaseline } from './db/schemaVersions.js'
import { runV2Cleanup } from './db/migrations/v2-schema-cleanup.js'
import { runWarehouseV2Schema } from './db/migrations/warehouse-v2.js'
import { ensureSystemDocumentTemplates } from './db/documentTemplates.js'
import { handleFinanceGroupMessage } from './services/chatFinanceBot.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

import { initJwtConfig, verifyToken } from './config.js'

// 加载 .env
dotenv.config({ path: resolve(__dirname, '../.env') })

// 确保数据库目录存在
const dbPath = join(process.env.HOME || homedir(), 'fuyulnk', 'jianshang.db')
const dbDir = dirname(dbPath)
const documentTemplateDir = join(__dirname, '../data/document-templates')
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true })
}

const db = new Database(dbPath)
setAuthDb(db)
ensureCoreTables(db)
ensureProjectTables(db)
ensureSchemaVersions(db)
recordFrameworkBaseline(db)
runV2Cleanup(db)
runWarehouseV2Schema(db)

// 初始化 JWT 配置（自动轮换密钥）
initJwtConfig(db)

// 添加入职向导字段
try { db.exec('ALTER TABLE users ADD COLUMN onboarding_done INTEGER DEFAULT 0') } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN real_name TEXT DEFAULT ''") } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN phone TEXT DEFAULT ''") } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN department TEXT DEFAULT ''") } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN position TEXT DEFAULT ''") } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN ai_pet_enabled INTEGER DEFAULT 1') } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN ai_auto_query INTEGER DEFAULT 1') } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN ai_name TEXT DEFAULT '简尚小助手'") } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN role_version INTEGER DEFAULT 1') } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN employee_id INTEGER DEFAULT 0') } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active'") } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN assignment_status TEXT DEFAULT 'assigned'") } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN activated_at TEXT DEFAULT ''") } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN activated_by INTEGER DEFAULT 0') } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN disabled_at TEXT DEFAULT ''") } catch {}
try { db.exec('ALTER TABLE users ADD COLUMN disabled_by INTEGER DEFAULT 0') } catch {}
try { db.exec("ALTER TABLE users ADD COLUMN last_login_at TEXT DEFAULT ''") } catch {}
try { db.exec("ALTER TABLE transactions ADD COLUMN status TEXT DEFAULT 'approved'") } catch {}
try { db.prepare("UPDATE transactions SET status = 'approved' WHERE status IS NULL OR status = ''").run() } catch {}
try { db.prepare("UPDATE users SET status = 'active' WHERE status IS NULL OR status = ''").run() } catch {}
try { db.prepare("UPDATE users SET status = 'active', assignment_status = 'pending' WHERE status = 'pending_activation'").run() } catch {}
try { db.prepare("UPDATE users SET assignment_status = 'assigned' WHERE username = 'fuyulnk' OR role IN ('super_admin', 'admin') OR COALESCE(employee_id, 0) > 0").run() } catch {}
try { db.prepare("UPDATE users SET assignment_status = 'pending' WHERE COALESCE(employee_id, 0) = 0 AND role = 'employee' AND username != 'fuyulnk' AND status = 'active'").run() } catch {}
try { db.prepare("UPDATE users SET role = 'super_admin' WHERE username = 'fuyulnk'").run() } catch {}
try { db.exec('ALTER TABLE employees ADD COLUMN employee_code TEXT') } catch {}
try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_employee_id_unique ON users(employee_id) WHERE employee_id > 0') } catch {}
try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_code_unique ON employees(employee_code) WHERE employee_code IS NOT NULL AND employee_code != ''") } catch {}
try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_participant ON conversation_participants(conversation_id, user_id)') } catch {}
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
try { db.exec('ALTER TABLE projects ADD COLUMN survey_user_id INTEGER DEFAULT 0') } catch {}
try { db.exec('ALTER TABLE projects ADD COLUMN recheck_user_id INTEGER DEFAULT 0') } catch {}
try { db.exec('ALTER TABLE projects ADD COLUMN final_inspection_user_id INTEGER DEFAULT 0') } catch {}
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
try { db.exec("ALTER TABLE material_requests ADD COLUMN material_total REAL DEFAULT 0") } catch {}
try { db.exec("ALTER TABLE material_requests ADD COLUMN auxiliary_total REAL DEFAULT 0") } catch {}
try { db.exec("ALTER TABLE material_requests ADD COLUMN tool_total REAL DEFAULT 0") } catch {}
try { db.exec("ALTER TABLE material_requests ADD COLUMN tool_loss_total REAL DEFAULT 0") } catch {}
try { db.exec("ALTER TABLE material_requests ADD COLUMN transport_fee REAL DEFAULT 0") } catch {}
try { db.exec("ALTER TABLE material_requests ADD COLUMN total_amount REAL DEFAULT 0") } catch {}
try { db.exec("ALTER TABLE material_request_items ADD COLUMN item_group TEXT DEFAULT 'material'") } catch {}
try { db.exec("ALTER TABLE material_request_items ADD COLUMN out_date TEXT DEFAULT ''") } catch {}
try { db.exec("ALTER TABLE material_request_items ADD COLUMN out_quantity REAL DEFAULT 0") } catch {}
try { db.exec("ALTER TABLE material_request_items ADD COLUMN return_quantity REAL DEFAULT 0") } catch {}
try { db.exec("ALTER TABLE material_request_items ADD COLUMN usage_quantity REAL DEFAULT 0") } catch {}
try { db.exec("ALTER TABLE material_request_items ADD COLUMN unit_price REAL DEFAULT 0") } catch {}
try { db.exec("ALTER TABLE material_request_items ADD COLUMN amount REAL DEFAULT 0") } catch {}
try { db.exec("ALTER TABLE material_request_items ADD COLUMN remark TEXT DEFAULT ''") } catch {}
try { db.exec('ALTER TABLE products ADD COLUMN is_test INTEGER DEFAULT 0') } catch {}
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      project_id INTEGER DEFAULT 0,
      material_request_id INTEGER DEFAULT 0,
      movement_type TEXT NOT NULL,
      quantity_delta REAL DEFAULT 0,
      quantity_before REAL DEFAULT 0,
      quantity_after REAL DEFAULT 0,
      unit TEXT DEFAULT '',
      reason TEXT DEFAULT '',
      note TEXT DEFAULT '',
      created_by INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );
    CREATE TABLE IF NOT EXISTS material_losses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER DEFAULT 0,
      material_request_id INTEGER DEFAULT 0,
      product_id INTEGER DEFAULT 0,
      product_name TEXT DEFAULT '',
      quantity REAL DEFAULT 0,
      unit TEXT DEFAULT '',
      reason TEXT DEFAULT '',
      note TEXT DEFAULT '',
      created_by INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_inventory_movements_product ON inventory_movements(product_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_inventory_movements_project ON inventory_movements(project_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_material_losses_project ON material_losses(project_id, created_at);
  `)
} catch {}
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
try { db.exec('CREATE INDEX IF NOT EXISTS idx_projects_survey_user ON projects(survey_user_id)') } catch {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_projects_recheck_user ON projects(recheck_user_id)') } catch {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_projects_final_inspection_user ON projects(final_inspection_user_id)') } catch {}
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
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS finance_ledger_workbooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      source_file_name TEXT DEFAULT '',
      source_file_path TEXT DEFAULT '',
      status TEXT DEFAULT 'active',
      imported_by INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );
    CREATE TABLE IF NOT EXISTS finance_ledger_sheets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workbook_id INTEGER NOT NULL,
      sheet_index INTEGER DEFAULT 0,
      name TEXT NOT NULL,
      row_count INTEGER DEFAULT 0,
      col_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );
    CREATE TABLE IF NOT EXISTS finance_ledger_cells (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workbook_id INTEGER NOT NULL,
      sheet_id INTEGER NOT NULL,
      row_index INTEGER NOT NULL,
      col_index INTEGER NOT NULL,
      address TEXT NOT NULL,
      value TEXT DEFAULT '',
      raw_value TEXT DEFAULT '',
      formula TEXT DEFAULT '',
      number_format TEXT DEFAULT '',
      updated_by INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
      UNIQUE(sheet_id, row_index, col_index)
    );
    CREATE TABLE IF NOT EXISTS finance_ledger_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workbook_id INTEGER NOT NULL,
      sheet_id INTEGER NOT NULL,
      row_index INTEGER NOT NULL,
      col_index INTEGER NOT NULL,
      address TEXT NOT NULL,
      comment_text TEXT DEFAULT '',
      created_by INTEGER DEFAULT 0,
      updated_by INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
      UNIQUE(sheet_id, row_index, col_index)
    );
    CREATE TABLE IF NOT EXISTS finance_ledger_merges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workbook_id INTEGER NOT NULL,
      sheet_id INTEGER NOT NULL,
      start_row INTEGER NOT NULL,
      start_col INTEGER NOT NULL,
      end_row INTEGER NOT NULL,
      end_col INTEGER NOT NULL,
      address TEXT DEFAULT '',
      created_by INTEGER DEFAULT 0,
      updated_by INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
      UNIQUE(sheet_id, start_row, start_col)
    );
    CREATE TABLE IF NOT EXISTS finance_ledger_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workbook_id INTEGER NOT NULL,
      sheet_id INTEGER DEFAULT 0,
      address TEXT DEFAULT '',
      action TEXT NOT NULL,
      old_value TEXT DEFAULT '',
      new_value TEXT DEFAULT '',
      created_by INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_finance_ledger_cells_sheet ON finance_ledger_cells(sheet_id, row_index, col_index);
    CREATE INDEX IF NOT EXISTS idx_finance_ledger_comments_sheet ON finance_ledger_comments(sheet_id, row_index, col_index);
    CREATE INDEX IF NOT EXISTS idx_finance_ledger_merges_sheet ON finance_ledger_merges(sheet_id, start_row, start_col);

  `)
  try { db.exec("ALTER TABLE finance_ledger_workbooks ADD COLUMN source_file_path TEXT DEFAULT ''") } catch {}
} catch {}
try { ensureSystemDocumentTemplates(db, documentTemplateDir) } catch {}
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

try { db.exec('ALTER TABLE ai_audit_logs ADD COLUMN agent_id INTEGER DEFAULT 0') } catch {}
try { db.exec("ALTER TABLE ai_audit_logs ADD COLUMN context_key TEXT DEFAULT ''") } catch {}
try { db.exec("ALTER TABLE ai_audit_logs ADD COLUMN risk_level TEXT DEFAULT ''") } catch {}
try { db.exec('ALTER TABLE ai_audit_logs ADD COLUMN confirmation_required INTEGER DEFAULT 0') } catch {}
try { db.exec('ALTER TABLE chat_history ADD COLUMN agent_id INTEGER DEFAULT 0') } catch {}
try { db.exec("ALTER TABLE chat_history ADD COLUMN context_type TEXT DEFAULT ''") } catch {}
try { db.exec("ALTER TABLE chat_history ADD COLUMN context_key TEXT DEFAULT ''") } catch {}

db.exec(`
  CREATE TABLE IF NOT EXISTS ai_tool_registry (
    tool_name TEXT PRIMARY KEY,
    label TEXT DEFAULT '',
    description TEXT DEFAULT '',
    tier TEXT DEFAULT 'L1',
    risk_level TEXT DEFAULT 'medium',
    action_type TEXT DEFAULT 'tool_read',
    requires_confirmation INTEGER DEFAULT 0,
    parameter_schema TEXT DEFAULT '{}',
    enabled INTEGER DEFAULT 1,
    updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
  );
  CREATE TABLE IF NOT EXISTS ai_agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    purpose TEXT DEFAULT '',
    scenario_type TEXT DEFAULT 'general',
    base_prompt TEXT DEFAULT '',
    allowed_roles TEXT DEFAULT '[]',
    memory_enabled INTEGER DEFAULT 0,
    memory_retention_days INTEGER DEFAULT 7,
    enabled INTEGER DEFAULT 1,
    is_default INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
  );
  CREATE TABLE IF NOT EXISTS ai_agent_tools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER NOT NULL REFERENCES ai_agents(id),
    tool_name TEXT NOT NULL,
    allowed INTEGER DEFAULT 0,
    UNIQUE(agent_id, tool_name)
  );
  CREATE TABLE IF NOT EXISTS ai_contexts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    context_type TEXT DEFAULT 'direct',
    context_key TEXT NOT NULL,
    agent_id INTEGER DEFAULT 0,
    user_id INTEGER DEFAULT 0,
    title TEXT DEFAULT '',
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
    UNIQUE(context_type, context_key, user_id)
  );
  CREATE TABLE IF NOT EXISTS ai_memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id INTEGER DEFAULT 0,
    context_type TEXT DEFAULT 'direct',
    context_key TEXT NOT NULL,
    user_id INTEGER DEFAULT 0,
    summary TEXT DEFAULT '',
    source TEXT DEFAULT 'auto',
    expires_at DATETIME DEFAULT '',
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
    UNIQUE(agent_id, context_type, context_key, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_ai_agent_tools_agent ON ai_agent_tools(agent_id);
  CREATE INDEX IF NOT EXISTS idx_ai_memories_context ON ai_memories(agent_id, context_type, context_key, user_id);
  CREATE INDEX IF NOT EXISTS idx_chat_history_agent_context ON chat_history(user_id, agent_id, context_key, session_id, id)
`)
try { db.exec("ALTER TABLE ai_agents ADD COLUMN allowed_roles TEXT DEFAULT '[]'") } catch {}

db.exec(`
  CREATE TABLE IF NOT EXISTS finance_account_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alias TEXT NOT NULL UNIQUE,
    account_name TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    source TEXT DEFAULT 'system',
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_finance_account_aliases_enabled ON finance_account_aliases(enabled, alias)
`)
ensureAiToolRegistry(db)
ensureDefaultAiAgents(db)
ensureFinanceAccountAliases(db)
reconcileAssignedUserRoles(db)

// 种子 AI 工具权限（仅首次）
const toolCount = db.prepare('SELECT COUNT(*) as c FROM ai_role_tools').get().c
if (toolCount === 0) {
  const allTools = AI_TOOL_REGISTRY.map(tool => tool.name)
  const roles = db.prepare('SELECT id, name FROM roles').all()
  const stmt = db.prepare('INSERT OR IGNORE INTO ai_role_tools (role_id, tool_name, allowed) VALUES (?, ?, ?)')

  for (const role of roles) {
    if (role.name === 'super_admin') {
      for (const t of allTools) stmt.run(role.id, t, 1)
    } else if (role.name === 'admin') {
      for (const t of allTools) stmt.run(role.id, t, ['get_accounts','get_transactions','get_today_summary','get_products','get_employees','get_projects','get_project_documents','get_system_stats','get_project_profit_summary','parse_finance_transaction','parse_project_handover','create_project_workorder'].includes(t) ? 1 : 0)
    } else if (role.name === 'finance') {
      for (const t of allTools) stmt.run(role.id, t, ['get_accounts','get_transactions','get_today_summary','get_system_stats','get_project_profit_summary','parse_finance_transaction','create_transaction'].includes(t) ? 1 : 0)
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
  bodyLimit: 1048576 * 30
})
const realtime = { io: null }

// 静态文件（JS/CSS 带 hash → 缓存一年；通过 .gz 文件提供 gzip）
server.register(fastifyStatic, {
  root: join(__dirname, '../public'),
  prefix: '/',
  setHeaders: (res, path) => {
    if (path.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript')
    else if (path.endsWith('.css')) res.setHeader('Content-Type', 'text/css')
    // 带 hash 的资源名 → 不可变，缓存一年
    if (/index-[^.]+\.(js|css)$/.test(path)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    }
  }
})

server.register(fastifyStatic, {
  root: join(__dirname, '../data/avatars'),
  prefix: '/avatars/',
  decorateReply: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
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
supplyOrderRoutes(server, db)
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

        // 获取会话信息（后续多个检查复用）
        const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversation_id)

        // 财务群自动录入（无 @AI 的财务消息）
        if (conv?.type === 'group' && socket.user.userId) {
          const botUser = db.prepare("SELECT id FROM users WHERE username = 'ai'").get()
          if (botUser && socket.user.userId !== botUser.id) {
            try {
              await handleFinanceGroupMessage({
                content: content.trim(),
                conversationId: conversation_id,
                conversationName: conv.name || '',
                senderId: socket.user.userId,
                db,
                io
              })
            } catch (err) {
              console.error('💰 财务自动录入异常:', err.message)
            }
          }
        }

        // 群聊 @AI 自动回复
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

            const response = await fetch(process.env.AI_ENDPOINT || 'https://api.deepseek.com/chat/completions', {
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
      survey_user_id INTEGER DEFAULT 0,
      recheck_user_id INTEGER DEFAULT 0,
      final_inspection_user_id INTEGER DEFAULT 0,
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
      position TEXT DEFAULT '',
      ai_pet_enabled INTEGER DEFAULT 1,
      ai_auto_query INTEGER DEFAULT 1,
      ai_name TEXT DEFAULT '简尚小助手',
      role_version INTEGER DEFAULT 1,
      employee_id INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      assignment_status TEXT DEFAULT 'assigned',
      activated_at TEXT DEFAULT '',
      activated_by INTEGER DEFAULT 0,
      disabled_at TEXT DEFAULT '',
      disabled_by INTEGER DEFAULT 0,
      last_login_at TEXT DEFAULT '',
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

    CREATE TABLE IF NOT EXISTS account_monthly_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      month TEXT NOT NULL,
      opening_balance REAL DEFAULT 0,
      income_total REAL DEFAULT 0,
      expense_total REAL DEFAULT 0,
      closing_balance REAL DEFAULT 0,
      source_file_name TEXT DEFAULT '',
      imported_by INTEGER DEFAULT 0,
      imported_at DATETIME DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT '',
      note TEXT DEFAULT '',
      UNIQUE(account_id, month)
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
      spec TEXT DEFAULT '',
      warehouse_code TEXT DEFAULT '',
      unit_price REAL DEFAULT 0,
      price_unit TEXT DEFAULT '',
      stock REAL DEFAULT 0,
      min_stock REAL DEFAULT 0,
      is_test INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS inventory_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      project_id INTEGER DEFAULT 0,
      material_request_id INTEGER DEFAULT 0,
      movement_type TEXT NOT NULL,
      quantity_delta REAL DEFAULT 0,
      quantity_before REAL DEFAULT 0,
      quantity_after REAL DEFAULT 0,
      unit TEXT DEFAULT '',
      reason TEXT DEFAULT '',
      note TEXT DEFAULT '',
      created_by INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS material_losses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER DEFAULT 0,
      material_request_id INTEGER DEFAULT 0,
      product_id INTEGER DEFAULT 0,
      product_name TEXT DEFAULT '',
      quantity REAL DEFAULT 0,
      unit TEXT DEFAULT '',
      reason TEXT DEFAULT '',
      note TEXT DEFAULT '',
      created_by INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS supply_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_no TEXT UNIQUE NOT NULL,
      project_id INTEGER DEFAULT 0,
      customer TEXT NOT NULL,
      phone TEXT DEFAULT '',
      source TEXT DEFAULT '',
      address TEXT DEFAULT '',
      amount REAL DEFAULT 0,
      fulfillment_type TEXT DEFAULT 'warehouse',
      status TEXT DEFAULT 'ordered',
      note TEXT DEFAULT '',
      created_by INTEGER DEFAULT 0,
      finance_confirmed_by INTEGER DEFAULT 0,
      warehouse_confirmed_by INTEGER DEFAULT 0,
      stock_out_by INTEGER DEFAULT 0,
      purchase_paid_by INTEGER DEFAULT 0,
      shipped_by INTEGER DEFAULT 0,
      completed_by INTEGER DEFAULT 0,
      finance_confirmed_at TEXT DEFAULT '',
      warehouse_confirmed_at TEXT DEFAULT '',
      stock_out_at TEXT DEFAULT '',
      purchase_paid_at TEXT DEFAULT '',
      shipped_at TEXT DEFAULT '',
      completed_at TEXT DEFAULT '',
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS supply_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER DEFAULT 0,
      product_name TEXT NOT NULL,
      category TEXT DEFAULT '',
      unit TEXT DEFAULT '',
      quantity REAL DEFAULT 0,
      unit_price REAL DEFAULT 0,
      amount REAL DEFAULT 0,
      note TEXT DEFAULT '',
      created_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS supply_order_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      operator TEXT DEFAULT '',
      content TEXT DEFAULT '',
      created_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS material_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      status TEXT DEFAULT 'requested',
      note TEXT DEFAULT '',
      material_total REAL DEFAULT 0,
      auxiliary_total REAL DEFAULT 0,
      tool_total REAL DEFAULT 0,
      tool_loss_total REAL DEFAULT 0,
      transport_fee REAL DEFAULT 0,
      total_amount REAL DEFAULT 0,
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
      product_id INTEGER DEFAULT 0,
      product_name TEXT NOT NULL,
      item_group TEXT DEFAULT 'material',
      category TEXT DEFAULT '',
      unit TEXT DEFAULT '',
      quantity REAL DEFAULT 0,
      out_date TEXT DEFAULT '',
      out_quantity REAL DEFAULT 0,
      return_quantity REAL DEFAULT 0,
      usage_quantity REAL DEFAULT 0,
      unit_price REAL DEFAULT 0,
      amount REAL DEFAULT 0,
      note TEXT DEFAULT '',
      remark TEXT DEFAULT '',
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
  try { db.exec("ALTER TABLE products ADD COLUMN spec TEXT DEFAULT ''") } catch {}
  try { db.exec("ALTER TABLE products ADD COLUMN warehouse_code TEXT DEFAULT ''") } catch {}
  try { db.exec('ALTER TABLE products ADD COLUMN unit_price REAL DEFAULT 0') } catch {}
  try { db.exec("ALTER TABLE products ADD COLUMN price_unit TEXT DEFAULT ''") } catch {}
  try { db.exec('ALTER TABLE products ADD COLUMN is_test INTEGER DEFAULT 0') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_products_warehouse_code ON products(warehouse_code)') } catch {}
  try { db.exec('ALTER TABLE supply_orders ADD COLUMN project_id INTEGER DEFAULT 0') } catch {}
  try { db.exec("ALTER TABLE supply_orders ADD COLUMN fulfillment_type TEXT DEFAULT 'warehouse'") } catch {}
  try { db.exec('ALTER TABLE supply_orders ADD COLUMN stock_out_by INTEGER DEFAULT 0') } catch {}
  try { db.exec("ALTER TABLE supply_orders ADD COLUMN stock_out_at TEXT DEFAULT ''") } catch {}
  try { db.exec('ALTER TABLE supply_orders ADD COLUMN purchase_paid_by INTEGER DEFAULT 0') } catch {}
  try { db.exec("ALTER TABLE supply_orders ADD COLUMN purchase_paid_at TEXT DEFAULT ''") } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_supply_orders_status ON supply_orders(status, created_at)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_supply_orders_created_by ON supply_orders(created_by, created_at)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_supply_orders_project ON supply_orders(project_id, created_at)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_material_requests_project ON material_requests(project_id, status, created_at)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_material_requests_status ON material_requests(status, created_at)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_material_request_items_request ON material_request_items(request_id)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_inventory_movements_product ON inventory_movements(product_id, created_at)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_inventory_movements_project ON inventory_movements(project_id, created_at)') } catch {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_material_losses_project ON material_losses(project_id, created_at)') } catch {}
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
  ensureOperationalProjectScopes(db)
  ensureFinanceProjectCreatePermission(db)
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
      create: ['transactions', 'projects', 'chat'].includes(module) ? 1 : 0,
      edit: ['transactions', 'projects', 'chat'].includes(module) ? 1 : 0,
      delete: 0,
      scope: ['accounts', 'transactions', 'finance', 'projects'].includes(module) ? 'all' : 'project_related'
    }
  }
  if (role === 'warehouse') {
    return {
      view: ['dashboard', 'products', 'projects', 'chat'].includes(module) ? 1 : 0,
      create: ['products', 'chat'].includes(module) ? 1 : 0,
      edit: ['products', 'projects', 'chat'].includes(module) ? 1 : 0,
      delete: 0,
      scope: ['products', 'projects'].includes(module) ? 'all' : 'project_related'
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

function ensureOperationalProjectScopes(db) {
  const key = 'ensure_operational_project_scopes_20260613'
  if (db.prepare('SELECT value FROM app_config WHERE key = ?').get(key)) return
  db.prepare(`
    UPDATE role_permissions
    SET data_scope = 'all'
    WHERE module = 'projects'
      AND role_id IN (
        SELECT id FROM roles
        WHERE name IN ('super_admin', 'admin', 'finance', 'warehouse', 'engineering')
      )
  `).run()
  db.prepare('INSERT OR REPLACE INTO app_config (key, value, updated_at) VALUES (?, ?, ?)')
    .run(key, '1', String(Date.now()))
}

function ensureFinanceProjectCreatePermission(db) {
  const key = 'ensure_finance_project_create_20260617'
  if (db.prepare('SELECT value FROM app_config WHERE key = ?').get(key)) return
  db.prepare(`
    UPDATE role_permissions
    SET can_create = 1, can_edit = 1, data_scope = 'all'
    WHERE module = 'projects'
      AND role_id IN (SELECT id FROM roles WHERE name = 'finance')
  `).run()
  db.prepare('INSERT OR REPLACE INTO app_config (key, value, updated_at) VALUES (?, ?, ?)')
    .run(key, '1', String(Date.now()))
}

function ensureAiToolPermissionRows(db) {
  const allTools = AI_TOOL_REGISTRY.map(tool => tool.name)
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
  if (role === 'admin') return ['get_accounts', 'get_transactions', 'get_today_summary', 'get_products', 'get_employees', 'get_projects', 'get_project_documents', 'get_system_stats', 'get_project_profit_summary', 'parse_finance_transaction', 'parse_project_handover', 'create_project_workorder'].includes(tool) ? 1 : 0
  if (role === 'finance') return ['get_accounts', 'get_transactions', 'get_today_summary', 'get_projects', 'get_project_documents', 'get_system_stats', 'get_project_profit_summary', 'parse_finance_transaction', 'create_transaction'].includes(tool) ? 1 : 0
  if (role === 'warehouse') return ['get_products', 'get_projects', 'get_project_documents', 'get_system_stats'].includes(tool) ? 1 : 0
  if (role === 'engineering') return ['get_projects', 'get_project_documents', 'get_products', 'get_system_stats', 'parse_project_handover', 'create_project_workorder'].includes(tool) ? 1 : 0
  return ['get_system_stats', 'get_projects', 'get_project_documents'].includes(tool) ? 1 : 0
}

function ensureAiToolRegistry(db) {
  const stmt = db.prepare(`
    INSERT INTO ai_tool_registry (
      tool_name, label, description, tier, risk_level, action_type, requires_confirmation, parameter_schema, enabled, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now', 'localtime'))
    ON CONFLICT(tool_name) DO UPDATE SET
      label = excluded.label,
      description = excluded.description,
      tier = excluded.tier,
      risk_level = excluded.risk_level,
      action_type = excluded.action_type,
      requires_confirmation = excluded.requires_confirmation,
      parameter_schema = excluded.parameter_schema,
      updated_at = datetime('now', 'localtime')
  `)
  for (const tool of AI_TOOL_REGISTRY) {
    stmt.run(
      tool.name,
      tool.label,
      tool.desc,
      tool.tier || 'L1',
      tool.risk_level || 'medium',
      tool.action_type || 'tool_read',
      tool.requires_confirmation ? 1 : 0,
      JSON.stringify(tool.schema || {})
    )
  }
}

function ensureDefaultAiAgents(db) {
  const insertAgent = db.prepare(`
    INSERT INTO ai_agents (
      key, name, purpose, scenario_type, base_prompt, allowed_roles, memory_enabled, memory_retention_days, enabled, is_default
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET
      name = excluded.name,
      purpose = excluded.purpose,
      scenario_type = excluded.scenario_type,
      allowed_roles = excluded.allowed_roles,
      updated_at = datetime('now', 'localtime')
  `)
  const toolStmt = db.prepare('INSERT OR IGNORE INTO ai_agent_tools (agent_id, tool_name, allowed) VALUES (?, ?, ?)')
  for (const agent of DEFAULT_AI_AGENTS) {
    insertAgent.run(
      agent.key,
      agent.name,
      agent.purpose,
      agent.scenario_type,
      agent.base_prompt,
      JSON.stringify(agent.allowed_roles || []),
      agent.memory_enabled ? 1 : 0,
      agent.memory_retention_days || 7,
      agent.is_default ? 1 : 0
    )
    const row = db.prepare('SELECT id FROM ai_agents WHERE key = ?').get(agent.key)
    if (!row) continue
    for (const tool of AI_TOOL_REGISTRY) {
      toolStmt.run(row.id, tool.name, agent.tools.includes(tool.name) ? 1 : 0)
    }
  }
}

function ensureFinanceAccountAliases(db) {
  const aliases = [
    ['晓婉中行', '王晓婉·中国银行'],
    ['王晓琬中国银行', '王晓婉·中国银行'],
    ['简尚建设公账', '简尚·建设公账'],
    ['简尚建设', '简尚·建设公账'],
    ['建设公账', '简尚·建设公账'],
    ['简尚招商', '简尚·招商公账'],
    ['招商公账', '简尚·招商公账'],
    ['赖总微信', '赖总·微信'],
    ['赖总建设', '赖总·建设银行'],
    ['明鸿平安', '明鸿·平安银行公账'],
    ['明鸿招商', '明鸿·招商银行公账'],
    ['晓婉微信', '王晓婉·微信']
  ]
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO finance_account_aliases (alias, account_name, source)
    VALUES (?, ?, 'system')
  `)
  for (const [alias, accountName] of aliases) stmt.run(alias, accountName)
}

function reconcileAssignedUserRoles(db) {
  const rows = db.prepare(`
    SELECT u.id, u.role, e.department, e.position
    FROM users u
    JOIN employees e ON e.id = u.employee_id
    WHERE COALESCE(u.employee_id, 0) > 0
      AND u.role NOT IN ('super_admin', 'admin')
  `).all()
  const update = db.prepare(`
    UPDATE users
    SET role = ?,
        department = COALESCE(NULLIF(department, ''), ?),
        position = COALESCE(NULLIF(position, ''), ?),
        assignment_status = 'assigned',
        role_version = COALESCE(role_version, 1) + 1
    WHERE id = ?
      AND (role != ? OR COALESCE(assignment_status, 'assigned') != 'assigned')
  `)
  for (const row of rows) {
    const role = roleFromDepartmentPosition(row.department, row.position, row.role)
    update.run(role, row.department || '', row.position || '', row.id, role)
  }
}

function roleFromDepartmentPosition(department, position, currentRole = 'employee') {
  if (['super_admin', 'admin'].includes(currentRole)) return currentRole
  const dept = String(department || '').trim()
  const pos = String(position || '').trim()
  if (dept === '财务部' || pos === '财务') return 'finance'
  if (dept === '仓库' || dept === '仓储部' || pos === '仓管') return 'warehouse'
  if (dept === '工程部' || ['监理', '施工员工', '工程'].includes(pos)) return 'engineering'
  return 'employee'
}
