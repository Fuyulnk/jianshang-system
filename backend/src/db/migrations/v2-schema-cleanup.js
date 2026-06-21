/**
 * V2 Schema Cleanup — consolidate scattered ALTER TABLE / CREATE TABLE
 * from index.js into organized migration steps.
 *
 * Each step is idempotent (uses try/catch or IF NOT EXISTS).
 * Run order: structural → index → data fixup.
 */

import { recordSchemaVersion } from '../schemaVersions.js'

const VERSION = '20260621_v2_schema_cleanup'
const DESCRIPTION = 'V2 迁移整理：将散落在 index.js 的建表/补字段逻辑集中到迁移模块'

export function runV2Cleanup(db) {
  stepUserFields(db)
  stepEmployeeFields(db)
  stepProjectFields(db)
  stepProjectStates(db)
  stepMaterialFields(db)
  stepProductFields(db)
  stepChatFields(db)
  stepInventoryTables(db)
  stepFinanceLedgerTables(db)
  stepAiTables(db)
  stepIndexes(db)
  stepDataFixes(db)
  recordSchemaVersion(db, VERSION, DESCRIPTION)
}

// ── 用户表补字段 ──
function stepUserFields(db) {
  const cols = [
    'onboarding_done INTEGER DEFAULT 0',
    "real_name TEXT DEFAULT ''",
    "phone TEXT DEFAULT ''",
    "department TEXT DEFAULT ''",
    "position TEXT DEFAULT ''",
    'ai_pet_enabled INTEGER DEFAULT 1',
    'ai_auto_query INTEGER DEFAULT 1',
    "ai_name TEXT DEFAULT '简尚小助手'",
    'role_version INTEGER DEFAULT 1',
    'employee_id INTEGER DEFAULT 0',
    "status TEXT DEFAULT 'active'",
    "assignment_status TEXT DEFAULT 'assigned'",
    "activated_at TEXT DEFAULT ''",
    'activated_by INTEGER DEFAULT 0',
    "disabled_at TEXT DEFAULT ''",
    'disabled_by INTEGER DEFAULT 0',
    "last_login_at TEXT DEFAULT ''",
  ]
  for (const col of cols) {
    try { db.exec(`ALTER TABLE users ADD COLUMN ${col}`) } catch {}
  }
}

// ── 员工表补字段 ──
function stepEmployeeFields(db) {
  try { db.exec('ALTER TABLE employees ADD COLUMN employee_code TEXT') } catch {}
}

// ── 项目表补字段 ──
function stepProjectFields(db) {
  const cols = [
    'manager_user_id INTEGER DEFAULT 0',
    'assignee_user_id INTEGER DEFAULT 0',
    'survey_user_id INTEGER DEFAULT 0',
    'recheck_user_id INTEGER DEFAULT 0',
    'final_inspection_user_id INTEGER DEFAULT 0',
    "address_province TEXT DEFAULT ''",
    "address_city TEXT DEFAULT ''",
    "address_detail TEXT DEFAULT ''",
    "order_taker TEXT DEFAULT ''",
    "order_date TEXT DEFAULT ''",
    "external_order_no TEXT DEFAULT ''",
    "handover_note TEXT DEFAULT ''",
    'created_by INTEGER DEFAULT 0',
    "crew_member_user_ids TEXT DEFAULT '[]'",
    "crew_status TEXT DEFAULT 'pending'",
    "material_out_status TEXT DEFAULT 'pending'",
    "material_out_note TEXT DEFAULT ''",
    "material_return_status TEXT DEFAULT 'pending'",
    "material_return_note TEXT DEFAULT ''",
  ]
  for (const col of cols) {
    try { db.exec(`ALTER TABLE projects ADD COLUMN ${col}`) } catch {}
  }
}

// ── 项目状态兼容 ──
function stepProjectStates(db) {
  const aliases = [
    ['info_confirmed', 'handover_received'],
    ['condition_met', 'pre_entry_payment_pending'],
    ['team_assigned', 'payment_received'],
    ['completed', 'inspection_done'],
    ['settled', 'finance_settled'],
    ['closed', 'archived'],
  ]
  for (const [old, curr] of aliases) {
    try {
      db.prepare(`UPDATE projects SET status = ? WHERE status = ?`).run(curr, old)
    } catch {}
  }
}

// ── 材料表补字段 ──
function stepMaterialFields(db) {
  const reqCols = [
    'material_total REAL DEFAULT 0',
    'auxiliary_total REAL DEFAULT 0',
    'tool_total REAL DEFAULT 0',
    'tool_loss_total REAL DEFAULT 0',
    'transport_fee REAL DEFAULT 0',
    'total_amount REAL DEFAULT 0',
  ]
  for (const col of reqCols) {
    try { db.exec(`ALTER TABLE material_requests ADD COLUMN ${col}`) } catch {}
  }
  const itemCols = [
    "item_group TEXT DEFAULT 'material'",
    "out_date TEXT DEFAULT ''",
    'out_quantity REAL DEFAULT 0',
    'return_quantity REAL DEFAULT 0',
    'usage_quantity REAL DEFAULT 0',
    'unit_price REAL DEFAULT 0',
    'amount REAL DEFAULT 0',
    "remark TEXT DEFAULT ''",
  ]
  for (const col of itemCols) {
    try { db.exec(`ALTER TABLE material_request_items ADD COLUMN ${col}`) } catch {}
  }
}

// ── 产品表补字段 ──
function stepProductFields(db) {
  try { db.exec('ALTER TABLE products ADD COLUMN is_test INTEGER DEFAULT 0') } catch {}
}

// ── 聊天表补字段 ──
function stepChatFields(db) {
  try { db.exec('ALTER TABLE chat_history ADD COLUMN user_id INTEGER DEFAULT 0') } catch {}
}

// ── 库存流水 / 损耗表 ──
function stepInventoryTables(db) {
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
}

// ── 财务入账登记表 ──
function stepFinanceLedgerTables(db) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS finance_ledger_workbooks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        source_file_name TEXT DEFAULT '',
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
        sheet_id INTEGER DEFAULT 0,
        row_index INTEGER DEFAULT 0,
        col_index INTEGER DEFAULT 0,
        cell_value TEXT DEFAULT '',
        cell_type TEXT DEFAULT 'string',
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
      );
      CREATE TABLE IF NOT EXISTS finance_ledger_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cell_id INTEGER NOT NULL,
        comment_text TEXT DEFAULT '',
        created_by INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
      );
      CREATE TABLE IF NOT EXISTS finance_ledger_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workbook_id INTEGER DEFAULT 0,
        action TEXT NOT NULL,
        detail TEXT DEFAULT '',
        created_by INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT (datetime('now', 'localtime'))
      );
    `)
  } catch {}
}

// ── AI 相关表 ──
function stepAiTables(db) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ai_tool_registry (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tool_name TEXT NOT NULL UNIQUE,
        description TEXT DEFAULT '',
        risk_level TEXT DEFAULT 'low',
        action_type TEXT DEFAULT 'tool_read',
        requires_confirmation INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
      );
      CREATE TABLE IF NOT EXISTS ai_agents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        prompt TEXT DEFAULT '',
        allowed_roles TEXT DEFAULT '[]',
        enabled INTEGER DEFAULT 1,
        context_enabled INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
      );
      CREATE TABLE IF NOT EXISTS ai_agent_tools (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id INTEGER NOT NULL,
        tool_name TEXT NOT NULL,
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        UNIQUE(agent_id, tool_name)
      );
      CREATE TABLE IF NOT EXISTS ai_contexts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        context_key TEXT NOT NULL,
        context_value TEXT DEFAULT '',
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
      );
      CREATE TABLE IF NOT EXISTS ai_memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER DEFAULT 0,
        agent_key TEXT DEFAULT '',
        memory_key TEXT NOT NULL,
        memory_value TEXT DEFAULT '',
        importance REAL DEFAULT 0,
        created_at DATETIME DEFAULT (datetime('now', 'localtime')),
        updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
      );
    `)
  } catch {}
}

// ── 索引 ──
function stepIndexes(db) {
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_employee_id_unique ON users(employee_id) WHERE employee_id > 0') } catch {}
  try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_code_unique ON employees(employee_code) WHERE employee_code IS NOT NULL AND employee_code != ''") } catch {}
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_participant ON conversation_participants(conversation_id, user_id)') } catch {}
}

// ── 数据修复（一次性数据补全）──
function stepDataFixes(db) {
  try { db.prepare("UPDATE users SET status = 'active' WHERE status IS NULL OR status = ''").run() } catch {}
  try { db.prepare("UPDATE users SET status = 'active', assignment_status = 'pending' WHERE status = 'pending_activation'").run() } catch {}
  try { db.prepare("UPDATE users SET assignment_status = 'assigned' WHERE username = 'fuyulnk' OR role IN ('super_admin', 'admin') OR COALESCE(employee_id, 0) > 0").run() } catch {}
  try { db.prepare("UPDATE users SET assignment_status = 'pending' WHERE COALESCE(employee_id, 0) = 0 AND role = 'employee' AND username != 'fuyulnk' AND status = 'active'").run() } catch {}
  try { db.prepare("UPDATE users SET role = 'super_admin' WHERE username = 'fuyulnk'").run() } catch {}
  try { db.exec("UPDATE projects SET address_detail = address WHERE COALESCE(address_detail, '') = '' AND COALESCE(address, '') != ''") } catch {}
  try {
    const owner = db.prepare("SELECT id FROM users WHERE username = 'fuyulnk'").get()
    if (owner) {
      db.prepare('UPDATE projects SET created_by = ? WHERE COALESCE(created_by, 0) = 0').run(owner.id)
      db.prepare('UPDATE chat_history SET user_id = ? WHERE COALESCE(user_id, 0) = 0').run(owner.id)
    }
  } catch {}
  // Employee code generation
  try {
    const withoutCode = db.prepare("SELECT id FROM employees WHERE employee_code IS NULL OR employee_code = ''").all()
    if (withoutCode.length) {
      const upd = db.prepare('UPDATE employees SET employee_code = ? WHERE id = ?')
      for (const emp of withoutCode) {
        const code = `JS-${String(emp.id).padStart(4, '0')}`
        upd.run(code, emp.id)
      }
    }
  } catch {}
}
