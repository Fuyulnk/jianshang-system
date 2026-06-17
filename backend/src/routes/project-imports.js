import * as XLSX from 'xlsx'
import { fileURLToPath } from 'url'
import { dirname, extname, join } from 'path'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import crypto from 'crypto'
import { authMiddleware } from '../middleware/auth.js'
import { canAccessModule, canAccessProjectRecord, getDataScope } from '../utils/permissions.js'
import { buildProjectDraft, emptyDeliveryDocument, missingBriefingFields, parseBriefingDocument, parseDeliveryDocument, parseMaterialOutDocument } from '../utils/projectDocumentImport.js'
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
const MAX_FILE_SIZE = 50 * 1024 * 1024
const LARGE_DELIVERY_BODY_LIMIT = 160 * 1024 * 1024
const MAX_MONEY_VALUE = 100000000
const ALLOWED_BRIEFING_ATTACHMENT_EXTS = new Set(['.csv', '.xls', '.xlsx', '.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx', '.ppt', '.pptx'])
const DELIVERY_DOCUMENT_TYPES = new Set(['survey_initial', 'survey_recheck', 'briefing', 'material_io', 'completion_inspection', 'labor_settlement', 'cost_check', 'finance_settlement'])

export default function projectImportRoutes(server, db) {
  server.post('/api/briefing-imports/parse', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!canAccessModule(db, request.user, 'projects', 'can_create')) {
      logAiAudit(db, request.user, {
        actionType: 'tool_write',
        toolName: 'parse_project_handover',
        status: 'denied',
        errorMessage: '无权限导入门店交底单'
      })
      reply.code(403).send({ success: false, message: '无权限导入门店交底单' })
      return
    }

    const { text = '', file_name = '', file_data = '' } = request.body || {}
    if (!String(text || '').trim() && !file_data) return { success: false, message: '请上传门店交底单或粘贴交底内容' }
    try {
      const parsed = file_data
        ? parseBriefingDocument(file_name, file_data)
        : parseBriefingText(text)
      const duplicates = findDuplicates(db, parsed.project_draft || {}, request.user)
      logAiAudit(db, request.user, {
        actionType: 'tool_write',
        toolName: 'parse_project_handover',
        requestSummary: file_name || summarizeRawContent(text, 500),
        resultSummary: `门店交底单识别：${parsed.form_data?.items?.length || 0} 条施工明细`,
        model: getAiConfig(db).model
      })
      return { success: true, data: { ...parsed, duplicate_matches: duplicates } }
    } catch (err) {
      logAiAudit(db, request.user, {
        actionType: 'tool_write',
        toolName: 'parse_project_handover',
        status: 'failed',
        errorMessage: err.message || '门店交底单解析失败'
      })
      reply.code(400).send({ success: false, message: err.message || '门店交底单解析失败' })
    }
  })

  server.post('/api/briefing-imports/confirm-create', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!canAccessModule(db, request.user, 'projects', 'can_create')) {
      logAiAudit(db, request.user, {
        actionType: 'tool_write',
        toolName: 'create_project_workorder',
        status: 'denied',
        errorMessage: '无权限从门店交底单创建项目'
      })
      reply.code(403).send({ success: false, message: '无权限从门店交底单创建项目' })
      return
    }

    try {
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
          warnings: [...warnings, ...duplicates.map(item => `可能重复：${item.name || item.customer}#${item.id}`)],
          userId: request.user.userId
        })
        addProjectLog(db, projectId, '导入门店交底单创建工单', request.user.username,
          `由门店交底单创建；单据 #${documentId}；缺失提示 ${missing.length} 项；重复提示 ${duplicates.length} 项；不自动推进状态。`)
      })
      tx()

      logAiAudit(db, request.user, {
        actionType: 'tool_write',
        toolName: 'create_project_workorder',
        requestSummary: `门店交底单创建项目：${draft.name}`,
        resultSummary: `项目 #${projectId}，单据 #${documentId}`,
        model: getAiConfig(db).model
      })
      return { success: true, data: { project_id: projectId, document_id: documentId, source_attachment_id: attachmentId, missing_fields: missing, duplicate_matches: duplicates } }
    } catch (err) {
      const message = buildCreateFailureMessage(err)
      logAiAudit(db, request.user, {
        actionType: 'tool_write',
        toolName: 'create_project_workorder',
        status: 'failed',
        errorMessage: message
      })
      reply.code(isUserFixableCreateError(err) ? 400 : 500).send({ success: false, message })
    }
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
      reply.code(403).send({ success: false, message: '无权限保存班组交底单' })
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
        warnings,
        userId: request.user.userId
      })
      syncProjectFromBriefing(db, project, draft)
      addProjectLog(db, project.id, '保存班组交底单', request.user.username,
        `系统版班组交底单 #${documentId} 已保存；同步字段 ${changed.join('、') || '无'}；不自动推进状态。`)
    })
    tx()

    return { success: true, data: { document_id: documentId, source_attachment_id: attachmentId, changed_fields: changed, missing_fields: missing } }
  })

  server.get('/api/projects/:id/delivery-chain', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(toInt(request.params.id))
    if (!project || !canAccessModule(db, request.user, 'projects', 'can_view') || !canAccessProjectRecord(db, request.user, project)) {
      reply.code(404).send({ success: false, message: '项目不存在或无权限' })
      return
    }
    return { success: true, data: buildDeliveryChain(db, project) }
  })

  server.post('/api/projects/:id/delivery-chain/:type/parse', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(toInt(request.params.id))
    const documentType = normalizeDeliveryDocumentType(request.params.type)
    if (!project || !documentType || !canAccessModule(db, request.user, 'projects', 'can_edit') || !canAccessProjectRecord(db, request.user, project)) {
      reply.code(404).send({ success: false, message: '项目不存在、单据类型无效或无权限' })
      return
    }
    const { file_name = '', file_data = '' } = request.body || {}
    if (!file_name || !file_data) return { success: false, message: '请选择要导入的项目单据' }
    try {
      const parsed = parseDeliveryDocument(documentType, file_name, file_data)
      return { success: true, data: decorateDeliveryParsedData(project, documentType, parsed) }
    } catch (err) {
      reply.code(400).send({ success: false, message: err.message || '单据解析失败' })
    }
  })

  server.post('/api/projects/:id/delivery-chain/:type/save', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(toInt(request.params.id))
    const documentType = normalizeDeliveryDocumentType(request.params.type)
    if (!project || !documentType || !canAccessModule(db, request.user, 'projects', 'can_edit') || !canAccessProjectRecord(db, request.user, project)) {
      reply.code(404).send({ success: false, message: '项目不存在、单据类型无效或无权限' })
      return
    }
    try {
      const parsedData = request.body?.parsed_data || {}
      const confirmedData = request.body?.confirmed_data || emptyDeliveryDocument(documentType, project)
      const warnings = Array.isArray(request.body?.warnings) ? request.body.warnings : parsedData.warnings || []
      let attachmentId = toInt(request.body?.source_attachment_id)
      const tx = db.transaction(() => {
        if (!attachmentId) attachmentId = saveProjectAttachment(db, request.user, project.id, request.body?.file || null)
        const documentId = upsertProjectDocument(db, {
          projectId: project.id,
          documentType,
          sourceAttachmentId: attachmentId,
          parsedData,
          confirmedData,
          warnings,
          userId: request.user.userId
        })
        syncProjectFromDeliveryDocument(db, project, documentType, confirmedData)
        addProjectLog(db, project.id, `保存${deliveryDocumentLabel(documentType)}`, request.user.username,
          `系统版${deliveryDocumentLabel(documentType)} #${documentId} 已保存；字段联动已刷新。`)
        return documentId
      })
      return { success: true, data: { document_id: tx(), source_attachment_id: attachmentId, chain: buildDeliveryChain(db, db.prepare('SELECT * FROM projects WHERE id = ?').get(project.id)) } }
    } catch (err) {
      reply.code(400).send({ success: false, message: err.message || '保存项目单据失败' })
    }
  })

  server.post('/api/projects/:id/delivery-chain/survey/generate-ppt', { bodyLimit: LARGE_DELIVERY_BODY_LIMIT }, async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(toInt(request.params.id))
    if (!project || !canAccessModule(db, request.user, 'projects', 'can_edit') || !canAccessProjectRecord(db, request.user, project)) {
      reply.code(404).send({ success: false, message: '项目不存在或无权限' })
      return
    }
    try {
      const documentType = request.body?.document_type === 'survey_recheck' ? 'survey_recheck' : 'survey_initial'
      const existingDoc = getLatestProjectDocument(db, project.id, documentType)
      const existingData = existingDoc?.confirmed_data || emptyDeliveryDocument(documentType, project)
      const input = {
        ...existingData.survey,
        ...(request.body || {}),
        images: Array.isArray(request.body?.images) && request.body.images.length
          ? request.body.images
          : existingData.survey?.images || []
      }
      const draftData = normalizeSurveyDraft(project, input, documentType)
      if (!draftData.survey.images.length) {
        reply.code(400).send({ success: false, message: '请先上传现场图片，再生成 PPT' })
        return
      }
      const imageAttachments = saveSurveyImageAttachments(db, request.user, project, documentType, draftData.survey?.images || [])
      const buffer = buildSurveyPptx(db, project, {
        ...draftData,
        survey: {
          ...draftData.survey,
          images: imageAttachments
        }
      })
      const confirmedData = stripSurveyImagePayloads(draftData, imageAttachments)
      const attachmentId = saveGeneratedProjectAttachment(
        db,
        request.user,
        project.id,
        `${project.name || project.customer || '项目'}-${deliveryDocumentLabel(documentType)}-现场图片PPT.pptx`,
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        buffer
      )
      const documentId = upsertProjectDocument(db, {
        projectId: project.id,
        documentType,
        sourceAttachmentId: attachmentId,
        parsedData: {
          source: 'image_upload_generate_ppt',
          ppt_attachment_id: attachmentId,
          image_attachment_ids: imageAttachments.map(item => item.attachment_id)
        },
        confirmedData,
        warnings: [],
        userId: request.user.userId
      })
      syncProjectFromDeliveryDocument(db, project, documentType, confirmedData)
      addProjectLog(db, project.id, `生成${deliveryDocumentLabel(documentType)}`, request.user.username,
        `上传 ${confirmedData.survey.image_count || 0} 张图片生成 PPT 附件 #${attachmentId}，图片附件 ${imageAttachments.map(item => `#${item.attachment_id}`).join('、') || '无'}，单据 #${documentId}。`)
      return { success: true, data: { document_id: documentId, source_attachment_id: attachmentId, chain: buildDeliveryChain(db, db.prepare('SELECT * FROM projects WHERE id = ?').get(project.id)) } }
    } catch (err) {
      reply.code(400).send({ success: false, message: err.message || '生成勘察 PPT 失败' })
    }
  })

  server.post('/api/projects/:id/delivery-chain/survey/images', { bodyLimit: LARGE_DELIVERY_BODY_LIMIT }, async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(toInt(request.params.id))
    if (!project || !canAccessModule(db, request.user, 'projects', 'can_edit') || !canAccessProjectRecord(db, request.user, project)) {
      reply.code(404).send({ success: false, message: '项目不存在或无权限' })
      return
    }
    try {
      const documentType = request.body?.document_type === 'survey_recheck' ? 'survey_recheck' : 'survey_initial'
      const existingDoc = getLatestProjectDocument(db, project.id, documentType)
      const existingData = existingDoc?.confirmed_data || emptyDeliveryDocument(documentType, project)
      const draftData = normalizeSurveyDraft(project, {
        ...existingData.survey,
        ...(request.body || {}),
        images: request.body?.images || []
      }, documentType)
      if (!draftData.survey.images.length) {
        reply.code(400).send({ success: false, message: '请选择要上传的现场图片' })
        return
      }
      const imageAttachments = saveSurveyImageAttachments(db, request.user, project, documentType, draftData.survey.images)
      const confirmedData = stripSurveyImagePayloads(draftData, imageAttachments)
      const documentId = upsertProjectDocument(db, {
        projectId: project.id,
        documentType,
        sourceAttachmentId: existingDoc?.source_attachment_id || 0,
        parsedData: {
          ...(existingDoc?.parsed_data || {}),
          source: 'survey_image_upload',
          image_attachment_ids: imageAttachments.map(item => item.attachment_id)
        },
        confirmedData,
        warnings: existingDoc?.warnings || [],
        userId: request.user.userId
      })
      syncProjectFromDeliveryDocument(db, project, documentType, confirmedData)
      addProjectLog(db, project.id, `上传${deliveryDocumentLabel(documentType)}现场图片`, request.user.username,
        `已保存 ${confirmedData.survey.image_count || 0} 张现场图片，单据 #${documentId}；尚未生成 PPT。`)
      return { success: true, data: { document_id: documentId, chain: buildDeliveryChain(db, db.prepare('SELECT * FROM projects WHERE id = ?').get(project.id)) } }
    } catch (err) {
      reply.code(400).send({ success: false, message: err.message || '上传现场图片失败' })
    }
  })

  server.post('/api/projects/:id/delivery-chain/:type/confirm-step', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(toInt(request.params.id))
    const documentType = normalizeDeliveryDocumentType(request.params.type)
    if (!project || !documentType || !canAccessProjectRecord(db, request.user, project)) {
      reply.code(404).send({ success: false, message: '项目不存在、单据类型无效或无权限' })
      return
    }
    const rule = deliveryStepConfirmRule(documentType, project)
    if (!rule) {
      reply.code(400).send({ success: false, message: '当前单据暂不支持直接确认推进' })
      return
    }
    if (!canConfirmDeliveryStep(request.user, rule)) {
      reply.code(403).send({ success: false, message: '当前角色不能确认这个步骤' })
      return
    }

    const doc = getLatestProjectDocument(db, project.id, documentType)
    if (!doc) {
      reply.code(400).send({ success: false, message: `请先保存或上传${deliveryDocumentLabel(documentType)}` })
      return
    }
    const guard = validateDeliveryStepConfirmation(db, project, documentType, doc)
    if (!guard.ok) {
      reply.code(400).send({ success: false, message: guard.message })
      return
    }

    const currentStatus = String(project.status || '')
    const targetStatus = guard.targetStatus || rule.targetStatus
    const shouldMove = targetStatus && rule.from.includes(currentStatus)
    const confirmedData = {
      ...doc.confirmed_data,
      step_confirmed: true,
      step_confirmed_at: new Date().toISOString(),
      step_confirmed_by: request.user.userId
    }
    if (doc.confirmed_data?.survey) {
      confirmedData.survey = {
        ...doc.confirmed_data.survey,
        step_confirmed: true,
        step_confirmed_at: confirmedData.step_confirmed_at
      }
    }

    try {
      const tx = db.transaction(() => {
        upsertProjectDocument(db, {
          projectId: project.id,
          documentType,
          sourceAttachmentId: doc.source_attachment_id,
          parsedData: doc.parsed_data || {},
          confirmedData,
          warnings: doc.warnings || [],
          userId: request.user.userId
        })
        syncProjectFromDeliveryDocument(db, project, documentType, confirmedData)
        const updates = stepConfirmProjectUpdates(documentType, confirmedData, guard)
        const values = updates.map(item => item.value)
        if (shouldMove) {
          updates.push({ field: 'status', value: targetStatus })
          values.push(targetStatus)
        }
        if (updates.length) {
          const assignments = updates.map(item => `${item.field} = ?`)
          assignments.push("updated_at = datetime('now', 'localtime')")
          values.push(project.id)
          let result
          if (shouldMove) {
            values.push(currentStatus)
            result = db.prepare(`UPDATE projects SET ${assignments.join(', ')} WHERE id = ? AND status = ?`).run(...values)
          } else {
            result = db.prepare(`UPDATE projects SET ${assignments.join(', ')} WHERE id = ?`).run(...values)
          }
          if (shouldMove && result.changes === 0) {
            const conflict = new Error('项目状态已被其他请求推进，请刷新后重试')
            conflict.code = 'PROJECT_STATUS_CONFLICT'
            throw conflict
          }
        }
        const label = deliveryDocumentLabel(documentType)
        const statusNote = shouldMove
          ? `项目状态推进到${deliveryStatusLabel(targetStatus)}。`
          : '项目已处于后续阶段，本次只确认单据。'
        addProjectLog(db, project.id, `确认${label}`, request.user.username,
          `${label}已确认完成；${guard.logExtra || ''}${statusNote}`)
      })
      tx()
      const nextProject = db.prepare('SELECT * FROM projects WHERE id = ?').get(project.id)
      return {
        success: true,
        data: {
          project_status: nextProject.status,
          message: shouldMove ? '当前步骤已完成，项目已进入下一步' : '当前步骤已完成',
          chain: buildDeliveryChain(db, nextProject)
        }
      }
    } catch (err) {
      reply.code(err.code === 'PROJECT_STATUS_CONFLICT' ? 409 : 400).send({ success: false, message: err.message || '确认当前步骤失败' })
    }
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
    if (!file_name || !file_data) return { success: false, message: '请选择班组交底单表格' }

    try {
      const parsed = parseBriefingDocument(file_name, file_data)
      const current = {}
      for (const field of parsed.fields || []) current[field.key] = project[field.key] ?? ''
      return { success: true, data: { ...parsed, document_label: '班组交底单', current } }
    } catch (err) {
      reply.code(400).send({ success: false, message: err.message || '班组交底单解析失败' })
    }
  })

  server.post('/api/projects/:id/document-imports/briefing/apply', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(toInt(request.params.id))
    if (!project) return reply.code(404).send({ success: false, message: '项目不存在' })
    if (!canApplyProjectDocumentImport(request.user) || !canAccessModule(db, request.user, 'projects', 'can_edit') || !canAccessProjectRecord(db, request.user, project)) {
      reply.code(403).send({ success: false, message: '无权限写入班组交底单字段' })
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
        reply.code(400).send({ success: false, message: '班组交底日期来自接单时间推断，必须单独确认后才能写入' })
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
    addProjectLog(db, project.id, '导入班组交底单字段', request.user.username,
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
        errorMessage: '无权限导入门店交底单'
      })
      reply.code(403).send({ success: false, message: '无权限导入门店交底单' })
      return
    }

    const { text = '', file_name = '', file_data = '', mime_type = '' } = request.body || {}
    const sourceType = file_data ? 'file' : 'text'
    const rawContent = sourceType === 'file'
      ? extractFileContent(file_name, file_data)
      : String(text || '')
    if (!rawContent.trim()) return { success: false, message: '请粘贴门店交底内容或上传表格' }

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
        addProjectLog(db, created.lastInsertRowid, '导入门店交底单创建工单', request.user.username,
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

const DELIVERY_CONFIRM_RULES = {
  survey_initial: {
    from: ['handover_received', 'survey_pending'],
    targetStatus: 'survey_done',
    roles: ['super_admin', 'admin', 'engineering']
  },
  survey_recheck: {
    from: ['survey_done'],
    targetStatus: 'recheck_done',
    roles: ['super_admin', 'admin', 'engineering']
  },
  briefing: {
    from: ['recheck_done'],
    targetStatus: 'briefing_done',
    roles: ['super_admin', 'admin', 'engineering']
  },
  material_io: {
    from: ['inspection_done'],
    targetStatus: 'material_returned',
    roles: ['super_admin', 'admin', 'warehouse', 'engineering']
  },
  completion_inspection: {
    from: ['in_progress', 'material_out'],
    targetStatus: 'inspection_done',
    roles: ['super_admin', 'admin', 'engineering', 'employee']
  },
  labor_settlement: {
    from: ['material_returned'],
    targetStatus: 'labor_settled',
    roles: ['super_admin', 'admin', 'finance', 'engineering']
  },
  cost_check: {
    from: ['labor_settled'],
    targetStatus: 'cost_checked',
    roles: ['super_admin', 'admin', 'finance']
  },
  finance_settlement: {
    from: ['cost_checked'],
    targetStatus: 'finance_settled',
    roles: ['super_admin', 'admin', 'finance']
  }
}

function deliveryStepConfirmRule(documentType, project) {
  const rule = DELIVERY_CONFIRM_RULES[documentType]
  if (!rule) return null
  if (documentType === 'survey_initial') {
    return { ...rule, targetStatus: surveyInitialTargetStatus(project) }
  }
  return rule
}

function surveyInitialTargetStatus(project) {
  const status = String(project?.status || '')
  return ['handover_received', 'survey_pending'].includes(status) ? 'recheck_done' : 'survey_done'
}

function canConfirmDeliveryStep(user, rule) {
  if (user?.role === 'super_admin') return true
  return rule.roles.includes(user?.role)
}

function validateDeliveryStepConfirmation(db, project, documentType, doc) {
  const data = doc.confirmed_data || {}
  if (['survey_initial', 'survey_recheck', 'completion_inspection'].includes(documentType)) {
    const survey = data.survey || {}
    const images = Array.isArray(survey.images) ? survey.images : []
    const pptAttachment = getAttachment(db, doc.source_attachment_id)
    if (documentType !== 'completion_inspection') {
      if (!images.length && (!pptAttachment || !isPptAttachment(pptAttachment))) {
        return { ok: false, message: '请先上传现场图片或直接上传工勘 PPT' }
      }
      if (!pptAttachment || !isPptAttachment(pptAttachment)) {
        return { ok: false, message: '请先生成或上传工勘 PPT，再确认完成' }
      }
    }
    if (documentType === 'survey_initial') {
      const judgment = String(survey.entry_judgment || '').trim()
      if (!['ready', 'conditional', 'blocked'].includes(judgment)) {
        return { ok: false, message: '请先选择工勘结论：无需复尺、需要复尺或暂不具备进场条件' }
      }
      if (judgment === 'blocked') {
        return { ok: false, message: '当前结论为暂不具备进场条件，请先处理整改或改为需要复尺后再推进' }
      }
      const needsRecheck = !!survey.need_recheck || judgment === 'conditional'
      return {
        ok: true,
        targetStatus: needsRecheck ? 'survey_done' : 'recheck_done',
        logExtra: needsRecheck ? '结论：需要复尺；' : '结论：无需复尺，已跳过复尺节点；'
      }
    }
    return {
      ok: true,
      logExtra: `PPT 附件 #${doc.source_attachment_id || 0}；现场图片 ${images.length} 张。`
    }
  }
  if (documentType === 'briefing') {
    const items = Array.isArray(data.items) ? data.items : []
    if (!data.project?.customer && !project.customer) return { ok: false, message: '班组交底单缺少客户姓名' }
    if (!items.length) return { ok: false, message: '班组交底单缺少施工项目明细' }
  }
  if (documentType === 'material_io') {
    const summary = data.summary || {}
    if (String(project.status || '') === 'briefing_done') {
      return { ok: false, message: '出库阶段请走“材料出库单”，由仓库确认后推进' }
    }
    if (summary.material_return_status && summary.material_return_status !== 'done') {
      return { ok: false, message: '材料回库状态未完成，不能确认回库节点' }
    }
  }
  if (documentType === 'labor_settlement' && !Number(data.summary?.labor_fee || 0)) {
    return { ok: false, message: '请先填写或导入人工费合计' }
  }
  if (documentType === 'cost_check' && !Number(data.summary?.total_cost || 0)) {
    return { ok: false, message: '请先填写或导入成本合计' }
  }
  if (documentType === 'finance_settlement' && data.summary?.payment_status !== 'paid') {
    return { ok: false, message: '财务归档前请先把收款状态确认为已收齐' }
  }
  return { ok: true, logExtra: '' }
}

function stepConfirmProjectUpdates(documentType, confirmedData, guard) {
  const updates = []
  const survey = confirmedData?.survey || {}
  const summary = confirmedData?.summary || {}
  if (['survey_initial', 'survey_recheck'].includes(documentType)) {
    if (survey.survey_date) updates.push({ field: 'survey_date', value: survey.survey_date })
    if (survey.conclusion) {
      updates.push({
        field: documentType === 'survey_initial' ? 'survey_report' : 'condition_note',
        value: survey.conclusion
      })
    }
    if (documentType === 'survey_initial' && guard?.targetStatus === 'recheck_done') {
      updates.push({ field: 'condition_note', value: `无需复尺：${survey.conclusion || '首次工勘确认具备进场条件'}` })
    }
  }
  if (documentType === 'completion_inspection') {
    if (survey.survey_date) updates.push({ field: 'acceptance_date', value: survey.survey_date })
    if (survey.conclusion) updates.push({ field: 'construction_note', value: survey.conclusion })
  }
  if (documentType === 'material_io') {
    updates.push({ field: 'material_return_status', value: 'done' })
    if (summary.material_return_note) updates.push({ field: 'material_return_note', value: summary.material_return_note })
  }
  if (documentType === 'cost_check' && Number(summary.revenue_amount || 0)) {
    updates.push({ field: 'settlement_amount', value: Number(summary.revenue_amount || 0) })
  }
  return updates
}

function deliveryStatusLabel(status) {
  return {
    survey_done: '勘察完成待复尺',
    recheck_done: '无需复尺/复尺完成待班组交底',
    briefing_done: '班组交底完成待出库',
    inspection_done: '验收完成待回库',
    material_returned: '回库完成待工费结算',
    labor_settled: '工费结算完成待成本核算',
    cost_checked: '成本核算完成待财务结算',
    finance_settled: '财务结算完成待归档'
  }[status] || status
}

const DELIVERY_NODE_RULES = [
  {
    key: 'survey_initial',
    stage: '工勘',
    label: '首次工勘表',
    desc: '上传现场图片生成标准工勘 PPT，记录基层、保护、整改和进场判断。',
    rx: /现场勘察|首次|工勘|工勘表|基层勘察|现场基层/i,
    required: true,
    actions: ['generate_ppt', 'view', 'import']
  },
  {
    key: 'survey_recheck',
    stage: '复勘',
    label: '二次勘察表',
    desc: '仅当前端/工程确认现场有问题时启用；不是每个项目必填。',
    rx: /二次|二次勘察表|复勘|复尺|复核|基层二次/i,
    optional: true,
    actions: ['generate_ppt', 'view', 'import']
  },
  {
    key: 'briefing',
    stage: '班组交底',
    label: '班组交底单',
    desc: '复尺后、出库前的工程执行交底，沉淀班组、施工面积、施工项和进场注意事项。',
    rx: /班组交底|施工交底|工勘交底|成本交底|交底单/i,
    required: true,
    actions: ['view', 'import']
  },
  {
    key: 'material_io',
    stage: '仓库',
    label: '材料出库单',
    desc: '记录材料、辅材、工具和运输，金额自动进入成本草稿。',
    rx: /出库|回库|材料单|材料出库|涂料进场/i,
    required: true,
    actions: ['view', 'import', 'sync']
  },
  {
    key: 'completion_inspection',
    stage: '验收',
    label: '完工验收质检表',
    desc: '记录完工图片、整改项和是否触发售后/维修。',
    rx: /完工验收|质检|完工质检/i,
    required: true,
    actions: ['view', 'import']
  },
  {
    key: 'labor_settlement',
    stage: '工费',
    label: '施工班组工费结算单',
    desc: '从面积、工期和班组信息生成草稿，人工确认点工/包工金额。',
    rx: /工费|人工|施工完工结算|班组|工资/i,
    required: true,
    actions: ['view', 'import', 'sync']
  },
  {
    key: 'cost_check',
    stage: '成本',
    label: '完工成本核算表',
    desc: '汇总人工、材料、辅材、工具、运输，自动计算利润和利润率。',
    rx: /完工成本|成本核算|成本表/i,
    required: true,
    actions: ['view', 'import', 'sync']
  },
  {
    key: 'finance_settlement',
    stage: '财务',
    label: '财务结算/归档',
    desc: '区分合同报价和交付核算收入，归档收款、尾款和最终对账。',
    rx: /财务|收款|付款|尾款|对账|归档/i,
    required: true,
    actions: ['view', 'sync']
  }
]

const DELIVERY_FIELD_MAPPINGS = {
  survey_initial: {
    structured: ['客户', '电话', '地址', '勘察日期', '勘察结论', '是否需要复尺', '现场问题清单'],
    attachment_only: ['现场图片原图', '工勘 PPT 版式', '图片备注细节']
  },
  survey_recheck: {
    structured: ['复尺日期', '复尺结论', '整改/复核结果', '是否可进场'],
    attachment_only: ['复尺图片', '二次勘察 PPT', '现场补充说明']
  },
  briefing: {
    structured: ['客户', '电话', '地址', '施工空间', '工艺/材料', '施工面积', '班组长', '交底日期', '合同报价'],
    attachment_only: ['原始交底表格式', '门店备注长文本', '签字/图片页']
  },
  material_io: {
    structured: ['材料名', '规格', '单位', '出库数量', '实际用量', '回库数量', '差异', '单价', '金额'],
    attachment_only: ['原始出库/回库表', '仓库备注', '签字或拍照凭证']
  },
  completion_inspection: {
    structured: ['验收日期', '质检结论', '整改项', '是否通过', '是否触发售后'],
    attachment_only: ['完工图片', '验收 PPT', '客户签字页']
  },
  labor_settlement: {
    structured: ['开工时间', '完工时间', '班组长', '工期', '施工面积', '人工费合计', '点工/包工说明'],
    attachment_only: ['班组签字', '原始工费表版式', '补充结算依据']
  },
  cost_check: {
    structured: ['交付核算收入', '人工费', '材料费', '辅材费', '工具费', '运输费', '成本合计', '毛利润', '利润率'],
    attachment_only: ['成本表原件', '计算过程补充页', '异常说明附件']
  },
  finance_settlement: {
    structured: ['合同报价', '交付核算收入', '已收款', '未收/尾款', '收款状态', '归档状态', '财务备注'],
    attachment_only: ['收款凭证', '发票/对账附件', '归档凭证原件']
  }
}

function buildDeliveryChain(db, project) {
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
  const latestDocs = {}
  const docVersions = {}
  for (const row of docs) {
    const formatted = formatProjectDocument(row)
    if (!docVersions[row.document_type]) docVersions[row.document_type] = []
    docVersions[row.document_type].push(formatted)
    if (!latestDocs[row.document_type]) latestDocs[row.document_type] = formatted
  }
  const attachments = db.prepare(`
    SELECT id, original_name, mime_type, size, created_at
    FROM attachments
    WHERE entity_type = 'project' AND entity_id = ? AND COALESCE(deleted_at, '') = ''
    ORDER BY id DESC
  `).all(project.id)
  const finance = buildDeliveryFinanceSummary(project, latestDocs)
  const conditionNote = String(project.condition_note || '')
  const needRecheck = !!latestDocs.survey_recheck
    || latestDocs.survey_initial?.confirmed_data?.survey?.need_recheck
    || /需要二次|需二次|需要复勘|需复勘|复勘待确认|整改待复核|问题待复核/.test(conditionNote)
  const nodes = DELIVERY_NODE_RULES.map(rule => buildDeliveryNode(rule, project, latestDocs[rule.key], attachments, finance, needRecheck, docVersions[rule.key] || []))
  const requiredNodes = nodes.filter(node => !node.optional || node.required_now)
  return {
    project_id: project.id,
    title: '项目交付资料链',
    subtitle: '从勘察、交底、出入库、工费、成本到财务归档',
    metrics: {
      confirmed_count: nodes.filter(node => node.status === '已确认').length,
      uploaded_count: nodes.filter(node => node.attachment_count > 0).length,
      missing_count: requiredNodes.filter(node => ['未开始', '已生成草稿', '有差异待确认'].includes(node.status)).length,
      optional_count: nodes.filter(node => node.optional).length
    },
    finance,
    nodes
  }
}

function buildDeliveryNode(rule, project, doc, attachments, finance, needRecheck, versions = []) {
  const linkedIds = documentAttachmentIds(doc)
  const seen = new Set()
  const files = attachments.filter(file => {
    const id = Number(file.id)
    if (seen.has(id)) return false
    if (!linkedIds.has(id) && !rule.rx.test(file.original_name || '')) return false
    seen.add(id)
    return true
  })
  const optional = !!rule.optional
  const requiredNow = !optional || needRecheck || !!doc || files.length > 0
  const confirmedData = doc?.confirmed_data || emptyDeliveryDocument(rule.key, project)
  const differenceCount = countDocumentDifferences(rule.key, confirmedData, finance)
  let status = '未开始'
  if (optional && !requiredNow) status = '按需'
  else if (differenceCount) status = '有差异待确认'
  else if (doc?.status === 'confirmed') status = '已确认'
  else if (doc) status = '已生成草稿'
  else if (files.length) status = '已上传'
  return {
    ...rule,
    optional,
    required_now: requiredNow,
    status,
    status_type: status === '已确认' ? 'success' : status === '按需' ? 'info' : status === '有差异待确认' ? 'warning' : files.length ? 'warning' : 'danger',
    attachment_count: files.length,
    attachments: files.slice(0, 8),
    document: doc || null,
    document_version_count: versions.length,
    document_versions: versions.slice(0, 6).map(version => ({
      id: version.id,
      status: version.status,
      source_file_name: version.source_file_name || '',
      uploader_name: version.updated_by_name || version.created_by_name || '',
      updated_at: version.updated_at,
      created_at: version.created_at
    })),
    field_mapping: DELIVERY_FIELD_MAPPINGS[rule.key] || { structured: [], attachment_only: [] },
    table_data: confirmedData,
    summary: summarizeDeliveryNode(rule.key, confirmedData, finance),
    differences: differenceCount
  }
}

function documentAttachmentIds(doc) {
  const ids = new Set()
  const sourceId = toInt(doc?.source_attachment_id)
  if (sourceId) ids.add(sourceId)
  const surveyImages = doc?.confirmed_data?.survey?.images
  if (Array.isArray(surveyImages)) {
    for (const image of surveyImages) {
      const id = toInt(image?.attachment_id)
      if (id) ids.add(id)
    }
  }
  const parsedIds = doc?.parsed_data?.image_attachment_ids
  if (Array.isArray(parsedIds)) {
    for (const id of parsedIds) {
      const cleanId = toInt(id)
      if (cleanId) ids.add(cleanId)
    }
  }
  return ids
}

function buildDeliveryFinanceSummary(project, docs) {
  const briefing = docs.briefing?.confirmed_data || {}
  const material = docs.material_io?.confirmed_data?.summary || {}
  const labor = docs.labor_settlement?.confirmed_data?.summary || {}
  const cost = docs.cost_check?.confirmed_data?.summary || {}
  const contractAmount = Number(briefing.finance?.estimated_total_amount || briefing.construction?.total_amount || project.total_amount || 0)
  const deliveryRevenue = Number(cost.revenue_amount || project.settlement_amount || 0)
  const laborFee = Number(labor.labor_fee || cost.labor_fee || 0)
  const materialFee = Number(material.material_fee || cost.material_fee || 0)
  const auxiliaryFee = Number(material.auxiliary_fee || cost.auxiliary_fee || 0)
  const toolFee = Number(material.tool_fee || cost.tool_fee || 0)
  const transportFee = Number(material.transport_fee || cost.transport_fee || 0)
  const totalCost = roundMoney(laborFee + materialFee + auxiliaryFee + toolFee + transportFee + Number(cost.other_fee || 0))
  const importedTotalCost = Number(cost.total_cost || 0)
  const revenueBase = deliveryRevenue || Number(cost.revenue_amount || 0)
  const grossProfit = revenueBase ? roundMoney(revenueBase - (importedTotalCost || totalCost)) : 0
  const profitRate = revenueBase ? Number((grossProfit / revenueBase).toFixed(4)) : 0
  const differences = []
  const notes = []
  if (importedTotalCost && totalCost && Math.abs(importedTotalCost - totalCost) > 0.01) {
    differences.push(`自动汇总成本 ${totalCost} 与成本表 ${importedTotalCost} 不一致`)
  }
  if (contractAmount && deliveryRevenue && Math.abs(contractAmount - deliveryRevenue) > 0.01) {
    notes.push(`合同报价 ${contractAmount} 与交付核算收入 ${deliveryRevenue} 是不同口径，请在财务归档时分开查看`)
  }
  return {
    contract_amount: roundMoney(contractAmount),
    delivery_revenue: roundMoney(deliveryRevenue),
    labor_fee: roundMoney(laborFee),
    material_fee: roundMoney(materialFee),
    auxiliary_fee: roundMoney(auxiliaryFee),
    tool_fee: roundMoney(toolFee),
    transport_fee: roundMoney(transportFee),
    auto_total_cost: totalCost,
    imported_total_cost: roundMoney(importedTotalCost),
    gross_profit: roundMoney(grossProfit),
    profit_rate: profitRate,
    differences,
    notes
  }
}

function summarizeDeliveryNode(type, data, finance) {
  if (type === 'briefing') {
    return [
      ['客户', data.basic?.customer],
      ['施工面积', data.construction?.total_area ? `${data.construction.total_area} m²` : ''],
      ['合同报价', moneyText(data.finance?.estimated_total_amount || data.construction?.total_amount)],
      ['施工项', Array.isArray(data.items) ? `${data.items.length} 条` : '0 条']
    ]
  }
  if (type === 'material_io') {
    return [
      ['材料费', moneyText(data.summary?.material_fee)],
      ['辅材', moneyText(data.summary?.auxiliary_fee)],
      ['工具', moneyText(data.summary?.tool_fee)],
      ['运输', moneyText(data.summary?.transport_fee)]
    ]
  }
  if (type === 'labor_settlement') return [['人工费', moneyText(data.summary?.labor_fee)], ['工期', data.summary?.duration], ['说明', data.summary?.work_note]]
  if (type === 'cost_check') return [['核算收入', moneyText(data.summary?.revenue_amount)], ['成本合计', moneyText(data.summary?.total_cost)], ['利润率', percentText(data.summary?.profit_rate)]]
  if (type === 'finance_settlement') return [['合同报价', moneyText(finance.contract_amount)], ['交付收入', moneyText(finance.delivery_revenue)], ['自动成本', moneyText(finance.auto_total_cost)], ['毛利润', moneyText(finance.gross_profit)]]
  if (type.includes('survey') || type === 'completion_inspection') return [['日期', data.survey?.survey_date], ['结论', data.survey?.conclusion]]
  return []
}

function countDocumentDifferences(type, data, finance) {
  if (type === 'cost_check') return finance.differences.length
  if (type === 'finance_settlement') return finance.differences.length
  return 0
}

function decorateDeliveryParsedData(project, documentType, parsed) {
  const confirmed = parsed.confirmed_data || parsed.form_data || emptyDeliveryDocument(documentType, project)
  return {
    ...parsed,
    document_type: documentType,
    document_label: deliveryDocumentLabel(documentType),
    confirmed_data: mergeProjectIntoDeliveryData(project, documentType, confirmed)
  }
}

function mergeProjectIntoDeliveryData(project, documentType, data) {
  const base = emptyDeliveryDocument(documentType, project)
  return {
    ...base,
    ...data,
    project: { ...base.project, ...(data.project || {}) }
  }
}

function normalizeDeliveryDocumentType(value) {
  const text = String(value || '').trim()
  return DELIVERY_DOCUMENT_TYPES.has(text) ? text : ''
}

function deliveryDocumentLabel(type) {
  return DELIVERY_NODE_RULES.find(rule => rule.key === type)?.label || '项目单据'
}

function syncProjectFromDeliveryDocument(db, project, documentType, data) {
  const updates = []
  const values = []
  if (documentType === 'survey_initial') {
    pushProjectUpdate(updates, values, project, 'survey_date', data.survey?.survey_date)
    pushProjectUpdate(updates, values, project, 'survey_report', data.survey?.conclusion)
    pushProjectUpdate(updates, values, project, 'condition_note', data.survey?.entry_judgment ? `${data.survey.entry_judgment}：${data.survey.conclusion || ''}` : '')
  }
  if (documentType === 'survey_recheck') {
    pushProjectUpdate(updates, values, project, 'condition_note', data.survey?.conclusion)
  }
  if (documentType === 'completion_inspection') {
    pushProjectUpdate(updates, values, project, 'acceptance_date', data.survey?.survey_date)
    pushProjectUpdate(updates, values, project, 'construction_note', data.survey?.conclusion)
  }
  if (documentType === 'cost_check') {
    pushProjectUpdate(updates, values, project, 'settlement_amount', data.summary?.revenue_amount)
  }
  if (!updates.length) return
  updates.push("updated_at = datetime('now', 'localtime')")
  values.push(project.id)
  db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`).run(...values)
}

function pushProjectUpdate(updates, values, project, field, value) {
  if (value === undefined || value === null || value === '') return
  if (String(project[field] ?? '') === String(value)) return
  updates.push(`${field} = ?`)
  values.push(value)
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
    document_label: '门店交底单',
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
    warnings: ['文字交底只做基础信息识别，施工项目明细建议上传正式门店交底单。']
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
    finance: {
      estimated_total_amount: toMoney(input.finance?.estimated_total_amount),
      received_summary: safeText(input.finance?.received_summary, 300),
      unpaid_summary: safeText(input.finance?.unpaid_summary, 300),
      rebate_note: safeText(input.finance?.rebate_note, 300),
      pricing_note: safeText(input.finance?.pricing_note, 300),
      raw_lines: Array.isArray(input.finance?.raw_lines) ? input.finance.raw_lines.slice(0, 20).map(item => safeText(item, 300)) : []
    },
    site: {
      base_condition: safeText(site.base_condition, 300),
      high_work: safeText(site.high_work, 80),
      scaffold: safeText(site.scaffold, 80),
      second_transfer: safeText(site.second_transfer, 80),
      entry_condition: safeText(site.entry_condition, 200),
      site_status: safeText(site.site_status, 300),
      site_contact_name: safeText(site.site_contact_name, 80),
      site_contact_phone: safeText(site.site_contact_phone, 40)
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
    quotation_items: (Array.isArray(input.quotation_items) ? input.quotation_items : []).slice(0, 120).map(item => ({
      area_group: safeText(item.area_group, 80),
      position: safeText(item.position, 80),
      product_en: safeText(item.product_en, 120),
      product_name: safeText(item.product_name, 120),
      process: safeText(item.process, 120),
      color_no: safeText(item.color_no, 80),
      area: toNumber(item.area),
      list_unit_price: toMoney(item.list_unit_price),
      discount_unit_price: toMoney(item.discount_unit_price),
      list_amount: toMoney(item.list_amount),
      final_amount: toMoney(item.final_amount)
    })),
    images: {
      embedded_count: Math.max(0, toNumber(input.images?.embedded_count)),
      note: safeText(input.images?.note, 300),
      attachment_note: safeText(input.images?.attachment_note, 300)
    },
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
    SELECT id, source_attachment_id FROM project_documents
    WHERE project_id = ? AND document_type = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(projectId, documentType)
  const parsed = JSON.stringify(parsedData || {})
  const confirmed = JSON.stringify(confirmedData || {})
  const warningText = JSON.stringify(Array.isArray(warnings) ? warnings : [])
  const hasNewSourceVersion = existing
    && sourceAttachmentId
    && Number(sourceAttachmentId) !== Number(existing.source_attachment_id || 0)
  if (existing && !hasNewSourceVersion) {
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

function getLatestProjectDocument(db, projectId, documentType) {
  const row = db.prepare(`
    SELECT d.*, a.original_name as source_file_name
    FROM project_documents d
    LEFT JOIN attachments a ON a.id = d.source_attachment_id
    WHERE d.project_id = ? AND d.document_type = ?
    ORDER BY d.id DESC
    LIMIT 1
  `).get(projectId, documentType)
  return row ? formatProjectDocument(row) : null
}

function getAttachment(db, id) {
  const cleanId = toInt(id)
  if (!cleanId) return null
  return db.prepare(`
    SELECT id, original_name, mime_type
    FROM attachments
    WHERE id = ? AND COALESCE(deleted_at, '') = ''
  `).get(cleanId)
}

function isPptAttachment(file) {
  return /ppt|presentation/i.test(file?.mime_type || '') || /\.(ppt|pptx)$/i.test(file?.original_name || '')
}

function formatProjectDocument(row) {
  return {
    ...row,
    parsed_data: parseJson(row.parsed_data, {}),
    confirmed_data: parseJson(row.confirmed_data, {}),
    warnings: parseJson(row.warnings, []),
    created_by_name: row.created_by_real_name || row.created_by_username || '',
    updated_by_name: row.updated_by_real_name || row.updated_by_username || '',
    source_file_name: row.source_file_name || ''
  }
}

function saveProjectAttachment(db, user, projectId, file) {
  if (!file?.data || !file?.name) return 0
  const originalName = safeFileName(file.name)
  const ext = extname(originalName).toLowerCase()
  if (!ALLOWED_BRIEFING_ATTACHMENT_EXTS.has(ext)) {
    throw new Error('该文件类型不允许作为班组交底单附件上传')
  }
  const buffer = decodeData(file.data)
  if (!buffer.length) throw new Error('班组交底单文件内容为空')
  if (buffer.length > MAX_FILE_SIZE || Number(file.size || 0) > MAX_FILE_SIZE) throw new Error('单个文件不能超过 50MB')

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

function saveGeneratedProjectAttachment(db, user, projectId, originalName, mimeType, buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('生成文件内容为空')
  if (buffer.length > MAX_FILE_SIZE) throw new Error('生成文件超过 50MB')
  const safeName = safeFileName(originalName)
  const ext = extname(safeName).toLowerCase()
  mkdirSync(UPLOAD_DIR, { recursive: true })
  const checksum = crypto.createHash('sha256').update(buffer).digest('hex')
  const storedName = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext || ''}`
  writeFileSync(join(UPLOAD_DIR, storedName), buffer)
  const result = db.prepare(`
    INSERT INTO attachments (
      entity_type, entity_id, original_name, stored_name, mime_type, size, checksum, uploaded_by
    ) VALUES ('project', ?, ?, ?, ?, ?, ?, ?)
  `).run(projectId, safeName, storedName, mimeType || 'application/octet-stream', buffer.length, checksum, user?.userId || 0)
  return result.lastInsertRowid
}


function readAttachmentBytes(db, attachmentId) {
  const record = db.prepare('SELECT stored_name, mime_type FROM attachments WHERE id = ?').get(attachmentId)
  if (!record) return null
  const filePath = join(UPLOAD_DIR, String(record.stored_name))
  try {
    const buffer = readFileSync(filePath)
    return { buffer, mimeType: record.mime_type || 'image/png' }
  } catch (e) {
    return null
  }
}

function saveSurveyImageAttachments(db, user, project, documentType, images) {
  if (!Array.isArray(images) || !images.length) return []
  const label = deliveryDocumentLabel(documentType)
  const projectName = safeFileName(project.name || project.customer || `项目${project.id}`)
  return images.map((image, index) => {
    const displayName = `现场图片 ${String(index + 1).padStart(2, '0')}`
    if (image.attachment_id) {
      return {
        attachment_id: image.attachment_id,
        name: displayName,
        original_name: safeFileName(image.original_name || image.name || displayName),
        mime_type: image.mime_type || 'image/png',
        size: image.size || 0,
        note: safeText(image.note || displayName, 300)
      }
    }
    const buffer = decodeData(image.data)
    if (!buffer.length) throw new Error(`第 ${index + 1} 张现场图片内容为空`)
    if (buffer.length > MAX_FILE_SIZE) throw new Error(`第 ${index + 1} 张现场图片超过 50MB`)
    const ext = imageExtension(image)
    const originalName = `${projectName}-${label}-${displayName}${ext}`
    const attachmentId = saveGeneratedProjectAttachment(db, user, project.id, originalName, image.mime_type || 'image/png', buffer)
    return {
      attachment_id: attachmentId,
      name: displayName,
      original_name: safeFileName(originalName),
      mime_type: image.mime_type || 'image/png',
      size: buffer.length,
      note: safeText(image.note || displayName, 300)
    }
  })
}

function stripSurveyImagePayloads(data, imageAttachments) {
  const clean = JSON.parse(JSON.stringify(data || {}))
  if (!clean.survey) clean.survey = {}
  // saveSurveyImageAttachments 会按前端传入顺序返回「已有附件 + 新附件」。
  // 这里必须直接使用返回值，不能只保存新生成的图片，否则下次追加上传会丢掉旧图。
  const seen = new Set()
  clean.survey.images = imageAttachments.filter(img => {
    const id = toInt(img.attachment_id)
    if (!id || seen.has(id)) return false
    seen.add(id)
    return true
  })
  clean.survey.image_count = clean.survey.images.length
  return clean
}

function normalizeExistingSurveyImageAttachments(images) {
  if (!Array.isArray(images)) return []
  return images
    .filter(image => image?.attachment_id)
    .map((image, index) => ({
      attachment_id: toInt(image.attachment_id),
      name: safeFileName(image.name || image.original_name || ''),
      original_name: safeFileName(image.original_name || image.name || ''),
      mime_type: image.mime_type || 'image/png',
      size: image.size || 0,
      note: safeText(image.note || image.name || `现场图片 ${index + 1}`, 300)
    }))
}

function imageExtension(image) {
  const nameExt = extname(image?.name || '').toLowerCase()
  if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(nameExt)) return nameExt
  const mime = String(image?.mime_type || '').toLowerCase()
  if (mime.includes('jpeg') || mime.includes('jpg')) return '.jpg'
  if (mime.includes('webp')) return '.webp'
  if (mime.includes('gif')) return '.gif'
  return '.png'
}

function normalizeSurveyDraft(project, input, documentType) {
  const images = Array.isArray(input.images) ? input.images.slice(0, 24).map(normalizeSurveyImage).filter(item => item.data || item.attachment_id) : []
  return {
    ...emptyDeliveryDocument(documentType, project),
    survey: {
      survey_date: safeText(input.survey_date || new Date().toISOString().slice(0, 10), 40),
      surveyor: safeText(input.surveyor || '', 80),
      surveyor_phone: safeText(input.surveyor_phone || '', 40),
      conclusion: safeText(input.conclusion || input.summary || '', 1200),
      entry_judgment: safeText(input.entry_judgment || 'conditional', 40),
      need_recheck: !!input.need_recheck,
      repair_required: !!input.repair_required,
      issues: Array.isArray(input.issues) ? input.issues.slice(0, 30).map(item => safeText(item, 300)).filter(Boolean) : [],
      image_count: images.length,
      images
    }
  }
}

function normalizeSurveyImage(item = {}) {
  const attachmentId = toInt(item.attachment_id)
  return {
    name: safeText(item.name || '现场图片', 120),
    original_name: safeText(item.original_name || item.name || '', 160),
    mime_type: safeText(item.mime_type || item.type || 'image/png', 80),
    note: safeText(item.note || '', 300),
    data: typeof item.data === 'string' ? item.data : '',
    attachment_id: attachmentId || undefined,
    size: typeof item.size === 'number' ? item.size : undefined,
  }
}

function buildSurveyPptx(db, project, data) {
  const survey = data.survey || {}
  const images = Array.isArray(survey.images) ? survey.images : []
  const projectTitle = project.name || project.address_detail || project.customer || '项目'
  const slides = [
    {
      title: `${projectTitle}`,
      lines: [
        deliveryDocumentLabel(data.survey?.need_recheck ? 'survey_recheck' : 'survey_initial'),
        `客户：${project.customer || ''}`,
        `联系方式：${project.phone || ''}`,
        `地址：${project.address || project.address_detail || ''}`,
        `勘察人：${survey.surveyor || ''} ${survey.surveyor_phone || ''}`,
        `日期：${survey.survey_date || ''}`
      ],
      images: []
    },
    {
      title: '现场图片',
      lines: images.length ? images.map((img, index) => `${index + 1}. ${img.note || img.name}`) : ['暂无图片说明'],
      images
    },
    {
      title: '项目勘察汇总',
      lines: [
        survey.conclusion || '请补充现场勘察结论。',
        survey.need_recheck ? '需要二次勘察/复核。' : '暂不强制二次勘察。',
        survey.repair_required ? '存在整改/维修事项。' : ''
      ].filter(Boolean),
      images: []
    }
  ]
  return createMinimalPptx(slides, db)
}

function createMinimalPptx(slides, db) {
  const files = new Map()
  files.set('[Content_Types].xml', contentTypesXml(slides))
  files.set('_rels/.rels', relsXml([{ id: 'rId1', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument', target: 'ppt/presentation.xml' }]))
  files.set('ppt/presentation.xml', presentationXml(slides.length))
  files.set('ppt/_rels/presentation.xml.rels', presentationRelsXml(slides.length))
  files.set('ppt/slideMasters/slideMaster1.xml', basicXml('p:sldMaster'))
  files.set('ppt/slideLayouts/slideLayout1.xml', basicXml('p:sldLayout'))
  files.set('ppt/theme/theme1.xml', themeXml())

  const media = []
  slides.forEach((slide, index) => {
    const slideNumber = index + 1
    const rels = [{ id: 'rId1', type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout', target: '../slideLayouts/slideLayout1.xml' }]
    const slideImages = []
    for (const image of slide.images || []) {
      let imgBuffer = null
      let imgMime = ''
      if (image.data) {
        imgBuffer = decodeData(image.data)
        imgMime = image.mime_type || 'image/png'
      } else if (image.attachment_id) {
        const result = readAttachmentBytes(db, image.attachment_id)
        if (result) { imgBuffer = result.buffer; imgMime = result.mimeType }
      }
      if (!imgBuffer || !imgBuffer.length) continue
      const ext = imgMime.includes('jpeg') || imgMime.includes('jpg') ? 'jpg' : 'png'
      const mediaName = `image${media.length + 1}.${ext}`
      files.set(`ppt/media/${mediaName}`, imgBuffer)
      rels.push({ id: `rId${rels.length + 1}`, type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', target: `../media/${mediaName}` })
      slideImages.push({ relId: `rId${rels.length}`, index: slideImages.length })
      media.push(mediaName)
      if (slideImages.length >= 4) break
    }
    files.set(`ppt/slides/slide${slideNumber}.xml`, slideXml(slide.title, slide.lines, slideImages))
    files.set(`ppt/slides/_rels/slide${slideNumber}.xml.rels`, relsXml(rels))
  })
  return makeZip(files)
}

function contentTypesXml(slides) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Default Extension="jpg" ContentType="image/jpeg"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
${slides.map((_, index) => `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}
</Types>`
}

function presentationXml(count) {
  const ids = Array.from({ length: count }, (_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId${count + 1}"/></p:sldMasterIdLst><p:sldIdLst>${ids}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000" type="wide"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`
}

function presentationRelsXml(count) {
  const rels = Array.from({ length: count }, (_, i) => ({ id: `rId${i + 1}`, type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide', target: `slides/slide${i + 1}.xml` }))
  rels.push({ id: `rId${count + 1}`, type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster', target: 'slideMasters/slideMaster1.xml' })
  rels.push({ id: `rId${count + 2}`, type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme', target: 'theme/theme1.xml' })
  return relsXml(rels)
}

function relsXml(rels) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.map(rel => `<Relationship Id="${rel.id}" Type="${rel.type}" Target="${rel.target}"/>`).join('')}</Relationships>`
}

function slideXml(title, lines = [], images = []) {
  const text = [
    textShape(title || '项目勘察表', 500000, 280000, 11200000, 600000, 3000, true),
    ...lines.slice(0, 10).map((line, index) => textShape(line, 650000, 1050000 + index * 430000, 10500000, 320000, 1450, false)),
    ...images.map((img, index) => imageShape(img.relId, 650000 + (index % 2) * 5400000, 3100000 + Math.floor(index / 2) * 1650000, 5000000, 1450000))
  ].join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${text}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
}

function textShape(text, x, y, cx, cy, size, bold) {
  const safe = escapeXml(text)
  const id = Math.floor(Math.random() * 1000000) + 10
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN" sz="${size}"${bold ? ' b="1"' : ''}/><a:t>${safe}</a:t></a:r></a:p></p:txBody></p:sp>`
}

function imageShape(relId, x, y, cx, cy) {
  const id = Math.floor(Math.random() * 1000000) + 100
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Picture"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
}

function basicXml(tag) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><${tag} xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`
}

function themeXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="JianShang"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:srgbClr val="111827"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:accent1><a:srgbClr val="F97316"/></a:accent1></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface="Microsoft YaHei"/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface="Microsoft YaHei"/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"/></a:themeElements></a:theme>`
}

function makeZip(files) {
  const localParts = []
  const centralParts = []
  let offset = 0
  for (const [name, content] of files.entries()) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8')
    const nameBuffer = Buffer.from(name)
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuffer.length, 26)
    local.writeUInt16LE(0, 28)
    localParts.push(local, nameBuffer, data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuffer.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, nameBuffer)
    offset += local.length + nameBuffer.length + data.length
  }
  const central = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(files.size, 8)
  end.writeUInt16LE(files.size, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...localParts, central, end])
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let c = index
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function escapeXml(value) {
  return String(value || '').replace(/[<>&'"]/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[char]))
}

function moneyText(value) {
  const n = Number(value || 0)
  return Number.isFinite(n) && n > 0 ? `￥${n.toFixed(2)}` : '未填写'
}

function percentText(value) {
  const n = Number(value || 0)
  return Number.isFinite(n) && n ? `${(n * 100).toFixed(2)}%` : '未填写'
}

function roundMoney(value) {
  const n = Number(value || 0)
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0
}

function isUserFixableCreateError(err) {
  const message = String(err?.message || '')
  return message.includes('文件类型')
    || message.includes('文件内容为空')
    || message.includes('超过 50MB')
    || message.includes('金额')
}

function buildCreateFailureMessage(err) {
  const message = String(err?.message || '').trim()
  if (!message) return '创建失败：服务器没有返回具体错误，请查看后端日志'
  if (isUserFixableCreateError(err)) return `创建失败：${message}`
  if (/SQLITE|database|no such table|no column|constraint/i.test(message)) {
    return `创建失败：数据库写入异常，技术信息：${message}`
  }
  return `创建失败：${message}`
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
    handover_note: '门店交底备注',
    team_leader: '班组长',
    briefing_date: '班组交底日期',
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
            content: '你是简尚涂装项目工单导入助手。请把门店/渠道交底内容拆分成 JSON 数组，只输出 JSON。字段：name, customer, phone, source, order_taker, order_date, external_order_no, address_province, address_city, address_detail, handover_note, total_amount, needs_construction, needs_stock, stock_note。没有就留空，不要编造。'
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
  if (draft.phone && /1[3-9]\d{9}/.test(draft.phone)) {
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
  return String(name || '班组交底单')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || '班组交底单'
}
