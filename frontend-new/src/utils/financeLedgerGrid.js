export const defaultLedgerCellStyle = Object.freeze({ horizontal: 'left', vertical: 'top', backgroundColor: '' })

export function buildMergeOwnerMap(merges = []) {
  const map = new Map()
  for (const merge of merges) {
    const owner = {
      row: Number(merge.start_row),
      col: Number(merge.start_col),
      merge
    }
    for (let row = Number(merge.start_row); row <= Number(merge.end_row); row++) {
      for (let col = Number(merge.start_col); col <= Number(merge.end_col); col++) {
        map.set(`${row}:${col}`, owner)
      }
    }
  }
  return map
}

export function resolveLedgerCellTarget(row, col, mergeOwnerMap) {
  const owner = mergeOwnerMap?.get(`${Number(row)}:${Number(col)}`)
  return owner ? { row: owner.row, col: owner.col } : { row: Number(row), col: Number(col) }
}

export function resolveLedgerCellStyle(row, col, mergeOwnerMap, styleMap, fallback = defaultLedgerCellStyle) {
  const target = resolveLedgerCellTarget(row, col, mergeOwnerMap)
  return styleMap?.get(`${target.row}:${target.col}`) || fallback
}

export function parseLedgerCellStyle(value) {
  let parsed = {}
  if (value && typeof value === 'object') {
    parsed = value
  } else if (value) {
    try {
      parsed = JSON.parse(value)
    } catch {
      parsed = {}
    }
  }
  const horizontal = ['left', 'center', 'right'].includes(parsed.horizontal) ? parsed.horizontal : 'left'
  const vertical = ['top', 'middle', 'bottom'].includes(parsed.vertical) ? parsed.vertical : 'top'
  const backgroundColor = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(parsed.backgroundColor || ''))
    ? String(parsed.backgroundColor)
    : ''
  return { horizontal, vertical, backgroundColor }
}
