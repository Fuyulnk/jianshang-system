import Database from 'better-sqlite3'
import { join } from 'path'
import { homedir } from 'os'

const db = new Database(join(homedir(), 'fuyulnk', 'jianshang.db'))

// 项目表
db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    customer TEXT NOT NULL,
    phone TEXT DEFAULT '',
    address TEXT DEFAULT '',
    source TEXT DEFAULT '',
    status TEXT DEFAULT 'info_confirmed',
    manager_user_id INTEGER DEFAULT 0,
    assignee_user_id INTEGER DEFAULT 0,

    -- 阶段1: 项目前期
    survey_report TEXT DEFAULT '',
    survey_date TEXT DEFAULT '',

    -- 阶段2: 准备阶段
    team_leader TEXT DEFAULT '',
    briefing_date TEXT DEFAULT '',
    condition_note TEXT DEFAULT '',

    -- 阶段3: 施工过程
    start_date TEXT DEFAULT '',
    expected_end_date TEXT DEFAULT '',
    construction_note TEXT DEFAULT '',

    -- 阶段4: 完工验收
    end_date TEXT DEFAULT '',
    acceptance_date TEXT DEFAULT '',
    total_amount REAL DEFAULT 0,
    deposit_amount REAL DEFAULT 0,
    settlement_amount REAL DEFAULT 0,

    created_by INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now', 'localtime')),
    updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
  )
`)

// 项目操作日志
db.exec(`
  CREATE TABLE IF NOT EXISTS project_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    operator TEXT DEFAULT '',
    content TEXT DEFAULT '',
    created_at DATETIME DEFAULT (datetime('now', 'localtime'))
  )
`)

console.log('项目表迁移完成')
db.close()
