const FRAMEWORK_VERSION = '20260618_database_framework_v1'

export function ensureSchemaVersions(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version TEXT UNIQUE NOT NULL,
      description TEXT DEFAULT '',
      applied_at DATETIME DEFAULT (datetime('now', 'localtime'))
    )
  `)
}

export function recordSchemaVersion(db, version, description = '') {
  ensureSchemaVersions(db)
  db.prepare(`
    INSERT OR IGNORE INTO schema_versions (version, description)
    VALUES (?, ?)
  `).run(version, description)
}

export function recordFrameworkBaseline(db) {
  recordSchemaVersion(
    db,
    FRAMEWORK_VERSION,
    '数据库框架 V1：保留 SQLite，新增迁移记录、业务字典和事实服务入口'
  )
}

export function getSchemaVersions(db) {
  ensureSchemaVersions(db)
  return db.prepare('SELECT version, description, applied_at FROM schema_versions ORDER BY id ASC').all()
}
