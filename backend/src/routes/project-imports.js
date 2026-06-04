import * as XLSX from 'xlsx'
import { fileURLToPath } from 'url'
import { dirname, extname, join } from 'path'
import { mkdirSync, writeFileSync } from 'fs'
import crypto from 'crypto'
import { authMiddleware } from '../middleware/auth.js'
import { canAccessModule, canAccessProjectRecord, getDataScope } from '../utils/permissions.js'
import { buildProjectDraft, missingBriefingFields, parseBriefingDocument, parseMaterialOutDocument } from '../utils/projectDocumentImport.js'
import {
  diffDraft,
  missingCoreFields,
  normalizeProjectDraft,
  parseProjectHandoverRows,
  parseProjectHandoverText,
  summarizeRawContent
} from '../utils/projectImport.js'

const AI_ENDPOINT = 'https://api.deepseek.com/chat/completions'
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const UPLOAD_DIR = join(__dirname, '../../data/uploads')
const MAX_FILE_SIZE = 10 * 1024 * 1024
const MAX_MONEY_VALUE = 100000000
const ALLOWED_BRIEFING_ATTACHMENT_EXTS = new Set(['.csv', '.xls', '.xlsx', '.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx'])

export default function projectImportRoutes(server, db) {
  server.post('/api/briefing-imports/parse', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!canAccessModule(db, request.user, 'projects', 'can_create')) {
      logAiAudit(db, request.user, {
        actionType: 'tool_write',
        toolName: 'parse_project_handover',
        status: 'denied',
        errorMessage: '无权限导入施工交底单'
      })
      reply.code(403).send({ success: false, message: '无权限导入施工交底单' })
      return
    }

    const { text = '', file_name = '', file_data = '' } = request.body || {}
    if (!String(text || '').trim() && !file_data) return { success: false, message: '请上传施工交底单或粘贴交底内容' }
    try {
      const parsed = file_data
        ? parseBriefingDocument(file_name, file_data)
        : parseBriefingText(text)
      const duplicates = findDuplicates(db, parsed.project_draft || {}, request.user)
      logAiAudit(db, request.user, {
        actionType: 'tool_write',
        toolName: 'parse_project_handover',
        requestSummary: file_name || summarizeRawContent(text, 500),
        resultSummary: `施工交底单识别：${parsed.form_data?.items?.length || 0} 条施工明细`,
        model: getAiConfig(db).model
      })
      return { success: true, data: { ...parsed, duplicate_matches: duplicates } }
    } catch (err) {
      logAiAudit(db, request.user, {
        actionType: 'tool_write',
        toolName: 'parse_project_handover',
        status: 'failed',
        errorMessage: err.message || '施工交底单解析失败'
      })
      reply.code(400).send({ success: false, message: err.message || '施工交底单解析失败' })
    }
  })

  server.post('/api/briefing-imports/confirm-create', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!canAccessModule(db, request.user, 'projects', 'can_create')) {
      logAiAudit(db, request.user, {
        actionType: 'tool_write',
        toolName: 'create_project_workorder',
        status: 'denied',
        errorMessage: '无权限从施工交底单创建项目'
      })
      reply.code(403).send({ success: false, message: '无权限从施工交底单创建项目' })
      return
    }

    const parsedData = request.body?.parsed_data || {}
    const confirmedData = normalizeBriefingForm(request.body?.confirmed_data || parsedData.form_data || {})
    const draft = buildProjectDraft(confirmedData)
    const warnings = Array.isArray(request.body?.warnings) ? request.body.warnings : parsedData.warnings || []
    const missing = missingBriefingFields(draft, confirmedData)
    const duplicates = findDuplicates(db, draft, request.user)
    if (!draft.name || !draft.customer) return { success: false, message: '项目名称和客户姓名必填' }

    let projectId = 0
    let documentId = 0
    let attachmentId = 0
    const createProject = db.prepare(`
      INSERT INTO projects (
        name, customer, phone, address, address_province, address_city, address_detail,
        source, order_taker, order_date, external_order_no, handover_note,
        team_leader, briefing_date, total_amount, deposit_amount, manager_user_id,
        assignee_user_id, status, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 'handover_received', ?)
    `)
    const tx = db.transaction(() => {
      const created = createProject.run(
        draft.name,
        draft.customer,
        draft.phone,
        buildAddress(draft),
        draft.address_province,
        draft.address_city,
        draft.address_detail,
        draft.source,
        draft.order_taker,
        draft.order_date,
        draft.external_order_no,
        draft.handover_note,
        draft.team_leader,
        draft.briefing_date,
        Number(draft.total_amount || 0),
        request.user.userId
      )
      projectId = created.lastInsertRowid
      attachmentId = saveProjectAttachment(db, request.user, projectId, request.body?.file || null)
      documentId = upsertProjectDocument(db, {
        projectId,
        documentType: 'briefing',
        sourceAttachmentId: attachmentId,
        parsedData,
        confirmedData,
        warnings: [...warnings, ...missing.map(item => `缺核心资料：${item}`), ...duplicates.map(item => `可能重复：${item.name || item.customer}#${item.id}`)],
        userId: request.user.userId
      })
      addProjectLog(db, projectId, '导入施工交底单创建工单', request.user.username,
        `由施工交底单创建；单据 #${documentId}；缺失提示 ${missing.length} 项；重复提示 ${duplicates.length} 项；不自动推进状态。`)
    })
    tx()

    logAiAudit(db, request.user, {
      actionType: 'tool_write',
      toolName: 'create_project_workorder',
      requestSummary: `施工交底单创建项目：${draft.name}`,
      resultSummary: `项目 #${projectId}，单据 #${documentId}`,
      model: getAiConfig(db).model
    })
    return { success: true, data: { project_id: projectId, document_id: documentId, source_attachment_id: attachmentId, missing_fields: missing, duplicate_matches: duplicates } }
  })

  server.get('/api/projects/:id/briefing', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(toInt(request.params.id))
    if (!project || !canAccessModule(db, request.user, 'projects', 'can_view') || !canAccessProjectRecord(db, request.user, project)) {
      reply.code(404).send({ success: false, message: '项目不存在或无权限' })
      return
    }
    const doc = db.prepare(`
      SELECT d.*, a.original_name as source_file_name
      FROM project_documents d
      LEFT JOIN attachments a ON a.id = d.source_attachment_id
      WHERE d.project_id = ? AND d.document_type = 'briefing'
      ORDER BY d.id DESC
      LIMIT 1
    `).get(project.id)
    return { success: true, data: doc ? formatProjectDocument(doc) : null }
  })

  server.post('/api/projects/:id/briefing/confirm', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(toInt(request.params.id))
    if (!project) return reply.code(404).send({ success: false, message: '项目不存在' })
    if (!canApplyProjectDocumentImport(request.user) || !canAccessModule(db, request.user, 'projects', 'can_edit') || !canAccessProjectRecord(db, request.user, project)) {
      reply.code(403).send({ success: false, message: '无权限保存施工交底单' })
      return
    }

    const parsedData = request.body?.parsed_data || {}
    const confirmedData = normalizeBriefingForm(request.body?.confirmed_data || parsedData.form_data || {})
    const draft = buildProjectDraft(confirmedData)
    const warnings = Array.isArray(request.body?.warnings) ? request.body.warnings : parsedData.warnings || []
    const missing = missingBriefingFields(draft, confirmedData)
    const changed = changedProjectFields(project, draft)
    let attachmentId = toInt(request.body?.source_attachment_id)
    let documentId = 0

    const tx = db.transaction(() => {
      if (!attachmentId) attachmentId = saveProjectAttachment(db, request.user, project.id, request.body?.file || null)
      documentId = upsertProjectDocument(db, {
        projectId: project.id,
        documentType: 'briefing',
        sourceAttachmentId: attachmentId,
        parsedData,
        confirmedData,
        warnings: [...warnings, ...missing.map(item => `缺核心资料：${item}`)],
        userId: request.user.userId
      })
      syncProjectFromBriefing(db, project, draft)
      addProjectLog(db, project.id, '保存施工交底单', request.user.username,
        `系统版交底单 #${documentId} 已保存；同步字段 ${changed.join('、') || '无'}；不自动推进状态。`)
    })
    tx()

    return { success: true, data: { document_id: documentId, source_attachment_id: attachmentId, changed_fields: changed, missing_fields: missing } }
  })

  server.post('/api/projects/:id/document-imports/material-out/parse', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(toInt(request.params.id))
    if (!project || !canAccessModule(db, request.user, 'projects', 'can_view') || !canAccessProjectRecord(db, request.user, project)) {
      reply.code(404).send({ success: false, message: '项目不存在或无权限' })
      return
    }

    const { file_name = '', file_data = '' } = request.body || {}
    if (!file_name || !file_data) return { success: false, message: '请选择材料出库表' }

    try {
      const parsed = parseMaterialOutDocument(file_name, file_data)
      return { success: true, data: parsed }
    } catch (err) {
      reply.code(400).send({ success: false, message: err.message || '材料出库表解析失败' })
    }
  })

  server.post('/api/projects/:id/document-imports/briefing/parse', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(toInt(request.params.id))
    if (!project || !canAccessModule(db, request.user, 'projects', 'can_view') || !canAccessProjectRecord(db, request.user, project)) {
      reply.code(404).send({ success: false, message: '项目不存在或无权限' })
      return
    }

    const { file_name = '', file_data = '' } = request.body || {}
    if (!file_name || !file_data) return { success: false, message: '请选择施工交底单表格' }

    try {
      const parsed = parseBriefingDocument(file_name, file_data)
      const current = {}
      for (const field of parsed.fields || []) current[field.key] = project[field.key] ?? ''
      return { success: true, data: { ...parsed, current } }
    } catch (err) {
      reply.code(400).send({ success: false, message: err.message || '施工交底单解析失败' })
    }
  })

  server.post('/api/projects/:id/document-imports/briefing/apply', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(toInt(request.params.id))
    if (!project) return reply.code(404).send({ success: false, message: '项目不存在' })
    if (!canApplyProjectDocumentImport(request.user) || !canAccessModule(db, request.user, 'projects', 'can_edit') || !canAccessProjectRecord(db, request.user, project)) {
      reply.code(403).send({ success: false, message: '无权限写入施工交底单字段' })
      return
    }

    const allowedFields = ['source', 'order_taker', 'order_date', 'customer', 'phone', 'address_detail', 'team_leader', 'briefing_date']
    const incoming = request.body?.fields || {}
    const confirmedInferredFields = Array.isArray(request.body?.confirmed_inferred_fields) ? request.body.confirmed_inferred_fields : []
    const updates = []
    const vals = []
    const changed = []

    for (const field of allowedFields) {
      if (incoming[field] === undefined) continue
      if (field === 'briefing_date' && !confirmedInferredFields.includes(field)) {
        reply.code(400).send({ success: false, message: '交底日期来自接单时间推断，必须单独确认后才能写入' })
        return
      }
      const value = safeText(incoming[field], field === 'address_detail' ? 300 : 120)
      updates.push(`${field} = ?`)
      vals.push(value)
      if (String(project[field] ?? '') !== value) changed.push(field)
    }

    if (incoming.address_detail !== undefined && incoming.address === undefined) {
      const detail = safeText(incoming.address_detail, 300)
      const fullAddress = [project.address_province, project.address_city, detail].filter(Boolean).join(' ')
      if (!updates.some(item => item.startsWith('address ='))) {
        updates.push('address = ?')
        vals.push(fullAddress)
        if (String(project.address || '') !== fullAddress) changed.push('address')
      }
    }

    if (!updates.length) return { success: false, message: '没有选择要写入的字段' }
    updates.push("updated_at = datetime('now', 'localtime')")
    vals.push(project.id)

    db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`).run(...vals)
    addProjectLog(db, project.id, '导入施工交底单字段', request.user.username,
      buildDocumentImportLog(request.body, changed, incoming))

    return { success: true, data: { changed_fields: changed } }
  })

  server.post('/api/project-imports/parse', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!canAccessModule(db, request.user, 'projects', 'can_create')) {
      logAiAudit(db, request.user, {
        actionType: 'tool_write',
        toolName: 'parse_project_handover',
        status: 'denied',
        errorMessage: '无权限导入施工交底单'
      })
      reply.code(403).send({ success: false, message: '无权限导入施工交底单' })
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
      const duplicates = findDuplicates(db, draft, request.user)
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
        total_amount, deposit_amount, manager_user_id, assignee_user_id, status, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 'handover_received', ?)
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
        const duplicates = findDuplicates(db, finalDraft, request.user)
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
        addProjectLog(db, created.lastInsertRowid, '导入施工交底单创建工单', request.user.username,
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

function canApplyProjectDocumentImport(user) {
  return ['super_admin', 'admin', 'engineering'].includes(user?.role)
}

function parseBriefingText(text = '') {
  const draft = normalizeProjectDraft(parseProjectHandoverText(text)[0] || {})
  const formData = normalizeBriefingForm({
    basic: {
      source: draft.source,
      order_taker: draft.order_taker,
      order_date: draft.order_date,
      customer: draft.customer,
      phone: draft.phone,
      address_province: draft.address_province,
      address_city: draft.address_city,
      address_detail: draft.address_detail,
      external_order_no: draft.external_order_no,
      handover_note: draft.handover_note
    },
    construction: {
      briefing_date: draft.order_date,
      total_amount: draft.total_amount
    },
    site: {},
    items: [],
    signatures: {}
  })
  const projectDraft = buildProjectDraft(formData)
  return {
    document_type: 'briefing',
    document_label: '施工交底单',
    file_name: '',
    sheet_name: '',
    project_draft: projectDraft,
    form_data: formData,
    fields: [],
    items: [],
    summary: {
      total_area: 0,
      remeasure: '',
      entry_method: '',
      plate_needed: '',
      item_summary: ''
    },
    missing_fields: missingBriefingFields(projectDraft, formData),
    warnings: ['文字交底只做基础信息识别，施工项目明细建议上传正式施工交底单。']
  }
}

function normalizeBriefingForm(input = {}) {
  const basic = input.basic || {}
  const construction = input.construction || {}
  const site = input.site || {}
  const signatures = input.signatures || {}
  const items = Array.isArray(input.items) ? input.items : []
  return {
    basic: {
      source: safeText(basic.source, 120),
      order_taker: safeText(basic.order_taker, 80),
      order_date: safeText(basic.order_date, 40),
      customer: safeText(basic.customer, 80),
      phone: safeText(basic.phone, 40),
      address_province: safeText(basic.address_province, 40),
      address_city: safeText(basic.address_city, 40),
      address_detail: safeText(basic.address_detail, 240),
      external_order_no: safeText(basic.external_order_no, 80),
      handover_note: safeText(basic.handover_note, 1000)
    },
    construction: {
      expected_start_date: safeText(construction.expected_start_date, 40),
      expected_duration: safeText(construction.expected_duration, 80),
      entry_method: safeText(construction.entry_method, 80),
      total_area: toNumber(construction.total_area),
      remeasure: safeText(construction.remeasure, 40),
      plate_needed: safeText(construction.plate_needed, 40),
      team_leader: safeText(construction.team_leader, 80),
      briefing_date: safeText(construction.briefing_date, 40),
        total_amount: toMoney(construction.total_amount)
    },
    site: {
      base_condition: safeText(site.base_condition, 300),
      high_work: safeText(site.high_work, 80),
      scaffold: safeText(site.scaffold, 80),
      second_transfer: safeText(site.second_transfer, 80),
      entry_condition: safeText(site.entry_condition, 200),
      site_status: safeText(site.site_status, 300)
    },
    items: items.slice(0, 120).map(item => ({
      space_name: safeText(item.space_name, 80),
      texture_name: safeText(item.texture_name, 120),
      process: safeText(item.process, 120),
      color_no: safeText(item.color_no, 80),
      planned_area: toNumber(item.planned_area),
      actual_area: toNumber(item.actual_area),
      unit_price: toMoney(item.unit_price),
      subtotal: toMoney(item.subtotal),
      remark: safeText(item.remark, 300)
    })),
    signatures: {
      briefer: safeText(signatures.briefer, 80),
      confirmer: safeText(signatures.confirmer, 80),
      confirmed_at: safeText(signatures.confirmed_at, 40),
      source_file: safeText(signatures.source_file, 160)
    }
  }
}

function upsertProjectDocument(db, { projectId, documentType, sourceAttachmentId, parsedData, confirmedData, warnings, userId }) {
  const existing = db.prepare(`
    SELECT id FROM project_documents
    WHERE project_id = ? AND document_type = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(projectId, documentType)
  const parsed = JSON.stringify(parsedData || {})
  const confirmed = JSON.stringify(confirmedData || {})
  const warningText = JSON.stringify(Array.isArray(warnings) ? warnings : [])
  if (existing) {
    db.prepare(`
      UPDATE project_documents
      SET source_attachment_id = COALESCE(NULLIF(?, 0), source_attachment_id),
          status = 'confirmed', parsed_data = ?, confirmed_data = ?, warnings = ?,
          updated_by = ?, updated_at = datetime('now', 'localtime')
      WHERE id = ?
    `).run(sourceAttachmentId || 0, parsed, confirmed, warningText, userId || 0, existing.id)
    return existing.id
  }
  const result = db.prepare(`
    INSERT INTO project_documents (
      project_id, document_type, source_attachment_id, status,
      parsed_data, confirmed_data, warnings, created_by, updated_by
    ) VALUES (?, ?, ?, 'confirmed', ?, ?, ?, ?, ?)
  `).run(projectId, documentType, sourceAttachmentId || 0, parsed, confirmed, warningText, userId || 0, userId || 0)
  return result.lastInsertRowid
}

function formatProjectDocument(row) {
  return {
    ...row,
    parsed_data: parseJson(row.parsed_data, {}),
    confirmed_data: parseJson(row.confirmed_data, {}),
    warnings: parseJson(row.warnings, [])
  }
}

function saveProjectAttachment(db, user, projectId, file) {
  if (!file?.data || !file?.name) return 0
  const originalName = safeFileName(file.name)
  const ext = extname(originalName).toLowerCase()
  if (!ALLOWED_BRIEFING_ATTACHMENT_EXTS.has(ext)) {
    throw new Error('该文件类型不允许作为交底单附件上传')
  }
  const buffer = decodeData(file.data)
  if (!buffer.length) throw new Error('交底单文件内容为空')
  if (buffer.length > MAX_FILE_SIZE || Number(file.size || 0) > MAX_FILE_SIZE) throw new Error('单个文件不能超过 10MB')

  mkdirSync(UPLOAD_DIR, { recursive: true })
  const checksum = crypto.createHash('sha256').update(buffer).digest('hex')
  const storedName = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext || ''}`
  writeFileSync(join(UPLOAD_DIR, storedName), buffer)
  const result = db.prepare(`
    INSERT INTO attachments (
      entity_type, entity_id, original_name, stored_name, mime_type, size, checksum, uploaded_by
    ) VALUES ('project', ?, ?, ?, ?, ?, ?, ?)
  `).run(projectId, originalName, storedName, file.mime_type || 'application/octet-stream', buffer.length, checksum, user?.userId || 0)
  return result.lastInsertRowid
}

function syncProjectFromBriefing(db, project, draft) {
  const allowed = ['customer', 'phone', 'address', 'address_province', 'address_city', 'address_detail',
    'source', 'order_taker', 'order_date', 'external_order_no', 'handover_note',
    'team_leader', 'briefing_date', 'total_amount']
  const updates = []
  const values = []
  for (const field of allowed) {
    if (draft[field] === undefined || draft[field] === null) continue
    const value = field === 'address' ? buildAddress(draft) : draft[field]
    if (String(project[field] ?? '') === String(value ?? '')) continue
    updates.push(`${field} = ?`)
    values.push(value)
  }
  if (!updates.length) return
  updates.push("updated_at = datetime('now', 'localtime')")
  values.push(project.id)
  db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`).run(...values)
}

function changedProjectFields(project, draft) {
  const labels = {
    customer: '客户',
    phone: '电话',
    address_detail: '详细地址',
    source: '来源',
    order_taker: '接单人',
    order_date: '接单日期',
    external_order_no: '门店单号',
    handover_note: '交接备注',
    team_leader: '班组长',
    briefing_date: '交底日期',
    total_amount: '金额'
  }
  return Object.entries(labels)
    .filter(([field]) => draft[field] !== undefined && String(project[field] ?? '') !== String(draft[field] ?? ''))
    .map(([, label]) => label)
}

function buildDocumentImportLog(body = {}, changed = [], incoming = {}) {
  const parts = [`人工确认写入 ${changed.length || Object.keys(incoming).length} 个字段：${changed.join('、') || Object.keys(incoming).join('、')}`]
  if (body.file_name) parts.push(`文件：${safeText(body.file_name, 120)}`)
  if (Array.isArray(body.warnings) && body.warnings.length) parts.push(`风险提示：${body.warnings.map(item => safeText(item, 80)).join('；')}`)
  return parts.join('\n')
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

function findDuplicates(db, draft, user) {
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
  const scope = getDataScope(db, user, 'projects')
  const visibility = projectDuplicateVisibility(scope, user)
  return db.prepare(`
    SELECT id, name, customer, phone, source, external_order_no, status, created_at
    FROM projects
    WHERE (${clauses.map(item => `(${item})`).join(' OR ')})
      ${visibility.sql}
    ORDER BY id DESC
    LIMIT 5
  `).all(...params, ...visibility.params)
}

function projectDuplicateVisibility(scope, user) {
  if (['super_admin', 'admin'].includes(user?.role) || scope === 'all') return { sql: '', params: [] }
  const userId = Number(user?.userId || 0)
  if (!userId || scope === 'none' || scope === 'private_grant') return { sql: 'AND 1 = 0', params: [] }
  return {
    sql: `AND (
      created_by = ?
      OR manager_user_id = ?
      OR assignee_user_id = ?
      OR crew_member_user_ids = ?
      OR crew_member_user_ids LIKE ?
      OR crew_member_user_ids LIKE ?
      OR crew_member_user_ids LIKE ?
    )`,
    params: [
      userId,
      userId,
      userId,
      `[${userId}]`,
      `[${userId},%`,
      `%,${userId},%`,
      `%,${userId}]`
    ]
  }
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

function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function toMoney(value) {
  const n = toNumber(value)
  if (n <= 0) return 0
  return Math.min(n, MAX_MONEY_VALUE)
}

function safeText(value, limit) {
  const text = String(value || '')
  return text.length > limit ? `${text.slice(0, limit)}...` : text
}

function safeFileName(name) {
  return String(name || '施工交底单')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || '施工交底单'
}
