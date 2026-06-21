import * as XLSX from 'xlsx'
import zlib from 'zlib'

const LOCAL_FILE_HEADER = 0x04034b50
const CENTRAL_FILE_HEADER = 0x02014b50
const EOCD = 0x06054b50

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

export function patchXlsxCells(originalBuffer, updates = []) {
  const buffer = Buffer.from(originalBuffer || [])
  if (!buffer.length) throw new Error('原始 Excel 文件为空')
  const entries = readZipEntries(buffer)
  const entryMap = new Map(entries.map(entry => [entry.name, entry]))
  const sheetTargets = resolveWorksheetTargets(entryMap)
  const grouped = groupUpdatesBySheet(updates, sheetTargets)

  for (const [sheetPath, sheetUpdates] of grouped.entries()) {
    const entry = entryMap.get(sheetPath)
    if (!entry) continue
    const xml = entry.data.toString('utf8')
    entry.data = Buffer.from(patchWorksheetXml(xml, sheetUpdates), 'utf8')
  }

  return writeZipEntries(entries)
}

export function buildLabelCellUpdates(originalBuffer, labelValues = [], sheetName = '') {
  const workbook = XLSX.read(originalBuffer, { type: 'buffer', cellDates: false, cellText: true, raw: false })
  const targetSheetName = sheetName || workbook.SheetNames[0] || ''
  const sheet = workbook.Sheets[targetSheetName]
  if (!sheet) return []
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: false, raw: false })
  const updates = []
  const used = new Set()
  for (const item of labelValues) {
    const labels = Array.isArray(item.labels) ? item.labels : [item.label]
    const value = item.value
    if (value === undefined || value === null || String(value) === '') continue
    const found = findLabelCell(rows, labels, used)
    if (!found) continue
    used.add(`${found.r}:${found.c}`)
    updates.push({
      sheetName: targetSheetName,
      address: XLSX.utils.encode_cell({ r: found.r, c: found.c + 1 }),
      value
    })
  }
  return updates
}

function findLabelCell(rows, labels, used) {
  const normalizedLabels = labels.map(normalizeText).filter(Boolean)
  if (!normalizedLabels.length) return null
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] || []
    for (let c = 0; c < row.length; c++) {
      if (used.has(`${r}:${c}`)) continue
      const text = normalizeText(row[c])
      if (!text) continue
      if (normalizedLabels.some(label => text === label || text.includes(label))) return { r, c }
    }
  }
  return null
}

function resolveWorksheetTargets(entryMap) {
  const workbookXml = entryMap.get('xl/workbook.xml')?.data?.toString('utf8') || ''
  const relsXml = entryMap.get('xl/_rels/workbook.xml.rels')?.data?.toString('utf8') || ''
  const rels = new Map()
  for (const rel of relsXml.matchAll(/<Relationship\b([^>]+?)\/?>/g)) {
    const attrs = parseXmlAttrs(rel[1])
    if (attrs.Id && attrs.Target) rels.set(attrs.Id, normalizeWorkbookTarget(attrs.Target))
  }
  const sheets = []
  let index = 0
  for (const match of workbookXml.matchAll(/<sheet\b([^>]+?)\/?>/g)) {
    const attrs = parseXmlAttrs(match[1])
    const relId = attrs['r:id'] || attrs.id
    const target = rels.get(relId) || `xl/worksheets/sheet${index + 1}.xml`
    sheets.push({ index, name: decodeXml(attrs.name || ''), path: target })
    index += 1
  }
  return sheets
}

function groupUpdatesBySheet(updates, sheetTargets) {
  const grouped = new Map()
  for (const update of updates) {
    const target = findSheetTarget(sheetTargets, update)
    if (!target?.path || !update.address) continue
    if (!grouped.has(target.path)) grouped.set(target.path, [])
    grouped.get(target.path).push({
      address: String(update.address).toUpperCase(),
      value: update.value
    })
  }
  return grouped
}

function findSheetTarget(sheetTargets, update) {
  if (update.sheetName) {
    const byName = sheetTargets.find(sheet => sheet.name === update.sheetName)
    if (byName) return byName
  }
  if (Number.isFinite(Number(update.sheetIndex))) {
    const byIndex = sheetTargets.find(sheet => sheet.index === Number(update.sheetIndex))
    if (byIndex) return byIndex
  }
  return sheetTargets[0]
}

function patchWorksheetXml(xml, updates) {
  let nextXml = xml
  for (const update of updates) {
    nextXml = upsertCell(nextXml, update.address, update.value)
  }
  return nextXml
}

function upsertCell(xml, address, value) {
  const rowIndex = Number(address.match(/\d+/)?.[0] || 0)
  if (!rowIndex) return xml
  const cellRegex = new RegExp(`<c\\b([^>]*\\br="${escapeRegex(address)}"[^>]*)>[\\s\\S]*?<\\/c>`)
  const matched = xml.match(cellRegex)
  if (matched) {
    const attrs = parseXmlAttrs(matched[1])
    return xml.replace(cellRegex, buildCellXml(address, value, attrs.s))
  }

  const rowRegex = new RegExp(`<row\\b([^>]*\\br="${rowIndex}"[^>]*)>([\\s\\S]*?)<\\/row>`)
  const rowMatch = xml.match(rowRegex)
  if (rowMatch) {
    const rowInner = insertCellIntoRow(rowMatch[2], address, value)
    return xml.replace(rowRegex, `<row${rowMatch[1]}>${rowInner}</row>`)
  }

  const sheetDataEnd = xml.indexOf('</sheetData>')
  if (sheetDataEnd < 0) return xml
  const rowXml = `<row r="${rowIndex}">${buildCellXml(address, value)}</row>`
  return `${xml.slice(0, sheetDataEnd)}${rowXml}${xml.slice(sheetDataEnd)}`
}

function insertCellIntoRow(rowInner, address, value) {
  const targetCol = XLSX.utils.decode_cell(address).c
  const cellMatches = [...rowInner.matchAll(/<c\b([^>]*\br="([A-Z]+)\d+"[^>]*)>[\s\S]*?<\/c>/g)]
  for (const match of cellMatches) {
    const col = XLSX.utils.decode_col(match[2])
    if (col > targetCol) {
      const offset = match.index || 0
      return `${rowInner.slice(0, offset)}${buildCellXml(address, value)}${rowInner.slice(offset)}`
    }
  }
  return `${rowInner}${buildCellXml(address, value)}`
}

function buildCellXml(address, value, styleId = '') {
  const style = styleId !== undefined && styleId !== null && styleId !== '' ? ` s="${escapeXml(styleId)}"` : ''
  if (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '' && isFinite(Number(value)))) {
    return `<c r="${address}"${style}><v>${escapeXml(String(value))}</v></c>`
  }
  return `<c r="${address}" t="inlineStr"${style}><is><t>${escapeXml(String(value ?? ''))}</t></is></c>`
}

function readZipEntries(buffer) {
  const eocdOffset = findEocd(buffer)
  if (eocdOffset < 0) throw new Error('不是有效的 xlsx 文件')
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10)
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16)
  const entries = []
  let offset = centralOffset
  for (let i = 0; i < totalEntries; i++) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_FILE_HEADER) throw new Error('xlsx 中央目录损坏')
    const method = buffer.readUInt16LE(offset + 10)
    const crc = buffer.readUInt32LE(offset + 16)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const uncompressedSize = buffer.readUInt32LE(offset + 24)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.slice(offset + 46, offset + 46 + nameLength).toString('utf8')
    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const compressed = buffer.slice(dataStart, dataStart + compressedSize)
    const data = method === 0 ? Buffer.from(compressed) : zlib.inflateRawSync(compressed)
    entries.push({ name, method, crc, uncompressedSize, data })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

function writeZipEntries(entries) {
  const localParts = []
  const centralParts = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const data = Buffer.from(entry.data || [])
    const compressed = zlib.deflateRawSync(data)
    const crc = crc32(data)
    const local = Buffer.alloc(30 + name.length)
    local.writeUInt32LE(LOCAL_FILE_HEADER, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(0, 10)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    name.copy(local, 30)
    localParts.push(local, compressed)

    const central = Buffer.alloc(46 + name.length)
    central.writeUInt32LE(CENTRAL_FILE_HEADER, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(0, 12)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    name.copy(central, 46)
    centralParts.push(central)
    offset += local.length + compressed.length
  }
  const centralOffset = offset
  const central = Buffer.concat(centralParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(EOCD, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(central.length, 12)
  eocd.writeUInt32LE(centralOffset, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...localParts, central, eocd])
}

function findEocd(buffer) {
  const min = Math.max(0, buffer.length - 0xffff - 22)
  for (let i = buffer.length - 22; i >= min; i--) {
    if (buffer.readUInt32LE(i) === EOCD) return i
  }
  return -1
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function parseXmlAttrs(text = '') {
  const attrs = {}
  for (const match of String(text).matchAll(/([A-Za-z_:][\w:.-]*)="([^"]*)"/g)) {
    attrs[match[1]] = decodeXml(match[2])
  }
  return attrs
}

function normalizeWorkbookTarget(target = '') {
  const clean = String(target).replace(/^\/+/, '')
  if (clean.startsWith('xl/')) return clean
  return `xl/${clean}`
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, '').replace(/[:：]/g, '').trim()
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function decodeXml(value) {
  return String(value ?? '')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
