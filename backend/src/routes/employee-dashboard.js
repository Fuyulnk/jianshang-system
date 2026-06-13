import { authMiddleware } from '../middleware/auth.js'
import { canAccessModule, canAccessProjectRecord, getDataScope } from '../utils/permissions.js'

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

// 每个角色关注的阶段/状态
const ROLE_FOCUS = {
  finance: {
    label: '财务',
    groups: [
      { key: 'labor', label: '待工费结算', statuses: ['material_returned'] },
      { key: 'cost', label: '待成本核算', statuses: ['labor_settled'] },
      { key: 'finance', label: '待财务结算', statuses: ['cost_checked'] },
      { key: 'archive', label: '待归档', statuses: ['finance_settled'] },
    ]
  },
  warehouse: {
    label: '仓管',
    groups: [
      { key: 'out', label: '待出库', statuses: ['briefing_done', 'material_requested'] },
      { key: 'return', label: '待回库', statuses: ['inspection_done'] },
      { key: 'stock_alerts', label: '低库存/待盘点', kind: 'stock' },
    ]
  },
  engineering: {
    label: '工程部',
    groups: [
      { key: 'survey', label: '待首勘', statuses: ['handover_received', 'survey_pending'] },
      { key: 'recheck', label: '待二勘/复尺', statuses: ['survey_done'] },
      { key: 'briefing', label: '待交底', statuses: ['recheck_done'] },
      { key: 'onsite', label: '施工中/待收尾验收', statuses: ['material_out', 'in_progress'] },
    ]
  },
  employee: {
    label: '员工',
    groups: [
      { key: 'prepare', label: '待开工', statuses: ['material_out'] },
      { key: 'active', label: '施工中', statuses: ['in_progress'] },
      { key: 'repair', label: '售后处理', statuses: ['repair_assigned'] },
    ]
  },
  super_admin: {
    label: '管理员',
    groups: [
      { key: 'missing', label: '缺资料', kind: 'missing' },
      { key: 'overdue', label: '超期', kind: 'overdue' },
      { key: 'stuck', label: '卡住的工单', kind: 'stuck' },
    ]
  }
}

ROLE_FOCUS.admin = ROLE_FOCUS.super_admin

export default function employeeDashboardRoutes(server, db) {
  // 员工工作台数据
  server.get('/api/employee/dashboard', async (request, reply) => {
    if (authMiddleware(request, reply) === false) return

    const role = request.user.role
    const focus = ROLE_FOCUS[role] || ROLE_FOCUS.employee

    // 获取用户详细信息
    const user = db.prepare(`
      SELECT u.id, u.username, u.role, u.real_name, u.department, u.phone, u.avatar_url
      FROM users u WHERE u.id = ?
    `).get(request.user.userId)

    // 获取项目。普通员工只看和自己相关的项目；仓管/财务/管理层看职责范围内的项目。
    let allProjects
    if (getDataScope(db, request.user, 'projects') === 'all') {
      allProjects = db.prepare(`
        SELECT p.*, au.username as assignee_username, au.real_name as assignee_real_name
        FROM projects p
        LEFT JOIN users au ON p.assignee_user_id = au.id
        ORDER BY p.created_at DESC LIMIT 200
      `).all()
    } else {
      allProjects = db.prepare(`
        SELECT p.*, au.username as assignee_username, au.real_name as assignee_real_name
        FROM projects p
        LEFT JOIN users au ON p.assignee_user_id = au.id
        WHERE p.created_by = ?
           OR p.manager_user_id = ?
           OR p.assignee_user_id = ?
           OR p.survey_user_id = ?
           OR p.recheck_user_id = ?
           OR p.final_inspection_user_id = ?
        ORDER BY p.created_at DESC LIMIT 200
      `).all(
        request.user.userId,
        request.user.userId,
        request.user.userId,
        request.user.userId,
        request.user.userId,
        request.user.userId
      )
    }
    allProjects = allProjects.filter(project => canAccessProjectRecord(db, request.user, project))

    // 按角色关注的分组统计
    const lowStockProducts = focus.groups.some(g => g.kind === 'stock') && canAccessModule(db, request.user, 'products', 'can_view')
      ? db.prepare(`
          SELECT id, name, category, unit, stock, min_stock
          FROM products
          WHERE min_stock > 0 AND stock <= min_stock
          ORDER BY (stock - min_stock) ASC, id ASC
          LIMIT 20
        `).all()
      : []

    const groups = focus.groups.map(g => {
      if (g.kind === 'stock') {
        return {
          key: g.key,
          label: g.label,
          count: lowStockProducts.length,
          kind: 'stock',
          projects: [],
          items: lowStockProducts.map(item => ({
            id: item.id,
            name: item.name,
            meta: `${item.category || '未分类'} · 当前 ${formatStock(item.stock)}${item.unit || ''} / 下限 ${formatStock(item.min_stock)}${item.unit || ''}`
          }))
        }
      }

      const projects = allProjects.filter(p => groupMatchesProject(g, p))
      return {
        key: g.key,
        label: g.label,
        count: projects.length,
        kind: g.kind || 'project',
        projects: projects.map(p => ({
          id: p.id,
          name: p.name,
          customer: p.customer,
          status: p.status,
          status_label: STATUS_LABELS[p.status]?.label || p.status,
          phase: STATUS_LABELS[p.status]?.phase || 0,
          assignee_name: p.assignee_real_name || p.assignee_username || '',
          hint: projectGroupHint(g, p)
        }))
      }
    })

    // 全部统计
    const allCount = allProjects.length
    const phaseCounts = {}
    for (let i = 1; i <= 5; i++) {
      phaseCounts[i] = allProjects.filter(p => STATUS_LABELS[p.status]?.phase === i).length
    }

    return {
      success: true,
      data: {
        user: {
          username: user?.username || request.user.username,
          role: user?.role || role,
          role_label: focus.label,
          real_name: user?.real_name || '',
          department: user?.department || '',
          avatar_url: user?.avatar_url || '',
        },
        groups,
        stats: {
          total: allCount,
          ...phaseCounts,
        }
      }
    }
  })
}

function groupMatchesProject(group, project) {
  if (group.kind === 'missing') return missingProjectFields(project).length > 0
  if (group.kind === 'overdue') return isProjectOverdue(project)
  if (group.kind === 'stuck') return isProjectStuck(project)
  return (group.statuses || []).includes(project.status)
}

function projectGroupHint(group, project) {
  if (group.kind === 'missing') return `缺：${missingProjectFields(project).join('、')}`
  if (group.kind === 'overdue') return `预计完工：${project.expected_end_date || '未填'}`
  if (group.kind === 'stuck') return `最后更新：${String(project.updated_at || project.created_at || '').slice(0, 10) || '未知'}`
  return ''
}

function missingProjectFields(project) {
  const status = String(project.status || '')
  const missing = []
  if (status === 'handover_received') {
    if (!project.source) missing.push('来源')
    if (!project.order_taker) missing.push('门店接单人')
    if (!project.phone) missing.push('电话')
    if (!project.address_detail && !project.address) missing.push('地址')
    if (!project.survey_user_id) missing.push('首勘人员')
  }
  if (status === 'survey_pending') {
    if (!project.survey_user_id) missing.push('首勘人员')
    if (!project.survey_date) missing.push('工勘日期')
    if (!hasText(project.survey_report, 8)) missing.push('工勘记录')
  }
  if (status === 'survey_done') {
    if (!project.recheck_user_id) missing.push('二勘/复尺人员')
    if (!hasText(project.condition_note, 8)) missing.push('复尺记录')
  }
  if (status === 'recheck_done') {
    if (!project.briefing_date) missing.push('交底日期')
    if (!project.assignee_user_id && !project.team_leader && !hasCrewMembers(project)) missing.push('施工负责人/班组')
  }
  if (status === 'material_out') {
    if (!project.start_date) missing.push('开工日期')
    if (!project.expected_end_date) missing.push('预计完工日期')
  }
  if (status === 'in_progress') {
    if (!project.final_inspection_user_id) missing.push('收尾验收人员')
    if (!project.end_date) missing.push('完工日期')
    if (!project.acceptance_date) missing.push('验收日期')
    if (!hasText(project.construction_note, 10)) missing.push('验收记录')
  }
  return missing
}

function isProjectOverdue(project) {
  if (['finance_settled', 'archived', 'repair_done'].includes(project.status)) return false
  if (!project.expected_end_date) return false
  const due = Date.parse(project.expected_end_date)
  if (!Number.isFinite(due)) return false
  return due < startOfToday()
}

function isProjectStuck(project) {
  if (['archived', 'repair_done'].includes(project.status)) return false
  const text = project.updated_at || project.created_at
  const updated = Date.parse(text)
  if (!Number.isFinite(updated)) return false
  return Date.now() - updated > 7 * 24 * 60 * 60 * 1000
}

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function hasText(value, min = 1) {
  return String(value || '').trim().length >= min
}

function hasCrewMembers(project) {
  try {
    const parsed = JSON.parse(project.crew_member_user_ids || '[]')
    return Array.isArray(parsed) && parsed.length > 0
  } catch {
    return false
  }
}

function formatStock(value) {
  const n = Number(value || 0)
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}
