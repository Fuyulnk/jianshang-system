import * as XLSX from 'xlsx'
import { authMiddleware } from '../middleware/auth.js'
import { canAccessModule } from '../utils/permissions.js'
import {
  diffDraft,
  missingCoreFields,
  normalizeProjectDraft,
  parseProjectHandoverRows,
  parseProjectHandoverText,
  summarizeRawContent
} from '../utils/projectImport.js'

const AI_ENDPOINT = 'https://api.deepseek.com/chat/completions'

export default function projectImportRoutes(server, db) {
  server.post('/api/project-imports/parse', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!canAccessModule(db, request.user, 'projects', 'can_create')) {
      logAiAudit(db, request.user, {
        actionType: 'tool_write',
        toolName: 'parse_project_handover',
        status: 'denied',
        errorMessage: '无权限导入项目工单'
      })
      reply.code(403).send({ success: false, message: '无权限导入项目工单' })
      return
    }

    const { text = '', file_name = '', file_data = '', mime_type = '' } = request.body || {}
    const sourceType = file_data ? 'file' : 'text'
    const rawContent = sourceType === 'file'
      ? extractFileContent(file_name, file_data)
      : String(text || '')
    if (!rawContent.trim()) return { success: false, message: '请粘贴交接内容或上传表格' }

    const aiDrafts = await parseWithAi(rawContent, db)
    const fallbackDrafts = sourceType === 'file' && looksLikeSpreadsheet(file_name, mime_type)
      ? parseProjectHandoverRows(extractRows(file_name, file_data))
      : parseProjectHandoverText(rawContent)
    const drafts = (aiDrafts.length ? aiDrafts : fallbackDrafts).map(normalizeProjectDraft)
    if (!drafts.length) return { success: false, message: '没有识别到有效工单，请补充客户、电话、地址或门店信息' }

    const batch = db.prepare(`
      INSERT INTO project_import_batches (
        source_type, file_name, raw_summary, raw_content, item_count, status, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      sourceType,
      safeText(file_name, 160),
      summarizeRawContent(rawContent, 500),
      rawContent.slice(0, 20000),
      drafts.length,
      'parsed',
      request.user.userId
    )

    const insertItem = db.prepare(`
      INSERT INTO project_import_items (
        batch_id, item_index, ai_draft, confirmed_draft, field_diff,
        missing_fields, duplicate_matches, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const items = drafts.map((draft, index) => {
      const missing = missingCoreFields(draft)
      const duplicates = findDuplicates(db, draft)
      const result = insertItem.run(
        batch.lastInsertRowid,
        index + 1,
        JSON.stringify(draft),
        JSON.stringify(draft),
        JSON.stringify({}),
        JSON.stringify(missing),
        JSON.stringify(duplicates),
        'draft'
      )
      return formatItem({
        id: result.lastInsertRowid,
        batch_id: batch.lastInsertRowid,
        item_index: index + 1,
        ai_draft: JSON.stringify(draft),
        confirmed_draft: JSON.stringify(draft),
        field_diff: JSON.stringify({}),
        missing_fields: JSON.stringify(missing),
        duplicate_matches: JSON.stringify(duplicates),
        status: 'draft',
        project_id: 0,
        error_message: ''
      })
    })

    logAiAudit(db, request.user, {
      actionType: 'tool_write',
      toolName: 'parse_project_handover',
      requestSummary: summarizeRawContent(rawContent, 500),
      resultSummary: `识别 ${items.length} 条工单草稿`,
      model: getAiConfig(db).model
    })

    return { success: true, data: { id: batch.lastInsertRowid, items } }
  })

  server.get('/api/project-imports/:id', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    const batch = db.prepare('SELECT * FROM project_import_batches WHERE id = ?').get(toInt(request.params.id))
    if (!batch || !canAccessBatch(request.user, batch)) {
      reply.code(404).send({ success: false, message: '导入批次不存在或无权限' })
      return
    }
    const items = db.prepare('SELECT * FROM project_import_items WHERE batch_id = ? ORDER BY item_index ASC').all(batch.id)
    return { success: true, data: { ...batch, items: items.map(formatItem) } }
  })

  server.post('/api/project-imports/:id/confirm', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!canAccessModule(db, request.user, 'projects', 'can_create')) {
      logAiAudit(db, request.user, {
        actionType: 'tool_write',
        toolName: 'create_project_workorder',
        status: 'denied',
        errorMessage: '无权限创建项目工单'
      })
      reply.code(403).send({ success: false, message: '无权限创建项目工单' })
      return
    }

    const batch = db.prepare('SELECT * FROM project_import_batches WHERE id = ?').get(toInt(request.params.id))
    if (!batch || !canAccessBatch(request.user, batch)) {
      reply.code(404).send({ success: false, message: '导入批次不存在或无权限' })
      return
    }

    const incoming = Array.isArray(request.body?.items) ? request.body.items : []
    if (!incoming.length) return { success: false, message: '请选择要创建的草稿' }

    const results = []
    const createProject = db.prepare(`
      INSERT INTO projects (
        name, customer, phone, address, address_province, address_city, address_detail,
        source, order_taker, order_date, external_order_no, handover_note,
        total_amount, deposit_amount, manager_user_id, assignee_user_id, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?)
    `)
    const updateItem = db.prepare(`
      UPDATE project_import_items
      SET confirmed_draft = ?, field_diff = ?, missing_fields = ?, duplicate_matches = ?,
          status = ?, project_id = ?, error_message = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `)

    const tx = db.transaction(() => {
      for (const itemInput of incoming) {
        const item = db.prepare('SELECT * FROM project_import_items WHERE id = ? AND batch_id = ?').get(toInt(itemInput.id), batch.id)
        if (!item || item.status === 'created') {
          results.push({ id: itemInput.id, success: false, message: '草稿不存在或已创建' })
          continue
        }
        const aiDraft = parseJson(item.ai_draft, {})
        const finalDraft = normalizeProjectDraft(itemInput.draft || parseJson(item.confirmed_draft, aiDraft))
        const missing = missingCoreFields(finalDraft)
        const duplicates = findDuplicates(db, finalDraft)
        const diff = diffDraft(aiDraft, finalDraft)

        if (!finalDraft.name || !finalDraft.customer) {
          updateItem.run(
            JSON.stringify(finalDraft),
            JSON.stringify(diff),
            JSON.stringify(missing),
            JSON.stringify(duplicates),
            'error',
            0,
            '工单名称和业主/客户必填',
            item.id
          )
          results.push({ id: item.id, success: false, message: '工单名称和业主/客户必填' })
          continue
        }

        const note = buildHandoverNote(finalDraft)
        const address = buildAddress(finalDraft)
        const created = createProject.run(
          finalDraft.name,
          finalDraft.customer,
          finalDraft.phone,
          address,
          finalDraft.address_province,
          finalDraft.address_city,
          finalDraft.address_detail,
          finalDraft.source,
          finalDraft.order_taker,
          finalDraft.order_date,
          finalDraft.external_order_no,
          note,
          Number(finalDraft.total_amount || 0),
          request.user.userId
        )
        addProjectLog(db, created.lastInsertRowid, 'AI导入工单', request.user.username,
          `由导入批次 #${batch.id} 创建；修正字段 ${Object.keys(diff).length} 个`)
        updateItem.run(
          JSON.stringify(finalDraft),
          JSON.stringify(diff),
          JSON.stringify(missing),
          JSON.stringify(duplicates),
          'created',
          created.lastInsertRowid,
          '',
          item.id
        )
        results.push({ id: item.id, success: true, project_id: created.lastInsertRowid, missing_fields: missing, duplicate_matches: duplicates })
      }

      const remaining = db.prepare("SELECT COUNT(*) as c FROM project_import_items WHERE batch_id = ? AND status != 'created'").get(batch.id).c
      db.prepare("UPDATE project_import_batches SET status = ?, updated_at = datetime('now', 'localtime') WHERE id = ?")
        .run(remaining ? 'partial_created' : 'created', batch.id)
    })
    tx()

    logAiAudit(db, request.user, {
      actionType: 'tool_write',
      toolName: 'create_project_workorder',
      requestSummary: `批次 ${batch.id} 确认 ${incoming.length} 条`,
      resultSummary: `成功 ${results.filter(item => item.success).length} 条，失败 ${results.filter(item => !item.success).length} 条`,
      model: getAiConfig(db).model
    })

    return { success: true, data: { results } }
  })
}

async function parseWithAi(rawContent, db) {
  const config = getAiConfig(db)
  if (!config.apiKey) return []
  try {
    const res = await fetch(AI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.1,
        max_tokens: 2200,
        messages: [
          {
            role: 'system',
            content: '你是简尚涂装项目工单导入助手。请把门店/渠道交接内容拆分成 JSON 数组，只输出 JSON。字段：name, customer, phone, source, order_taker, order_date, external_order_no, address_province, address_city, address_detail, handover_note, total_amount, needs_construction, needs_stock, stock_note。没有就留空，不要编造。'
          },
          { role: 'user', content: rawContent.slice(0, 12000) }
        ]
      }),
      signal: AbortSignal.timeout(15000)
    })
    if (!res.ok) return []
    const json = await res.json()
    const content = json?.choices?.[0]?.message?.content || ''
    const parsed = parseJson(extractJson(content), [])
    return Array.isArray(parsed) ? parsed.map(normalizeProjectDraft) : []
  } catch {
    return []
  }
}

function extractFileContent(fileName, fileData) {
  if (!looksLikeSpreadsheet(fileName)) return ''
  const rows = extractRows(fileName, fileData)
  return rows.map(row => Object.entries(row).map(([key, value]) => `${key}: ${value}`).join('；')).join('\n')
}

function extractRows(fileName, fileData) {
  const buffer = decodeData(fileData)
  if (!buffer.length) return []
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return []
  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' }).slice(0, 100)
}

function decodeData(value = '') {
  const text = String(value || '')
  const base64 = text.includes(',') ? text.split(',').pop() : text
  return Buffer.from(base64, 'base64')
}

function looksLikeSpreadsheet(fileName = '', mimeType = '') {
  return /\.(csv|xls|xlsx)$/i.test(fileName) || /spreadsheet|excel|csv/.test(mimeType)
}

function findDuplicates(db, draft) {
  const clauses = []
  const params = []
  if (draft.phone) {
    clauses.push('phone = ?')
    params.push(draft.phone)
  }
  if (draft.external_order_no) {
    clauses.push('external_order_no = ?')
    params.push(draft.external_order_no)
  }
  if (draft.customer) {
    clauses.push('customer = ?')
    params.push(draft.customer)
  }
  if (!clauses.length) return []
  return db.prepare(`
    SELECT id, name, customer, phone, source, external_order_no, status, created_at
    FROM projects
    WHERE ${clauses.map(item => `(${item})`).join(' OR ')}
    ORDER BY id DESC
    LIMIT 5
  `).all(...params)
}

function formatItem(item) {
  return {
    ...item,
    ai_draft: parseJson(item.ai_draft, {}),
    confirmed_draft: parseJson(item.confirmed_draft, {}),
    field_diff: parseJson(item.field_diff, {}),
    missing_fields: parseJson(item.missing_fields, []),
    duplicate_matches: parseJson(item.duplicate_matches, [])
  }
}

function buildAddress(draft) {
  return [draft.address_province, draft.address_city, draft.address_detail].filter(Boolean).join(' ')
}

function buildHandoverNote(draft) {
  const lines = []
  if (draft.handover_note) lines.push(draft.handover_note)
  lines.push(`AI导入标记：${draft.needs_construction ? '需要施工' : '不需要施工'}；${draft.needs_stock ? '需要备货' : '不需要备货'}`)
  if (draft.stock_note) lines.push(`备货备注：${draft.stock_note}`)
  return lines.join('\n')
}

function addProjectLog(db, projectId, action, operator, content) {
  db.prepare('INSERT INTO project_logs (project_id, action, operator, content) VALUES (?, ?, ?, ?)')
    .run(projectId, action, operator || '', content || '')
}

function canAccessBatch(user, batch) {
  return ['super_admin', 'admin'].includes(user.role) || batch.created_by === user.userId
}

function getAiConfig(db) {
  const settings = Object.fromEntries(db.prepare('SELECT key, value FROM system_settings').all().map(row => [row.key, row.value]))
  return {
    apiKey: process.env.AI_API_KEY || '',
    model: settings.ai_model || process.env.AI_MODEL || 'deepseek-chat'
  }
}

function logAiAudit(db, user, data) {
  db.prepare(`
    INSERT INTO ai_audit_logs (
      user_id, employee_id, role, action_type, tool_name, request_summary,
      result_summary, status, error_message, model
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    user?.userId || 0,
    user?.employeeId || 0,
    user?.role || '',
    data.actionType || 'tool_write',
    data.toolName || '',
    safeText(data.requestSummary || '', 500),
    safeText(data.resultSummary || '', 500),
    data.status || 'ok',
    safeText(data.errorMessage || '', 500),
    data.model || ''
  )
}

function parseJson(value, fallback) {
  try { return JSON.parse(value || '') } catch { return fallback }
}

function extractJson(content) {
  const text = String(content || '').trim()
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced?.[1]) return fenced[1].trim()
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  return start >= 0 && end > start ? text.slice(start, end + 1) : text
}

function toInt(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0
}

function safeText(value, limit) {
  const text = String(value || '')
  return text.length > limit ? `${text.slice(0, limit)}...` : text
}
