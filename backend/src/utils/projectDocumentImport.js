import * as XLSX from 'xlsx'

const KNOWN_LABELS = [
  '单源', '接单时间', '销售顾问', '销售电话', '客户姓名', '客户电话', '详细地址',
  '预计开工时间', '预计总工期', '进入方式', '施工总面积', '是否复尺',
  '车牌是否需要报备', '其他事项说明'
]

const BRIEFING_FIELD_DEFS = [
  { key: 'source', label: '来源门店/渠道', source: '单源' },
  { key: 'order_taker', label: '门店接单人', source: '销售顾问' },
  { key: 'order_date', label: '接单日期', source: '接单时间' },
  { key: 'customer', label: '业主/客户', source: '客户姓名' },
  { key: 'phone', label: '业主电话', source: '客户电话' },
  { key: 'address_detail', label: '详细地址', source: '详细地址' },
  { key: 'team_leader', label: '班组长', source: '其他事项说明' },
  { key: 'briefing_date', label: '交底日期', source: '接单时间推断', caution: '表内没有独立交底日期，默认按接单时间推断，保存前请人工确认。' }
]

export function parseBriefingDocument(fileName = '', fileData = '') {
  if (!looksLikeSpreadsheet(fileName)) {
    return { fields: [], items: [], warnings: ['施工交底单 V1 只支持 CSV / XLS / XLSX'] }
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

  const raw = parseBriefingRows(rows)
  const fields = BRIEFING_FIELD_DEFS.map(def => ({
    key: def.key,
    label: def.label,
    source: def.source,
    value: normalizeField(def.key, raw[def.key] || ''),
    caution: def.caution || ''
  }))

  const warnings = []
  if (!fields.find(field => field.key === 'customer')?.value) warnings.push('未识别到客户姓名')
  if (!fields.find(field => field.key === 'address_detail')?.value) warnings.push('未识别到详细地址')
  if (!raw.items.length) warnings.push('未识别到施工项目明细')
  if (raw.phone_source && !raw.phone) warnings.push(raw.phone_source)
  const fileDate = extractFileDate(fileName)
  if (fileDate && raw.order_date && fileDate !== raw.order_date) {
    warnings.push(`文件名日期 ${fileDate} 与表内日期 ${raw.order_date} 不一致，请人工确认后再写入。`)
  }

  return {
    document_type: 'briefing',
    document_label: '施工交底单',
    file_name: fileName,
    sheet_name: sheetName,
    fields,
    items: raw.items,
    summary: raw.summary,
    warnings
  }
}

function parseBriefingRows(rows) {
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
  const teamLeader = extractTeamLeader(rows)
  const items = extractConstructionItems(rows)
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
    phone_source: !phone && salesPhone ? `客户电话为空，表内销售电话为 ${salesPhone}，未自动写入业主电话。` : '',
    address_detail: addressDetail,
    team_leader: teamLeader,
    briefing_date: orderDate,
    total_area: totalArea,
    items,
    summary: {
      total_area: totalArea,
      remeasure,
      entry_method: entryMethod,
      plate_needed: plateNeeded,
      item_summary: itemSummary
    }
  }
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
  return text
}

function extractFileDate(fileName) {
  const text = String(fileName || '')
  const match = text.match(/20\d{6}/)
  if (!match) return ''
  return `${match[0].slice(0, 4)}-${match[0].slice(4, 6)}-${match[0].slice(6, 8)}`
}

function normalizePhone(value) {
  const match = clean(value).match(/1[3-9]\d{9}/)
  return match?.[0] || ''
}

function normalizeNumber(value) {
  const text = clean(value)
  const match = text.match(/-?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : 0
}

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}
