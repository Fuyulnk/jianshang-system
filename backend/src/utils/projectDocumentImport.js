import * as XLSX from 'xlsx'

const KNOWN_LABELS = [
  '单源', '接单时间', '销售顾问', '销售电话', '客户姓名', '客户电话', '详细地址',
  '预计开工时间', '预计总工期', '进入方式', '施工总面积', '是否复尺',
  '车牌是否需要报备', '其他事项说明', '项目名称', '合同编号', '门店单号',
  '基层情况', '基层工艺工法', '是否高空作业', '是否需要脚手架', '二次搬运',
  '室内基本状况', '是否具备进场条件', '交底人', '确认人'
]

const BRIEFING_FIELD_DEFS = [
  { key: 'source', label: '来源门店/渠道', source: '单源' },
  { key: 'order_taker', label: '门店接单人', source: '销售顾问' },
  { key: 'order_date', label: '接单日期', source: '接单时间' },
  { key: 'customer', label: '业主/客户', source: '客户姓名' },
  { key: 'phone', label: '业主联系方式', source: '客户电话' },
  { key: 'address_detail', label: '详细地址', source: '详细地址' },
  { key: 'team_leader', label: '班组长', source: '其他事项说明' },
  { key: 'briefing_date', label: '班组交底日期', source: '接单时间推断', inferred: true, caution: '表内没有独立班组交底日期，只能按接单时间推断；必须单独勾选确认后才会写入。' }
]

export function parseBriefingDocument(fileName = '', fileData = '') {
  if (!looksLikeSpreadsheet(fileName)) {
    return { fields: [], items: [], warnings: ['门店交底单 V1 只支持 CSV / XLS / XLSX'] }
  }

  const workbook = XLSX.read(decodeData(fileData), { type: 'buffer' })
  const sheetName = pickBriefingSheet(workbook)
  if (!sheetName) return { fields: [], items: [], warnings: ['表格内没有可读取的工作表'] }

  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    defval: '',
    blankrows: false,
    raw: false
  })
  const salesSheetName = workbook.SheetNames.find(name => /销售|报价/.test(name)) || ''
  const salesRows = salesSheetName
    ? XLSX.utils.sheet_to_json(workbook.Sheets[salesSheetName], {
        header: 1,
        defval: '',
        blankrows: false,
        raw: false
      })
    : []

  const raw = parseBriefingRows(rows, salesRows, countEmbeddedMedia(fileData))
  const formData = buildBriefingForm(raw, fileName)
  const projectDraft = buildProjectDraft(formData)
  const fields = BRIEFING_FIELD_DEFS.map(def => ({
    key: def.key,
    label: def.label,
    source: def.source,
    value: normalizeField(def.key, projectDraft[def.key] || raw[def.key] || ''),
    inferred: !!def.inferred,
    caution: def.caution || ''
  }))

  const warnings = []
  if (!projectDraft.customer) warnings.push('未识别到客户姓名')
  if (!projectDraft.address_detail) warnings.push('未识别到详细地址')
  if (!raw.items.length) warnings.push('未识别到施工项目明细')
  if (raw.phone_source && !raw.phone) warnings.push(raw.phone_source)
  const fileDate = extractFileDate(fileName)
  if (fileDate && raw.order_date && fileDate !== raw.order_date) {
    warnings.push(`文件名日期 ${fileDate} 与表内日期 ${raw.order_date} 不一致，请人工确认后再写入。`)
  }

  return {
    document_type: 'briefing',
    document_label: '门店交底单',
    file_name: fileName,
    sheet_name: sheetName,
    project_draft: projectDraft,
    form_data: formData,
    missing_fields: missingBriefingFields(projectDraft, formData),
    fields,
    items: raw.items,
    summary: raw.summary,
    warnings
  }
}

export function parseMaterialOutDocument(fileName = '', fileData = '') {
  if (!looksLikeSpreadsheet(fileName)) {
    return { items: [], warnings: ['材料出库表 V1 只支持 CSV / XLS / XLSX'] }
  }

  const workbook = XLSX.read(decodeData(fileData), { type: 'buffer' })
  const sheetName = workbook.SheetNames[0] || ''
  if (!sheetName) return { items: [], warnings: ['表格内没有可读取的工作表'] }

  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    defval: '',
    blankrows: false,
    raw: false
  })
  const parsed = parseMaterialOutRows(rows)
  const warnings = []
  if (!parsed.project_name) warnings.push('未识别到项目名称')
  if (!parsed.items.length) warnings.push('未识别到材料出库明细')

  return {
    document_type: 'material_out',
    document_label: '材料出库表',
    file_name: fileName,
    sheet_name: sheetName,
    fields: [],
    items: parsed.items,
    summary: parsed.summary,
    warnings
  }
}

export function parseDeliveryDocument(documentType = '', fileName = '', fileData = '') {
  if (documentType === 'briefing') {
    const parsed = parseBriefingDocument(fileName, fileData)
    return { ...parsed, document_label: deliveryDocumentLabel(documentType) }
  }
  if (documentType === 'material_io') return parseMaterialIoDocument(fileName, fileData)
  if (documentType === 'labor_settlement') return parseLaborSettlementDocument(fileName, fileData)
  if (documentType === 'cost_check') return parseCostCheckDocument(fileName, fileData)
  return {
    document_type: documentType,
    document_label: deliveryDocumentLabel(documentType),
    file_name: fileName,
    fields: [],
    items: [],
    confirmed_data: emptyDeliveryDocument(documentType),
    summary: {},
    warnings: ['该单据类型暂只支持保存附件和手动录入。']
  }
}

export function emptyDeliveryDocument(documentType = '', project = {}) {
  const base = {
    project: {
      project_name: clean(project.name),
      customer: clean(project.customer),
      phone: clean(project.phone),
      address: clean(project.address || [project.address_province, project.address_city, project.address_detail].filter(Boolean).join('')),
      source: clean(project.source),
      order_taker: clean(project.order_taker)
    }
  }
  if (documentType === 'survey_initial' || documentType === 'survey_recheck' || documentType === 'completion_inspection') {
    return {
      ...base,
      survey: {
        survey_date: documentType === 'completion_inspection' ? clean(project.acceptance_date) : clean(project.survey_date),
        surveyor: '',
        surveyor_phone: '',
        conclusion: documentType === 'completion_inspection' ? clean(project.construction_note) : clean(project.survey_report),
        entry_judgment: '',
        need_recheck: false,
        repair_required: false,
        issues: [],
        image_count: 0
      }
    }
  }
  if (documentType === 'material_io') {
    return { ...base, items: [], summary: { material_fee: 0, auxiliary_fee: 0, tool_fee: 0, transport_fee: 0, total_cost: 0 } }
  }
  if (documentType === 'labor_settlement') {
    return { ...base, items: [], summary: { start_date: clean(project.start_date), end_date: clean(project.end_date), total_area: 0, labor_fee: 0, work_note: '' } }
  }
  if (documentType === 'cost_check') {
    return {
      ...base,
      cost_items: [],
      summary: {
        revenue_amount: Number(project.settlement_amount || 0),
        labor_fee: 0,
        material_fee: 0,
        auxiliary_fee: 0,
        tool_fee: 0,
        transport_fee: 0,
        total_cost: 0,
        gross_profit: 0,
        profit_rate: 0,
        control_result: ''
      }
    }
  }
  if (documentType === 'finance_settlement') {
    return {
      ...base,
      summary: {
        contract_amount: Number(project.total_amount || 0),
        delivery_revenue: Number(project.settlement_amount || 0),
        received_amount: Number(project.deposit_amount || 0),
        unpaid_amount: 0,
        finance_note: ''
      }
    }
  }
  return base
}

function parseMaterialIoDocument(fileName = '', fileData = '') {
  const parsed = parseMaterialOutDocument(fileName, fileData)
  const summary = parsed.summary || {}
  return {
    ...parsed,
    document_type: 'material_io',
    document_label: '材料出库单',
    confirmed_data: {
      project: { project_name: summary.project_name || '' },
      items: parsed.items || [],
      summary: summary.cost_summary || {
        material_fee: Number(summary.total_amount || 0),
        auxiliary_fee: 0,
        tool_fee: 0,
        transport_fee: 0,
        total_cost: Number(summary.total_amount || 0)
      }
    }
  }
}

function parseLaborSettlementDocument(fileName = '', fileData = '') {
  if (!looksLikeSpreadsheet(fileName)) {
    return { document_type: 'labor_settlement', document_label: '施工班组工费结算单', items: [], warnings: ['工费结算单只支持 CSV / XLS / XLSX'] }
  }
  const workbook = XLSX.read(decodeData(fileData), { type: 'buffer' })
  const sheetName = workbook.SheetNames[0] || ''
  const rows = sheetName ? XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', blankrows: false, raw: false }) : []
  const parsed = parseLaborRows(rows)
  return {
    document_type: 'labor_settlement',
    document_label: '施工班组工费结算单',
    file_name: fileName,
    sheet_name: sheetName,
    items: parsed.items,
    summary: parsed.summary,
    confirmed_data: parsed,
    warnings: parsed.summary.labor_fee ? [] : ['未识别到工费合计，请人工确认。']
  }
}

function parseCostCheckDocument(fileName = '', fileData = '') {
  if (!looksLikeSpreadsheet(fileName)) {
    return { document_type: 'cost_check', document_label: '完工成本核算表', items: [], warnings: ['成本核算表只支持 CSV / XLS / XLSX'] }
  }
  const workbook = XLSX.read(decodeData(fileData), { type: 'buffer' })
  const sheetName = workbook.SheetNames[0] || ''
  const rows = sheetName ? XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', blankrows: false, raw: false }) : []
  const parsed = parseCostRows(rows)
  return {
    document_type: 'cost_check',
    document_label: '完工成本核算表',
    file_name: fileName,
    sheet_name: sheetName,
    items: parsed.cost_items,
    summary: parsed.summary,
    confirmed_data: parsed,
    warnings: parsed.summary.total_cost ? [] : ['未识别到成本合计，请人工确认。']
  }
}

function parseBriefingRows(rows, salesRows = [], embeddedImageCount = 0) {
  const source = findValue(rows, '单源')
  const orderDate = normalizeDate(findValue(rows, '接单时间'))
  const customer = findValue(rows, '客户姓名')
  const phone = normalizePhone(findValue(rows, '客户电话'))
  const salesPhone = normalizePhone(findValue(rows, '销售电话'))
  const addressDetail = findValue(rows, '详细地址')
  const totalArea = normalizeNumber(findValue(rows, '施工总面积'))
  const remeasure = findValue(rows, '是否复尺')
  const entryMethod = findValue(rows, '进入方式')
  const plateNeeded = findValue(rows, '车牌是否需要报备')
  const expectedStartDate = normalizeDate(findValue(rows, '预计开工时间'))
  const expectedDuration = findValue(rows, '预计总工期')
  const handoverNote = findValue(rows, '其他事项说明')
  const finance = extractFinanceNotes(rows, salesRows)
  const teamLeader = extractTeamLeader(rows)
  const items = extractConstructionItems(rows)
  const quotationItems = extractQuotationItems(salesRows)
  const siteContact = extractSiteContact(entryMethod)
  const estimatedTotalAmount = extractAmount(handoverNote)
  const itemSummary = items.map(item => {
    const parts = [item.space_name, item.texture_name, item.process, item.color_no].filter(Boolean).join('/')
    const area = item.actual_area || item.planned_area
    return `${parts}${area ? ` ${area}m²` : ''}`
  }).filter(Boolean).join('；')

  return {
    source,
    order_taker: findValue(rows, '销售顾问'),
    order_date: orderDate,
    customer,
    phone,
    sales_phone: salesPhone,
    phone_source: !phone && salesPhone ? `客户联系方式为空，表内销售电话为 ${salesPhone}，未自动写入业主联系方式。` : '',
    address_detail: addressDetail,
    external_order_no: findValue(rows, '门店单号') || findValue(rows, '合同编号'),
    handover_note: handoverNote,
    team_leader: teamLeader,
    briefing_date: orderDate,
    expected_start_date: expectedStartDate,
    expected_duration: expectedDuration,
    estimated_total_amount: estimatedTotalAmount,
    finance,
    total_area: totalArea,
    entry_method: entryMethod,
    site_contact_name: siteContact.name,
    site_contact_phone: siteContact.phone,
    remeasure,
    plate_needed: plateNeeded,
    base_condition: findValue(rows, '基层情况') || findValue(rows, '基层工艺工法'),
    high_work: findValue(rows, '是否高空作业'),
    scaffold: findValue(rows, '是否需要脚手架'),
    second_transfer: findValue(rows, '二次搬运'),
    site_status: findValue(rows, '室内基本状况'),
    entry_condition: findValue(rows, '是否具备进场条件'),
    briefer: findValue(rows, '交底人'),
    confirmer: findValue(rows, '确认人'),
    items,
    quotation_items: quotationItems,
    images: {
      embedded_count: embeddedImageCount,
      note: embeddedImageCount ? `原始 Excel 内含 ${embeddedImageCount} 张图片，当前作为原始附件保留。` : '原始 Excel 未检测到内嵌图片。'
    },
    summary: {
      total_area: totalArea,
      remeasure,
      entry_method: entryMethod,
      plate_needed: plateNeeded,
      item_summary: itemSummary
    }
  }
}

function buildBriefingForm(raw, fileName) {
  const amount = raw.items.reduce((sum, item) => sum + Number(item.subtotal || 0), 0)
  const totalAmount = raw.estimated_total_amount || amount
  return {
    basic: {
      source: clean(raw.source),
      order_taker: clean(raw.order_taker),
      order_date: raw.order_date || '',
      customer: clean(raw.customer),
      phone: clean(raw.phone),
      address_province: '',
      address_city: '',
      address_detail: clean(raw.address_detail),
      external_order_no: clean(raw.external_order_no),
      handover_note: clean(raw.handover_note)
    },
    construction: {
      expected_start_date: raw.expected_start_date || '',
      expected_duration: clean(raw.expected_duration),
      entry_method: clean(raw.entry_method),
      total_area: raw.total_area || 0,
      remeasure: clean(raw.remeasure),
      plate_needed: clean(raw.plate_needed),
      team_leader: clean(raw.team_leader),
      briefing_date: raw.briefing_date || '',
      total_amount: Number(totalAmount.toFixed(2))
    },
    finance: {
      estimated_total_amount: raw.finance?.estimated_total_amount || raw.estimated_total_amount || 0,
      received_summary: clean(raw.finance?.received_summary),
      unpaid_summary: clean(raw.finance?.unpaid_summary),
      rebate_note: clean(raw.finance?.rebate_note),
      pricing_note: clean(raw.finance?.pricing_note),
      raw_lines: raw.finance?.raw_lines || []
    },
    site: {
      base_condition: clean(raw.base_condition),
      high_work: clean(raw.high_work),
      scaffold: clean(raw.scaffold),
      second_transfer: clean(raw.second_transfer),
      entry_condition: clean(raw.entry_condition),
      site_status: clean(raw.site_status),
      site_contact_name: clean(raw.site_contact_name),
      site_contact_phone: clean(raw.site_contact_phone)
    },
    items: raw.items || [],
    quotation_items: raw.quotation_items || [],
    images: {
      embedded_count: raw.images?.embedded_count || 0,
      note: clean(raw.images?.note),
      attachment_note: raw.images?.embedded_count ? '图片暂随原始 Excel 附件保存；后续可单独上传现场图片/工艺参考图。' : '可在工单附件中单独上传现场图片、工艺参考图或签字图片。'
    },
    signatures: {
      briefer: clean(raw.briefer),
      confirmer: clean(raw.confirmer),
      confirmed_at: '',
      source_file: clean(fileName)
    }
  }
}

export function buildProjectDraft(formData = {}) {
  const basic = formData.basic || {}
  const construction = formData.construction || {}
  const address = [basic.address_province, basic.address_city, basic.address_detail].filter(Boolean).join(' ')
  const projectNameBase = basic.customer || basic.address_detail || basic.source || '未命名'
  return {
    name: `${projectNameBase} 项目工单`.slice(0, 80),
    customer: clean(basic.customer),
    phone: normalizePhone(basic.phone),
    address,
    address_province: clean(basic.address_province),
    address_city: clean(basic.address_city),
    address_detail: clean(basic.address_detail),
    source: clean(basic.source),
    order_taker: clean(basic.order_taker),
    order_date: normalizeDate(basic.order_date),
    external_order_no: clean(basic.external_order_no),
    handover_note: clean(basic.handover_note),
    team_leader: clean(construction.team_leader),
    briefing_date: normalizeDate(construction.briefing_date),
    total_amount: Number(construction.total_amount || 0)
  }
}

export function missingBriefingFields(projectDraft = {}, formData = {}) {
  const checks = [
    ['source', '来源门店/渠道'],
    ['order_taker', '门店接单人'],
    ['customer', '客户姓名'],
    ['phone', '业主联系方式'],
    ['address_detail', '详细地址']
  ]
  const missing = checks
    .filter(([field]) => !String(projectDraft[field] || '').trim())
    .map(([, label]) => label)
  if (!Array.isArray(formData.items) || !formData.items.length) missing.push('施工项目明细')
  return missing
}

function findValue(rows, label) {
  for (const row of rows) {
    for (let col = 0; col < row.length; col++) {
      if (clean(row[col]) !== label) continue
      for (let next = col + 1; next < Math.min(row.length, col + 5); next++) {
        const value = clean(row[next])
        if (!value) continue
        if (KNOWN_LABELS.includes(value)) break
        return value
      }
    }
  }
  return ''
}

function extractTeamLeader(rows) {
  for (const row of rows) {
    const text = row.map(clean).filter(Boolean).join(' ')
    const match = text.match(/施工班组\s*[:：]\s*([^\s；;，,]+)/)
    if (match?.[1]) return clean(match[1])
  }
  return ''
}

function extractConstructionItems(rows) {
  const headerIndex = rows.findIndex(row => row.some(cell => clean(cell) === '空间名称') && row.some(cell => /纹理名称/.test(clean(cell))))
  if (headerIndex < 0) return []
  const items = []
  for (const row of rows.slice(headerIndex + 1)) {
    const joined = row.map(clean).join(' ')
    if (/施工金额合计|其他事项说明|客户签字/.test(joined)) break
    const item = {
      space_name: clean(row[1]),
      texture_name: clean(row[2]),
      process: clean(row[3]),
      color_no: clean(row[4]),
      planned_area: normalizeNumber(row[5]),
      actual_area: normalizeNumber(row[6]),
      unit_price: normalizeNumber(row[7]),
      subtotal: normalizeNumber(row[8]),
      remark: clean(row[9])
    }
    if (Object.values(item).some(value => String(value || '').trim())) items.push(item)
  }
  return items.slice(0, 80)
}

function extractQuotationItems(rows) {
  if (!rows.length) return []
  const items = []
  for (const row of rows) {
    const joined = row.map(clean).filter(Boolean).join(' ')
    if (/合计|小计|备注：|签字/.test(joined)) continue
    const seq = clean(row[0])
    if (!/^\d+$/.test(seq)) continue
    const item = {
      area_group: clean(row[1]),
      position: clean(row[2]),
      product_en: clean(row[3]),
      product_name: clean(row[4]),
      process: clean(row[5]),
      color_no: clean(row[6]),
      area: normalizeNumber(row[7]),
      list_unit_price: normalizeNumber(row[8]),
      discount_unit_price: normalizeNumber(row[9]),
      list_amount: normalizeNumber(row[10]),
      final_amount: normalizeNumber(row[11])
    }
    if (item.position || item.product_name || item.area || item.final_amount) items.push(item)
  }
  return items.slice(0, 120)
}

function extractFinanceNotes(rows, salesRows = []) {
  const lines = []
  const startIndex = rows.findIndex(row => row.some(cell => clean(cell) === '其他事项说明'))
  if (startIndex >= 0) {
    for (const row of rows.slice(startIndex, startIndex + 8)) {
      const text = row.map(clean).filter(Boolean).filter(item => item !== '其他事项说明').join(' ')
      if (!text) continue
      if (/客户签字|销售顾问签字|工程总监签字/.test(text)) break
      lines.push(text)
    }
  }
  for (const row of salesRows) {
    const text = row.map(clean).filter(Boolean).join(' ')
    if (/合计总金额|多退少补|报价不含税/.test(text)) lines.push(text)
  }

  const joined = lines.join('\n')
  return {
    estimated_total_amount: extractAmount(joined),
    received_summary: pickLine(lines, /已收款|已付|已支付/),
    unpaid_summary: pickLine(lines, /未收款|未付|尾款/),
    rebate_note: pickLine(lines, /返点|返款|退款/),
    pricing_note: pickLine(lines, /多退少补|报价不含税|预估/),
    raw_lines: lines
  }
}

function parseMaterialOutRows(rows) {
  const projectName = findValue(rows, '项目名称')
  const items = []
  let currentCategory = '材料'

  for (const row of rows) {
    const categoryCell = clean(row[0])
    if (/材\s*料\s*清\s*单/.test(categoryCell)) currentCategory = '材料'
    if (/辅\s*材/.test(categoryCell)) currentCategory = '辅材'
    if (/工\s*具/.test(categoryCell)) currentCategory = '工具'
    if (/合计|总计|运输费|收货人/.test(row.map(clean).join(' '))) continue

    const name = clean(row[3])
    if (!name || name === '材料名') continue
    const item = {
      category: currentCategory,
      out_date: normalizeDate(clean(row[2])),
      material_name: name,
      unit: clean(row[4]),
      out_quantity: normalizeNumber(row[5]),
      return_quantity: normalizeNumber(row[6]),
      return_date: normalizeDate(clean(row[7])),
      usage_quantity: normalizeNumber(row[8]),
      unit_price: normalizeNumber(row[9]),
      amount: normalizeNumber(row[10]),
      remark: clean(row[11])
    }
    if (item.out_quantity || item.return_quantity || item.amount || item.remark) items.push(item)
  }

  const totals = items.reduce((acc, item) => {
    acc.amount += Number(item.amount || 0)
    acc.out_quantity += Number(item.out_quantity || 0)
    if (!acc.categories.includes(item.category)) acc.categories.push(item.category)
    return acc
  }, { amount: 0, out_quantity: 0, categories: [] })

  return {
    project_name: projectName,
    items: items.slice(0, 120),
    summary: {
      project_name: projectName,
      item_count: items.length,
      categories: totals.categories.join('、'),
      total_amount: Number(totals.amount.toFixed(2)),
      total_out_quantity: Number(totals.out_quantity.toFixed(2)),
      cost_summary: extractMaterialCostSummary(rows, items)
    }
  }
}

function extractMaterialCostSummary(rows, items = []) {
  const byCategory = items.reduce((acc, item) => {
    const key = item.category === '辅材' ? 'auxiliary_fee' : item.category === '工具' ? 'tool_fee' : 'material_fee'
    acc[key] += Number(item.amount || 0)
    return acc
  }, { material_fee: 0, auxiliary_fee: 0, tool_fee: 0 })
  const summary = { ...byCategory, transport_fee: 0, total_cost: 0 }
  for (const row of rows) {
    const text = row.map(clean).filter(Boolean).join(' ')
    if (/运输费/.test(text)) summary.transport_fee = firstNumberAfterLabel(row, /运输费/) || normalizeNumber(row[1])
    if (/总计/.test(text)) summary.total_cost = firstNumberAfterLabel(row, /总计/) || normalizeNumber(row[1])
    if (/材料合计/.test(text)) summary.material_fee = firstNumberAfterLabel(row, /材料合计/) || summary.material_fee
    if (/损耗合计/.test(text)) summary.auxiliary_fee = firstNumberAfterLabel(row, /损耗合计/) || summary.auxiliary_fee
    if (/工具损耗/.test(text)) summary.tool_fee = firstNumberAfterLabel(row, /工具损耗/) || summary.tool_fee
  }
  summary.material_fee = roundMoney(summary.material_fee)
  summary.auxiliary_fee = roundMoney(summary.auxiliary_fee)
  summary.tool_fee = roundMoney(summary.tool_fee)
  summary.transport_fee = roundMoney(summary.transport_fee)
  if (!summary.total_cost) summary.total_cost = summary.material_fee + summary.auxiliary_fee + summary.tool_fee + summary.transport_fee
  summary.total_cost = roundMoney(summary.total_cost)
  return summary
}

function parseLaborRows(rows) {
  const items = []
  const headerIndex = rows.findIndex(row => row.some(cell => /空间名称/.test(clean(cell))) && row.some(cell => /核算数量/.test(clean(cell))))
  if (headerIndex >= 0) {
    for (const row of rows.slice(headerIndex + 1)) {
      const text = row.map(clean).filter(Boolean).join(' ')
      if (/合\s*计|完工验收|工程质检|深圳市/.test(text)) break
      const item = {
        space_name: clean(row[1]),
        texture_name: clean(row[2]),
        process: clean(row[3]),
        color_no: clean(row[4]),
        area: normalizeNumber(row[5]),
        unit_price: normalizeNumber(row[6]),
        amount: normalizeNumber(row[7]),
        confirmer: clean(row[8]),
        remark: text && !/^\d+$/.test(clean(row[0])) ? text : ''
      }
      if (Object.values(item).some(value => String(value || '').trim())) items.push(item)
    }
  }
  const summary = {
    customer: findValue(rows, '客户姓名'),
    address: findValue(rows, '项目地址'),
    salesperson: findValue(rows, '销售顾问'),
    start_date: normalizeDate(findValue(rows, '开工时间')),
    end_date: normalizeDate(findValue(rows, '完工时间')),
    duration: findValue(rows, '总工期'),
    total_area: normalizeNumber(findValue(rows, '施工总面积')),
    labor_fee: 0,
    work_note: ''
  }
  for (const row of rows) {
    const text = row.map(clean).filter(Boolean).join(' ')
    if (/合\s*计/.test(text)) summary.labor_fee = firstNumberAfterLabel(row, /合\s*计/) || summary.labor_fee
    if (/点工|加班|个工/.test(text) && !summary.work_note) summary.work_note = text
  }
  if (!summary.labor_fee) summary.labor_fee = roundMoney(items.reduce((sum, item) => sum + Number(item.amount || 0), 0))
  return {
    project: { customer: summary.customer, address: summary.address, source: summary.salesperson },
    items,
    summary
  }
}

function parseCostRows(rows) {
  const costItems = []
  const headerIndex = rows.findIndex(row => row.some(cell => /费用名称/.test(clean(cell))) && row.some(cell => /金额/.test(clean(cell))))
  if (headerIndex >= 0) {
    for (const row of rows.slice(headerIndex + 1)) {
      const text = row.map(clean).filter(Boolean).join(' ')
      if (/成本合计|项目毛利润|制表人/.test(text)) break
      const item = {
        name: clean(row[1]),
        amount: normalizeNumber(row[2]),
        ratio: normalizeNumber(row[3]),
        area_average: normalizeNumber(row[4]),
        remark: clean(row[5])
      }
      if (item.name) costItems.push(item)
    }
  }
  const summary = {
    salesperson: findValue(rows, '销售姓名'),
    customer: findValue(rows, '客户姓名'),
    address: findValue(rows, '项目详细地址'),
    order_no: '',
    revenue_amount: 0,
    total_area: 0,
    start_date: '',
    end_date: '',
    delivery_date: '',
    crew_note: '',
    labor_fee: amountByName(costItems, /人工/),
    material_fee: amountByName(costItems, /材料费/),
    auxiliary_fee: amountByName(costItems, /辅料/),
    tool_fee: amountByName(costItems, /工具/),
    transport_fee: amountByName(costItems, /运输/),
    total_cost: 0,
    gross_profit: 0,
    profit_rate: 0,
    control_result: ''
  }
  const baseRowIndex = rows.findIndex(row => row.some(cell => /订单编号/.test(clean(cell))))
  if (baseRowIndex >= 0 && rows[baseRowIndex + 1]) {
    const row = rows[baseRowIndex + 1]
    summary.order_no = clean(row[0])
    summary.revenue_amount = normalizeNumber(row[1])
    summary.total_area = normalizeNumber(row[2])
    summary.start_date = normalizeDate(row[3])
    summary.end_date = normalizeDate(row[4])
    summary.delivery_date = normalizeDate(row[5])
    summary.crew_note = clean(row[6])
  }
  for (const row of rows) {
    const text = row.map(clean).filter(Boolean).join(' ')
    if (/成本合计/.test(text)) {
      summary.total_cost = firstNumberAfterLabel(row, /成本合计/) || summary.total_cost
      summary.profit_rate = firstNumberAfterLabel(row, /利润率/) || summary.profit_rate
      summary.control_result = valueAfterLabel(row, /成本控制/) || summary.control_result
    }
    if (/项目毛利润/.test(text)) summary.gross_profit = firstNumberAfterLabel(row, /项目毛利润/) || summary.gross_profit
  }
  if (!summary.total_cost) summary.total_cost = roundMoney(costItems.reduce((sum, item) => sum + Number(item.amount || 0), 0))
  if (!summary.gross_profit && summary.revenue_amount) summary.gross_profit = roundMoney(summary.revenue_amount - summary.total_cost)
  if (summary.profit_rate > 1) summary.profit_rate = Number((summary.profit_rate / 100).toFixed(4))
  if (!summary.profit_rate && summary.revenue_amount) summary.profit_rate = Number((summary.gross_profit / summary.revenue_amount).toFixed(4))
  return {
    project: { customer: summary.customer, address: summary.address, source: summary.salesperson },
    cost_items: costItems,
    summary
  }
}

function amountByName(items, pattern) {
  const item = items.find(row => pattern.test(row.name || ''))
  return item ? Number(item.amount || 0) : 0
}

function firstNumberAfterLabel(row, pattern) {
  for (let i = 0; i < row.length; i++) {
    if (!pattern.test(clean(row[i]))) continue
    for (let j = i + 1; j < row.length; j++) {
      const value = normalizeNumber(row[j])
      if (value) return value
    }
  }
  return 0
}

function valueAfterLabel(row, pattern) {
  for (let i = 0; i < row.length; i++) {
    if (!pattern.test(clean(row[i]))) continue
    for (let j = i + 1; j < Math.min(row.length, i + 4); j++) {
      const value = clean(row[j])
      if (value && !pattern.test(value)) return value
    }
  }
  return ''
}

function deliveryDocumentLabel(documentType) {
  const labels = {
    survey_initial: '首次工勘表',
    survey_recheck: '二次勘察表',
    briefing: '班组交底单',
    material_io: '材料出库单',
    completion_inspection: '完工验收质检表',
    labor_settlement: '施工班组工费结算单',
    cost_check: '完工成本核算表',
    finance_settlement: '财务结算/归档'
  }
  return labels[documentType] || '项目单据'
}

function pickBriefingSheet(workbook) {
  return workbook.SheetNames.find(name => /施工.*交底|交底/.test(name)) || workbook.SheetNames[0] || ''
}

function decodeData(value = '') {
  const text = String(value || '')
  const base64 = text.includes(',') ? text.split(',').pop() : text
  return Buffer.from(base64, 'base64')
}

function looksLikeSpreadsheet(fileName = '') {
  return /\.(csv|xls|xlsx)$/i.test(fileName)
}

function normalizeField(key, value) {
  if (['order_date', 'briefing_date'].includes(key)) return normalizeDate(value)
  if (key === 'phone') return normalizePhone(value)
  return clean(value)
}

function normalizeDate(value) {
  const text = clean(value)
  if (!text) return ''
  let match = text.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/)
  if (match) return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
  match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (match) {
    const year = match[3].length === 2 ? `20${match[3]}` : match[3]
    return `${year}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`
  }
  match = text.match(/^(\d{2})[.年/-](\d{1,2})[.月/-](\d{1,2})/)
  if (match) return `20${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
  return text
}

function extractFileDate(fileName) {
  const text = String(fileName || '')
  const match = text.match(/20\d{6}/)
  if (!match) return ''
  return `${match[0].slice(0, 4)}-${match[0].slice(4, 6)}-${match[0].slice(6, 8)}`
}

function normalizePhone(value) {
  const text = clean(value)
  if (!text) return ''
  const match = text.match(/1[3-9]\d{9}/)
  if (match?.[0]) return match[0]
  if (/微信|企微|企业微信|电话联系|现场联系|联系业主|业主微信/.test(text)) return text
  return ''
}

function normalizeNumber(value) {
  const text = clean(value)
  const match = text.match(/-?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : 0
}

function roundMoney(value) {
  const n = Number(value || 0)
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0
}

function extractAmount(value) {
  const text = clean(value)
  const match = text.match(/(?:预估总金额|合计总金额|总金额|合同金额)\s*[:：]?\s*[￥¥]?\s*([\d,]+(?:\.\d+)?)/)
  if (!match?.[1]) return 0
  return Number(match[1].replace(/,/g, '')) || 0
}

function extractSiteContact(value) {
  const text = clean(value)
  const match = text.match(/现场联系人\s*[:：]?\s*([^，,；;\s]*?)\s*(1[3-9]\d{9})/)
  return {
    name: clean(match?.[1] || ''),
    phone: clean(match?.[2] || '')
  }
}

function pickLine(lines, pattern) {
  return lines.find(line => pattern.test(line)) || ''
}

function countEmbeddedMedia(fileData) {
  try {
    const buffer = decodeData(fileData)
    const text = buffer.toString('latin1')
    const matches = text.match(/xl\/media\/image\d+\.(?:png|jpg|jpeg|gif)/gi)
    return new Set(matches || []).size
  } catch {
    return 0
  }
}

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}
