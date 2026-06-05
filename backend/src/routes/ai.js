// AI 聊天模块 - 调 DeepSeek API + 工具调用 + 流式返回
import crypto from 'crypto'
import { authMiddleware } from '../middleware/auth.js'
import { canAccessModule } from '../utils/permissions.js'
import { missingCoreFields, normalizeProjectDraft, parseProjectHandoverText } from '../utils/projectImport.js'

const KB_SERVER = 'http://127.0.0.1:18790'
const AI_ENDPOINT = 'https://api.deepseek.com/chat/completions'

const PROJECT_STATUS_LABELS = {
  handover_received: { phase: 1, label: '门店交接待核对', phaseLabel: '交接/勘察' },
  survey_pending: { phase: 1, label: '待现场勘察', phaseLabel: '交接/勘察' },
  survey_done: { phase: 1, label: '勘察完成待复尺', phaseLabel: '交接/勘察' },
  recheck_done: { phase: 2, label: '复尺完成待交底', phaseLabel: '复尺/交底/出库' },
  briefing_done: { phase: 2, label: '交底完成待出库', phaseLabel: '复尺/交底/出库' },
  material_requested: { phase: 2, label: '已申请出库', phaseLabel: '复尺/交底/出库' },
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

// ====== 工具定义 ======
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_accounts',
      description: '获取所有账户列表，包括名称、类型、初始余额和当前余额',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_transactions',
      description: '获取交易记录列表，可按时间范围、类型筛选',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'number', description: '近N天的交易，默认30' },
          type: { type: 'string', enum: ['income', 'expense'], description: '交易类型' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_today_summary',
      description: '获取今日交易汇总：收入总额、支出总额、交易笔数',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_products',
      description: '获取所有产品库存信息，包括名称、分类、库存数量',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_employees',
      description: '获取员工列表，包括姓名、部门、职位、状态',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_projects',
      description: '获取项目工单列表，可按阶段筛选',
      parameters: {
        type: 'object',
        properties: {
          phase: { type: 'number', description: '阶段编号 1=交接勘察 2=复尺出库 3=施工验收 4=回库核算 5=财务归档 6=售后处理' },
          status: { type: 'string', description: '工单状态，如 handover_received、briefing_done、material_out、in_progress、archived' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_system_stats',
      description: '获取系统概况统计：账户总数、今日交易额、产品种类数、员工人数',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_transaction',
      description: '新增一笔交易记录（收入或支出）',
      parameters: {
        type: 'object',
        properties: {
          account_id: { type: 'number', description: '账户ID，先调用 get_accounts 获取' },
          type: { type: 'string', enum: ['income', 'expense'], description: '收入/支出' },
          amount: { type: 'number', description: '金额，正数' },
          category: { type: 'string', description: '分类，如材料费、工资、收入等' },
          description: { type: 'string', description: '备注说明' },
          party: { type: 'string', description: '交易对方' }
        },
        required: ['account_id', 'type', 'amount', 'category']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_account',
      description: '新增一个账户（公司或个人）',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '账户名称' },
          type: { type: 'string', enum: ['company', 'personal'], description: '账户类型' }
        },
        required: ['name', 'type']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'parse_project_handover',
      description: '把门店/渠道交接文字拆分成一个或多个项目工单草稿，只解析不入库',
      parameters: {
        type: 'object',
        properties: {
          raw_text: { type: 'string', description: '微信、电话记录或交接单文字' }
        },
        required: ['raw_text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_project_workorder',
      description: '在用户明确确认后创建项目工单；不允许替用户跳过确认',
      parameters: {
        type: 'object',
        properties: {
          confirmed: { type: 'boolean', description: '用户是否已明确确认创建' },
          name: { type: 'string', description: '工单名称' },
          customer: { type: 'string', description: '业主/客户' },
          phone: { type: 'string', description: '业主联系方式，可为手机号、微信联系、现场联系等' },
          source: { type: 'string', description: '来源门店/渠道' },
          order_taker: { type: 'string', description: '门店接单人' },
          order_date: { type: 'string', description: '接单日期 YYYY-MM-DD' },
          external_order_no: { type: 'string', description: '门店单号/合同号' },
          address_province: { type: 'string', description: '省份' },
          address_city: { type: 'string', description: '城市' },
          address_detail: { type: 'string', description: '详细地址' },
          handover_note: { type: 'string', description: '交接备注' },
          total_amount: { type: 'number', description: '合同金额' }
        },
        required: ['confirmed', 'name', 'customer']
      }
    }
  }
]

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
      const data = db.prepare('SELECT id, name, category, unit, stock, min_stock FROM products ORDER BY id').all()
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
               p.manager_user_id, p.assignee_user_id, p.created_at, p.updated_at,
               mu.username as manager_username, mu.real_name as manager_real_name,
               au.username as assignee_username, au.real_name as assignee_real_name
        FROM projects p
        LEFT JOIN users mu ON p.manager_user_id = mu.id
        LEFT JOIN users au ON p.assignee_user_id = au.id
        WHERE 1=1
      `
      const params = []
      if (!canSeeAllProjects(user.role)) {
        sql += ' AND (p.created_by = ? OR p.manager_user_id = ? OR p.assignee_user_id = ?)'
        params.push(user.userId, user.userId, user.userId)
      }
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
      const data = db.prepare(sql).all(...params).map(p => ({
        ...p,
        raw_status: p.status,
        status: canonicalProjectStatus(p.status),
        status_label: projectStatusMeta(p.status).label,
        phase: projectStatusMeta(p.status).phase,
        phase_label: projectStatusMeta(p.status).phaseLabel
      }))
      return JSON.stringify({ success: true, count: data.length, data })
    }

    case 'get_system_stats': {
      const accounts = db.prepare('SELECT COUNT(*) as c FROM accounts').get().c
      const todayTx = db.prepare("SELECT COALESCE(SUM(amount),0) as total FROM transactions WHERE date(created_at) = date('now')").get().total
      const products = db.prepare('SELECT COUNT(*) as c FROM products').get().c
      const employees = db.prepare('SELECT COUNT(*) as c FROM employees WHERE status = ?').get('active')?.c || 0
      return JSON.stringify({ success: true, data: { accounts, today_transactions: todayTx, products, employees } })
    }

    default:
      return JSON.stringify({ success: false, message: `未知工具: ${name}` })

    case 'create_transaction': {
      if (!canAccessModule(db, user, 'transactions', 'can_create')) {
        return JSON.stringify({ success: false, message: '没有创建交易的权限' })
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
function getAllowedTools(userId, roleName, db) {
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
  return result
}

function canSeeAllProjects(role) {
  return ['super_admin', 'admin', 'finance', 'warehouse'].includes(role)
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
      result_summary, status, error_message, model, input_tokens, output_tokens, duration_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    data.durationMs || 0
  )
}

function summarize(value, limit = 500) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > limit ? `${text.slice(0, limit)}...` : text
}

function getSystemPrompt(username) {
  return `你是简尚系统的智能助手，名字叫"简尚小助手"。

## 简尚真实业务
简尚不是销售 CRM，门店/渠道负责签单和交接，简尚负责施工承接。项目工单流程是：
1. 门店交接待核对：补齐来源门店/渠道、门店接单人、业主联系方式、详细地址。
2. 待现场勘察：工程部填写勘察日期和现场记录，或关联标准勘察表。
3. 勘察完成待复尺：记录复尺面积、基层、水电、保护和进场条件。
4. 复尺完成待交底：安排班组长、施工负责人、施工成员和交底日期。
5. 交底完成待出库：只能通过材料出库申请进入仓库确认，不能直接跳过。
6. 已出库待进场 / 施工中 / 验收完成待回库：记录开工日期、施工过程、完工验收和回库状态。
7. 回库完成待工费结算 -> 工费结算完成待成本核算 -> 成本核算完成待财务结算 -> 财务结算完成待归档 -> 已归档。
8. 售后是独立事件：repair_requested / repair_assigned / repair_done，不倒退主工程流程。

你描述项目状态时必须使用以上口径，不要再说“项目前期、准备阶段、施工执行”这种旧阶段名称。

## 你的能力
1. 回答关于公司财务、制度、流程、产品、合同等方面的问题
2. 帮助用户理解简尚系统的功能
3. **直接查询系统数据并回答** - 你可以调用工具获取账户、交易、产品、员工、项目等实时数据
4. 帮用户把门店/微信交接内容拆成项目工单草稿

## 知识库
你有一个公司文档知识库可供查询。系统会自动搜索相关文档提供给你参考。

## 工具使用规则
- 当用户问及具体数据时（如"查账户余额"、"今天收入多少"、"库存还有多少"等），直接调用对应工具查询
- 当用户要求新增数据时（如"记一笔账"、"新增一个账户"等），直接调用对应工具创建
- 创建操作前**必须向用户确认关键信息**（金额、账户、类型、工单客户、电话、地址等），得到确认后再执行
- 当用户粘贴门店/微信交接内容时，优先调用 parse_project_handover 拆成草稿；只给用户确认清单，不要直接创建
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

export default function aiRoutes(server, db) {
  // AI 聊天（流式）
  server.post('/api/chat', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    const user = request.user

    const { message, session_id } = request.body
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

    const sid = session_id || crypto.randomUUID()
    const startedAt = Date.now()
    let totalInputTokens = 0
    let totalOutputTokens = 0

    // 保存用户消息
    db.prepare("INSERT INTO chat_history (user_id, role, content, session_id, created_at) VALUES (?, ?, ?, ?, datetime('now', 'localtime'))").run(user.userId, 'user', message, sid)

    // 获取历史上下文
    const history = db.prepare(
      'SELECT role, content FROM chat_history WHERE user_id = ? AND session_id = ? ORDER BY id ASC LIMIT 20'
    ).all(user.userId, sid)

    // 构建消息列表
    const messages = [
      { role: 'system', content: getSystemPrompt(user.username) },
      ...history.map(h => ({ role: h.role, content: h.content }))
    ]

    // 搜索知识库
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

    // ====== 按角色过滤可用工具 ======
    const allowedToolNames = getAllowedTools(user.userId, user.role, db)
    const allowedTools = TOOLS.filter(t => allowedToolNames.includes(t.function.name))

    // ====== 工具循环：最多 10 轮 ======
    let finalContent = ''
    let currentMessages = messages
    let maxRounds = 10

    for (let round = 0; round < maxRounds; round++) {
      const result = await callDeepSeek(currentMessages, config, round === 0 ? allowedTools : undefined)
      totalInputTokens += result.usage?.prompt_tokens || 0
      totalOutputTokens += result.usage?.completion_tokens || 0
      const choice = result.choices?.[0]
      const finishReason = choice?.finish_reason

      // 如果是普通文本回复
      if (finishReason === 'stop' || !choice?.message?.tool_calls) {
        finalContent = choice?.message?.content || ''
        break
      }

      // 处理工具调用
      const toolCalls = choice.message.tool_calls
      currentMessages.push({ role: 'assistant', content: choice.message.content || null, tool_calls: toolCalls })

      for (const tc of toolCalls) {
        let args = {}
        try { args = JSON.parse(tc.function.arguments) } catch {}
        const resultData = executeTool(tc.function.name, args, db, user)
        logAiAudit(db, user, {
          actionType: ['create_transaction', 'create_account', 'parse_project_handover', 'create_project_workorder'].includes(tc.function.name) ? 'tool_write' : 'tool_read',
          toolName: tc.function.name,
          requestSummary: args,
          resultSummary: resultData,
          model: config.model
        })
        currentMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: resultData
        })
      }
    }

    // 没有生成内容 → 兜底
    if (!finalContent) {
      finalContent = '抱歉，我暂时无法回答这个问题。'
    }

    // 保存 AI 回复到历史（含工具调用上下文）
    // 把所有工具调用记录打包成一条系统消息存进去，保证多轮对话有记忆
    const toolLogs = currentMessages.filter(m => m.role === 'tool')
    if (toolLogs.length > 0) {
      const summary = toolLogs.map(m => {
        const data = JSON.parse(m.content || '{}')
        return `→ ${data.message || data.data || m.content}`
      }).join('\n')
      db.prepare("INSERT INTO chat_history (user_id, role, content, session_id, created_at) VALUES (?, ?, ?, ?, datetime('now', 'localtime'))").run(user.userId, 'system', `【上一次操作结果】\n${summary}`, sid)
    }
    db.prepare("INSERT INTO chat_history (user_id, role, content, session_id, created_at) VALUES (?, ?, ?, ?, datetime('now', 'localtime'))").run(user.userId, 'assistant', finalContent, sid)
    logAiAudit(db, user, {
      actionType: 'chat',
      requestSummary: message,
      resultSummary: finalContent,
      model: config.model,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      durationMs: Date.now() - startedAt
    })

    // 流式返回给前端
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    })

    reply.raw.write(`data: ${JSON.stringify({ type: 'session', session_id: sid })}\n\n`)
    reply.raw.write(`data: ${JSON.stringify({ type: 'text', content: finalContent })}\n\n`)
    reply.raw.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
    reply.raw.end()
  })

  // 获取聊天历史
  server.get('/api/chat/history', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return

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
