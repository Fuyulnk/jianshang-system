export const PROJECT_IMPORT_FIELDS = [
  'name',
  'customer',
  'phone',
  'source',
  'order_taker',
  'order_date',
  'external_order_no',
  'address_province',
  'address_city',
  'address_detail',
  'handover_note',
  'total_amount',
  'needs_construction',
  'needs_stock',
  'stock_note'
]

const FIELD_ALIASES = {
  name: ['工单名称', '项目名称', '工程名称', '订单名称'],
  customer: ['客户', '业主', '客户姓名', '业主姓名', '姓名'],
  phone: ['电话', '手机号', '联系电话', '业主电话', '客户电话'],
  source: ['来源', '来源门店', '门店', '渠道', '接单门店'],
  order_taker: ['接单人', '门店接单人', '对接人', '业务员'],
  order_date: ['接单日期', '下单日期', '订单日期', '日期'],
  external_order_no: ['门店单号', '合同号', '订单号', '外部单号', '编号'],
  address_province: ['省', '省份'],
  address_city: ['市', '城市'],
  address_detail: ['地址', '详细地址', '施工地址', '小区地址'],
  handover_note: ['备注', '交接备注', '施工要求', '要求'],
  total_amount: ['金额', '合同金额', '总金额', '报价'],
  needs_construction: ['是否施工', '需要施工'],
  needs_stock: ['是否备货', '需要备货', '备货'],
  stock_note: ['备货备注', '材料备注']
}

export function normalizeProjectDraft(input = {}) {
  const draft = {}
  for (const field of PROJECT_IMPORT_FIELDS) draft[field] = ''
  for (const field of PROJECT_IMPORT_FIELDS) {
    if (input[field] !== undefined && input[field] !== null) draft[field] = input[field]
  }
  draft.name = cleanText(draft.name)
  draft.customer = cleanText(draft.customer)
  draft.phone = normalizePhone(draft.phone)
  draft.source = cleanText(draft.source)
  draft.order_taker = cleanText(draft.order_taker)
  draft.order_date = normalizeDate(draft.order_date)
  draft.external_order_no = cleanText(draft.external_order_no)
  draft.address_province = cleanText(draft.address_province)
  draft.address_city = cleanText(draft.address_city)
  draft.address_detail = cleanText(draft.address_detail)
  draft.handover_note = cleanText(draft.handover_note)
  draft.total_amount = normalizeAmount(draft.total_amount)
  draft.needs_construction = normalizeBoolean(draft.needs_construction, true)
  draft.needs_stock = normalizeBoolean(draft.needs_stock, false)
  draft.stock_note = cleanText(draft.stock_note)
  if (!draft.name) draft.name = buildProjectName(draft)
  return draft
}

export function parseProjectHandoverText(text = '') {
  const blocks = splitTextIntoBlocks(text)
  return blocks.map(block => normalizeProjectDraft(parseBlock(block))).filter(hasDraftSignal)
}

export function parseProjectHandoverRows(rows = []) {
  return rows
    .map(row => normalizeProjectDraft(mapRowToDraft(row)))
    .filter(hasDraftSignal)
}

export function missingCoreFields(draft = {}) {
  const checks = [
    ['source', '来源门店/渠道'],
    ['order_taker', '门店接单人'],
    ['phone', '业主联系方式'],
    ['address_detail', '详细地址']
  ]
  return checks
    .filter(([field]) => !String(draft[field] || '').trim())
    .map(([, label]) => label)
}

export function diffDraft(aiDraft = {}, finalDraft = {}) {
  const diff = {}
  for (const field of PROJECT_IMPORT_FIELDS) {
    const before = normalizeForCompare(aiDraft[field])
    const after = normalizeForCompare(finalDraft[field])
    if (before !== after) diff[field] = { ai: aiDraft[field] ?? '', manual: finalDraft[field] ?? '' }
  }
  return diff
}

export function summarizeRawContent(value = '', limit = 500) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length > limit ? `${text.slice(0, limit)}...` : text
}

function splitTextIntoBlocks(text) {
  const raw = String(text || '').replace(/\r/g, '').trim()
  if (!raw) return []
  const blankBlocks = raw.split(/\n{2,}/).map(item => item.trim()).filter(Boolean)
  if (blankBlocks.length > 1) return blankBlocks

  const lines = raw.split('\n').map(item => item.trim()).filter(Boolean)
  const phoneLines = lines.filter(line => /1[3-9]\d{9}/.test(line))
  if (phoneLines.length <= 1) return [raw]

  const groups = []
  let current = []
  for (const line of lines) {
    if (/1[3-9]\d{9}/.test(line) && current.some(item => /1[3-9]\d{9}/.test(item))) {
      groups.push(current.join('\n'))
      current = []
    }
    current.push(line)
  }
  if (current.length) groups.push(current.join('\n'))
  return groups
}

function parseBlock(block) {
  const text = String(block || '')
  const address = pickField(text, ['施工地址', '详细地址', '地址'])
  const region = splitAddress(address)
  const customer = pickField(text, ['业主姓名', '客户姓名', '业主', '客户', '姓名']) || guessCustomer(text)
  const draft = {
    customer,
    phone: firstMatch(text, /1[3-9]\d{9}/),
    source: pickField(text, ['来源门店', '来源', '门店', '渠道']),
    order_taker: pickField(text, ['门店接单人', '接单人', '对接人', '业务员']),
    order_date: pickField(text, ['接单日期', '下单日期', '订单日期', '日期']) || firstMatch(text, /\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}/),
    external_order_no: pickField(text, ['门店单号', '合同号', '订单号', '编号']),
    address_province: region.province,
    address_city: region.city,
    address_detail: region.detail || address,
    handover_note: pickField(text, ['交接备注', '备注', '施工要求', '要求']) || summarizeRawContent(text, 220),
    total_amount: pickField(text, ['合同金额', '总金额', '金额', '报价']) || firstMatch(text, /(?:￥|¥)?\s*\d+(?:\.\d+)?\s*(?:元|块)?/),
    needs_construction: !/(无需施工|不施工|只备货)/.test(text),
    needs_stock: /(备货|出库|材料|漆|桶|刷|工具)/.test(text),
    stock_note: pickField(text, ['备货备注', '材料备注'])
  }
  draft.name = pickField(text, ['工单名称', '项目名称', '工程名称']) || buildProjectName(draft)
  return draft
}

function mapRowToDraft(row = {}) {
  const draft = {}
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const alias of aliases) {
      if (row[alias] !== undefined && row[alias] !== null && String(row[alias]).trim() !== '') {
        draft[field] = row[alias]
        break
      }
    }
  }
  if (!draft.address_detail && row.address) draft.address_detail = row.address
  return draft
}

function pickField(text, labels) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = String(text).match(new RegExp(`${escaped}\\s*[:：]\\s*([^\\n；;]+)`))
    if (match?.[1]) return cleanText(match[1])
  }
  return ''
}

function guessCustomer(text) {
  const phone = firstMatch(text, /1[3-9]\d{9}/)
  const line = String(text || '').split('\n').map(item => item.trim()).find(Boolean) || ''
  return cleanText(line.replace(phone, '').replace(/客户|业主|姓名|[:：]/g, '')).slice(0, 20)
}

function splitAddress(address) {
  const text = cleanText(address)
  const province = firstMatch(text, /[\u4e00-\u9fa5]{2,8}(?:省|自治区|市)/)
  const afterProvince = province ? text.slice(text.indexOf(province) + province.length) : text
  const city = firstMatch(afterProvince, /[\u4e00-\u9fa5]{2,10}市/)
  let detail = text
  if (province) detail = detail.replace(province, '')
  if (city) detail = detail.replace(city, '')
  return { province, city, detail: cleanText(detail) }
}

function firstMatch(text, regex) {
  const match = String(text || '').match(regex)
  return match?.[0] ? cleanText(match[0]) : ''
}

function buildProjectName(draft) {
  const base = draft.customer || draft.source || draft.address_detail || '未命名'
  return `${base} 项目工单`.slice(0, 80)
}

function hasDraftSignal(draft) {
  return ['customer', 'phone', 'source', 'external_order_no', 'address_detail', 'handover_note']
    .some(field => String(draft[field] || '').trim())
}

function normalizePhone(value) {
  return firstMatch(value, /1[3-9]\d{9}/) || cleanText(value)
}

function normalizeDate(value) {
  const text = cleanText(value)
  const match = text.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/)
  if (!match) return text
  const [, year, month, day] = match
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

function normalizeAmount(value) {
  const text = cleanText(value)
  const match = text.match(/\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : 0
}

function normalizeBoolean(value, fallback) {
  if (typeof value === 'boolean') return value
  const text = cleanText(value)
  if (!text) return fallback
  if (['1', 'true', '是', '需要', 'yes', 'y'].includes(text.toLowerCase())) return true
  if (['0', 'false', '否', '不需要', 'no', 'n'].includes(text.toLowerCase())) return false
  return fallback
}

function normalizeForCompare(value) {
  return typeof value === 'boolean' ? String(value) : String(value ?? '').trim()
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}
