// AI 聊天模块 - 调 DeepSeek API + 工具调用 + 流式返回
import crypto from 'crypto'
import { authMiddleware } from '../middleware/auth.js'
import { canAccessModule, canAccessProjectRecord, requireAssignedAccount } from '../utils/permissions.js'
import { missingCoreFields, normalizeProjectDraft, parseProjectHandoverText } from '../utils/projectImport.js'
import { parseFinanceTransactionDraft as parseFinanceTransactionDraftShared } from '../utils/financeParser.js'
import { AI_TOOL_REGISTRY, buildToolSchemas, toolMeta } from '../ai/toolRegistry.js'

const KB_SERVER = 'http://127.0.0.1:18790'
const AI_ENDPOINT = 'https://api.deepseek.com/chat/completions'

const PROJECT_STATUS_LABELS = {
  handover_received: { phase: 1, label: '门店交底待核对', phaseLabel: '门店交底/勘察' },
  survey_pending: { phase: 1, label: '待现场勘察', phaseLabel: '门店交底/勘察' },
  survey_done: { phase: 1, label: '勘察完成待复尺', phaseLabel: '门店交底/勘察' },
  recheck_done: { phase: 2, label: '复尺完成待班组交底', phaseLabel: '复尺/班组交底/出库' },
  briefing_done: { phase: 2, label: '班组交底完成待出库', phaseLabel: '复尺/班组交底/出库' },
  material_requested: { phase: 2, label: '已申请出库', phaseLabel: '复尺/班组交底/出库' },
  material_out: { phase: 3, label: '已出库待进场', phaseLabel: '进场/施工/验收' },
  in_progress: { phase: 3, label: '施工中', phaseLabel: '进场/施工/验收' },
  inspection_done: { phase: 3, label: '验收完成待回库', phaseLabel: '进场/施工/验收' },
  material_returned: { phase: 4, label: '回库完成待工费结算', phaseLabel: '回库/工费/成本' },
  labor_settled: { phase: 4, label: '工费结算完成待成本核算', phaseLabel: '回库/工费/成本' },
  cost_checked: { phase: 4, label: '成本核算完成待财务结算', phaseLabel: '回库/工费/成本' },
  finance_settled: { phase: 5, label: '财务结算完成待归档', phaseLabel: '财务/归档' },
  archived: { phase: 5, label: '已归档', phaseLabel: '财务/归档' },
  repair_requested: { phase: 6, label: '售后待安排', phaseLabel: '售后处理' },
  repair_assigned: { phase: 6, label: '售后处理中', phaseLabel: '售后处理' },
  repair_done: { phase: 6, label: '售后已完成', phaseLabel: '售后处理' },
}

const PROJECT_STATUS_ALIASES = {
  info_confirmed: 'handover_received',
  condition_met: 'recheck_done',
  team_assigned: 'recheck_done',
  completed: 'inspection_done',
  settled: 'finance_settled',
  closed: 'archived'
}

function getConfig(db) {
  const settings = getSystemSettings(db)
  return {
    apiKey: process.env.AI_API_KEY || '',
    model: settings.ai_model || process.env.AI_MODEL || 'deepseek-chat',
    maxTokens: parseInt(settings.ai_max_tokens || process.env.AI_MAX_TOKENS || '4096'),
    temperature: parseFloat(settings.ai_temperature || process.env.AI_TEMPERATURE || '0.7')
  }
}

function getSystemSettings(db) {
  try {
    const rows = db.prepare('SELECT key, value FROM system_settings').all()
    return Object.fromEntries(rows.map(r => [r.key, r.value]))
  } catch {
    return {}
  }
}

function canonicalProjectStatus(status) {
  return PROJECT_STATUS_ALIASES[status] || status
}

function projectStatusMeta(status) {
  const canonical = canonicalProjectStatus(status)
  return PROJECT_STATUS_LABELS[canonical] || { phase: 0, label: status || '未知状态', phaseLabel: '' }
}

function projectStatusesForPhase(phase) {
  const phaseNumber = Number(phase)
  const statuses = new Set(
    Object.entries(PROJECT_STATUS_LABELS)
      .filter(([, meta]) => meta.phase === phaseNumber)
      .map(([status]) => status)
  )
  for (const [legacy, target] of Object.entries(PROJECT_STATUS_ALIASES)) {
    if (PROJECT_STATUS_LABELS[target]?.phase === phaseNumber) statuses.add(legacy)
  }
  return [...statuses]
}

function projectStatusesForFilter(status) {
  const canonical = canonicalProjectStatus(status)
  const statuses = new Set([canonical])
  for (const [legacy, target] of Object.entries(PROJECT_STATUS_ALIASES)) {
    if (target === canonical) statuses.add(legacy)
  }
  return [...statuses]
}

function projectNextStep(status) {
  return {
    handover_received: '安排首勘人员，补齐门店交底资料后进入待现场勘察。',
    survey_pending: '首勘人员补齐工勘日期和现场记录，确认首次工勘结论。',
    survey_done: '安排二勘/复尺人员，补齐复尺或开工条件复核记录。',
    recheck_done: '确认班组交底单，补齐班组、施工负责人和班组交底日期。',
    briefing_done: '仓库处理材料出库申请并确认出库。',
    material_requested: '仓库核对库存，确认材料出库。',
    material_out: '工程/施工负责人确认开工日期、预计完工日期和进场人员。',
    in_progress: '收尾验收人员确认完工日期、验收日期和验收通过结论。',
    inspection_done: '仓管填写并确认材料回库单。',
    material_returned: '财务/工程确认施工班组工费结算单。',
    labor_settled: '财务确认完工成本核算表。',
    cost_checked: '财务确认财务结算/归档凭证，收款状态需为已收齐。',
    finance_settled: '检查关键单据链完整后归档。',
    archived: '主工程已归档；后续售后单独发起。',
    repair_requested: '安排售后维修负责人。',
    repair_assigned: '记录售后处理结果并关闭售后。',
    repair_done: '售后已完成。'
  }[status] || '按项目工单当前状态补齐缺失资料。'
}

const TOOLS = buildToolSchemas()

// ====== 工具执行器 ======
function executeTool(name, args, db, user) {
  switch (name) {
    case 'get_accounts': {
      const data = db.prepare('SELECT id, name, type, initial_balance, current_balance FROM accounts ORDER BY id').all()
      return JSON.stringify({ success: true, data })
    }

    case 'get_transactions': {
      const days = args.days || 30
      let sql = "SELECT t.*, a.name as account_name FROM transactions t LEFT JOIN accounts a ON t.account_id = a.id WHERE t.created_at >= datetime('now', 'localtime', '-' || ? || ' days')"
      const params = [days]
      if (args.type) {
        sql += ' AND t.type = ?'
        params.push(args.type)
      }
      sql += ' ORDER BY t.created_at DESC LIMIT 100'
      const data = db.prepare(sql).all(...params)
      return JSON.stringify({ success: true, count: data.length, data })
    }

    case 'get_today_summary': {
      const summary = db.prepare(`
        SELECT
          COUNT(*) as total_count,
          COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END), 0) as total_income,
          COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END), 0) as total_expense
        FROM transactions WHERE date(created_at) = date('now')
      `).get()
      return JSON.stringify({ success: true, data: summary })
    }

    case 'get_products': {
      const data = db.prepare('SELECT id, name, category, spec, unit, unit_price, price_unit, stock, min_stock, is_test FROM products ORDER BY name ASC, spec ASC, id ASC').all()
        .map(product => ({
          ...product,
          display_name: productDisplayName(product),
          sku_label: productSkuLabel(product),
          stock_status: Number(product.stock || 0) <= Number(product.min_stock || 0) ? 'low' : 'normal',
          is_test: product.is_test ? 1 : 0
        }))
      return JSON.stringify({ success: true, data })
    }

    case 'get_employees': {
      const data = db.prepare('SELECT id, name, department, position, phone, status FROM employees ORDER BY id').all()
      return JSON.stringify({ success: true, data })
    }

    case 'get_projects': {
      let sql = `
        SELECT p.id, p.name, p.customer, p.phone, p.address, p.status,
               p.total_amount, p.deposit_amount, p.settlement_amount,
               p.manager_user_id, p.assignee_user_id, p.survey_user_id, p.recheck_user_id, p.final_inspection_user_id,
               p.crew_member_user_ids, p.created_by, p.created_at, p.updated_at,
               mu.username as manager_username, mu.real_name as manager_real_name,
               au.username as assignee_username, au.real_name as assignee_real_name
        FROM projects p
        LEFT JOIN users mu ON p.manager_user_id = mu.id
        LEFT JOIN users au ON p.assignee_user_id = au.id
        WHERE 1=1
      `
      const params = []
      if (args.phase) {
        const statuses = projectStatusesForPhase(args.phase)
        if (statuses.length) {
          sql += ` AND p.status IN (${statuses.map(() => '?').join(',')})`
          params.push(...statuses)
        }
      }
      if (args.status) {
        const statuses = projectStatusesForFilter(args.status).filter(status => PROJECT_STATUS_LABELS[canonicalProjectStatus(status)])
        if (statuses.length) {
          sql += ` AND p.status IN (${statuses.map(() => '?').join(',')})`
          params.push(...statuses)
        }
      }
      sql += ' ORDER BY p.created_at DESC LIMIT 100'
      const data = db.prepare(sql).all(...params)
        .filter(project => canAccessProjectRecord(db, user, project))
        .map(p => ({
          ...p,
          raw_status: p.status,
          status: canonicalProjectStatus(p.status),
          status_label: projectStatusMeta(p.status).label,
          phase: projectStatusMeta(p.status).phase,
          phase_label: projectStatusMeta(p.status).phaseLabel,
          next_step: projectNextStep(canonicalProjectStatus(p.status))
        }))
      return JSON.stringify({ success: true, count: data.length, data })
    }

    case 'get_project_profit_summary': {
      if (!canAccessModule(db, user, 'finance', 'can_view')) {
        return JSON.stringify({ success: false, message: '没有查看项目利润粗算的权限' })
      }
      const limit = Math.min(Math.max(Number(args.limit || 20), 1), 50)
      const data = buildAiProjectProfitSummary(db, limit)
      return JSON.stringify({ success: true, ...data })
    }

    case 'get_system_stats': {
      const accounts = db.prepare('SELECT COUNT(*) as c FROM accounts').get().c
      const todayTx = db.prepare("SELECT COALESCE(SUM(amount),0) as total FROM transactions WHERE date(created_at) = date('now')").get().total
      const products = db.prepare('SELECT COUNT(*) as c FROM products').get().c
      const employees = db.prepare('SELECT COUNT(*) as c FROM employees WHERE status = ?').get('active')?.c || 0
      return JSON.stringify({ success: true, data: { accounts, today_transactions: todayTx, products, employees } })
    }

    case 'parse_finance_transaction': {
      const draft = parseFinanceTransactionDraftShared(String(args.raw_text || ''), db)
      return JSON.stringify({
        success: true,
        message: '已生成收支草稿，聊天写入前仍必须由用户明确确认',
        data: { ...draft, needs_confirmation: true }
      })
    }

    default:
      return JSON.stringify({ success: false, message: `未知工具: ${name}` })

    case 'create_transaction': {
      if (!canAccessModule(db, user, 'transactions', 'can_create')) {
        return JSON.stringify({ success: false, message: '没有创建交易的权限' })
      }
      if (!args.confirmed) {
        return JSON.stringify({ success: false, message: '写入流水前必须先让用户明确确认' })
      }
      if (!args.account_id || !args.amount || args.amount <= 0) {
        return JSON.stringify({ success: false, message: '参数无效：account_id 和 amount（正数）必填' })
      }
      const info = db.prepare('SELECT name, current_balance FROM accounts WHERE id = ?').get(args.account_id)
      if (!info) return JSON.stringify({ success: false, message: `账户 ${args.account_id} 不存在` })
      db.prepare(
        'INSERT INTO transactions (account_id, type, amount, category, description, party) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(args.account_id, args.type, args.amount, args.category, args.description || '', args.party || '')
      // 更新账户余额
      const sign = args.type === 'income' ? 1 : -1
      db.prepare(
        "UPDATE accounts SET current_balance = current_balance + ?, updated_at = datetime('now', 'localtime') WHERE id = ?"
      ).run(sign * args.amount, args.account_id)
      const newBalance = db.prepare('SELECT current_balance FROM accounts WHERE id = ?').get(args.account_id).current_balance
      return JSON.stringify({ success: true, message: `已成功添加${args.type === 'income' ? '收入' : '支出'} ${args.amount} 元 [${args.category}]，账户「${info.name}」当前余额 ${newBalance} 元` })
    }

    case 'create_account': {
      if (!canAccessModule(db, user, 'accounts', 'can_create')) {
        return JSON.stringify({ success: false, message: '没有创建账户的权限' })
      }
      if (!args.confirmed) {
        return JSON.stringify({ success: false, message: '创建账户前必须先让用户明确确认' })
      }
      if (!args.name) return JSON.stringify({ success: false, message: '账户名称必填' })
      db.prepare('INSERT INTO accounts (name, type) VALUES (?, ?)').run(args.name, args.type || 'personal')
      return JSON.stringify({ success: true, message: `账户「${args.name}」创建成功` })
    }

    case 'parse_project_handover': {
      const rawText = String(args.raw_text || '')
      const drafts = parseProjectHandoverText(rawText).map(draft => ({
        ...draft,
        missing_fields: missingCoreFields(draft)
      }))
      return JSON.stringify({ success: true, count: drafts.length, data: drafts })
    }

    case 'create_project_workorder': {
      if (!canAccessModule(db, user, 'projects', 'can_create')) {
        return JSON.stringify({ success: false, message: '没有创建项目工单的权限' })
      }
      if (!args.confirmed) {
        return JSON.stringify({ success: false, message: '创建项目工单前必须先让用户确认' })
      }
      const draft = normalizeProjectDraft(args)
      if (!draft.name || !draft.customer) {
        return JSON.stringify({ success: false, message: '工单名称和业主/客户必填' })
      }
      const address = [draft.address_province, draft.address_city, draft.address_detail].filter(Boolean).join(' ')
      const result = db.prepare(`
        INSERT INTO projects (
          name, customer, phone, address, address_province, address_city, address_detail,
          source, order_taker, order_date, external_order_no, handover_note,
          total_amount, deposit_amount, manager_user_id, assignee_user_id, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?)
      `).run(
        draft.name,
        draft.customer,
        draft.phone,
        address,
        draft.address_province,
        draft.address_city,
        draft.address_detail,
        draft.source,
        draft.order_taker,
        draft.order_date,
        draft.external_order_no,
        draft.handover_note,
        Number(draft.total_amount || 0),
        user.userId
      )
      db.prepare('INSERT INTO project_logs (project_id, action, operator, content) VALUES (?, ?, ?, ?)')
        .run(result.lastInsertRowid, 'AI创建工单', user.username || '', '用户确认后由简尚 AI 创建项目工单')
      return JSON.stringify({ success: true, id: result.lastInsertRowid, message: `已创建项目工单「${draft.name}」` })
    }
  }
}

function productDisplayName(item) {
  const name = String(item?.name || '').trim()
  const spec = String(item?.spec || '').trim()
  if (!spec || name.includes(spec)) return name
  return `${name}${spec}`
}

function productSkuLabel(item) {
  const unit = String(item?.unit || '').trim()
  const stock = formatQty(item?.stock || 0)
  return `${productDisplayName(item)}${unit ? `｜${unit}` : ''}｜${stock}`
}

function formatQty(value) {
  const n = Number(value || 0)
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

function buildAiProjectProfitSummary(db, limit) {
  const projects = db.prepare(`
    SELECT id, name, customer, status, total_amount, deposit_amount, settlement_amount, updated_at
    FROM projects
    WHERE status IN ('material_returned', 'labor_settled', 'cost_checked', 'finance_settled', 'archived')
    ORDER BY updated_at DESC, id DESC
    LIMIT ?
  `).all(limit)
  const docs = getLatestProjectFinanceDocs(db, projects.map(item => item.id))
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

function getLatestProjectFinanceDocs(db, projectIds) {
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

function loadFinanceAccountAliases(db) {
  try {
    return db.prepare(`
      SELECT alias, account_name
      FROM finance_account_aliases
      WHERE enabled = 1
      ORDER BY length(alias) DESC, id ASC
    `).all()
  } catch {
    return []
  }
}

function findAccountByName(accounts, targetName) {
  const target = normalizeAccountName(targetName)
  return accounts.find(item => {
    const current = normalizeAccountName(item.name)
    return item.name === targetName || current === target || current.includes(target) || target.includes(current)
  }) || null
}

function normalizeAccountName(value) {
  return String(value || '').replace(/[·\s　]/g, '')
}

function inferFinanceCategory(text, type) {
  if (/退款|退货退款/.test(text)) return '退款'
  if (/工资|结算工资/.test(text)) return type === 'income' ? '工资款' : '工人工资'
  if (/预支|借支/.test(text)) return /差旅|出差/.test(text) ? '差旅' : '借支'
  if (/报销/.test(text)) return '报销'
  if (/货拉拉|打车|加油|停车|高速/.test(text)) return '交通费'
  if (/手续费|代发/.test(text)) return '手续费'
  if (/个税|社保|税费/.test(text)) return '税费'
  if (/茶叶|招待|应酬/.test(text)) return '应酬费'
  if (/货款|材料|涂料|底漆|面漆|结算单/.test(text)) return type === 'income' ? '货款' : '材料采购'
  if (/返点|渠道返款/.test(text)) return '返点支出'
  if (/装修|电线|工地/.test(text)) return type === 'income' ? '项目收入' : '装修费'
  if (/生活费/.test(text)) return '生活费'
  return type === 'income' ? '项目收入' : '其他'
}

function inferCounterparty(text) {
  const patterns = [
    /(?:给|付给|支付给|收到|收)([^，,。；;\s]{2,12})/,
    /对方[:：]\s*([^，,。；;\s]{2,12})/
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) return match[1].replace(/[0-9.]/g, '').trim()
  }
  return ''
}

function cleanFinanceDescription(text) {
  return text
    .replace(/[0-9]+(?:\.[0-9]{1,2})?/g, '')
    .replace(/收入|收到|收款|支付|支出|付款|扣款/g, '')
    .trim()
    .slice(0, 120)
}

// ====== 知识库搜索 ======
async function searchKnowledgeBase(query, topK = 3) {
  try {
    const res = await fetch(`${KB_SERVER}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, top_k: topK, threshold: 0.25, allow_categories: true }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return []
    return await res.json()
  } catch { return [] }
}

// ====== AI 工具权限过滤 ======
function getAllowedTools(userId, roleName, db, agent) {
  const role = db.prepare('SELECT id FROM roles WHERE name = ?').get(roleName)
  if (!role) return []

  // 取角色预设
  const rolePerms = db.prepare(
    'SELECT tool_name, allowed FROM ai_role_tools WHERE role_id = ?'
  ).all(role.id)

  // 取用户覆盖
  const userPerms = db.prepare(
    'SELECT tool_name, allowed FROM ai_user_tools WHERE user_id = ?'
  ).all(userId)

  const overrideMap = {}
  for (const up of userPerms) overrideMap[up.tool_name] = up.allowed

  // 合并：user override 优先，其次 role preset
  const result = []
  for (const rp of rolePerms) {
    if (overrideMap.hasOwnProperty(rp.tool_name)) {
      if (overrideMap[rp.tool_name]) result.push(rp.tool_name)
    } else {
      if (rp.allowed) result.push(rp.tool_name)
    }
  }
  if (!agent?.id) return result
  const agentRows = db.prepare('SELECT tool_name, allowed FROM ai_agent_tools WHERE agent_id = ?').all(agent.id)
  if (!agentRows.length) return result
  const agentAllowed = new Set(agentRows.filter(row => row.allowed).map(row => row.tool_name))
  return result.filter(tool => agentAllowed.has(tool))
}

function getRateLimits(role) {
  if (role === 'super_admin') return { perMinute: 80, perDay: 2000 }
  if (['finance', 'warehouse', 'admin'].includes(role)) return { perMinute: 40, perDay: 800 }
  return { perMinute: 20, perDay: 300 }
}

function checkAiRateLimit(db, user) {
  const limits = getRateLimits(user.role)
  const row = db.prepare(`
    SELECT
      SUM(CASE WHEN created_at >= datetime('now', 'localtime', '-1 minute') THEN 1 ELSE 0 END) as minute_count,
      COUNT(*) as day_count
    FROM ai_audit_logs
    WHERE user_id = ?
      AND action_type = 'chat'
      AND created_at >= datetime('now', 'localtime', '-1 day')
  `).get(user.userId)
  if ((row?.minute_count || 0) >= limits.perMinute) {
    return { ok: false, message: 'AI 使用过于频繁，请稍后再试' }
  }
  if ((row?.day_count || 0) >= limits.perDay) {
    return { ok: false, message: '今日 AI 使用次数已达上限，请联系管理员' }
  }
  return { ok: true }
}

function logAiAudit(db, user, data) {
  db.prepare(`
    INSERT INTO ai_audit_logs (
      user_id, employee_id, role, action_type, tool_name, request_summary,
      result_summary, status, error_message, model, input_tokens, output_tokens, duration_ms,
      agent_id, context_key, risk_level, confirmation_required
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    user.userId || 0,
    user.employeeId || 0,
    user.role || '',
    data.actionType,
    data.toolName || '',
    summarize(data.requestSummary || ''),
    summarize(data.resultSummary || ''),
    data.status || 'ok',
    summarize(data.errorMessage || ''),
    data.model || '',
    data.inputTokens || 0,
    data.outputTokens || 0,
    data.durationMs || 0,
    data.agentId || 0,
    summarize(data.contextKey || '', 120),
    data.riskLevel || '',
    data.confirmationRequired ? 1 : 0
  )
}

function summarize(value, limit = 500) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > limit ? `${text.slice(0, limit)}...` : text
}

function getSystemPrompt(username, agent, memorySummary = '') {
  return `你是简尚系统的智能助手，名字叫"简尚小助手"。

## 简尚真实业务
简尚不是销售 CRM，门店/渠道负责签单和交底，简尚负责施工承接。项目工单流程是：
1. 门店交底待核对：补齐来源门店/渠道、门店接单人、业主联系方式、详细地址、施工空间、材料意向和注意事项。
2. 待现场勘察：工程部填写勘察日期和现场记录，或关联标准勘察表。
3. 勘察完成待复尺：记录复尺面积、基层、水电、保护和进场条件。
4. 复尺完成待班组交底：安排班组长、施工负责人、施工成员和班组交底日期。
5. 班组交底完成待出库：只能通过材料出库申请进入仓库确认，不能直接跳过。
6. 已出库待进场 / 施工中 / 验收完成待回库：记录开工日期、施工过程、完工验收和回库状态。
7. 回库完成待工费结算 -> 工费结算完成待成本核算 -> 成本核算完成待财务结算 -> 财务结算完成待归档 -> 已归档。
8. 售后是独立事件：repair_requested / repair_assigned / repair_done，不倒退主工程流程。

你描述项目状态时必须使用以上口径，不要再说“项目前期、准备阶段、施工执行”这种旧阶段名称。注意区分“门店交底”和“班组交底”：门店交底是项目来源和客户需求，班组交底是复尺后、出库前的工程执行安排。
你可以说明下一步缺什么、帮用户生成草稿或检查单据，但不能绕过人工确认。工费、成本、财务结算必须分别通过施工班组工费结算单、完工成本核算表、财务结算/归档凭证确认推进。
普通员工只能查看和自己相关的项目；如果用户询问无关项目或工具没有返回数据，应明确说明“没有权限或没有查到可见数据”，不要猜测。

## 当前分身
名称：${agent?.name || '简尚总助手'}
用途：${agent?.purpose || '系统助手'}
分身提示词：${agent?.base_prompt || '优先查询系统事实，再简洁回答。'}
${memorySummary ? `\n## 当前场景轻记忆\n${memorySummary}` : ''}

## 你的能力
1. 回答关于公司财务、制度、流程、产品、合同等方面的问题
2. 帮助用户理解简尚系统的功能
3. **直接查询系统数据并回答** - 你可以调用工具获取账户、交易、产品、员工、项目等实时数据
4. 帮用户把门店/微信交底内容拆成项目工单草稿

## 知识库
你有一个公司文档知识库可供查询。系统会自动搜索相关文档提供给你参考。

## 工具使用规则
- 当用户问及具体数据时（如"查账户余额"、"今天收入多少"、"库存还有多少"等），直接调用对应工具查询
- 当用户要求新增数据时（如"记一笔账"、"新增一个账户"等），直接调用对应工具创建
- 创建操作前**必须向用户确认关键信息**（金额、账户、类型、工单客户、电话、地址等），得到确认后再执行
- 当用户粘贴门店/微信交底内容时，优先调用 parse_project_handover 拆成草稿；只给用户确认清单，不要直接创建
- 只有用户明确说确认创建后，才允许调用 create_project_workorder
- 查询得到数据后，用简洁易懂的语言整理给用户
- 涉及金额用中文数字单位（元/万元）
- 数据量较大时给出汇总和关键信息，不要罗列全部原始数据

## 回复风格
- 专业、简洁、友好
- 不确定的信息不要编造，直接说不知道

当前用户：${username}`
}

// ====== 调用 DeepSeek（非流式，支持工具） ======
async function callDeepSeek(messages, config, tools) {
  const body = {
    model: config.model,
    messages,
    max_tokens: config.maxTokens,
    temperature: config.temperature,
  }
  if (tools) body.tools = tools

  const response = await fetch(AI_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify(body)
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`AI API ${response.status}: ${errText.slice(0, 200)}`)
  }

  return await response.json()
}

async function handleAiChat(request, reply, db) {
  if (authMiddleware(request, reply) === false) return
  if (!requireAssignedAccount(request, reply, '账号等待管理员建档和岗位分配，暂不能使用 AI 查询业务数据')) return
  const user = request.user
  const { message, session_id, agent_id, agent_key, context_type = 'direct', context_key = '' } = request.body || {}
  if (!message) {
    reply.code(400).send({ success: false, message: '消息不能为空' })
    return
  }

  const rate = checkAiRateLimit(db, user)
  if (!rate.ok) {
    reply.code(429).send({ success: false, message: rate.message })
    return
  }

  const config = getConfig(db)
  if (!config.apiKey) {
    reply.code(500).send({ success: false, message: 'AI 未配置' })
    return
  }

  const agent = resolveAiAgent(db, { agentId: agent_id, agentKey: agent_key }, user)
  if (!agent) {
    reply.code(403).send({ success: false, message: '无权限使用该 AI 分身' })
    return
  }
  const sid = session_id || crypto.randomUUID()
  const ctxKey = cleanContextKey(context_key || sid)
  const ctxType = cleanContextType(context_type)
  const startedAt = Date.now()
  let totalInputTokens = 0
  let totalOutputTokens = 0

  ensureAiContext(db, { userId: user.userId, agentId: agent.id, contextType: ctxType, contextKey: ctxKey, title: sid })
  saveChatMessage(db, {
    userId: user.userId,
    agentId: agent.id,
    contextType: ctxType,
    contextKey: ctxKey,
    sessionId: sid,
    role: 'user',
    content: message
  })

  const history = db.prepare(`
    SELECT role, content
    FROM chat_history
    WHERE user_id = ? AND session_id = ? AND agent_id = ? AND context_key = ?
    ORDER BY id ASC LIMIT 20
  `).all(user.userId, sid, agent.id, ctxKey)

  const memorySummary = agent.memory_enabled ? loadAiMemory(db, {
    userId: user.userId,
    agentId: agent.id,
    contextType: ctxType,
    contextKey: ctxKey
  }) : ''

  const messages = [
    { role: 'system', content: getSystemPrompt(user.username, agent, memorySummary) },
    ...history.map(h => ({ role: h.role, content: h.content }))
  ]

  const kbResults = await searchKnowledgeBase(message, 3)
  if (kbResults.length > 0) {
    const context = kbResults.map((r, i) =>
      `[${i + 1}] 来源: ${r.source}\n内容: ${r.content}`
    ).join('\n\n')
    messages.splice(1, 0, {
      role: 'system',
      content: `以下是公司知识库中相关的参考资料，请据此回答用户问题：\n\n${context}`
    })
  }

  const allowedToolNames = getAllowedTools(user.userId, user.role, db, agent)
  const allowedTools = TOOLS.filter(t => allowedToolNames.includes(t.function.name))
  let finalContent = ''
  const currentMessages = messages

  try {
    for (let round = 0; round < 10; round++) {
      const result = await callDeepSeek(currentMessages, config, round === 0 ? allowedTools : undefined)
      totalInputTokens += result.usage?.prompt_tokens || 0
      totalOutputTokens += result.usage?.completion_tokens || 0
      const choice = result.choices?.[0]
      if (choice?.finish_reason === 'stop' || !choice?.message?.tool_calls) {
        finalContent = choice?.message?.content || ''
        break
      }

      const toolCalls = choice.message.tool_calls
      currentMessages.push({ role: 'assistant', content: choice.message.content || null, tool_calls: toolCalls })
      for (const tc of toolCalls) {
        let args = {}
        try { args = JSON.parse(tc.function.arguments) } catch {}
        const meta = toolMeta(tc.function.name)
        const resultData = executeTool(tc.function.name, args, db, user)
        logAiAudit(db, user, {
          actionType: meta.action_type || 'tool_read',
          toolName: tc.function.name,
          requestSummary: args,
          resultSummary: resultData,
          model: config.model,
          agentId: agent.id,
          contextKey: ctxKey,
          riskLevel: meta.risk_level,
          confirmationRequired: meta.requires_confirmation
        })
        currentMessages.push({ role: 'tool', tool_call_id: tc.id, content: resultData })
      }
    }
  } catch (err) {
    const errorMessage = humanizeAiError(err)
    request.log?.error({ err }, 'AI chat failed')
    logAiAudit(db, user, {
      actionType: 'chat_failed',
      requestSummary: message,
      resultSummary: errorMessage,
      model: config.model,
      durationMs: Date.now() - startedAt,
      agentId: agent.id,
      contextKey: ctxKey
    })
    reply.code(502).send({ success: false, message: errorMessage })
    return
  }

  if (!finalContent) finalContent = '抱歉，我暂时无法回答这个问题。'

  const toolLogs = currentMessages.filter(m => m.role === 'tool')
  if (toolLogs.length > 0) {
    const summary = toolLogs.map(m => {
      const data = parseJsonSafe(m.content, {})
      return `→ ${data.message || summarize(data.data || m.content, 180)}`
    }).join('\n')
    saveChatMessage(db, {
      userId: user.userId,
      agentId: agent.id,
      contextType: ctxType,
      contextKey: ctxKey,
      sessionId: sid,
      role: 'system',
      content: `【上一次操作结果】\n${summary}`
    })
  }
  saveChatMessage(db, {
    userId: user.userId,
    agentId: agent.id,
    contextType: ctxType,
    contextKey: ctxKey,
    sessionId: sid,
    role: 'assistant',
    content: finalContent
  })
  if (agent.memory_enabled) {
    saveAiMemory(db, {
      userId: user.userId,
      agentId: agent.id,
      contextType: ctxType,
      contextKey: ctxKey,
      summary: finalContent,
      retentionDays: agent.memory_retention_days
    })
  }
  logAiAudit(db, user, {
    actionType: 'chat',
    requestSummary: message,
    resultSummary: finalContent,
    model: config.model,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    durationMs: Date.now() - startedAt,
    agentId: agent.id,
    contextKey: ctxKey
  })

  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  })
  reply.raw.write(`data: ${JSON.stringify({ type: 'session', session_id: sid, agent_id: agent.id, agent_name: agent.name })}\n\n`)
  reply.raw.write(`data: ${JSON.stringify({ type: 'text', content: finalContent })}\n\n`)
  reply.raw.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
  reply.raw.end()
}

function resolveAiAgent(db, { agentId, agentKey } = {}, user) {
  let agent = null
  const requested = !!agentId || !!agentKey
  if (agentId) agent = db.prepare('SELECT * FROM ai_agents WHERE id = ? AND enabled = 1').get(Number(agentId))
  if (!agent && agentKey) agent = db.prepare('SELECT * FROM ai_agents WHERE key = ? AND enabled = 1').get(String(agentKey))
  if (agent) return canUseAiAgent(agent, user) ? agent : null
  if (requested) return null
  agent = db.prepare('SELECT * FROM ai_agents WHERE is_default = 1 AND enabled = 1 ORDER BY id LIMIT 1').get()
  if (agent && canUseAiAgent(agent, user)) return agent
  const rows = db.prepare('SELECT * FROM ai_agents WHERE enabled = 1 ORDER BY id LIMIT 20').all()
  agent = rows.find(row => canUseAiAgent(row, user))
  return agent || { id: 0, key: 'general', name: '简尚总助手', purpose: '系统助手', base_prompt: '', memory_enabled: 0, memory_retention_days: 7 }
}

function canUseAiAgent(agent, user) {
  if (!agent || !user) return false
  if (user.role === 'super_admin') return true
  const roles = parseRoleList(agent.allowed_roles)
  if (roles.length === 0) return user.role === 'admin' || Number(agent.is_default || 0) === 1 || Number(agent.id || 0) === 0
  return roles.includes(user.role)
}

function parseRoleList(value) {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed.map(item => String(item || '').trim()).filter(Boolean) : []
  } catch {
    return String(value || '').split(',').map(item => item.trim()).filter(Boolean)
  }
}

function ensureAiContext(db, { userId, agentId, contextType, contextKey, title }) {
  db.prepare(`
    INSERT INTO ai_contexts (context_type, context_key, agent_id, user_id, title, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now', 'localtime'))
    ON CONFLICT(context_type, context_key, user_id) DO UPDATE SET
      agent_id = excluded.agent_id,
      title = excluded.title,
      updated_at = datetime('now', 'localtime')
  `).run(contextType, contextKey, agentId || 0, userId || 0, title || '')
}

function saveChatMessage(db, { userId, agentId, contextType, contextKey, sessionId, role, content }) {
  db.prepare(`
    INSERT INTO chat_history (
      user_id, agent_id, context_type, context_key, role, content, session_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
  `).run(userId || 0, agentId || 0, contextType || 'direct', contextKey || '', role, content, sessionId)
}

function loadAiMemory(db, { userId, agentId, contextType, contextKey }) {
  const row = db.prepare(`
    SELECT summary
    FROM ai_memories
    WHERE user_id = ? AND agent_id = ? AND context_type = ? AND context_key = ?
      AND (expires_at = '' OR expires_at > datetime('now', 'localtime'))
    ORDER BY id DESC LIMIT 1
  `).get(userId || 0, agentId || 0, contextType || 'direct', contextKey || '')
  return row?.summary || ''
}

function saveAiMemory(db, { userId, agentId, contextType, contextKey, summary, retentionDays }) {
  const text = summarize(summary || '', 500)
  db.prepare(`
    INSERT INTO ai_memories (
      agent_id, context_type, context_key, user_id, summary, source, expires_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'auto', datetime('now', 'localtime', ?), datetime('now', 'localtime'))
    ON CONFLICT(agent_id, context_type, context_key, user_id) DO UPDATE SET
      summary = excluded.summary,
      expires_at = excluded.expires_at,
      updated_at = datetime('now', 'localtime')
  `).run(agentId || 0, contextType || 'direct', contextKey || '', userId || 0, text, `+${Math.max(1, Number(retentionDays || 7))} days`)
}

function cleanContextType(value) {
  const text = String(value || 'direct').trim()
  return ['direct', 'group', 'page', 'module'].includes(text) ? text : 'direct'
}

function cleanContextKey(value) {
  return String(value || '').trim().slice(0, 120) || crypto.randomUUID()
}

function parseJsonSafe(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback
  } catch {
    return fallback
  }
}

function humanizeAiError(err) {
  const text = String(err?.message || err || '')
  const lower = text.toLowerCase()
  if (lower.includes('insufficient') || lower.includes('balance') || lower.includes('quota') || text.includes('402')) {
    return 'AI 服务余额或额度不足，请检查 DeepSeek 账户余额后再试。'
  }
  if (lower.includes('unauthorized') || lower.includes('invalid api') || lower.includes('api key') || text.includes('401')) {
    return 'AI 密钥无效或已过期，请在系统设置或服务器环境变量里检查 AI_API_KEY。'
  }
  if (lower.includes('rate') || text.includes('429')) {
    return 'AI 请求太频繁，请稍等一会儿再试。'
  }
  if (lower.includes('timeout') || lower.includes('fetch failed') || lower.includes('econn') || lower.includes('enotfound')) {
    return 'AI 服务连接失败，请检查服务器网络或稍后再试。'
  }
  if (text.includes('400')) {
    return 'AI 请求格式被模型拒绝，请稍后重试；如果持续出现，需要检查工具参数或模型配置。'
  }
  return 'AI 服务暂时异常，请稍后重试。'
}

function canManageAi(user) {
  return ['super_admin', 'admin'].includes(user?.role)
}

function normalizeAgentBody(body = {}) {
  const key = String(body.key || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40)
  const allowedRoles = Array.isArray(body.allowed_roles)
    ? body.allowed_roles
    : parseRoleList(body.allowed_roles)
  return {
    key,
    name: String(body.name || '').trim().slice(0, 40),
    purpose: String(body.purpose || '').trim().slice(0, 200),
    scenario_type: ['general', 'finance', 'warehouse', 'project', 'custom'].includes(body.scenario_type) ? body.scenario_type : 'custom',
    base_prompt: String(body.base_prompt || '').trim().slice(0, 4000),
    allowed_roles: JSON.stringify(allowedRoles.filter(role => ['super_admin', 'admin', 'finance', 'warehouse', 'engineering', 'employee'].includes(role))),
    memory_enabled: body.memory_enabled ? 1 : 0,
    memory_retention_days: Math.max(1, Math.min(90, Number(body.memory_retention_days || 7))),
    enabled: body.enabled === 0 || body.enabled === false ? 0 : 1
  }
}

function seedAgentToolRows(db, agentId) {
  const stmt = db.prepare('INSERT OR IGNORE INTO ai_agent_tools (agent_id, tool_name, allowed) VALUES (?, ?, 0)')
  for (const tool of AI_TOOL_REGISTRY) stmt.run(agentId, tool.name)
}

export default function aiRoutes(server, db) {
  server.post('/api/ai/chat', async (request, reply) => handleAiChat(request, reply, db))
  server.post('/api/chat', async (request, reply) => handleAiChat(request, reply, db))

  server.get('/api/ai/agents', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!canManageAi(request.user)) return reply.code(403).send({ success: false, message: '无权限管理 AI 分身' })
    const agents = db.prepare('SELECT * FROM ai_agents ORDER BY is_default DESC, id ASC').all()
    const tools = db.prepare('SELECT agent_id, tool_name, allowed FROM ai_agent_tools ORDER BY id ASC').all()
    return {
      success: true,
      data: agents.map(agent => ({
        ...agent,
        tools: tools.filter(tool => tool.agent_id === agent.id)
      }))
    }
  })

  server.post('/api/ai/agents', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!canManageAi(request.user)) return reply.code(403).send({ success: false, message: '无权限创建 AI 分身' })
    const body = normalizeAgentBody(request.body || {})
    if (!body.key || !body.name) return reply.code(400).send({ success: false, message: '分身标识和名称必填' })
    const result = db.prepare(`
      INSERT INTO ai_agents (
        key, name, purpose, scenario_type, base_prompt, allowed_roles, memory_enabled, memory_retention_days, enabled, is_default
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(body.key, body.name, body.purpose, body.scenario_type, body.base_prompt, body.allowed_roles, body.memory_enabled, body.memory_retention_days, body.enabled)
    seedAgentToolRows(db, result.lastInsertRowid)
    return { success: true, data: db.prepare('SELECT * FROM ai_agents WHERE id = ?').get(result.lastInsertRowid) }
  })

  server.put('/api/ai/agents/:id', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!canManageAi(request.user)) return reply.code(403).send({ success: false, message: '无权限更新 AI 分身' })
    const id = Number(request.params.id || 0)
    const current = db.prepare('SELECT * FROM ai_agents WHERE id = ?').get(id)
    if (!current) return reply.code(404).send({ success: false, message: 'AI 分身不存在' })
    const body = normalizeAgentBody({ ...current, ...(request.body || {}) })
    db.prepare(`
      UPDATE ai_agents
      SET name = ?, purpose = ?, scenario_type = ?, base_prompt = ?,
          allowed_roles = ?, memory_enabled = ?, memory_retention_days = ?, enabled = ?,
          updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(body.name, body.purpose, body.scenario_type, body.base_prompt, body.allowed_roles, body.memory_enabled, body.memory_retention_days, body.enabled, id)
    return { success: true, data: db.prepare('SELECT * FROM ai_agents WHERE id = ?').get(id) }
  })

  server.get('/api/ai/tools', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!canManageAi(request.user)) return reply.code(403).send({ success: false, message: '无权限查看 AI 工具目录' })
    const rows = db.prepare('SELECT * FROM ai_tool_registry WHERE enabled = 1 ORDER BY tier ASC, tool_name ASC').all()
    return { success: true, data: rows }
  })

  server.put('/api/ai/agents/:id/tools', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!canManageAi(request.user)) return reply.code(403).send({ success: false, message: '无权限更新分身工具' })
    const agentId = Number(request.params.id || 0)
    const agent = db.prepare('SELECT id FROM ai_agents WHERE id = ?').get(agentId)
    if (!agent) return reply.code(404).send({ success: false, message: 'AI 分身不存在' })
    const tools = Array.isArray(request.body?.tools) ? request.body.tools : []
    const tx = db.transaction(() => {
      for (const item of tools) {
        const toolName = String(item.tool_name || item.name || '').trim()
        if (!toolName) continue
        db.prepare(`
          INSERT INTO ai_agent_tools (agent_id, tool_name, allowed)
          VALUES (?, ?, ?)
          ON CONFLICT(agent_id, tool_name) DO UPDATE SET allowed = excluded.allowed
        `).run(agentId, toolName, item.allowed ? 1 : 0)
      }
    })
    tx()
    return { success: true }
  })

  server.get('/api/ai/audit-logs', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!canManageAi(request.user)) return reply.code(403).send({ success: false, message: '无权限查看 AI 审计' })
    const { agent_id, tool_name, action_type, status, limit = 100 } = request.query || {}
    const conditions = []
    const params = []
    if (agent_id) { conditions.push('l.agent_id = ?'); params.push(Number(agent_id)) }
    if (tool_name) { conditions.push('l.tool_name = ?'); params.push(String(tool_name)) }
    if (action_type) { conditions.push('l.action_type = ?'); params.push(String(action_type)) }
    if (status) { conditions.push('l.status = ?'); params.push(String(status)) }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const rows = db.prepare(`
      SELECT l.*, u.username, u.real_name, a.name as agent_name
      FROM ai_audit_logs l
      LEFT JOIN users u ON u.id = l.user_id
      LEFT JOIN ai_agents a ON a.id = l.agent_id
      ${where}
      ORDER BY l.id DESC LIMIT ?
    `).all(...params, Math.min(300, Number(limit) || 100))
    return { success: true, data: rows }
  })

  // 获取聊天历史
  server.get('/api/chat/history', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!requireAssignedAccount(request, reply, '账号等待管理员建档和岗位分配，暂不能查看 AI 聊天历史')) return

    const sessions = db.prepare(
      `SELECT session_id, role, content, created_at
       FROM chat_history
       WHERE user_id = ?
       ORDER BY id DESC LIMIT 50`
    ).all(request.user.userId)

    const grouped = {}
    for (const row of sessions.reverse()) {
      if (!grouped[row.session_id]) grouped[row.session_id] = []
      grouped[row.session_id].push({ role: row.role, content: row.content, created_at: row.created_at })
    }

    return { success: true, data: grouped }
  })
}
