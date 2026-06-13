// 数据库初始化脚本
import Database from 'better-sqlite3'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import fs from 'fs'
import bcrypt from 'bcryptjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// 数据库文件位置：~/fuyulnk/jianshang.db
const dbPath = join(process.env.HOME, 'fuyulnk', 'jianshang.db')
const dataDir = dirname(dbPath)

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}

const db = new Database(dbPath)
console.log('📦 数据库初始化中...')

// 创建 6 张表
db.exec(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT DEFAULT 'user',
  role_version INTEGER DEFAULT 1,
  employee_id INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  activated_at TEXT DEFAULT '',
  activated_by INTEGER DEFAULT 0,
  disabled_at TEXT DEFAULT '',
  disabled_by INTEGER DEFAULT 0,
  last_login_at TEXT DEFAULT '',
  created_at DATETIME DEFAULT (datetime('now', 'localtime'))
)`)

db.exec(`CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT DEFAULT 'personal',
  initial_balance REAL DEFAULT 0,
  current_balance REAL DEFAULT 0,
  updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
)`)

db.exec(`CREATE TABLE IF NOT EXISTS transactions (
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
)`)

db.exec(`CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT,
  unit TEXT DEFAULT 'kg',
  spec TEXT DEFAULT '',
  unit_price REAL DEFAULT 0,
  price_unit TEXT DEFAULT '',
  stock REAL DEFAULT 0,
  min_stock REAL DEFAULT 0,
  updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
)`)

db.exec(`CREATE TABLE IF NOT EXISTS supply_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT UNIQUE NOT NULL,
  project_id INTEGER DEFAULT 0,
  customer TEXT NOT NULL,
  phone TEXT DEFAULT '',
  source TEXT DEFAULT '',
  address TEXT DEFAULT '',
  amount REAL DEFAULT 0,
  status TEXT DEFAULT 'ordered',
  note TEXT DEFAULT '',
  created_by INTEGER DEFAULT 0,
  finance_confirmed_by INTEGER DEFAULT 0,
  warehouse_confirmed_by INTEGER DEFAULT 0,
  shipped_by INTEGER DEFAULT 0,
  completed_by INTEGER DEFAULT 0,
  finance_confirmed_at TEXT DEFAULT '',
  warehouse_confirmed_at TEXT DEFAULT '',
  shipped_at TEXT DEFAULT '',
  completed_at TEXT DEFAULT '',
  created_at DATETIME DEFAULT (datetime('now', 'localtime')),
  updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
)`)

db.exec(`CREATE TABLE IF NOT EXISTS supply_order_items (
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
)`)

db.exec(`CREATE TABLE IF NOT EXISTS supply_order_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  operator TEXT DEFAULT '',
  content TEXT DEFAULT '',
  created_at DATETIME DEFAULT (datetime('now', 'localtime'))
)`)

db.exec(`CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_code TEXT UNIQUE,
  name TEXT NOT NULL,
  department TEXT,
  position TEXT,
  phone TEXT,
  status TEXT DEFAULT 'active',
  created_at DATETIME DEFAULT (datetime('now', 'localtime'))
)`)

db.exec(`CREATE TABLE IF NOT EXISTS chat_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER DEFAULT 0,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  session_id TEXT NOT NULL,
  created_at DATETIME DEFAULT (datetime('now', 'localtime'))
)`)

db.exec(`CREATE TABLE IF NOT EXISTS ai_audit_logs (
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
)`)

console.log('✅ 6 张表创建成功')

// 插入默认系统所有者账号（用户名：fuyulnk，密码：123456）
const hashedPassword = bcrypt.hashSync('123456', 10)
db.prepare(`
  INSERT OR IGNORE INTO users (username, password, role)
  VALUES ('fuyulnk', ?, 'super_admin')
`).run(hashedPassword)
db.prepare("UPDATE users SET role = 'super_admin' WHERE username = 'fuyulnk'").run()
console.log('✅ 系统所有者账号创建成功（fuyulnk/123456）')

// 插入 11 个账户
const accounts = [
  { name: '赖总·微信', type: 'personal' },
  { name: '赖总·支付宝', type: 'personal' },
  { name: '赖总·招商银行卡', type: 'personal' },
  { name: '赖总·建设银行卡', type: 'personal' },
  { name: '王晓婉·微信', type: 'personal' },
  { name: '王晓婉·招商银行卡', type: 'personal' },
  { name: '简尚·招商银行公账', type: 'company' },
  { name: '简尚·建设银行公账', type: 'company' },
  { name: '微望·公账', type: 'company' },
  { name: '王威青·账户', type: 'personal' },
  { name: '赖济发·账户', type: 'personal' },
]

const stmt = db.prepare(`
  INSERT OR IGNORE INTO accounts (name, type, initial_balance, current_balance)
  VALUES (?, ?, 0, 0)
`)

for (const acc of accounts) {
  stmt.run(acc.name, acc.type)
}
console.log('✅ 11 个账户初始化成功')

db.close()
console.log('🎉 数据库初始化完成！')
