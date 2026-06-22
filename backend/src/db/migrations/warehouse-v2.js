import { recordSchemaVersion } from '../schemaVersions.js'
import { parseWarehouseCode } from '../../services/warehouseCatalog.js'

const VERSION = '20260622_warehouse_v2'
const DESCRIPTION = '仓库体系 V2：分类、库位、别名和盘点草稿'

export function runWarehouseV2Schema(db) {
  stepWarehouseCatalogTables(db)
  stepWarehouseProductFields(db)
  stepWarehouseIndexes(db)
  stepBackfillCatalog(db)
  assertWarehouseSchemaShape(db)
  recordSchemaVersion(db, VERSION, DESCRIPTION)
}

function stepWarehouseCatalogTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS product_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      parent_id INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS warehouse_locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      area TEXT DEFAULT '',
      shelf_no TEXT DEFAULT '',
      row_no TEXT DEFAULT '',
      position_no TEXT DEFAULT '',
      label TEXT DEFAULT '',
      sort_key TEXT DEFAULT '',
      category_hint TEXT DEFAULT '',
      enabled INTEGER DEFAULT 1,
      note TEXT DEFAULT '',
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      updated_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS product_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      alias TEXT NOT NULL,
      source TEXT DEFAULT 'manual',
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      UNIQUE(product_id, alias)
    );

    CREATE TABLE IF NOT EXISTS product_location_balances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      location_id INTEGER NOT NULL,
      quantity REAL DEFAULT 0,
      reserved_quantity REAL DEFAULT 0,
      min_stock REAL DEFAULT 0,
      is_primary INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT (datetime('now', 'localtime')),
      UNIQUE(product_id, location_id)
    );

    CREATE TABLE IF NOT EXISTS material_request_item_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_item_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      location_id INTEGER NOT NULL,
      planned_quantity REAL DEFAULT 0,
      out_quantity REAL DEFAULT 0,
      return_quantity REAL DEFAULT 0,
      usage_quantity REAL DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS supply_order_item_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supply_order_item_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      location_id INTEGER NOT NULL,
      planned_quantity REAL DEFAULT 0,
      out_quantity REAL DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS stocktaking_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_no TEXT UNIQUE NOT NULL,
      title TEXT DEFAULT '',
      source_file_name TEXT DEFAULT '',
      status TEXT DEFAULT 'draft',
      note TEXT DEFAULT '',
      created_by INTEGER DEFAULT 0,
      confirmed_by INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now', 'localtime')),
      confirmed_at TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS stocktaking_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL,
      product_id INTEGER DEFAULT 0,
      product_name TEXT NOT NULL,
      category TEXT DEFAULT '',
      spec TEXT DEFAULT '',
      warehouse_code TEXT DEFAULT '',
      unit TEXT DEFAULT '',
      book_quantity REAL DEFAULT 0,
      actual_quantity REAL DEFAULT 0,
      difference_quantity REAL DEFAULT 0,
      min_stock REAL DEFAULT 0,
      unit_price REAL DEFAULT 0,
      note TEXT DEFAULT '',
      row_index INTEGER DEFAULT 0,
      match_status TEXT DEFAULT 'unmatched',
      created_at DATETIME DEFAULT (datetime('now', 'localtime'))
    );
  `)
}

function stepWarehouseProductFields(db) {
  addColumns(db, 'products', [
    "warehouse_code TEXT DEFAULT ''",
    'category_id INTEGER DEFAULT 0',
    'location_id INTEGER DEFAULT 0'
  ])
  addColumns(db, 'inventory_movements', [
    'stocktaking_batch_id INTEGER DEFAULT 0',
    'location_id INTEGER DEFAULT 0',
    'source_location_id INTEGER DEFAULT 0',
    'target_location_id INTEGER DEFAULT 0',
    'location_quantity_before REAL DEFAULT 0',
    'location_quantity_after REAL DEFAULT 0',
    "reference_type TEXT DEFAULT ''",
    'reference_id INTEGER DEFAULT 0'
  ])
  addColumns(db, 'material_request_items', [
    'location_id INTEGER DEFAULT 0'
  ])
  addColumns(db, 'supply_order_items', [
    'location_id INTEGER DEFAULT 0'
  ])
  addColumns(db, 'stocktaking_items', [
    'min_stock REAL DEFAULT 0'
  ])
}

function stepWarehouseIndexes(db) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);
    CREATE INDEX IF NOT EXISTS idx_products_location_id ON products(location_id);
    CREATE INDEX IF NOT EXISTS idx_products_name_spec_unit ON products(name, spec, unit);
    CREATE INDEX IF NOT EXISTS idx_product_aliases_alias ON product_aliases(alias);
    CREATE INDEX IF NOT EXISTS idx_product_location_balances_product ON product_location_balances(product_id, location_id);
    CREATE INDEX IF NOT EXISTS idx_product_location_balances_location ON product_location_balances(location_id, product_id);
    CREATE INDEX IF NOT EXISTS idx_inventory_movements_location ON inventory_movements(location_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_material_request_item_allocations_item ON material_request_item_allocations(request_item_id);
    CREATE INDEX IF NOT EXISTS idx_material_request_item_allocations_location ON material_request_item_allocations(location_id, product_id);
    CREATE INDEX IF NOT EXISTS idx_supply_order_items_order ON supply_order_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_supply_order_item_allocations_item ON supply_order_item_allocations(supply_order_item_id);
    CREATE INDEX IF NOT EXISTS idx_stocktaking_items_batch ON stocktaking_items(batch_id, row_index);
    CREATE INDEX IF NOT EXISTS idx_stocktaking_items_product ON stocktaking_items(product_id);
    CREATE INDEX IF NOT EXISTS idx_warehouse_locations_area ON warehouse_locations(area, sort_key);
  `)
}

function stepBackfillCatalog(db) {
  const categories = db.prepare(`
    SELECT DISTINCT category FROM products WHERE COALESCE(category, '') != ''
  `).all()
  const insertCategory = db.prepare('INSERT OR IGNORE INTO product_categories (name) VALUES (?)')
  for (const row of categories) insertCategory.run(String(row.category || '').trim())

  db.prepare(`
    UPDATE products
    SET category_id = COALESCE((SELECT id FROM product_categories WHERE product_categories.name = products.category), 0)
    WHERE COALESCE(category_id, 0) = 0 AND COALESCE(category, '') != ''
  `).run()

  const locations = db.prepare(`
    SELECT DISTINCT warehouse_code FROM products WHERE COALESCE(warehouse_code, '') != ''
  `).all()
  const insertLocation = db.prepare(`
    INSERT OR IGNORE INTO warehouse_locations (code, area, shelf_no, row_no, position_no, label, sort_key)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)
  for (const row of locations) {
    const parsed = parseWarehouseCode(row.warehouse_code)
    if (!parsed?.code) continue
    insertLocation.run(parsed.code, parsed.area || '', parsed.shelf_no || '', parsed.row_no || '', parsed.position_no || '', parsed.label || parsed.code, parsed.sort_key || parsed.code)
  }

  db.prepare(`
    UPDATE products
    SET location_id = COALESCE((SELECT id FROM warehouse_locations WHERE warehouse_locations.code = products.warehouse_code), 0)
    WHERE COALESCE(location_id, 0) = 0 AND COALESCE(warehouse_code, '') != ''
  `).run()

  db.prepare(`
    INSERT OR IGNORE INTO product_location_balances (
      product_id, location_id, quantity, min_stock, is_primary
    )
    SELECT id, location_id, stock, min_stock, 1
    FROM products
    WHERE COALESCE(location_id, 0) > 0
  `).run()
}

function addColumns(db, table, columns) {
  for (const column of columns) {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${column}`) } catch {}
  }
}

function assertWarehouseSchemaShape(db) {
  const required = {
    product_categories: ['id', 'name', 'enabled'],
    warehouse_locations: ['id', 'code', 'area', 'shelf_no', 'row_no', 'position_no', 'sort_key'],
    product_aliases: ['product_id', 'alias'],
    product_location_balances: ['product_id', 'location_id', 'quantity', 'reserved_quantity', 'is_primary'],
    material_request_item_allocations: ['request_item_id', 'product_id', 'location_id', 'planned_quantity'],
    supply_order_item_allocations: ['supply_order_item_id', 'product_id', 'location_id', 'planned_quantity'],
    stocktaking_batches: ['batch_no', 'status'],
    stocktaking_items: ['batch_id', 'product_name', 'actual_quantity', 'min_stock', 'match_status'],
    products: ['category_id', 'location_id'],
    inventory_movements: ['stocktaking_batch_id', 'location_id', 'source_location_id', 'target_location_id', 'reference_type', 'reference_id'],
    material_request_items: ['location_id'],
    supply_order_items: ['location_id']
  }
  for (const [table, cols] of Object.entries(required)) {
    const existing = db.prepare(`PRAGMA table_info(${table})`).all().map(col => col.name)
    const missing = cols.filter(col => !existing.includes(col))
    if (missing.length) throw new Error(`仓库 V2 迁移未完成：${table} 缺少字段 ${missing.join(', ')}`)
  }
}
