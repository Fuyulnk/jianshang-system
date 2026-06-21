import { existsSync } from 'fs'
import { join } from 'path'
import { SYSTEM_DOCUMENT_TEMPLATES } from '../domain/documentTemplateConfig.js'

export function ensureDocumentTemplateTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS document_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_type TEXT NOT NULL,
      title TEXT NOT NULL,
      template_version TEXT DEFAULT 'v1',
      source_file_name TEXT DEFAULT '',
      source_file_path TEXT DEFAULT '',
      status TEXT DEFAULT 'active',
      created_by INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );
    CREATE TABLE IF NOT EXISTS document_template_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL,
      field_key TEXT NOT NULL,
      field_label TEXT DEFAULT '',
      sheet_name TEXT DEFAULT '',
      cell_address TEXT NOT NULL,
      value_type TEXT DEFAULT 'text',
      required INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
      UNIQUE(template_id, field_key)
    );
    CREATE TABLE IF NOT EXISTS document_exports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER DEFAULT 0,
      document_type TEXT NOT NULL,
      template_id INTEGER DEFAULT 0,
      source_attachment_id INTEGER DEFAULT 0,
      output_file_name TEXT DEFAULT '',
      exported_by INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_document_templates_type ON document_templates(document_type, status);
    CREATE INDEX IF NOT EXISTS idx_document_exports_project_type ON document_exports(project_id, document_type, created_at);
  `)
}

export function ensureSystemDocumentTemplates(db, templateRoot) {
  ensureDocumentTemplateTables(db)
  for (const template of SYSTEM_DOCUMENT_TEMPLATES) {
    const sourcePath = join(templateRoot, template.file_name)
    const storedPath = existsSync(sourcePath) ? sourcePath : ''
    const templateId = upsertTemplate(db, {
      ...template,
      source_file_path: storedPath,
      status: storedPath ? 'active' : 'missing_file'
    })
    upsertMappings(db, templateId, template.mappings || [])
  }
}

function upsertTemplate(db, template) {
  const existing = db.prepare(`
    SELECT id
    FROM document_templates
    WHERE document_type = ? AND template_version = ?
    ORDER BY id ASC
    LIMIT 1
  `).get(template.document_type, template.template_version)

  if (existing) {
    db.prepare(`
      UPDATE document_templates
      SET title = ?,
          source_file_name = ?,
          source_file_path = ?,
          status = ?,
          updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(
      template.title,
      template.file_name,
      template.source_file_path || '',
      template.status || 'active',
      existing.id
    )
    return existing.id
  }

  const created = db.prepare(`
    INSERT INTO document_templates (
      document_type, title, template_version, source_file_name, source_file_path, status
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    template.document_type,
    template.title,
    template.template_version || 'v1',
    template.file_name || '',
    template.source_file_path || '',
    template.status || 'active'
  )
  return created.lastInsertRowid
}

function upsertMappings(db, templateId, mappings) {
  const stmt = db.prepare(`
    INSERT INTO document_template_mappings (
      template_id, field_key, field_label, sheet_name, cell_address, value_type, required
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(template_id, field_key) DO UPDATE SET
      field_label = excluded.field_label,
      sheet_name = excluded.sheet_name,
      cell_address = excluded.cell_address,
      value_type = excluded.value_type,
      required = excluded.required,
      updated_at = datetime('now', 'localtime')
  `)
  for (const mapping of mappings) {
    stmt.run(
      templateId,
      mapping.field_key,
      mapping.field_label || '',
      mapping.sheet_name || '',
      mapping.cell_address,
      mapping.value_type || 'text',
      mapping.required ? 1 : 0
    )
  }
}
