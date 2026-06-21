import { existsSync } from 'fs'

export function getActiveDocumentTemplate(db, documentType) {
  const template = db.prepare(`
    SELECT *
    FROM document_templates
    WHERE document_type = ?
      AND status = 'active'
      AND COALESCE(source_file_path, '') != ''
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  `).get(documentType)
  if (!template || !existsSync(template.source_file_path)) return null
  const mappings = db.prepare(`
    SELECT field_key, field_label, sheet_name, cell_address, value_type, required
    FROM document_template_mappings
    WHERE template_id = ?
    ORDER BY id ASC
  `).all(template.id)
  return { ...template, mappings }
}
