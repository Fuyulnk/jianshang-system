import { emptyDeliveryDocument } from '../utils/projectDocumentImport.js'

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
    key: 'project_payment_request',
    stage: '收款',
    label: '项目结算收款单',
    desc: '复尺或跳过复尺后由财务制作收款单，确认总监签字、门店收取进场前 90% 款项后才能班组交底。',
    rx: /项目结算|结算收款|收款单|付款单|进场款|90%|尾款/i,
    required: true,
    actions: ['view', 'import', 'sync']
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
  project_payment_request: {
    structured: ['客户', '地址', '结算总金额', '进场前90%金额', '尾款10%', '总监签字状态', '门店收款状态', '收款确认人'],
    attachment_only: ['打印签字原件', '门店收款凭证图片', '财务备注长文本']
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

export function buildProjectDeliveryChain(db, project) {
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

export function deliveryDocumentLabel(type) {
  return DELIVERY_NODE_RULES.find(rule => rule.key === type)?.label || '项目单据'
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
  const payment = docs.project_payment_request?.confirmed_data || {}
  const material = docs.material_io?.confirmed_data?.summary || {}
  const labor = docs.labor_settlement?.confirmed_data?.summary || {}
  const cost = docs.cost_check?.confirmed_data?.summary || {}
  const contractAmount = Number(payment.summary?.contract_amount || briefing.finance?.estimated_total_amount || briefing.construction?.total_amount || project.total_amount || 0)
  const deliveryRevenue = Number(cost.revenue_amount || project.settlement_amount || 0)
  const preEntryAmount = Number(payment.summary?.pre_entry_amount || 0)
  const tailAmount = Number(payment.summary?.tail_amount || 0)
  const receivedAmount = Number(payment.summary?.received_amount || project.deposit_amount || 0)
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
    pre_entry_amount: roundMoney(preEntryAmount),
    tail_amount: roundMoney(tailAmount),
    received_amount: roundMoney(receivedAmount),
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
  if (type === 'project_payment_request') {
    return [
      ['结算总额', moneyText(data.summary?.contract_amount)],
      ['进场款90%', moneyText(data.summary?.pre_entry_amount)],
      ['已收', moneyText(data.summary?.received_amount)],
      ['状态', data.summary?.payment_status === 'pre_entry_paid' ? '进场款已收' : '待确认收款']
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

function parseJson(value, fallback) {
  try { return JSON.parse(value || '') } catch { return fallback }
}

function toInt(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0
}
