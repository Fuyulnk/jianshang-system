import {
  canonicalProjectStatus,
  PROJECT_DOCUMENT_TYPES,
  projectNextStep,
  projectStatusMeta,
  projectStatusesForFilter,
  projectStatusesForPhase
} from '../domain/businessDictionaries.js'
import { canAccessModule, canAccessProjectRecord } from '../utils/permissions.js'
import { emptyDeliveryDocument } from '../utils/projectDocumentImport.js'
import { buildLocationDisplay, warehouseSortKeyFromProduct } from './warehouseCatalog.js'

export function inventoryFacts(db, user, filters = {}) {
  if (!canAccessModule(db, user, 'products', 'can_view')) {
    return denied('没有查看库存的权限')
  }
  const query = clean(filters.query)
  const category = clean(filters.category)
  const area = clean(filters.area).toUpperCase()
  const warehouseCode = clean(filters.warehouse_code).toUpperCase()
  const locationStatus = clean(filters.location_status)
  const stockStatus = clean(filters.stock_status)
  const orderBy = clean(filters.order_by)
  const limit = clampLimit(filters.limit, 100, 300)
  let rows = db.prepare(`
    SELECT p.id, p.name, p.category, p.category_id, pc.name as category_name,
           p.spec, p.warehouse_code, p.location_id,
           wl.code as location_code, wl.label as location_label, wl.area as location_area, wl.sort_key as location_sort_key,
           p.unit, p.unit_price, p.price_unit, p.stock, p.min_stock, p.is_test, p.updated_at,
           COALESCE(GROUP_CONCAT(pa.alias, ' '), '') as aliases
    FROM products p
    LEFT JOIN product_categories pc ON pc.id = p.category_id
    LEFT JOIN warehouse_locations wl ON wl.id = p.location_id
    LEFT JOIN product_aliases pa ON pa.product_id = p.id
    GROUP BY p.id
    ORDER BY
      CASE WHEN ? = 'warehouse' THEN COALESCE(wl.sort_key, 'ZZZ') ELSE '' END ASC,
      p.name ASC, p.spec ASC, p.id ASC
  `).all(orderBy)
  if (category) rows = rows.filter(row => clean(row.category_name || row.category) === category)
  if (area) rows = rows.filter(row => clean(row.location_area).toUpperCase() === area)
  if (warehouseCode) rows = rows.filter(row => clean(row.warehouse_code || row.location_code).toUpperCase().includes(warehouseCode))
  if (locationStatus === 'missing') rows = rows.filter(row => !clean(row.warehouse_code || row.location_code))
  if (locationStatus === 'assigned') rows = rows.filter(row => clean(row.warehouse_code || row.location_code))
  if (stockStatus === 'low') rows = rows.filter(row => Number(row.stock || 0) <= Number(row.min_stock || 0))
  if (stockStatus === 'normal') rows = rows.filter(row => Number(row.stock || 0) > Number(row.min_stock || 0))
  const data = rows
    .map(productFact)
    .filter(row => !query || row.search_text.includes(query.toLowerCase()))
    .slice(0, limit)
  return ok(data, {
    count: data.length,
    domain: 'inventory',
    query,
    category,
    area,
    warehouse_code: warehouseCode,
    location_status: locationStatus,
    stock_status: stockStatus,
    order_by: orderBy
  })
}

export function employeeFacts(db, user, filters = {}) {
  if (!canAccessModule(db, user, 'employees', 'can_view')) {
    return denied('没有查看员工档案的权限')
  }
  const query = clean(filters.query)
  const status = clean(filters.status)
  const limit = clampLimit(filters.limit, 100, 300)
  let rows = db.prepare(`
    SELECT e.id, e.employee_code, e.name, e.department, e.position, e.phone, e.status,
           u.id as bound_user_id, u.username as bound_username, u.role as bound_user_role
    FROM employees e
    LEFT JOIN users u ON u.employee_id = e.id
    ORDER BY e.id ASC
  `).all()
  if (status) rows = rows.filter(row => String(row.status || '') === status)
  const data = rows
    .filter(row => {
      if (!query) return true
      return [row.employee_code, row.name, row.department, row.position, row.phone, row.bound_username]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query.toLowerCase())
    })
    .slice(0, limit)
  return ok(data, {
    count: data.length,
    domain: 'identity',
    query,
    status
  })
}

export function projectFacts(db, user, filters = {}) {
  if (!canAccessModule(db, user, 'projects', 'can_view')) {
    return denied('没有查看项目工单的权限')
  }
  const query = clean(filters.query)
  const limit = clampLimit(filters.limit, 100, 300)
  let sql = `
    SELECT p.id, p.name, p.customer, p.phone, p.address, p.status,
           p.total_amount, p.deposit_amount, p.settlement_amount,
           p.manager_user_id, p.assignee_user_id, p.survey_user_id, p.recheck_user_id,
           p.final_inspection_user_id, p.crew_member_user_ids, p.created_by,
           p.created_at, p.updated_at,
           mu.username as manager_username, mu.real_name as manager_real_name,
           au.username as assignee_username, au.real_name as assignee_real_name
    FROM projects p
    LEFT JOIN users mu ON p.manager_user_id = mu.id
    LEFT JOIN users au ON p.assignee_user_id = au.id
    WHERE 1=1
  `
  const params = []
  if (filters.phase) {
    const statuses = projectStatusesForPhase(filters.phase)
    if (statuses.length) {
      sql += ` AND p.status IN (${statuses.map(() => '?').join(',')})`
      params.push(...statuses)
    }
  }
  if (filters.status) {
    const statuses = projectStatusesForFilter(filters.status).filter(status => projectStatusMeta(status).phase)
    if (statuses.length) {
      sql += ` AND p.status IN (${statuses.map(() => '?').join(',')})`
      params.push(...statuses)
    }
  }
  if (query) {
    sql += ' AND (p.name LIKE ? OR p.customer LIKE ? OR p.phone LIKE ? OR p.address LIKE ?)'
    const like = `%${query}%`
    params.push(like, like, like, like)
  }
  sql += ' ORDER BY p.created_at DESC LIMIT ?'
  params.push(limit)
  const data = db.prepare(sql).all(...params)
    .filter(project => canAccessProjectRecord(db, user, project))
    .map(projectFact)
  return ok(data, {
    count: data.length,
    domain: 'projects',
    query,
    phase: filters.phase || '',
    status: filters.status || ''
  })
}

export function projectDocumentFacts(db, user, projectId) {
  if (!canAccessModule(db, user, 'projects', 'can_view')) {
    return denied('没有查看项目单据的权限')
  }
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(projectId || 0))
  if (!project || !canAccessProjectRecord(db, user, project)) {
    return { success: false, message: '项目不存在或无权限', data: null, meta: { count: 0 } }
  }
  const docs = db.prepare(`
    SELECT d.*, a.original_name as source_file_name,
           cu.username as created_by_username, cu.real_name as created_by_real_name,
           uu.username as updated_by_username, uu.real_name as updated_by_real_name
    FROM project_documents d
    LEFT JOIN attachments a ON a.id = d.source_attachment_id
    LEFT JOIN users cu ON cu.id = d.created_by
    LEFT JOIN users uu ON uu.id = d.updated_by
    WHERE d.project_id = ?
    ORDER BY d.id DESC
  `).all(project.id)
  const attachments = db.prepare(`
    SELECT id, original_name, mime_type, size, created_at
    FROM attachments
    WHERE entity_type = 'project' AND entity_id = ? AND COALESCE(deleted_at, '') = ''
    ORDER BY id DESC
  `).all(project.id)

  const versionsByType = {}
  for (const row of docs) {
    const formatted = formatProjectDocumentFact(row)
    if (!versionsByType[row.document_type]) versionsByType[row.document_type] = []
    versionsByType[row.document_type].push(formatted)
  }

  const nodes = PROJECT_DOCUMENT_TYPES.map(type => {
    const versions = versionsByType[type.key] || []
    const latest = versions[0] || null
    const linkedAttachments = attachments.filter(file => versions.some(doc => Number(doc.source_attachment_id || 0) === Number(file.id)))
    const status = latest?.status === 'confirmed'
      ? '已确认'
      : latest
        ? '已有'
        : linkedAttachments.length
          ? '已上传'
          : '缺失'
    return {
      document_type: type.key,
      label: type.label,
      node: type.node,
      status,
      version_count: versions.length,
      latest,
      versions: versions.slice(0, 6),
      attachments: linkedAttachments.slice(0, 8),
      table_data: latest?.confirmed_data || emptyDeliveryDocument(type.key, project)
    }
  })

  return ok({
    project: projectFact(project),
    metrics: {
      total_count: nodes.length,
      confirmed_count: nodes.filter(node => node.status === '已确认').length,
      existing_count: nodes.filter(node => node.status !== '缺失').length,
      missing_count: nodes.filter(node => node.status === '缺失').length,
      multi_version_count: nodes.filter(node => node.version_count > 1).length
    },
    nodes
  }, {
    domain: 'project_documents',
    project_id: project.id,
    count: nodes.length
  })
}

export function financeFacts(db, user, filters = {}) {
  if (!canAccessModule(db, user, 'finance', 'can_view')) {
    return denied('没有查看财务数据的权限')
  }
  const limit = clampLimit(filters.limit, 20, 50)
  const data = buildProjectProfitSummary(db, limit)
  return ok(data.data, {
    domain: 'finance',
    count: data.data.length,
    totals: data.totals
  })
}

export function transactionFacts(db, user, filters = {}) {
  if (!canAccessModule(db, user, 'transactions', 'can_view')) {
    return denied('没有查看流水的权限')
  }
  const days = Math.min(Math.max(Number(filters.days || 30), 1), 365)
  const type = clean(filters.type)
  const query = clean(filters.query)
  const limit = clampLimit(filters.limit, 100, 300)
  let sql = `
    SELECT t.*, a.name as account_name
    FROM transactions t
    LEFT JOIN accounts a ON t.account_id = a.id
    WHERE t.created_at >= datetime('now', 'localtime', '-' || ? || ' days')
  `
  const params = [days]
  if (['income', 'expense'].includes(type)) {
    sql += ' AND t.type = ?'
    params.push(type)
  }
  if (query) {
    sql += ' AND (t.category LIKE ? OR t.description LIKE ? OR t.party LIKE ? OR a.name LIKE ?)'
    const like = `%${query}%`
    params.push(like, like, like, like)
  }
  sql += ' ORDER BY t.created_at DESC LIMIT ?'
  params.push(limit)
  const data = db.prepare(sql).all(...params)
  return ok(data, {
    count: data.length,
    domain: 'finance',
    days,
    type,
    query
  })
}

export function accountFacts(db, user) {
  if (!canAccessModule(db, user, 'accounts', 'can_view')) {
    return denied('没有查看账户的权限')
  }
  const data = db.prepare('SELECT id, name, type, initial_balance, current_balance FROM accounts ORDER BY id').all()
  return ok(data, { count: data.length, domain: 'finance' })
}

export function systemStatsFacts(db, user) {
  const data = {
    accounts: canAccessModule(db, user, 'accounts', 'can_view') ? countRows(db, 'accounts') : 0,
    today_transactions: canAccessModule(db, user, 'transactions', 'can_view')
      ? db.prepare("SELECT COALESCE(SUM(amount),0) as total FROM transactions WHERE date(created_at) = date('now')").get().total
      : 0,
    products: canAccessModule(db, user, 'products', 'can_view') ? countRows(db, 'products') : 0,
    employees: canAccessModule(db, user, 'employees', 'can_view')
      ? db.prepare('SELECT COUNT(*) as c FROM employees WHERE status = ?').get('active')?.c || 0
      : 0
  }
  return ok(data, { domain: 'system' })
}

export function todayFinanceSummaryFacts(db, user) {
  if (!canAccessModule(db, user, 'transactions', 'can_view')) {
    return denied('没有查看流水的权限')
  }
  const data = db.prepare(`
    SELECT
      COUNT(*) as total_count,
      COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END), 0) as total_income,
      COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0) as total_expense
    FROM transactions WHERE date(created_at) = date('now')
  `).get()
  return ok(data, { domain: 'finance' })
}

function productFact(product) {
  const displayName = productDisplayName(product)
  const unit = clean(product.unit)
  const stock = Number(product.stock || 0)
  const warehouseCode = clean(product.warehouse_code)
  const locationDisplay = buildLocationDisplay(product)
  const sortKey = warehouseSortKeyFromProduct(product)
  const categoryName = clean(product.category_name || product.category)
  const skuLabel = `${displayName}${warehouseCode ? `｜${warehouseCode}` : ''}${unit ? `｜${unit}` : ''}｜库存${formatQty(stock)}`
  return {
    ...product,
    category: categoryName,
    is_test: product.is_test ? 1 : 0,
    display_name: displayName,
    sku_label: skuLabel,
    location_display: locationDisplay,
    location_sort_key: sortKey,
    aliases: clean(product.aliases),
    stock_status: stock <= Number(product.min_stock || 0) ? 'low' : 'normal',
    search_text: [displayName, product.name, product.spec, categoryName, product.warehouse_code, locationDisplay, product.location_area, product.unit, product.aliases, skuLabel]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
  }
}

function projectFact(project) {
  const status = canonicalProjectStatus(project.status)
  const meta = projectStatusMeta(project.status)
  return {
    ...project,
    raw_status: project.status,
    status,
    status_label: meta.label,
    phase: meta.phase,
    phase_label: meta.phaseLabel,
    next_step: projectNextStep(status)
  }
}

function formatProjectDocumentFact(row) {
  return {
    id: row.id,
    project_id: row.project_id,
    document_type: row.document_type,
    source_attachment_id: row.source_attachment_id || 0,
    source_file_name: row.source_file_name || '',
    status: row.status || '',
    parsed_data: parseJsonSafe(row.parsed_data, {}),
    confirmed_data: parseJsonSafe(row.confirmed_data, {}),
    warnings: parseJsonSafe(row.warnings, []),
    created_by: row.created_by || 0,
    updated_by: row.updated_by || 0,
    created_by_name: row.created_by_real_name || row.created_by_username || '',
    updated_by_name: row.updated_by_real_name || row.updated_by_username || '',
    created_at: row.created_at || '',
    updated_at: row.updated_at || ''
  }
}

function buildProjectProfitSummary(db, limit) {
  const projects = db.prepare(`
    SELECT id, name, customer, status, total_amount, deposit_amount, settlement_amount, updated_at
    FROM projects
    WHERE status IN ('material_returned', 'labor_settled', 'cost_checked', 'finance_settled', 'archived')
    ORDER BY updated_at DESC, id DESC
    LIMIT ?
  `).all(limit)
  const docs = latestProjectFinanceDocs(db, projects.map(item => item.id))
  const rows = projects.map(project => projectProfitRow(project, docs[project.id] || {}))
  const totals = rows.reduce((sum, row) => {
    sum.revenue_amount += row.revenue_amount
    sum.total_cost += row.total_cost
    sum.gross_profit += row.gross_profit
    sum.unpaid_amount += row.unpaid_amount
    if (row.warnings.length) sum.warning_count += 1
    return sum
  }, { project_count: rows.length, revenue_amount: 0, total_cost: 0, gross_profit: 0, unpaid_amount: 0, warning_count: 0 })
  totals.revenue_amount = roundMoney(totals.revenue_amount)
  totals.total_cost = roundMoney(totals.total_cost)
  totals.gross_profit = roundMoney(totals.gross_profit)
  totals.unpaid_amount = roundMoney(totals.unpaid_amount)
  totals.profit_rate = totals.revenue_amount ? Number((totals.gross_profit / totals.revenue_amount).toFixed(4)) : 0
  return { totals, data: rows }
}

function latestProjectFinanceDocs(db, projectIds) {
  if (!projectIds.length) return {}
  const rows = db.prepare(`
    SELECT *
    FROM project_documents
    WHERE project_id IN (${projectIds.map(() => '?').join(',')})
      AND document_type IN ('material_io', 'labor_settlement', 'cost_check', 'finance_settlement')
    ORDER BY project_id ASC, document_type ASC, id DESC
  `).all(...projectIds)
  const map = {}
  for (const row of rows) {
    if (!map[row.project_id]) map[row.project_id] = {}
    if (!map[row.project_id][row.document_type]) {
      map[row.project_id][row.document_type] = parseJsonSafe(row.confirmed_data, {})
    }
  }
  return map
}

function projectProfitRow(project, docs) {
  const material = docs.material_io?.summary || {}
  const labor = docs.labor_settlement?.summary || {}
  const cost = docs.cost_check?.summary || {}
  const finance = docs.finance_settlement?.summary || {}
  const revenue = firstMoney(finance.delivery_revenue, cost.revenue_amount, project.settlement_amount, finance.contract_amount, project.total_amount)
  const laborFee = firstMoney(labor.labor_fee, cost.labor_fee)
  const materialFee = firstMoney(material.material_fee, cost.material_fee)
  const auxiliaryFee = firstMoney(material.auxiliary_fee, cost.auxiliary_fee)
  const toolFee = firstMoney(material.tool_fee, cost.tool_fee)
  const transportFee = firstMoney(material.transport_fee, cost.transport_fee)
  const autoCost = roundMoney(laborFee + materialFee + auxiliaryFee + toolFee + transportFee + firstMoney(cost.other_fee))
  const totalCost = firstMoney(cost.total_cost, autoCost)
  const grossProfit = roundMoney(revenue - totalCost)
  const unpaidAmount = firstMoney(finance.unpaid_amount, Math.max(revenue - firstMoney(finance.received_amount, project.deposit_amount), 0))
  const warnings = []
  if (grossProfit < 0) warnings.push('毛利为负')
  if (unpaidAmount > 0) warnings.push('存在尾款/未收')
  if (revenue && !docs.finance_settlement) warnings.push('缺财务结算/归档凭证')
  return {
    project_id: project.id,
    project_name: project.name,
    customer: project.customer,
    status: canonicalProjectStatus(project.status),
    status_label: projectStatusMeta(project.status).label,
    revenue_amount: roundMoney(revenue),
    total_cost: roundMoney(totalCost),
    gross_profit: roundMoney(grossProfit),
    profit_rate: revenue ? Number((grossProfit / revenue).toFixed(4)) : 0,
    unpaid_amount: roundMoney(unpaidAmount),
    payment_status: finance.payment_status || (unpaidAmount > 0 ? 'partial' : revenue ? 'paid' : 'pending'),
    warnings
  }
}

function productDisplayName(item) {
  const name = clean(item?.name)
  const spec = clean(item?.spec)
  if (!spec || name.includes(spec)) return name
  return `${name}${spec}`
}

function countRows(db, table) {
  return db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get().c
}

function denied(message) {
  return { success: false, message, data: [], meta: { count: 0 } }
}

function ok(data, meta = {}) {
  return { success: true, data, meta }
}

function clean(value) {
  return String(value || '').trim()
}

function clampLimit(value, fallback, max) {
  const n = Number(value || fallback)
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(Math.floor(n), 1), max)
}

function formatQty(value) {
  const n = Number(value || 0)
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

function firstMoney(...values) {
  for (const value of values) {
    const n = Number(value)
    if (Number.isFinite(n) && n > 0) return n
  }
  return 0
}

function roundMoney(value) {
  const n = Number(value || 0)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0
}

function parseJsonSafe(value, fallback) {
  try {
    return JSON.parse(value || '')
  } catch {
    return fallback
  }
}
