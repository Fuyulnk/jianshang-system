import Database from 'better-sqlite3'
import { dirname, resolve } from 'path'
import { mkdirSync } from 'fs'
import { runWarehouseV2Schema } from '../src/db/migrations/warehouse-v2.js'
import { ensureSchemaVersions, recordFrameworkBaseline } from '../src/db/schemaVersions.js'

const dbPath = resolve(process.argv[2] || 'data/safe-ai-test.db')
mkdirSync(dirname(dbPath), { recursive: true })
const db = new Database(dbPath)

db.exec(`
  DROP TABLE IF EXISTS role_permissions;
  DROP TABLE IF EXISTS roles;
  DROP TABLE IF EXISTS users;
  DROP TABLE IF EXISTS products;
  DROP TABLE IF EXISTS projects;
  DROP TABLE IF EXISTS employees;
  DROP TABLE IF EXISTS accounts;
  DROP TABLE IF EXISTS transactions;
  DROP TABLE IF EXISTS project_documents;
  DROP TABLE IF EXISTS document_template_mappings;
  DROP TABLE IF EXISTS document_templates;
  DROP TABLE IF EXISTS document_exports;
  DROP TABLE IF EXISTS inventory_movements;
  DROP TABLE IF EXISTS material_request_items;
  DROP TABLE IF EXISTS supply_order_items;

  CREATE TABLE roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    label TEXT NOT NULL
  );
  CREATE TABLE role_permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role_id INTEGER NOT NULL,
    module TEXT NOT NULL,
    can_view INTEGER DEFAULT 0,
    can_create INTEGER DEFAULT 0,
    can_edit INTEGER DEFAULT 0,
    can_delete INTEGER DEFAULT 0,
    data_scope TEXT DEFAULT 'none',
    UNIQUE(role_id, module)
  );
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    real_name TEXT DEFAULT '',
    role TEXT DEFAULT 'employee',
    assignment_status TEXT DEFAULT 'assigned',
    employee_id INTEGER DEFAULT 0
  );
  CREATE TABLE products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT DEFAULT '',
    unit TEXT DEFAULT '桶',
    spec TEXT DEFAULT '',
    warehouse_code TEXT DEFAULT '',
    unit_price REAL DEFAULT 0,
    price_unit TEXT DEFAULT '',
    stock REAL DEFAULT 0,
    min_stock REAL DEFAULT 0,
    is_test INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
  );
  CREATE TABLE projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    customer TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    address TEXT DEFAULT '',
    address_detail TEXT DEFAULT '',
    source TEXT DEFAULT '',
    status TEXT DEFAULT 'handover_received',
    total_amount REAL DEFAULT 0,
    deposit_amount REAL DEFAULT 0,
    settlement_amount REAL DEFAULT 0,
    created_by INTEGER DEFAULT 0,
    manager_user_id INTEGER DEFAULT 0,
    assignee_user_id INTEGER DEFAULT 0,
    survey_user_id INTEGER DEFAULT 0,
    recheck_user_id INTEGER DEFAULT 0,
    final_inspection_user_id INTEGER DEFAULT 0,
    crew_member_user_ids TEXT DEFAULT '[]',
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
  );
  CREATE TABLE employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_code TEXT DEFAULT '',
    name TEXT NOT NULL,
    department TEXT DEFAULT '',
    position TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    status TEXT DEFAULT 'active',
    bound_user_id INTEGER DEFAULT 0
  );
  CREATE TABLE accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'company',
    current_balance REAL DEFAULT 0
  );
  CREATE TABLE transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    amount REAL NOT NULL,
    category TEXT DEFAULT '',
    description TEXT DEFAULT '',
    party TEXT DEFAULT '',
    created_at DATETIME DEFAULT (datetime('now', 'localtime'))
  );
  CREATE TABLE project_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    document_type TEXT NOT NULL,
    status TEXT DEFAULT 'confirmed',
    confirmed_data TEXT DEFAULT '{}',
    updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
  );
  CREATE TABLE inventory_movements (
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
  CREATE TABLE material_request_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER DEFAULT 0,
    product_id INTEGER DEFAULT 0,
    product_name TEXT DEFAULT ''
  );
  CREATE TABLE supply_order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER DEFAULT 0,
    product_id INTEGER DEFAULT 0,
    product_name TEXT DEFAULT ''
  );
`)

const roleStmt = db.prepare('INSERT INTO roles (name, label) VALUES (?, ?)')
const roles = [
  ['super_admin', '超级管理员'],
  ['finance', '财务'],
  ['warehouse', '仓库'],
  ['employee', '普通员工']
]
for (const role of roles) roleStmt.run(...role)

const permStmt = db.prepare(`
  INSERT INTO role_permissions (role_id, module, can_view, can_create, can_edit, can_delete, data_scope)
  VALUES ((SELECT id FROM roles WHERE name = ?), ?, ?, ?, ?, ?, ?)
`)
const perms = [
  ['finance', 'projects', 1, 1, 1, 0, 'all'],
  ['finance', 'finance', 1, 1, 1, 0, 'all'],
  ['finance', 'transactions', 1, 1, 1, 0, 'all'],
  ['finance', 'products', 0, 0, 0, 0, 'none'],
  ['warehouse', 'products', 1, 1, 1, 0, 'all'],
  ['warehouse', 'projects', 1, 0, 0, 0, 'all'],
  ['warehouse', 'finance', 0, 0, 0, 0, 'none'],
  ['employee', 'projects', 1, 0, 0, 0, 'project_related'],
  ['employee', 'products', 0, 0, 0, 0, 'none'],
  ['employee', 'finance', 0, 0, 0, 0, 'none']
]
for (const row of perms) permStmt.run(...row)

db.prepare("INSERT INTO users (id, username, real_name, role, assignment_status) VALUES (101, 'finance_test', '财务测试', 'finance', 'assigned')").run()
db.prepare("INSERT INTO users (id, username, real_name, role, assignment_status) VALUES (102, 'warehouse_test', '仓库测试', 'warehouse', 'assigned')").run()
db.prepare("INSERT INTO users (id, username, real_name, role, assignment_status) VALUES (104, 'employee_test', '员工测试', 'employee', 'assigned')").run()
db.prepare("INSERT INTO users (id, username, real_name, role, assignment_status) VALUES (105, 'pending_test', '待建档测试', 'employee', 'pending')").run()

db.prepare(`
  INSERT INTO products (name, category, unit, spec, warehouse_code, unit_price, price_unit, stock, min_stock)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run('霞光沙', '诺瓦艺术漆', '桶', '5升', 'A-1-1-1', 500, '桶', 38, 10)
db.prepare(`
  INSERT INTO products (name, category, unit, spec, warehouse_code, unit_price, price_unit, stock, min_stock)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run('霞光沙', '诺瓦艺术漆', '桶', '1升', 'A-1-1-2', 100, '桶', 50, 3)
db.prepare(`
  INSERT INTO products (name, category, unit, spec, warehouse_code, unit_price, price_unit, stock, min_stock)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run('银光沙', '本杰明艺术漆', '桶', '20kg', 'B-1-1-1', 150, '桶', 60, 10)
db.prepare(`
  INSERT INTO projects (name, customer, phone, address, address_detail, source, status, total_amount, deposit_amount, settlement_amount, created_by, assignee_user_id)
  VALUES ('测试项目A', '测试客户甲', '18800000000', '测试地址A', '测试地址A', '测试门店', 'briefing_done', 10000, 9000, 0, 101, 104)
`).run()
db.prepare("INSERT INTO accounts (name, type, current_balance) VALUES ('测试公账', 'company', 10000)").run()
db.prepare("INSERT INTO transactions (account_id, type, amount, category, description, party) VALUES (1, 'income', 9000, '项目收款', '测试项目A首款', '测试门店')").run()

ensureSchemaVersions(db)
recordFrameworkBaseline(db)
runWarehouseV2Schema(db)
db.close()

console.log(`safe_ai_test_db=${dbPath}`)
