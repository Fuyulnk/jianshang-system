import { authMiddleware } from '../middleware/auth.js'
import { canAccessProjectRecord, getDataScope } from '../utils/permissions.js'

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
      { key: 'labor', label: '待工费/成本', statuses: ['material_returned', 'labor_settled'] },
      { key: 'finance', label: '待财务结算', statuses: ['cost_checked'] },
      { key: 'archive', label: '待归档', statuses: ['finance_settled'] },
    ]
  },
  warehouse: {
    label: '仓管',
    groups: [
      { key: 'out', label: '待出库', statuses: ['briefing_done', 'material_requested'] },
      { key: 'return', label: '待回库', statuses: ['inspection_done'] },
    ]
  },
  engineering: {
    label: '工程部',
    groups: [
      { key: 'handover', label: '待交接/工勘', statuses: ['handover_received', 'survey_pending', 'survey_done'] },
      { key: 'briefing', label: '待交底', statuses: ['recheck_done'] },
      { key: 'onsite', label: '待进场/施工', statuses: ['material_out', 'in_progress'] },
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
      { key: 'handover', label: '交接/工勘阻塞', statuses: ['handover_received', 'survey_pending', 'survey_done', 'recheck_done'] },
      { key: 'warehouse', label: '仓库/施工阻塞', statuses: ['briefing_done', 'material_requested', 'material_out', 'in_progress', 'inspection_done'] },
      { key: 'finance', label: '结算/归档阻塞', statuses: ['material_returned', 'labor_settled', 'cost_checked', 'finance_settled'] },
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
        WHERE p.created_by = ? OR p.manager_user_id = ? OR p.assignee_user_id = ?
        ORDER BY p.created_at DESC LIMIT 200
      `).all(request.user.userId, request.user.userId, request.user.userId)
    }
    allProjects = allProjects.filter(project => canAccessProjectRecord(db, request.user, project))

    // 按角色关注的分组统计
    const groups = focus.groups.map(g => {
      const projects = allProjects.filter(p => g.statuses.includes(p.status))
      return {
        key: g.key,
        label: g.label,
        count: projects.length,
        projects: projects.map(p => ({
          id: p.id,
          name: p.name,
          customer: p.customer,
          status: p.status,
          status_label: STATUS_LABELS[p.status]?.label || p.status,
          phase: STATUS_LABELS[p.status]?.phase || 0,
          assignee_name: p.assignee_real_name || p.assignee_username || '',
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
