import * as XLSX from 'xlsx'
import { extname } from 'path'

const MAX_MONEY_VALUE = 100000000
const MAX_FILE_SIZE = 10 * 1024 * 1024
const ALLOWED_EXTS = new Set(['.csv', '.xls', '.xlsx'])

export function parseSupplyOrderDocument(fileName, fileData) {
  const ext = extname(cleanText(fileName)).toLowerCase()
  if (!ALLOWED_EXTS.has(ext)) throw new Error('项目供货单暂只支持 CSV / XLS / XLSX')
  const buffer = decodeData(fileData)
  if (!buffer.length) throw new Error('供货单文件内容为空')
  if (buffer.length > MAX_FILE_SIZE) throw new Error('单个供货单文件不能超过 10MB')

  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) throw new Error('供货单内没有可读取的工作表')
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    header: 1,
    defval: '',
    raw: false,
    blankrows: false
  })
  if (!rows.length) throw new Error('供货单没有可识别内容')

  const textLines = rows.map(row => row.map(cleanText).filter(Boolean).join(' | ')).filter(Boolean)
  const fullText = textLines.join('\n')
  const headerIndex = rows.findIndex(row => row.some(cell => cleanText(cell).includes('序号')))
  if (headerIndex < 0) throw new Error('未找到供货明细表头，请确认表内有“序号/品牌/数量/金额”等字段')

  const header = rows[headerIndex].map(cleanText)
  const layout = detectLayout(header)
  const items = parseItems(rows.slice(headerIndex + 1), layout)
  const profile = parseProfile(fullText)
  const totalFromText = findTotalAmount(rows)
  const amount = totalFromText.found ? totalFromText.amount : roundMoney(items.reduce((sum, item) => sum + Number(item.amount || 0), 0))
  const warnings = buildWarnings({ profile, items, amount, hasTotalFromText: totalFromText.found })
  const analysis = buildAnalysis({ fileName, sheetName, layout, profile, items, amount, warnings })

  return {
    source_file: cleanText(fileName),
    sheet_name: sheetName,
    form_data: {
      customer: profile.customer,
      phone: profile.phone,
      source: profile.consultant ? `订单顾问：${profile.consultant}` : '供货单导入',
      address: profile.delivery_address || profile.address,
      amount,
      note: buildNote(profile, warnings),
      items,
      meta: buildMeta(profile)
    },
    analysis,
    warnings
  }
}

function detectLayout(header) {
  const line = header.join('|')
  if (line.includes('品牌') || line.includes('计量单位') || line.includes('总价金额')) {
    return {
      type: 'supply_sales_order',
      label: '供货销售单',
      category: findHeader(header, ['品牌']),
      product: findHeader(header, ['款式', '产品', '材料']),
      color: findHeader(header, ['色号']),
      unit: findHeader(header, ['计量单位', '单位']),
      quantity: findHeader(header, ['数量']),
      unitPrice: findHeader(header, ['单价']),
      amount: findHeader(header, ['总价金额', '总金额', '金额']),
      remark: findHeader(header, ['备注'])
    }
  }
  return {
    type: 'material_budget_order',
    label: '材料预算单',
    category: findHeader(header, ['使用空间', '空间']),
    productPrefix: 2,
    product: findHeader(header, ['款式', '产品', '材料']),
    color: findHeader(header, ['色号']),
    area: findHeader(header, ['面积']),
    unit: -1,
    quantity: findHeader(header, ['数量']),
    unitPrice: findHeader(header, ['单价']),
    amount: findHeader(header, ['总金额', '总价金额', '金额']),
    remark: findHeader(header, ['备注'])
  }
}

function parseItems(dataRows, layout) {
  const items = []
  for (const row of dataRows) {
    const first = cleanText(row[0])
    if (!first) continue
    if (!/^\d+$/.test(first)) break
    if (isSummaryRow(row)) continue

    const quantity = toNumber(row[layout.quantity])
    const unitPrice = toMoney(row[layout.unitPrice])
    const amount = toMoney(row[layout.amount]) || roundMoney(quantity * unitPrice)
    const productName = pickProductName(row, layout)
    if (!productName) continue

    const color = cleanText(row[layout.color])
    const area = layout.area >= 0 ? cleanText(row[layout.area]) : ''
    const rawRemark = cleanText(row[layout.remark])
    const noteParts = []
    if (color) noteParts.push(`色号：${color}`)
    if (area) noteParts.push(`面积：${area}`)
    if (rawRemark) noteParts.push(rawRemark)

    items.push({
      product_id: 0,
      product_name: productName,
      category: cleanText(row[layout.category]),
      unit: layout.unit >= 0 ? cleanText(row[layout.unit]) || inferUnit(layout, productName) : inferUnit(layout, productName),
      quantity,
      unit_price: unitPrice,
      amount,
      note: noteParts.join('；')
    })
  }
  return items
}

function pickProductName(row, layout) {
  if (layout.type === 'material_budget_order') {
    const prefix = cleanText(row[layout.productPrefix])
    const name = cleanText(row[layout.product])
    return [prefix, name].filter(Boolean).join(' / ')
  }
  return cleanText(row[layout.product])
}

function parseProfile(text) {
  const customerRaw = matchFirst(text, /客户名称[:：]\s*([^\n|]+)/)
  const phoneInCustomer = matchFirst(customerRaw, /(1[3-9]\d{9})/)
  const phone = phoneInCustomer || matchFirst(text, /联系电话[:：]\s*([^\n|]+)/)
  const cleanCustomer = cleanText(customerRaw.replace(phoneInCustomer, ''))
  const contactAddress = matchFirst(text, /联系地址[:：]\s*([^\n|]+)/)
  const deliveryAddress = matchFirst(text, /送货地址[:：]\s*([^\n]+)/)
  return {
    customer: cleanCustomer,
    phone: pickPhone(phone) || phoneInCustomer || cleanText(phone),
    address: contactAddress,
    delivery_address: deliveryAddress,
    order_date: normalizeDate(matchFirst(text, /日期[:：]\s*([0-9]{4}[\/\-.][0-9]{1,2}[\/\-.][0-9]{1,2})/)),
    consultant: matchFirst(text, /订单顾问[:：]\s*([^\n|客户销售店长确认]+)/),
    payment_note: findPaymentNote(text),
    remark: findRemarkLines(text)
  }
}

function findTotalAmount(rows) {
  for (const row of rows) {
    const line = row.map(cleanText).join('|')
    if (!line.includes('合计')) continue
    if (line.includes('面积') || line.includes('桶数')) continue
    if (!/(金额|总价|总金额|总价金额)/.test(line) && !/^3\|合计\|/.test(line)) continue
    const cells = row.slice(1).map(cleanText).filter(Boolean)
    const values = cells
      .map(toMoney)
      .filter((n, index) => n > 0 || /^0+(\.0+)?$/.test(cells[index].replace(/[￥¥,]/g, '')))
    if (values.length) return { found: true, amount: values[values.length - 1] }
  }
  return { found: false, amount: 0 }
}

function buildWarnings({ profile, items, amount, hasTotalFromText }) {
  const warnings = []
  if (!profile.customer) warnings.push('缺客户名称')
  if (!profile.phone) warnings.push('缺客户/现场联系电话')
  if (!profile.address && !profile.delivery_address) warnings.push('缺收货/项目地址')
  if (!items.length) warnings.push('未识别到供货明细')
  if (!amount) warnings.push('订单金额为 0，请确认是否为内部调拨或价格待补')
  if (!hasTotalFromText && items.length) warnings.push('未识别到表内合计金额，已按明细金额自动汇总')
  const noPrice = items.filter(item => item.quantity > 0 && !item.unit_price && !item.amount)
  if (noPrice.length) warnings.push(`${noPrice.length} 条明细缺单价和金额`)
  return warnings
}

function buildAnalysis({ fileName, sheetName, layout, profile, items, amount, warnings }) {
  return {
    title: `${layout.label}识别结果`,
    order_type: layout.type,
    order_type_label: layout.label,
    confidence: items.length ? 0.86 : 0.45,
    source_file: cleanText(fileName),
    sheet_name: sheetName,
    summary: [
      `识别为${layout.label}`,
      `客户：${profile.customer || '未识别'}`,
      `明细：${items.length} 条`,
      `金额：${amount ? `￥${amount.toFixed(2)}` : '待确认'}`
    ],
    warnings
  }
}

function buildMeta(profile) {
  return {
    order_date: profile.order_date,
    consultant: profile.consultant,
    contact_address: profile.address,
    delivery_address: profile.delivery_address,
    payment_note: profile.payment_note,
    address_duplicated: isSameAddress(profile.address, profile.delivery_address)
  }
}

function buildNote(profile) {
  return profile.remark || ''
}

function normalizeAddress(value) {
  return cleanText(value)
    .replace(/1[3-9]\d{9}/g, '')
    .replace(/\b[\u4e00-\u9fa5]{1,3}\b$/g, '')
    .replace(/\s+/g, '')
    .replace(/[，,。；;|]/g, '')
    .replace(/(先生|女士|小姐|总|经理|工)$/g, '')
}

function isSameAddress(left, right) {
  const a = normalizeAddress(left)
  const b = normalizeAddress(right)
  if (!a || !b) return false
  if (a === b) return true
  return Math.min(a.length, b.length) >= 8 && (a.includes(b) || b.includes(a))
}

function findHeader(header, names) {
  return header.findIndex(cell => names.some(name => cleanText(cell).includes(name)))
}

function isSummaryRow(row) {
  return row.some(cell => /合计|总计/.test(cleanText(cell))) && !cleanText(row[3])
}

function inferUnit(layout, productName) {
  if (layout.type === 'material_budget_order') return '桶'
  if (/漆|涂料|底漆|面漆/.test(productName)) return '桶'
  return ''
}

function decodeData(data) {
  const value = String(data || '')
  const base64 = value.includes(',') ? value.split(',').pop() : value
  return Buffer.from(base64, 'base64')
}

function pickPhone(text) {
  return matchFirst(text, /(1[3-9]\d{9})/)
}

function matchFirst(text, regex) {
  const match = String(text || '').match(regex)
  return cleanText(match?.[1] || '')
}

function findLine(text, keywords) {
  return String(text || '').split(/\n+/).map(cleanText)
    .find(line => !line.includes('序号') && keywords.some(keyword => line.includes(keyword))) || ''
}

function findRemarkLines(text) {
  return String(text || '').split(/\n+/)
    .map(cleanText)
    .filter(line => line.includes('备注') && !line.includes('序号'))
    .map(line => cleanRemarkLine(line))
    .filter(Boolean)
    .join('\n')
}

function findPaymentNote(text) {
  return String(text || '').split(/\n+/)
    .map(cleanText)
    .map(line => line.split(/送货地址[:：]/)[0])
    .map(line => line.replace(/\s*[|｜]\s*$/g, '').trim())
    .find(line => {
      if (!line || line.includes('序号')) return false
      if (/备注[:：]?/.test(line)) return false
      return ['转账', '帐号', '账号', '银行账户', '开户银行', '全款', '税号', '开户名'].some(keyword => line.includes(keyword))
    }) || ''
}

function cleanRemarkLine(line) {
  return cleanText(line)
    .replace(/^备注\s*[|｜]\s*/, '')
    .replace(/^备注[:：]\s*/, '')
}

function normalizeDate(value) {
  const text = cleanText(value)
  if (!text) return ''
  const parts = text.split(/[\/\-.]/).map(part => part.padStart(2, '0'))
  if (parts.length !== 3) return text
  return `${parts[0]}-${parts[1]}-${parts[2]}`
}

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function toMoney(value) {
  const text = cleanText(value).replace(/[￥¥,]/g, '')
  const n = Number(text)
  if (!Number.isFinite(n)) return 0
  return Math.min(MAX_MONEY_VALUE, Math.max(0, Number(n.toFixed(2))))
}

function toNumber(value) {
  const text = cleanText(value).replace(/[￥¥,]/g, '')
  const n = Number(text)
  if (!Number.isFinite(n)) return 0
  return Math.min(MAX_MONEY_VALUE, Math.max(0, Number(n.toFixed(3))))
}

function roundMoney(value) {
  const n = Number(value || 0)
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0
}
