import * as XLSX from 'xlsx'
import { fileURLToPath } from 'url'
import { dirname, extname, join } from 'path'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import crypto from 'crypto'
import { authMiddleware } from '../middleware/auth.js'
import { canAccessModule, canAccessProjectRecord, getDataScope } from '../utils/permissions.js'
import { buildProjectDraft, emptyDeliveryDocument, missingBriefingFields, parseBriefingDocument, parseDeliveryDocument, parseMaterialOutDocument } from '../utils/projectDocumentImport.js'
import { buildLabelCellUpdates, patchXlsxCells } from '../utils/xlsxTemplateExport.js'
import { getActiveDocumentTemplate } from '../services/documentTemplateService.js'
import { buildProjectDeliveryChain, deliveryDocumentLabel } from '../services/projectDocumentChain.js'
import { confirmDeliveryStep, getLatestProjectDocument, normalizeDeliveryDocumentType, syncProjectFromDeliveryDocument, upsertProjectDocument } from '../services/projectDocumentCommands.js'
import {
  diffDraft,
  missingCoreFields,
  normalizeProjectDraft,
  parseProjectHandoverRows,
  parseProjectHandoverText,
  summarizeRawContent
} from '../utils/projectImport.js'

const AI_ENDPOINT = process.env.AI_ENDPOINT || 'https://api.deepseek.com/chat/completions'
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const UPLOAD_DIR = join(__dirname, '../../data/uploads')
const MAX_FILE_SIZE = 50 * 1024 * 1024
const LARGE_DELIVERY_BODY_LIMIT = 160 * 1024 * 1024
const MAX_MONEY_VALUE = 100000000
const ALLOWED_BRIEFING_ATTACHMENT_EXTS = new Set(['.csv', '.xls', '.xlsx', '.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx', '.ppt', '.pptx'])

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

    const timing = createTimingTracker()
    const { text = '', file_name = '', file_data = '' } = request.body || {}
    if (!String(text || '').trim() && !file_data) return { success: false, message: '请上传门店交底单或粘贴交底内容' }
    try {
      timing.mark('文件读取')
      const parsed = file_data
        ? parseBriefingDocument(file_name, file_data)
        : parseBriefingText(text)
      timing.mark(file_data ? 'Excel解析' : '文本解析')
      const duplicates = findDuplicates(db, parsed.project_draft || {}, request.user)
      timing.mark('重复检查')
      logAiAudit(db, request.user, {
        actionType: 'tool_write',
        toolName: 'parse_project_handover',
        requestSummary: file_name || summarizeRawContent(text, 500),
        resultSummary: `门店交底单识别：${parsed.form_data?.items?.length || 0} 条施工明细；解析方式 local_template；耗时 ${timing.summary()}`,
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
    return { success: true, data: buildProjectDeliveryChain(db, project) }
  })

  server.post('/api/projects/:id/delivery-chain/:type/parse', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(toInt(request.params.id))
    const documentType = normalizeDeliveryDocumentType(request.params.type)
    if (!project || !documentType || !canAccessModule(db, request.user, 'projects', 'can_edit') || !canAccessProjectRecord(db, request.user, project)) {
      reply.code(404).send({ success: false, message: '项目不存在、单据类型无效或无权限' })
      return
    }
    if (!canWriteDeliveryDocument(request.user, documentType)) {
      reply.code(403).send({ success: false, message: deliveryDocumentWriteDeniedMessage(documentType) })
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

  server.post('/api/projects/:id/documents/project-payment-request/import', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(toInt(request.params.id))
    if (!project || !canAccessModule(db, request.user, 'projects', 'can_edit') || !canAccessProjectRecord(db, request.user, project)) {
      reply.code(404).send({ success: false, message: '项目不存在或无权限导入项目结算收款单' })
      return
    }
    if (!canWriteDeliveryDocument(request.user, 'project_payment_request')) {
      reply.code(403).send({ success: false, message: deliveryDocumentWriteDeniedMessage('project_payment_request') })
      return
    }
    const { file_name = '', file_data = '' } = request.body || {}
    if (!file_name || !file_data) return { success: false, message: '请选择项目结算收款单' }
    try {
      const parsed = parseDeliveryDocument('project_payment_request', file_name, file_data)
      return { success: true, data: decorateDeliveryParsedData(project, 'project_payment_request', parsed) }
    } catch (err) {
      reply.code(400).send({ success: false, message: err.message || '项目结算收款单解析失败' })
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
    if (!canWriteDeliveryDocument(request.user, documentType)) {
      reply.code(403).send({ success: false, message: deliveryDocumentWriteDeniedMessage(documentType) })
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
      return { success: true, data: { document_id: tx(), source_attachment_id: attachmentId, chain: buildProjectDeliveryChain(db, db.prepare('SELECT * FROM projects WHERE id = ?').get(project.id)) } }
    } catch (err) {
      reply.code(400).send({ success: false, message: err.message || '保存项目单据失败' })
    }
  })

  server.get('/api/projects/:id/delivery-chain/:type/export', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(toInt(request.params.id))
    const documentType = normalizeDeliveryDocumentType(request.params.type)
    if (!project || !documentType || !canAccessModule(db, request.user, 'projects', 'can_view') || !canAccessProjectRecord(db, request.user, project)) {
      reply.code(404).send({ success: false, message: '项目不存在、单据类型无效或无权限导出' })
      return
    }
    const doc = getLatestProjectDocument(db, project.id, documentType)
    if (!doc) return reply.code(404).send({ success: false, message: '当前项目还没有这张单据' })
    const attachment = getAttachmentFile(db, doc.source_attachment_id)
    const template = attachment ? null : getActiveDocumentTemplate(db, documentType)
    const sourceName = attachment?.original_name || template?.source_file_name || template?.title || ''
    const sourcePath = attachment ? join(UPLOAD_DIR, attachment.stored_name) : template?.source_file_path || ''
    if (!sourcePath) return reply.code(400).send({ success: false, message: '当前单据没有原始 Excel 附件，也没有可用的系统固定模板。' })
    if (!/\.xlsx$/i.test(sourceName || sourcePath || '')) {
      return reply.code(400).send({ success: false, message: '原格式导出第一阶段只支持 .xlsx，旧版 .xls 请先另存为 .xlsx 后重新上传。' })
    }
    try {
      const original = readFileSync(sourcePath)
      const updates = buildProjectDocumentExportUpdates(original, project, documentType, doc.confirmed_data || {})
      const output = patchXlsxCells(original, updates)
      const fileName = `${safeFileName(project.name || project.customer || '项目')}-${deliveryDocumentLabel(documentType)}-原格式导出.xlsx`
      db.prepare(`
        INSERT INTO document_exports (
          project_id, document_type, template_id, source_attachment_id, output_file_name, exported_by
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(project.id, documentType, template?.id || 0, doc.source_attachment_id || 0, fileName, request.user.userId)
      addProjectLog(db, project.id, `导出${deliveryDocumentLabel(documentType)}`, request.user.username,
        `按原始表格格式导出 ${fileName}。`)
      reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`)
        .header('Content-Length', output.length)
        .send(output)
    } catch (err) {
      reply.code(500).send({ success: false, message: err.message || '原格式导出失败' })
    }
  })

  server.post('/api/projects/:id/documents/project-payment-request/confirm', async (request, reply) => {
    request.params.type = 'project_payment_request'
    return server.inject({
      method: 'POST',
      url: `/api/projects/${toInt(request.params.id)}/delivery-chain/project_payment_request/confirm-step`,
      headers: { authorization: request.headers.authorization || '' },
      payload: {}
    }).then(async res => {
      reply.code(res.statusCode)
      try {
        return JSON.parse(res.body || '{}')
      } catch {
        return { success: false, message: res.body || '确认项目结算收款单失败' }
      }
    })
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
      return { success: true, data: { document_id: documentId, source_attachment_id: attachmentId, chain: buildProjectDeliveryChain(db, db.prepare('SELECT * FROM projects WHERE id = ?').get(project.id)) } }
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
      return { success: true, data: { document_id: documentId, chain: buildProjectDeliveryChain(db, db.prepare('SELECT * FROM projects WHERE id = ?').get(project.id)) } }
    } catch (err) {
      reply.code(400).send({ success: false, message: err.message || '上传现场图片失败' })
    }
  })

  server.post('/api/projects/:id/delivery-chain/survey-recheck/skip', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(toInt(request.params.id))
    if (!project || !canAccessModule(db, request.user, 'projects', 'can_edit') || !canAccessProjectRecord(db, request.user, project)) {
      reply.code(404).send({ success: false, message: '项目不存在或无权限跳过复尺' })
      return
    }
    if (!['super_admin', 'admin', 'engineering'].includes(request.user.role)) {
      reply.code(403).send({ success: false, message: '当前角色不能跳过复尺' })
      return
    }
    if (String(project.status || '') !== 'survey_done') {
      reply.code(400).send({ success: false, message: '只有“勘察完成待复尺”的项目才能跳过复尺' })
      return
    }
    const reason = safeText(request.body?.reason || '', 500)
    if (reason.length < 6) {
      reply.code(400).send({ success: false, message: '请填写不少于 6 个字的跳过复尺原因' })
      return
    }
    const confirmedAt = new Date().toISOString()
    const confirmedData = {
      ...emptyDeliveryDocument('survey_recheck', project),
      survey: {
        survey_date: confirmedAt.slice(0, 10),
        surveyor: request.user.username || '',
        surveyor_phone: '',
        conclusion: `无需复尺：${reason}`,
        entry_judgment: 'ready',
        need_recheck: false,
        repair_required: false,
        issues: [],
        image_count: 0,
        images: [],
        skipped: true,
        skip_reason: reason,
        skipped_at: confirmedAt,
        skipped_by: request.user.userId,
        step_confirmed: true,
        step_confirmed_at: confirmedAt
      },
      step_confirmed: true,
      step_confirmed_at: confirmedAt,
      step_confirmed_by: request.user.userId
    }
    try {
      const tx = db.transaction(() => {
        const documentId = upsertProjectDocument(db, {
          projectId: project.id,
          documentType: 'survey_recheck',
          sourceAttachmentId: 0,
          parsedData: { source: 'skip_recheck' },
          confirmedData,
          warnings: ['该项目由人工确认无需复尺，已记录跳过原因。'],
          userId: request.user.userId
        })
        db.prepare(`
          UPDATE projects
          SET status = 'pre_entry_payment_pending',
              condition_note = ?,
              updated_at = datetime('now', 'localtime')
          WHERE id = ? AND status = 'survey_done'
        `).run(`无需复尺/跳过复尺：${reason}`, project.id)
        addProjectLog(db, project.id, '跳过复尺', request.user.username,
          `已记录“无需复尺”，原因：${reason}；单据 #${documentId}；项目转交财务处理项目结算收款单。`)
      })
      tx()
      const nextProject = db.prepare('SELECT * FROM projects WHERE id = ?').get(project.id)
      return { success: true, data: { project_status: nextProject.status, chain: buildProjectDeliveryChain(db, nextProject) } }
    } catch (err) {
      reply.code(400).send({ success: false, message: err.message || '跳过复尺失败' })
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
    try {
      const result = confirmDeliveryStep(db, { project, documentType, user: request.user })
      return {
        success: true,
        data: {
          project_status: result.nextProject.status,
          message: result.message,
          chain: buildProjectDeliveryChain(db, result.nextProject)
        }
      }
    } catch (err) {
      reply.code(err.statusCode || (err.code === 'PROJECT_STATUS_CONFLICT' ? 409 : 400)).send({ success: false, message: err.message || '确认当前步骤失败' })
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

    const timing = createTimingTracker()
    const { text = '', file_name = '', file_data = '', mime_type = '' } = request.body || {}
    const sourceType = file_data ? 'file' : 'text'
    const rawContent = sourceType === 'file'
      ? extractFileContent(file_name, file_data)
      : String(text || '')
    timing.mark('文件读取')
    if (!rawContent.trim()) return { success: false, message: '请粘贴门店交底内容或上传表格' }

    const fallbackDrafts = sourceType === 'file' && looksLikeSpreadsheet(file_name, mime_type)
      ? parseProjectHandoverRows(extractRows(file_name, file_data))
      : parseProjectHandoverText(rawContent)
    timing.mark('本地解析')
    let parserSource = fallbackDrafts.length ? 'local_template' : 'ai'
    let aiDrafts = []
    if (!fallbackDrafts.length) {
      aiDrafts = await parseWithAi(rawContent, db)
      timing.mark('AI调用')
    }
    const drafts = (fallbackDrafts.length ? fallbackDrafts : aiDrafts).map(normalizeProjectDraft)
    timing.mark('字段映射')
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
    timing.mark('数据库写入')

    logAiAudit(db, request.user, {
      actionType: 'tool_write',
      toolName: 'parse_project_handover',
      requestSummary: summarizeRawContent(rawContent, 500),
      resultSummary: `识别 ${items.length} 条工单草稿；解析方式 ${parserSource}；耗时 ${timing.summary()}`,
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
  return ['super_admin', 'admin', 'engineering', 'finance'].includes(user?.role)
}

const DELIVERY_DOCUMENT_WRITE_ROLES = {
  survey_initial: ['engineering'],
  survey_recheck: ['engineering'],
  project_payment_request: ['finance'],
  briefing: ['engineering'],
  material_io: ['warehouse'],
  completion_inspection: ['engineering', 'employee'],
  labor_settlement: ['finance', 'engineering'],
  cost_check: ['finance'],
  finance_settlement: ['finance']
}

function canWriteDeliveryDocument(user, documentType) {
  if (['super_admin', 'admin'].includes(user?.role)) return true
  return (DELIVERY_DOCUMENT_WRITE_ROLES[documentType] || []).includes(user?.role)
}

function deliveryDocumentWriteDeniedMessage(documentType) {
  return `当前岗位不能保存${deliveryDocumentLabel(documentType)}`
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

function getAttachmentFile(db, id) {
  const cleanId = toInt(id)
  if (!cleanId) return null
  const record = db.prepare(`
    SELECT id, original_name, stored_name, mime_type
    FROM attachments
    WHERE id = ? AND COALESCE(deleted_at, '') = ''
  `).get(cleanId)
  if (!record?.stored_name) return null
  const filePath = join(UPLOAD_DIR, record.stored_name)
  try {
    readFileSync(filePath)
    return record
  } catch {
    return null
  }
}

function buildProjectDocumentExportUpdates(originalBuffer, project, documentType, data = {}) {
  if (documentType === 'project_payment_request') {
    const p = data.project || {}
    const req = data.payment_request || {}
    const summary = data.summary || {}
    return buildLabelCellUpdates(originalBuffer, [
      { labels: ['项目名称', '项目'], value: p.project_name || project.name },
      { labels: ['客户姓名', '客户', '业主'], value: p.customer || project.customer },
      { labels: ['客户电话', '电话', '联系方式'], value: p.phone || project.phone },
      { labels: ['详细地址', '项目地址', '地址'], value: p.address || project.address_detail || project.address },
      { labels: ['单源', '来源门店', '来源'], value: p.source || project.source },
      { labels: ['销售顾问', '接单人'], value: req.salesperson || p.order_taker || project.order_taker },
      { labels: ['销售电话'], value: req.sales_phone },
      { labels: ['预计开工时间', '开工时间'], value: req.expected_start_date || project.start_date },
      { labels: ['预计总工期', '总工期'], value: req.expected_duration },
      { labels: ['进入方式'], value: req.entry_method },
      { labels: ['施工总面积', '总面积'], value: req.total_area },
      { labels: ['是否复尺'], value: req.needs_recheck },
      { labels: ['车牌是否需要报备', '车牌报备'], value: req.car_plate_report_required },
      { labels: ['合同金额', '结算金额', '结算总金额', '付款金额', '总金额', '合计'], value: summary.contract_amount },
      { labels: ['90%', '进场款', '进度款', '首款', '预付款'], value: summary.pre_entry_amount },
      { labels: ['10%', '尾款', '质保款'], value: summary.tail_amount },
      { labels: ['已收', '收到', '收款确认'], value: summary.received_amount },
      { labels: ['备注', '说明', '其他事项说明'], value: req.note }
    ])
  }
  const p = data.project || {}
  return buildLabelCellUpdates(originalBuffer, [
    { labels: ['项目名称', '项目'], value: p.project_name || project.name },
    { labels: ['客户姓名', '客户', '业主'], value: p.customer || project.customer },
    { labels: ['客户电话', '电话', '联系方式'], value: p.phone || project.phone },
    { labels: ['详细地址', '项目地址', '地址'], value: p.address || project.address_detail || project.address }
  ])
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
    return '创建失败：数据库写入异常，请联系管理员'
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

function createTimingTracker() {
  const start = Date.now()
  let last = start
  const parts = []
  return {
    mark(label) {
      const now = Date.now()
      parts.push(`${label}${now - last}ms`)
      last = now
    },
    summary() {
      const total = Date.now() - start
      return `${parts.join(' / ')} / 总计${total}ms`
    }
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
