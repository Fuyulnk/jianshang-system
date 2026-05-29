import { authMiddleware } from '../middleware/auth.js'

// 项目状态流转规则（各阶段子状态）
const STATUS_LABELS = {
  // 阶段1：项目前期
  info_confirmed:  { phase: 1, label: '信息确认', phaseLabel: '项目前期' },
  survey_done:     { phase: 1, label: '工勘完成', phaseLabel: '项目前期' },
  // 阶段2：准备阶段
  condition_met:   { phase: 2, label: '条件确认', phaseLabel: '准备阶段' },
  team_assigned:   { phase: 2, label: '班组安排', phaseLabel: '准备阶段' },
  briefing_done:   { phase: 2, label: '开工交底', phaseLabel: '准备阶段' },
  // 阶段3：施工过程
  material_out:    { phase: 3, label: '材料出库', phaseLabel: '施工过程' },
  in_progress:     { phase: 3, label: '施工中', phaseLabel: '施工过程' },
  inspection_done: { phase: 3, label: '检查完成', phaseLabel: '施工过程' },
  // 阶段4：完工验收
  completed:       { phase: 4, label: '已完工', phaseLabel: '完工验收' },
  material_returned: { phase: 4, label: '材料回库', phaseLabel: '完工验收' },
  settled:         { phase: 4, label: '已结算', phaseLabel: '完工验收' },
  // 阶段5：售后服务
  repair_requested: { phase: 5, label: '报修待处理', phaseLabel: '售后服务' },
  repair_assigned:  { phase: 5, label: '维修中', phaseLabel: '售后服务' },
  repair_done:      { phase: 5, label: '维修完成', phaseLabel: '售后服务' },
}

const STATUS_ORDER = Object.keys(STATUS_LABELS)

const PROJECT_TRANSITIONS = {
  info_confirmed: { next: 'survey_done', roles: ['super_admin', 'admin'], required: ['survey'] },
  survey_done: { next: 'condition_met', roles: ['super_admin', 'admin', 'finance'] },
  condition_met: { next: 'team_assigned', roles: ['super_admin', 'admin'], required: ['assignee'] },
  team_assigned: { next: 'briefing_done', roles: ['super_admin', 'admin'], required: ['briefing_date'] },
  briefing_done: { next: 'material_out', roles: ['super_admin', 'admin', 'warehouse'] },
  material_out: { next: 'in_progress', roles: ['super_admin', 'admin', 'employee'], assignedOnly: true, required: ['start_date'] },
  in_progress: { next: 'inspection_done', roles: ['super_admin', 'admin', 'employee'], assignedOnly: true, required: ['construction_note'] },
  inspection_done: { next: 'completed', roles: ['super_admin', 'admin'], required: ['end_date'] },
  completed: { next: 'material_returned', roles: ['super_admin', 'admin', 'warehouse'] },
  material_returned: { next: 'settled', roles: ['super_admin', 'admin', 'finance'], required: ['settlement_amount'] },
  settled: { next: 'repair_requested', roles: ['super_admin', 'admin'] },
  repair_requested: { next: 'repair_assigned', roles: ['super_admin', 'admin'] },
  repair_assigned: { next: 'repair_done', roles: ['super_admin', 'admin'], required: ['construction_note'] },
}

export default function projectRoutes(server, db) {
  // 可分配人员：项目负责人/施工负责人都先绑定系统用户，后续再和员工档案打通。
  server.get('/api/projects/assignees', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    const users = db.prepare(`
      SELECT u.id, u.username, u.real_name, u.department, u.role, r.label as role_label
      FROM users u LEFT JOIN roles r ON u.role = r.name
      WHERE u.role IN ('super_admin', 'admin', 'employee', 'warehouse', 'finance')
      ORDER BY CASE u.role
        WHEN 'super_admin' THEN 1
        WHEN 'admin' THEN 2
        WHEN 'employee' THEN 3
        WHEN 'warehouse' THEN 4
        WHEN 'finance' THEN 5
        ELSE 9
      END, u.id ASC
    `).all()
    return { success: true, data: users }
  })

  // 列表
  server.get('/api/projects', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    const userId = request.user.userId
    const { status, phase, keyword } = request.query

    if (!canProjectAccess(db, request.user, 'can_view')) {
      reply.code(403).send({ success: false, message: '无权限查看工程订单' })
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

    if (!canSeeAllProjects(request.user.role)) {
      sql += ' AND (p.created_by = ? OR p.manager_user_id = ? OR p.assignee_user_id = ?)'
      params.push(userId, userId, userId)
    }

    if (keyword) {
      sql += ' AND (p.name LIKE ? OR p.customer LIKE ? OR p.phone LIKE ?)'
      const k = `%${keyword}%`
      params.push(k, k, k)
    }

    if (status) {
      sql += ' AND p.status = ?'
      params.push(status)
    }

    if (phase) {
      const phaseStatuses = Object.entries(STATUS_LABELS)
        .filter(([, v]) => v.phase === parseInt(phase))
        .map(([k]) => k)
      if (phaseStatuses.length) {
        sql += ` AND p.status IN (${phaseStatuses.map(() => '?').join(',')})`
        params.push(...phaseStatuses)
      }
    }

    sql += ' ORDER BY p.created_at DESC LIMIT 200'
    const list = db.prepare(sql).all(...params)

    // 附加状态标签
    const enriched = list.map(p => ({
      ...p,
      status_label: STATUS_LABELS[p.status]?.label || p.status,
      phase_label: STATUS_LABELS[p.status]?.phaseLabel || '',
      phase: STATUS_LABELS[p.status]?.phase || 0,
    }))

    return { success: true, data: enriched }
  })

  // 创建
  server.post('/api/projects', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    if (!canProjectAccess(db, request.user, 'can_create')) {
      reply.code(403).send({ success: false, message: '无权限新建工程订单' })
      return
    }
    const userId = request.user.userId
    const { name, customer, phone, address, source, total_amount, deposit_amount, manager_user_id, assignee_user_id } = request.body
    if (!name || !customer) return { success: false, message: '项目名称和客户为必填' }

    const result = db.prepare(`
      INSERT INTO projects (
        name, customer, phone, address, source, total_amount, deposit_amount,
        manager_user_id, assignee_user_id, created_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      name,
      customer,
      phone || '',
      address || '',
      source || '',
      toNumber(total_amount),
      toNumber(deposit_amount),
      toInt(manager_user_id),
      toInt(assignee_user_id),
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
    if (!canProjectAccess(db, request.user, 'can_view') || !canSeeProject(request.user, project)) {
      reply.code(403).send({ success: false, message: '无权限查看该项目' })
      return
    }

    project.status_label = STATUS_LABELS[project.status]?.label || project.status
    project.phase_label = STATUS_LABELS[project.status]?.phaseLabel || ''
    project.phase = STATUS_LABELS[project.status]?.phase || 0
    project.logs = db.prepare('SELECT * FROM project_logs WHERE project_id = ? ORDER BY created_at DESC LIMIT 50').all(project.id)

    return { success: true, data: project }
  })

  // 更新
  server.put('/api/projects/:id', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(request.params.id)
    if (!project) return reply.code(404).send({ success: false, message: '项目不存在' })
    if (!canSeeProject(request.user, project) || !canUpdateProject(db, request.user, project)) {
      reply.code(403).send({ success: false, message: '无权限编辑该项目' })
      return
    }

    const baseFields = ['name', 'customer', 'phone', 'address', 'source', 'survey_report', 'survey_date',
      'team_leader', 'briefing_date', 'condition_note', 'start_date', 'expected_end_date', 'construction_note',
      'end_date', 'acceptance_date', 'total_amount', 'deposit_amount', 'settlement_amount',
      'manager_user_id', 'assignee_user_id']
    const fields = canProjectAccess(db, request.user, 'can_edit')
      ? baseFields
      : ['start_date', 'expected_end_date', 'construction_note', 'end_date']
    const updates = []
    const vals = []

    for (const f of fields) {
      if (request.body[f] !== undefined) {
        updates.push(`${f} = ?`)
        vals.push(formatFieldValue(f, request.body[f]))
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
    if (!canProjectAccess(db, request.user, 'can_view') || !canSeeProject(request.user, project)) {
      reply.code(403).send({ success: false, message: '无权限推进该项目' })
      return
    }

    const { status } = request.body
    if (!STATUS_LABELS[status]) return { success: false, message: '无效状态' }
    const guard = canAdvanceProject(request.user, project, status)
    if (!guard.ok) {
      reply.code(403).send({ success: false, message: guard.message })
      return
    }

    db.prepare("UPDATE projects SET status = ?, updated_at = datetime('now', 'localtime') WHERE id = ?").run(status, project.id)
    addLog(db, project.id, '状态变更', request.user.username,
      `状态更新: ${STATUS_LABELS[project.status]?.label || project.status} → ${STATUS_LABELS[status]?.label || status}`)

    return { success: true }
  })

  // 删除
  server.delete('/api/projects/:id', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(request.params.id)
    if (!project) return reply.code(404).send({ success: false, message: '项目不存在' })
    if (!canProjectAccess(db, request.user, 'can_delete')) {
      reply.code(403).send({ success: false, message: '无权限删除工程订单' })
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
    if (!canProjectAccess(db, request.user, 'can_view') || !canSeeProject(request.user, project)) {
      reply.code(403).send({ success: false, message: '无权限查看该项目日志' })
      return
    }
    const logs = db.prepare('SELECT * FROM project_logs WHERE project_id = ? ORDER BY created_at DESC LIMIT 100').all(request.params.id)
    return { success: true, data: logs }
  })
}

function addLog(db, projectId, action, operator, content) {
  db.prepare('INSERT INTO project_logs (project_id, action, operator, content) VALUES (?, ?, ?, ?)')
    .run(projectId, action, operator || '', content || '')
}

function canSeeAllProjects(role) {
  return ['super_admin', 'admin', 'finance', 'warehouse'].includes(role)
}

function canSeeProject(user, project) {
  if (canSeeAllProjects(user.role)) return true
  return [project.created_by, project.manager_user_id, project.assignee_user_id].includes(user.userId)
}

function canProjectAccess(db, user, permission) {
  if (['super_admin', 'admin'].includes(user.role)) return true
  const row = db.prepare(`
    SELECT rp.*
    FROM role_permissions rp
    JOIN roles r ON rp.role_id = r.id
    WHERE r.name = ? AND rp.module = 'projects'
  `).get(user.role)
  return !!row?.[permission]
}

function canUpdateProject(db, user, project) {
  if (canProjectAccess(db, user, 'can_edit')) return true
  return user.role === 'employee' && project.assignee_user_id === user.userId
}

function canAdvanceProject(user, project, targetStatus) {
  const transition = PROJECT_TRANSITIONS[project.status]
  if (!transition || transition.next !== targetStatus) {
    return { ok: false, message: '只能按工程流程顺序推进状态' }
  }

  const roleAllowed = transition.roles.includes(user.role)
  if (!roleAllowed) return { ok: false, message: '当前角色不能执行这一步' }
  if (transition.assignedOnly && user.role === 'employee' && project.assignee_user_id !== user.userId) {
    return { ok: false, message: '只有该项目施工负责人才能执行这一步' }
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
    if (key === 'survey' && !project.survey_report && !project.survey_date) missing.push('工勘记录或工勘日期')
    if (key === 'assignee' && !project.assignee_user_id && !project.team_leader) missing.push('施工负责人或班组长')
    if (key === 'briefing_date' && !project.briefing_date) missing.push('交底日期')
    if (key === 'start_date' && !project.start_date) missing.push('开工日期')
    if (key === 'construction_note' && !project.construction_note) missing.push('施工/维修备注')
    if (key === 'end_date' && !project.end_date) missing.push('完工日期')
    if (key === 'settlement_amount' && !Number(project.settlement_amount)) missing.push('结算金额')
  }
  return missing
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
  return value
}
