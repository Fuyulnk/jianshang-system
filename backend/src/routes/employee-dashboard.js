import { authMiddleware } from '../middleware/auth.js'

const STATUS_LABELS = {
  info_confirmed:  { phase: 1, label: '信息确认', phaseLabel: '项目前期' },
  survey_done:     { phase: 1, label: '工勘完成', phaseLabel: '项目前期' },
  condition_met:   { phase: 2, label: '条件确认', phaseLabel: '准备阶段' },
  team_assigned:   { phase: 2, label: '班组安排', phaseLabel: '准备阶段' },
  briefing_done:   { phase: 2, label: '开工交底', phaseLabel: '准备阶段' },
  material_out:    { phase: 3, label: '材料出库', phaseLabel: '施工过程' },
  in_progress:     { phase: 3, label: '施工中', phaseLabel: '施工过程' },
  inspection_done: { phase: 3, label: '检查完成', phaseLabel: '施工过程' },
  completed:       { phase: 4, label: '已完工', phaseLabel: '完工验收' },
  material_returned: { phase: 4, label: '材料回库', phaseLabel: '完工验收' },
  settled:         { phase: 4, label: '已结算', phaseLabel: '完工验收' },
  repair_requested: { phase: 5, label: '报修待处理', phaseLabel: '售后服务' },
  repair_assigned:  { phase: 5, label: '维修中', phaseLabel: '售后服务' },
  repair_done:      { phase: 5, label: '维修完成', phaseLabel: '售后服务' },
}

// 每个角色关注的阶段/状态
const ROLE_FOCUS = {
  finance: {
    label: '财务',
    groups: [
      { key: 'payment', label: '待收款', statuses: ['completed', 'material_returned'] },
      { key: 'settle', label: '待结算', statuses: ['settled'] },
    ]
  },
  warehouse: {
    label: '仓管',
    groups: [
      { key: 'prepare', label: '待备料', statuses: ['briefing_done'] },
      { key: 'return', label: '待回库', statuses: ['completed'] },
    ]
  },
  employee: {
    label: '员工',
    groups: [
      { key: 'prepare', label: '待开工', statuses: ['material_out'] },
      { key: 'active', label: '施工中', statuses: ['in_progress'] },
      { key: 'review', label: '待检查/验收', statuses: ['inspection_done'] },
    ]
  },
  super_admin: {
    label: '管理员',
    groups: [
      { key: 'pending', label: '待处理', statuses: ['info_confirmed', 'survey_done', 'condition_met', 'team_assigned', 'briefing_done', 'material_out'] },
      { key: 'active', label: '进行中', statuses: ['in_progress', 'inspection_done'] },
      { key: 'done', label: '待结算', statuses: ['completed', 'material_returned', 'settled'] },
    ]
  }
}

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
    if (['super_admin', 'admin', 'finance', 'warehouse'].includes(role)) {
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
