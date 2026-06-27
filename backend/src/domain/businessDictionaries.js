export const DATA_DOMAINS = [
  {
    key: 'identity',
    label: '账号员工',
    tables: ['users', 'employees', 'roles', 'role_permissions'],
    interfaces: ['/api/users', '/api/employees', '/api/roles', '/api/user-menu'],
    factScope: 'employeeFacts'
  },
  {
    key: 'inventory',
    label: '材料库存',
    tables: ['products', 'inventory_movements', 'material_losses'],
    interfaces: ['/api/products', '/api/inventory-movements'],
    factScope: 'inventoryFacts'
  },
  {
    key: 'projects',
    label: '项目工单',
    tables: ['projects', 'project_logs'],
    interfaces: ['/api/projects', '/api/employee/dashboard'],
    factScope: 'projectFacts'
  },
  {
    key: 'project_documents',
    label: '项目单据',
    tables: ['project_documents', 'project_import_batches', 'project_import_items', 'material_requests', 'material_request_items'],
    interfaces: ['/api/projects/:id/delivery-chain', '/api/projects/:id/material-requests'],
    factScope: 'projectDocumentFacts'
  },
  {
    key: 'finance',
    label: '财务流水',
    tables: ['accounts', 'transactions', 'finance_ledger_workbooks', 'finance_ledger_sheets', 'finance_ledger_cells'],
    interfaces: ['/api/accounts', '/api/transactions', '/api/finance/*'],
    factScope: 'financeFacts'
  },
  {
    key: 'files',
    label: '文件附件',
    tables: ['attachments', 'chat_files', 'private_workspaces', 'resource_access_grants', 'access_audit_logs'],
    interfaces: ['/api/files', '/api/files/:id/download'],
    factScope: 'fileFacts'
  }
]

export const PROJECT_STATUS_ALIASES = {
  info_confirmed: 'handover_received',
  condition_met: 'pre_entry_payment_pending',
  team_assigned: 'payment_received',
  completed: 'inspection_done',
  settled: 'finance_settled',
  closed: 'archived'
}

export const PROJECT_STATUS_LABELS = {
  handover_received: { phase: 1, label: '门店交底待核对', phaseLabel: '门店交底/勘察' },
  survey_pending: { phase: 1, label: '待现场勘察', phaseLabel: '门店交底/勘察' },
  survey_done: { phase: 1, label: '勘察完成待复尺', phaseLabel: '门店交底/勘察' },
  recheck_done: { phase: 2, label: '复尺完成待收款单', phaseLabel: '复尺/收款/班组交底' },
  pre_entry_payment_pending: { phase: 2, label: '待财务处理项目结算收款单', phaseLabel: '复尺/收款/班组交底' },
  payment_received: { phase: 2, label: '进场款已收，待班组交底', phaseLabel: '复尺/收款/班组交底' },
  briefing_done: { phase: 2, label: '班组交底完成待出库', phaseLabel: '班组交底/出库' },
  material_requested: { phase: 2, label: '已申请出库', phaseLabel: '班组交底/出库' },
  material_out: { phase: 3, label: '已出库待进场', phaseLabel: '进场/施工/验收' },
  in_progress: { phase: 3, label: '施工中', phaseLabel: '进场/施工/验收' },
  inspection_done: { phase: 3, label: '验收完成待回库', phaseLabel: '进场/施工/验收' },
  material_returned: { phase: 4, label: '回库完成待工费结算', phaseLabel: '回库/工费/成本' },
  labor_settled: { phase: 4, label: '工费结算完成待成本核算', phaseLabel: '回库/工费/成本' },
  cost_checked: { phase: 4, label: '成本核算完成待财务结算', phaseLabel: '回库/工费/成本' },
  finance_settled: { phase: 5, label: '财务结算完成待归档', phaseLabel: '财务/归档' },
  archived: { phase: 5, label: '已归档', phaseLabel: '财务/归档' },
  repair_requested: { phase: 6, label: '售后待安排', phaseLabel: '售后处理' },
  repair_assigned: { phase: 6, label: '售后处理中', phaseLabel: '售后处理' },
  repair_done: { phase: 6, label: '售后已完成', phaseLabel: '售后处理' }
}

export const PROJECT_DOCUMENT_TYPES = [
  { key: 'handover', label: '门店交底单', node: 'handover_received', structured: true },
  { key: 'survey_initial', label: '首勘/首次工勘表', node: 'survey_pending', structured: true },
  { key: 'survey_recheck', label: '二勘/复尺表', node: 'survey_done', structured: true },
  { key: 'project_payment_request', label: '项目结算收款单', node: 'pre_entry_payment_pending', structured: true },
  { key: 'briefing', label: '施工班组交底单', node: 'payment_received', structured: true },
  { key: 'material_io', label: '材料出库/回库单', node: 'briefing_done', structured: true },
  { key: 'completion_inspection', label: '完工验收/内检表', node: 'in_progress', structured: true },
  { key: 'labor_settlement', label: '施工班组工费结算单', node: 'material_returned', structured: true },
  { key: 'cost_check', label: '完工成本核算表', node: 'labor_settled', structured: true },
  { key: 'finance_settlement', label: '财务结算/归档凭证', node: 'cost_checked', structured: true }
]

export const MATERIAL_UNITS = ['桶', '支', '卷', '袋', '套', '把', '个', '米', '平方', '公斤', '升']

export const FINANCE_CATEGORIES = [
  '项目收入',
  '货款',
  '材料采购',
  '工人工资',
  '交通费',
  '报销',
  '税费',
  '手续费',
  '返点支出',
  '生活费',
  '其他'
]

export const ORG_DEPARTMENT_POSITIONS = [
  {
    department: '技术部',
    positions: ['AI开发工程师'],
    registration_allowed: true,
    assignment_note: '负责系统开发、维护和AI能力建设。'
  },
  {
    department: '工程部',
    positions: ['监理'],
    registration_allowed: true,
    assignment_note: '负责首勘、复尺、班组交底、施工跟进和验收等工程节点。'
  },
  {
    department: '财务部',
    positions: ['财务'],
    registration_allowed: true,
    assignment_note: '负责收款单、入账登记、工费、成本核算和财务结算。'
  },
  {
    department: '仓库',
    positions: ['仓管'],
    registration_allowed: true,
    assignment_note: '负责材料出库、回库、库存流水、盘点和低库存处理。'
  },
  {
    department: '样板开发',
    positions: ['样板开发'],
    registration_allowed: true,
    assignment_note: '负责样板开发相关工作，默认不参与项目工单核心流转。'
  }
]

export const AI_TOOL_TIERS = [
  { key: 'L1', label: '查询工具', description: '只读查询数据库事实，不写入业务数据。' },
  { key: 'L2', label: '草稿工具', description: '把自然语言或文件内容整理为草稿，提交前仍需人工确认。' },
  { key: 'L3', label: '确认写入工具', description: '用户明确确认后写入业务数据，必须记录审计。' },
  { key: 'L4', label: '管理工具', description: '修改配置、权限或批量数据，仅管理员可用。' },
  { key: 'L5', label: '命令工具', description: '后期白名单 CLI 能力，当前阶段不开放任意命令。' }
]

export const AI_TOOL_ACTION_TYPES = [
  { key: 'tool_read', label: '只读查询', requires_confirmation: false },
  { key: 'tool_draft', label: '生成草稿', requires_confirmation: false },
  { key: 'tool_write', label: '确认写入', requires_confirmation: true },
  { key: 'tool_admin', label: '管理配置', requires_confirmation: true },
  { key: 'tool_cli', label: '白名单命令', requires_confirmation: true }
]

export const AI_TOOL_RISK_LEVELS = [
  { key: 'low', label: '低风险', description: '只读或低敏摘要，失败不改变业务数据。' },
  { key: 'medium', label: '中风险', description: '可能涉及项目、员工或财务敏感事实，需要权限过滤。' },
  { key: 'high', label: '高风险', description: '会写入或影响关键业务数据，必须用户确认并留下审计。' }
]

export const AI_TOOL_TYPES = AI_TOOL_TIERS.map(tier => ({
  ...tier,
  action_types: AI_TOOL_ACTION_TYPES.map(action => action.key)
}))

export function canonicalProjectStatus(status) {
  return PROJECT_STATUS_ALIASES[status] || status
}

export function projectStatusMeta(status) {
  const canonical = canonicalProjectStatus(status)
  return PROJECT_STATUS_LABELS[canonical] || { phase: 0, label: status || '未知状态', phaseLabel: '' }
}

export function projectStatusesForPhase(phase) {
  const phaseNumber = Number(phase)
  const statuses = new Set(
    Object.entries(PROJECT_STATUS_LABELS)
      .filter(([, meta]) => meta.phase === phaseNumber)
      .map(([status]) => status)
  )
  for (const [legacy, target] of Object.entries(PROJECT_STATUS_ALIASES)) {
    if (PROJECT_STATUS_LABELS[target]?.phase === phaseNumber) statuses.add(legacy)
  }
  return [...statuses]
}

export function projectStatusesForFilter(status) {
  const canonical = canonicalProjectStatus(status)
  const statuses = new Set([canonical])
  for (const [legacy, target] of Object.entries(PROJECT_STATUS_ALIASES)) {
    if (target === canonical) statuses.add(legacy)
  }
  return [...statuses]
}

export function projectNextStep(status) {
  return {
    handover_received: '安排首勘人员，补齐门店交底资料后进入待现场勘察。',
    survey_pending: '首勘人员补齐工勘日期和现场记录，确认首次工勘结论。',
    survey_done: '处理二勘/复尺；如无需复尺，必须填写原因后进入项目结算收款单。',
    recheck_done: '财务根据工勘/复尺资料制作项目结算收款单，并确认总监签字和门店收取进场前 90% 款项。',
    pre_entry_payment_pending: '财务处理项目结算收款单；确认进场款已收后才能进入班组交底。',
    payment_received: '进场款已收，工程确认班组交底单，补齐班组、施工负责人和班组交底日期。',
    briefing_done: '仓库处理材料出库申请并确认出库。',
    material_requested: '仓库核对库存，确认材料出库。',
    material_out: '工程/施工负责人确认开工日期、预计完工日期和进场人员。',
    in_progress: '收尾验收人员确认完工日期、验收日期和验收通过结论。',
    inspection_done: '仓管填写并确认材料回库单。',
    material_returned: '财务/工程确认施工班组工费结算单。',
    labor_settled: '财务确认完工成本核算表。',
    cost_checked: '财务确认财务结算/归档凭证，收款状态需为已收齐。',
    finance_settled: '检查关键单据链完整后归档。',
    archived: '主工程已归档；后续售后单独发起。',
    repair_requested: '安排售后维修负责人。',
    repair_assigned: '记录售后处理结果并关闭售后。',
    repair_done: '售后已完成。'
  }[status] || '按项目工单当前状态补齐缺失资料。'
}
