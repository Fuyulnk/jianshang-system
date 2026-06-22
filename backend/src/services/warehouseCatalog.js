export function normalizeWarehouseCode(value) {
  const raw = String(value || '').trim()
  if (/门口|左边|右边|临时|暂放|地上|墙边/.test(raw)) return ''
  return raw
    .trim()
    .replace(/[－—–]/g, '-')
    .replace(/\s+/g, '')
    .toUpperCase()
}

export function parseWarehouseCode(value) {
  const code = normalizeWarehouseCode(value)
  if (!code) return null
  const match = code.match(/^([A-Z])-(\d+)-(\d+)-(\d+)$/)
  if (!match) return { code, area: '', shelf_no: '', row_no: '', position_no: '', label: code, sort_key: code }
  const [, area, shelf, row, position] = match
  return {
    code,
    area,
    shelf_no: shelf,
    row_no: row,
    position_no: position,
    label: `${area}区 ${Number(shelf)}号货架 第${Number(row)}排 第${Number(position)}格`,
    sort_key: `${area}-${padNumber(shelf)}-${padNumber(row)}-${padNumber(position)}`
  }
}

export function ensureProductCategory(db, name) {
  const cleanName = cleanText(name)
  if (!cleanName) return 0
  const existing = db.prepare('SELECT id FROM product_categories WHERE name = ?').get(cleanName)
  if (existing) return existing.id
  const result = db.prepare('INSERT INTO product_categories (name) VALUES (?)').run(cleanName)
  return result.lastInsertRowid
}

export function ensureWarehouseLocation(db, code, fallback = {}) {
  const parsed = parseWarehouseCode(code)
  if (!parsed?.code) return 0
  const existing = db.prepare('SELECT id FROM warehouse_locations WHERE code = ?').get(parsed.code)
  if (existing) return existing.id
  const result = db.prepare(`
    INSERT INTO warehouse_locations (
      code, area, shelf_no, row_no, position_no, label, sort_key, category_hint, note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    parsed.code,
    parsed.area || cleanText(fallback.area),
    parsed.shelf_no || cleanText(fallback.shelf_no),
    parsed.row_no || cleanText(fallback.row_no),
    parsed.position_no || cleanText(fallback.position_no),
    parsed.label || cleanText(fallback.label) || parsed.code,
    parsed.sort_key || parsed.code,
    cleanText(fallback.category_hint),
    cleanText(fallback.note)
  )
  return result.lastInsertRowid
}

export function upsertProductAliases(db, productId, aliases = []) {
  const values = [...new Set((Array.isArray(aliases) ? aliases : String(aliases || '').split(/[，,、\n]/))
    .map(cleanText)
    .filter(Boolean))]
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO product_aliases (product_id, alias, source)
    VALUES (?, ?, 'manual')
  `)
  for (const alias of values) stmt.run(productId, alias)
}

export function listWarehouseOptions(db) {
  const categories = db.prepare(`
    SELECT id, name, parent_id, sort_order, enabled
    FROM product_categories
    WHERE enabled = 1
    ORDER BY sort_order ASC, name ASC
  `).all()
  const locations = db.prepare(`
    SELECT id, code, area, shelf_no, row_no, position_no, label, sort_key, enabled
    FROM warehouse_locations
    WHERE enabled = 1
    ORDER BY sort_key ASC, code ASC
  `).all()
  const uncataloguedCategories = db.prepare(`
    SELECT DISTINCT category as name
    FROM products
    WHERE COALESCE(category, '') != ''
      AND category NOT IN (SELECT name FROM product_categories)
    ORDER BY category ASC
  `).all()
  const uncataloguedLocations = db.prepare(`
    SELECT DISTINCT warehouse_code as code
    FROM products
    WHERE COALESCE(warehouse_code, '') != ''
      AND warehouse_code NOT IN (SELECT code FROM warehouse_locations)
    ORDER BY warehouse_code ASC
  `).all()
  return {
    categories: [
      ...categories,
      ...uncataloguedCategories.map(row => ({ id: 0, name: row.name, inferred: true }))
    ],
    locations: [
      ...locations,
      ...uncataloguedLocations.map(row => ({ id: 0, ...parseWarehouseCode(row.code), inferred: true }))
    ],
    areas: [...new Set(locations.map(row => row.area).filter(Boolean))].sort()
  }
}

export function buildLocationDisplay(row) {
  const label = cleanText(row?.location_label)
  if (label) return label
  const parsed = parseWarehouseCode(row?.warehouse_code)
  return parsed?.label || cleanText(row?.warehouse_code)
}

export function warehouseSortKeyFromProduct(row) {
  return cleanText(row?.location_sort_key) || parseWarehouseCode(row?.warehouse_code)?.sort_key || 'ZZZ'
}

export function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function padNumber(value) {
  return String(Number(value || 0)).padStart(4, '0')
}
