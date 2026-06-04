import { authMiddleware } from '../middleware/auth.js'
import { canAccessModule, canAccessProjectRecord, getDataScope } from '../utils/permissions.js'

// 项目状态流转规则：V2 对齐总监“门店交接 -> 施工承接 -> 结算归档”流程。
const STATUS_LABELS = {
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
  repair_assigned:  { phase: 6, label: '售后处理中', phaseLabel: '售后处理' },
  repair_done:      { phase: 6, label: '售后已完成', phaseLabel: '售后处理' },
}

const LEGACY_STATUS_ALIASES = {
  info_confirmed: 'handover_received',
  condition_met: 'recheck_done',
  team_assigned: 'recheck_done',
  completed: 'inspection_done',
  settled: 'finance_settled',
  closed: 'archived'
}

const PROJECT_TRANSITIONS = {
  handover_received: { next: 'survey_pending', roles: ['super_admin', 'admin', 'engineering'], required: ['handover'] },
  survey_pending: { next: 'survey_done', roles: ['super_admin', 'admin', 'engineering'], required: ['survey'] },
  survey_done: { next: 'recheck_done', roles: ['super_admin', 'admin', 'engineering'], required: ['condition_note'] },
  recheck_done: { next: 'briefing_done', roles: ['super_admin', 'admin', 'engineering'], required: ['assignee', 'briefing_date'] },
  material_out: { next: 'in_progress', roles: ['super_admin', 'admin', 'engineering', 'employee'], assignedOnly: true, required: ['start_date'] },
  in_progress: { next: 'inspection_done', roles: ['super_admin', 'admin', 'engineering', 'employee'], assignedOnly: true, required: ['construction_note'] },
  inspection_done: { next: 'material_returned', roles: ['super_admin', 'admin', 'warehouse', 'engineering'], required: ['end_date', 'material_return'] },
  material_returned: { next: 'labor_settled', roles: ['super_admin', 'admin', 'finance', 'engineering'] },
  labor_settled: { next: 'cost_checked', roles: ['super_admin', 'admin', 'finance'] },
  cost_checked: { next: 'finance_settled', roles: ['super_admin', 'admin', 'finance'], required: ['settlement_amount'] },
  finance_settled: { next: 'archived', roles: ['super_admin', 'admin', 'finance'] },
  archived: { next: 'repair_requested', roles: ['super_admin', 'admin', 'engineering'] },
  repair_requested: { next: 'repair_assigned', roles: ['super_admin', 'admin', 'engineering'] },
  repair_assigned: { next: 'repair_done', roles: ['super_admin', 'admin', 'engineering'], required: ['construction_note'] },
}

export default function projectRoutes(server, db) {
  // 可分配人员：项目负责人/施工负责人都先绑定系统用户，后续再和员工档案打通。
  server.get('/api/projects/assignees', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    const users = db.prepare(`
      SELECT u.id, u.username, u.real_name, u.department, u.role, r.label as role_label
      FROM users u LEFT JOIN roles r ON u.role = r.name
      WHERE u.role IN ('super_admin', 'admin', 'engineering', 'employee', 'warehouse', 'finance')
      ORDER BY CASE u.role
        WHEN 'super_admin' THEN 1
        WHEN 'admin' THEN 2
        WHEN 'engineering' THEN 3
        WHEN 'employee' THEN 4
        WHEN 'warehouse' THEN 5
        WHEN 'finance' THEN 6
        ELSE 9
      END, u.id ASC
    `).all()
    const activeProjects = db.prepare(`
      SELECT id, name, assignee_user_id, crew_member_user_ids, status, start_date, expected_end_date
      FROM projects
      WHERE status IN (
        'recheck_done', 'team_assigned', 'briefing_done', 'material_requested',
        'material_out', 'in_progress', 'inspection_done'
      )
      ORDER BY updated_at DESC
    `).all()
    const enrichedUsers = users.map(user => {
      const busy = activeProjects.find(project => isUserInProjectCrew(user.id, project))
      return {
        ...user,
        availability_status: busy ? 'busy' : 'available',
        busy_project_id: busy?.id || 0,
        busy_project_name: busy?.name || '',
        busy_until: busy?.expected_end_date || ''
      }
    })
    return { success: true, data: enrichedUsers }
  })

  // 列表
  server.get('/api/projects', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    const userId = request.user.userId
    const { status, phase, keyword } = request.query

    if (!canProjectAccess(db, request.user, 'can_view')) {
      reply.code(403).send({ success: false, message: '无权限查看项目工单' })
      return
    }

    let sql = `
      SELECT p.*, u.username as creator_name,
             mu.username as manager_username, mu.real_name as manager_real_name,
             au.username as assignee_username, au.real_name as assignee_real_name
      FROM projects p
      LEFT JOIN users u ON p.created_by = u.id
      LEFT JOIN users mu ON p.manager_user_id = mu.id
      LEFT JOIN users au ON p.assignee_user_id = au.id
      WHERE 1=1
    `
    const params = []

    if (!canSeeAllProjects(db, request.user)) {
      sql += `
        AND (
          p.created_by = ?
          OR p.manager_user_id = ?
          OR p.assignee_user_id = ?
          OR EXISTS (
            SELECT 1 FROM json_each(COALESCE(p.crew_member_user_ids, '[]'))
            WHERE CAST(value AS INTEGER) = ?
          )
        )
      `
      params.push(userId, userId, userId, userId)
    }

    if (keyword) {
      sql += `
        AND (
          p.name LIKE ? OR p.customer LIKE ? OR p.phone LIKE ?
          OR p.source LIKE ? OR p.order_taker LIKE ? OR p.external_order_no LIKE ?
        )
      `
      const k = `%${keyword}%`
      params.push(k, k, k, k, k, k)
    }

    if (status) {
      const statuses = statusesForStatusFilter(status)
      sql += ` AND p.status IN (${statuses.map(() => '?').join(',')})`
      params.push(...statuses)
    }

    if (phase) {
      const phaseStatuses = statusesForPhase(phase)
      if (phaseStatuses.length) {
        sql += ` AND p.status IN (${phaseStatuses.map(() => '?').join(',')})`
        params.push(...phaseStatuses)
      }
    }

    sql += ' ORDER BY p.created_at DESC LIMIT 200'
    const list = db.prepare(sql).all(...params)

    // 附加状态标签
    const enriched = list.map(decorateProjectStatus)

    return { success: true, data: enriched }
  })

  // 创建
  server.post('/api/projects', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!canProjectAccess(db, request.user, 'can_create')) {
      reply.code(403).send({ success: false, message: '无权限新建项目工单' })
      return
    }
    const userId = request.user.userId
    const {
      name, customer, phone, source, total_amount, deposit_amount,
      manager_user_id, assignee_user_id,
      order_taker, order_date, external_order_no, handover_note
    } = request.body
    if (!name || !customer) return { success: false, message: '项目名称和客户为必填' }
    const address = normalizeAddress(request.body)

    const result = db.prepare(`
      INSERT INTO projects (
        name, customer, phone, address, address_province, address_city, address_detail,
        source, order_taker, order_date, external_order_no, handover_note,
        total_amount, deposit_amount,
        manager_user_id, assignee_user_id, status, created_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      name,
      customer,
      phone || '',
      address.fullAddress,
      address.province,
      address.city,
      address.detail,
      source || '',
      order_taker || '',
      order_date || '',
      external_order_no || '',
      handover_note || '',
      toNumber(total_amount),
      toNumber(deposit_amount),
      toInt(manager_user_id),
      toInt(assignee_user_id),
      'handover_received',
      userId
    )

    addLog(db, result.lastInsertRowid, '创建项目', request.user.username, `创建项目「${name}」- 客户: ${customer}`)
    return { success: true, id: result.lastInsertRowid }
  })

  // 详情
  server.get('/api/projects/:id', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    const project = db.prepare(`
      SELECT p.*, u.username as creator_name,
             mu.username as manager_username, mu.real_name as manager_real_name,
             au.username as assignee_username, au.real_name as assignee_real_name
      FROM projects p
      LEFT JOIN users u ON p.created_by = u.id
      LEFT JOIN users mu ON p.manager_user_id = mu.id
      LEFT JOIN users au ON p.assignee_user_id = au.id
      WHERE p.id = ?
    `).get(request.params.id)
    if (!project) return reply.code(404).send({ success: false, message: '项目不存在' })
    if (!canProjectAccess(db, request.user, 'can_view') || !canSeeProject(db, request.user, project)) {
      reply.code(403).send({ success: false, message: '无权限查看该项目' })
      return
    }

    Object.assign(project, decorateProjectStatus(project))
    project.logs = db.prepare('SELECT * FROM project_logs WHERE project_id = ? ORDER BY created_at DESC LIMIT 50').all(project.id)

    return { success: true, data: project }
  })

  // 更新
  server.put('/api/projects/:id', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(request.params.id)
    if (!project) return reply.code(404).send({ success: false, message: '项目不存在' })
    if (!canSeeProject(db, request.user, project) || !canUpdateProject(db, request.user, project)) {
      reply.code(403).send({ success: false, message: '无权限编辑该项目' })
      return
    }

    const baseFields = ['name', 'customer', 'phone', 'address', 'address_province', 'address_city', 'address_detail', 'source',
      'order_taker', 'order_date', 'external_order_no', 'handover_note',
      'survey_report', 'survey_date',
      'team_leader', 'crew_member_user_ids', 'crew_status', 'briefing_date', 'condition_note',
      'material_out_status', 'material_out_note', 'material_return_status', 'material_return_note',
      'start_date', 'expected_end_date', 'construction_note',
      'end_date', 'acceptance_date', 'total_amount', 'deposit_amount', 'settlement_amount',
      'manager_user_id', 'assignee_user_id']
    const fields = canProjectAccess(db, request.user, 'can_edit')
      ? baseFields
      : ['start_date', 'expected_end_date', 'construction_note', 'end_date', 'crew_status']
    const updates = []
    const vals = []

    for (const f of fields) {
      if (request.body[f] !== undefined) {
        updates.push(`${f} = ?`)
        vals.push(formatFieldValue(f, request.body[f]))
      }
    }

    if (canProjectAccess(db, request.user, 'can_edit') && hasAddressParts(request.body)) {
      const address = normalizeAddress(request.body)
      const addressUpdates = {
        address: address.fullAddress,
        address_province: address.province,
        address_city: address.city,
        address_detail: address.detail
      }
      for (const [field, value] of Object.entries(addressUpdates)) {
        if (!updates.some(item => item.startsWith(`${field} =`))) {
          updates.push(`${field} = ?`)
          vals.push(value)
        }
      }
    }

    if (updates.length > 0) {
      updates.push("updated_at = datetime('now', 'localtime')")
      vals.push(request.params.id)
      db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`).run(...vals)
      addLog(db, project.id, '更新项目', request.user.username, `更新了项目信息`)
    }

    return { success: true }
  })

  // 更新状态（阶段推进）
  server.put('/api/projects/:id/status', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(request.params.id)
    if (!project) return reply.code(404).send({ success: false, message: '项目不存在' })
    if (!canProjectAccess(db, request.user, 'can_view') || !canSeeProject(db, request.user, project)) {
      reply.code(403).send({ success: false, message: '无权限推进该项目' })
      return
    }

    const targetStatus = canonicalProjectStatus(request.body.status)
    if (!STATUS_LABELS[targetStatus]) return { success: false, message: '无效状态' }
    const guard = canAdvanceProject(request.user, project, targetStatus)
    if (!guard.ok) {
      reply.code(403).send({ success: false, message: guard.message })
      return
    }

    db.prepare("UPDATE projects SET status = ?, updated_at = datetime('now', 'localtime') WHERE id = ?").run(targetStatus, project.id)
    addLog(db, project.id, '状态变更', request.user.username,
      `状态更新: ${statusMeta(project.status).label} → ${statusMeta(targetStatus).label}`)

    return { success: true }
  })

  // 删除
  server.delete('/api/projects/:id', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(request.params.id)
    if (!project) return reply.code(404).send({ success: false, message: '项目不存在' })
    if (!canProjectAccess(db, request.user, 'can_delete')) {
      reply.code(403).send({ success: false, message: '无权限删除项目工单' })
      return
    }

    db.prepare('DELETE FROM project_logs WHERE project_id = ?').run(project.id)
    db.prepare('DELETE FROM projects WHERE id = ?').run(project.id)
    return { success: true }
  })

  // 日志
  server.get('/api/projects/:id/logs', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(request.params.id)
    if (!project) return reply.code(404).send({ success: false, message: '项目不存在' })
    if (!canProjectAccess(db, request.user, 'can_view') || !canSeeProject(db, request.user, project)) {
      reply.code(403).send({ success: false, message: '无权限查看该项目日志' })
      return
    }
    const logs = db.prepare('SELECT * FROM project_logs WHERE project_id = ? ORDER BY created_at DESC LIMIT 100').all(request.params.id)
    return { success: true, data: logs }
  })
}

function addLog(db, projectId, action, operator, content) {
  try {
    db.prepare('INSERT INTO project_logs (project_id, action, operator, content) VALUES (?, ?, ?, ?)')
      .run(projectId, action, operator || '', content || '')
  } catch (err) {
    console.warn('写入工程日志失败:', err.message)
  }
}

function canonicalProjectStatus(status) {
  return LEGACY_STATUS_ALIASES[status] || status
}

function statusMeta(status) {
  const canonical = canonicalProjectStatus(status)
  return STATUS_LABELS[canonical] || { phase: 0, label: status || '未知状态', phaseLabel: '' }
}

function decorateProjectStatus(project) {
  const rawStatus = project.status
  const canonicalStatus = canonicalProjectStatus(rawStatus)
  const meta = statusMeta(rawStatus)
  return {
    ...project,
    raw_status: rawStatus,
    status: canonicalStatus,
    status_label: meta.label,
    phase_label: meta.phaseLabel,
    phase: meta.phase
  }
}

function statusesForStatusFilter(status) {
  const canonical = canonicalProjectStatus(status)
  const statuses = new Set([canonical])
  for (const [legacy, target] of Object.entries(LEGACY_STATUS_ALIASES)) {
    if (target === canonical) statuses.add(legacy)
  }
  return [...statuses]
}

function statusesForPhase(phase) {
  const phaseNumber = parseInt(phase)
  const statuses = new Set(
    Object.entries(STATUS_LABELS)
      .filter(([, value]) => value.phase === phaseNumber)
      .map(([key]) => key)
  )
  for (const [legacy, target] of Object.entries(LEGACY_STATUS_ALIASES)) {
    if (STATUS_LABELS[target]?.phase === phaseNumber) statuses.add(legacy)
  }
  return [...statuses]
}

function canSeeAllProjects(db, user) {
  return getDataScope(db, user, 'projects') === 'all'
}

function canSeeProject(db, user, project) {
  return canAccessProjectRecord(db, user, project)
}

function canProjectAccess(db, user, permission) {
  return canAccessModule(db, user, 'projects', permission)
}

function canUpdateProject(db, user, project) {
  if (canProjectAccess(db, user, 'can_edit')) return true
  if (['finance', 'warehouse'].includes(user.role) && canSeeProject(db, user, project)) return true
  return ['employee', 'engineering'].includes(user.role) && isUserInProjectCrew(user.userId, project)
}

function canAdvanceProject(user, project, targetStatus) {
  const currentStatus = canonicalProjectStatus(project.status)
  const transition = PROJECT_TRANSITIONS[currentStatus]
  if (!transition || transition.next !== targetStatus) {
    return { ok: false, message: '只能按项目工单流程顺序推进状态' }
  }

  const roleAllowed = transition.roles.includes(user.role)
  if (!roleAllowed) return { ok: false, message: '当前角色不能执行这一步' }
  if (transition.assignedOnly && ['employee', 'engineering'].includes(user.role) && !isUserInProjectCrew(user.userId, project)) {
    return { ok: false, message: '只有该项目施工人员才能执行这一步' }
  }

  const missing = missingRequired(project, transition.required || [])
  if (missing.length) {
    return { ok: false, message: `请先补全：${missing.join('、')}` }
  }
  return { ok: true }
}

function missingRequired(project, required) {
  const missing = []
  for (const key of required) {
    if (key === 'handover') missing.push(...missingHandoverFields(project))
    if (key === 'survey' && !project.survey_report && !project.survey_date) missing.push('工勘记录或工勘日期')
    if (key === 'assignee' && !project.assignee_user_id && !project.team_leader && !hasCrewMembers(project)) missing.push('施工负责人、班组长或施工成员')
    if (key === 'briefing_date' && !project.briefing_date) missing.push('交底日期')
    if (key === 'condition_note' && !project.condition_note) missing.push('复尺/开工条件复核记录')
    if (key === 'start_date' && !project.start_date) missing.push('开工日期')
    if (key === 'construction_note' && !project.construction_note) missing.push('施工/维修备注')
    if (key === 'end_date' && !project.end_date) missing.push('完工日期')
    if (key === 'material_return' && project.material_return_status !== 'done') missing.push('材料回库状态')
    if (key === 'settlement_amount' && !Number(project.settlement_amount)) missing.push('结算金额')
  }
  return missing
}

function missingHandoverFields(project) {
  const fields = [
    ['source', '来源门店/渠道'],
    ['order_taker', '门店接单人'],
    ['phone', '业主电话'],
    ['address_detail', '详细地址']
  ]
  return fields
    .filter(([field]) => !String(project[field] || '').trim())
    .map(([, label]) => label)
}

function toInt(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0
}

function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function formatFieldValue(field, value) {
  if (['manager_user_id', 'assignee_user_id'].includes(field)) return toInt(value)
  if (['total_amount', 'deposit_amount', 'settlement_amount'].includes(field)) return toNumber(value)
  if (field === 'crew_member_user_ids') return normalizeCrewMemberIds(value)
  return value
}

function normalizeCrewMemberIds(value) {
  if (Array.isArray(value)) return JSON.stringify(value.map(toInt).filter(Boolean))
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return JSON.stringify(parsed.map(toInt).filter(Boolean))
    } catch {}
  }
  return '[]'
}

function hasCrewMembers(project) {
  return parseCrewMemberIds(project.crew_member_user_ids).length > 0
}

function isUserInProjectCrew(userId, project) {
  return project.assignee_user_id === userId || parseCrewMemberIds(project.crew_member_user_ids).includes(userId)
}

function parseCrewMemberIds(value) {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed.map(toInt).filter(Boolean) : []
  } catch {
    return []
  }
}

function hasAddressParts(body) {
  return ['address', 'address_province', 'address_city', 'address_detail'].some(key => body[key] !== undefined)
}

function normalizeAddress(body = {}) {
  const province = cleanText(body.address_province)
  const city = cleanText(body.address_city)
  const detail = cleanText(body.address_detail)
  const composed = [province, city, detail].filter(Boolean).join(' ')
  return {
    province,
    city,
    detail,
    fullAddress: composed || cleanText(body.address)
  }
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : ''
}
