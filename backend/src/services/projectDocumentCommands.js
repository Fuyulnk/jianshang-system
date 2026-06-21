import { deliveryDocumentLabel } from './projectDocumentChain.js'

const DELIVERY_DOCUMENT_TYPES = new Set([
  'survey_initial',
  'survey_recheck',
  'project_payment_request',
  'briefing',
  'material_io',
  'completion_inspection',
  'labor_settlement',
  'cost_check',
  'finance_settlement'
])

const DELIVERY_CONFIRM_RULES = {
  survey_initial: {
    from: ['handover_received', 'survey_pending'],
    targetStatus: 'survey_done',
    roles: ['super_admin', 'admin', 'engineering']
  },
  survey_recheck: {
    from: ['survey_done'],
    targetStatus: 'pre_entry_payment_pending',
    roles: ['super_admin', 'admin', 'engineering']
  },
  project_payment_request: {
    from: ['recheck_done', 'pre_entry_payment_pending'],
    targetStatus: 'payment_received',
    roles: ['super_admin', 'admin', 'finance']
  },
  briefing: {
    from: ['payment_received'],
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

export function normalizeDeliveryDocumentType(value) {
  const text = String(value || '').trim()
  return DELIVERY_DOCUMENT_TYPES.has(text) ? text : ''
}

export function getLatestProjectDocument(db, projectId, documentType) {
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

export function upsertProjectDocument(db, { projectId, documentType, sourceAttachmentId, parsedData, confirmedData, warnings, userId }) {
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

export function syncProjectFromDeliveryDocument(db, project, documentType, data) {
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
  if (documentType === 'project_payment_request') {
    pushProjectUpdate(updates, values, project, 'total_amount', data.summary?.contract_amount)
    pushProjectUpdate(updates, values, project, 'deposit_amount', data.summary?.received_amount)
  }
  if (documentType === 'cost_check') {
    pushProjectUpdate(updates, values, project, 'settlement_amount', data.summary?.revenue_amount)
  }
  if (!updates.length) return
  updates.push("updated_at = datetime('now', 'localtime')")
  values.push(project.id)
  db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`).run(...values)
}

export function confirmDeliveryStep(db, { project, documentType, user }) {
  const rule = deliveryStepConfirmRule(documentType, project)
  if (!rule) throw commandError('当前单据暂不支持直接确认推进', 400)
  if (!canConfirmDeliveryStep(user, rule)) throw commandError('当前角色不能确认这个步骤', 403)

  const doc = getLatestProjectDocument(db, project.id, documentType)
  if (!doc) throw commandError(`请先保存或上传${deliveryDocumentLabel(documentType)}`, 400)

  const guard = validateDeliveryStepConfirmation(db, project, documentType, doc)
  if (!guard.ok) throw commandError(guard.message, 400)

  const currentStatus = String(project.status || '')
  const targetStatus = guard.targetStatus || rule.targetStatus
  const shouldMove = targetStatus && rule.from.includes(currentStatus)
  const confirmedData = buildStepConfirmedData(doc, user)

  const tx = db.transaction(() => {
    upsertProjectDocument(db, {
      projectId: project.id,
      documentType,
      sourceAttachmentId: doc.source_attachment_id,
      parsedData: doc.parsed_data || {},
      confirmedData,
      warnings: doc.warnings || [],
      userId: user.userId
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
        throw commandError('项目状态已被其他请求推进，请刷新后重试', 409, 'PROJECT_STATUS_CONFLICT')
      }
    }
    const label = deliveryDocumentLabel(documentType)
    const statusNote = shouldMove
      ? `项目状态推进到${deliveryStatusLabel(targetStatus)}。`
      : '项目已处于后续阶段，本次只确认单据。'
    addProjectLog(db, project.id, `确认${label}`, user.username,
      `${label}已确认完成；${guard.logExtra || ''}${statusNote}`)
  })
  tx()

  const nextProject = db.prepare('SELECT * FROM projects WHERE id = ?').get(project.id)
  return {
    nextProject,
    shouldMove,
    message: shouldMove ? '当前步骤已完成，项目已进入下一步' : '当前步骤已完成'
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
  return ['handover_received', 'survey_pending'].includes(status) ? 'pre_entry_payment_pending' : 'survey_done'
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
        targetStatus: needsRecheck ? 'survey_done' : 'pre_entry_payment_pending',
        logExtra: needsRecheck ? '结论：需要复尺；' : '结论：无需复尺，已跳过复尺节点并转财务收款单；'
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
  if (documentType === 'project_payment_request') {
    const summary = data.summary || {}
    const request = data.payment_request || {}
    const preEntryAmount = Number(summary.pre_entry_amount || 0)
    const receivedAmount = Number(summary.received_amount || 0)
    const confirmed = !!request.pre_entry_payment_confirmed
      || summary.payment_status === 'pre_entry_paid'
      || (preEntryAmount > 0 && receivedAmount >= preEntryAmount)
    if (!preEntryAmount) return { ok: false, message: '请先填写进场前 90% 收款金额' }
    if (!confirmed) return { ok: false, message: '请先确认门店已收进场前 90% 款项，再进入班组交底' }
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
    if (documentType === 'survey_initial' && guard?.targetStatus === 'pre_entry_payment_pending') {
      updates.push({ field: 'condition_note', value: `无需复尺：${survey.conclusion || '首次工勘确认具备进场条件'}` })
    }
  }
  if (documentType === 'project_payment_request') {
    if (Number(summary.contract_amount || 0)) updates.push({ field: 'total_amount', value: Number(summary.contract_amount || 0) })
    if (Number(summary.received_amount || 0)) updates.push({ field: 'deposit_amount', value: Number(summary.received_amount || 0) })
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

function buildStepConfirmedData(doc, user) {
  const confirmedAt = new Date().toISOString()
  const confirmedData = {
    ...doc.confirmed_data,
    step_confirmed: true,
    step_confirmed_at: confirmedAt,
    step_confirmed_by: user.userId
  }
  if (doc.confirmed_data?.survey) {
    confirmedData.survey = {
      ...doc.confirmed_data.survey,
      step_confirmed: true,
      step_confirmed_at: confirmedAt
    }
  }
  return confirmedData
}

function pushProjectUpdate(updates, values, project, field, value) {
  if (value === undefined || value === null || value === '') return
  if (String(project[field] ?? '') === String(value)) return
  updates.push(`${field} = ?`)
  values.push(value)
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

function deliveryStatusLabel(status) {
  return {
    survey_done: '勘察完成待复尺',
    recheck_done: '复尺完成待收款单',
    pre_entry_payment_pending: '待财务处理项目结算收款单',
    payment_received: '进场款已收，待班组交底',
    briefing_done: '班组交底完成待出库',
    inspection_done: '验收完成待回库',
    material_returned: '回库完成待工费结算',
    labor_settled: '工费结算完成待成本核算',
    cost_checked: '成本核算完成待财务结算',
    finance_settled: '财务结算完成待归档'
  }[status] || status
}

function addProjectLog(db, projectId, action, operator, content) {
  db.prepare('INSERT INTO project_logs (project_id, action, operator, content) VALUES (?, ?, ?, ?)')
    .run(projectId, action, operator || '', content || '')
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

function commandError(message, statusCode, code = '') {
  const err = new Error(message)
  err.statusCode = statusCode
  if (code) err.code = code
  return err
}

function parseJson(value, fallback) {
  try { return JSON.parse(value || '') } catch { return fallback }
}

function toInt(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0
}
