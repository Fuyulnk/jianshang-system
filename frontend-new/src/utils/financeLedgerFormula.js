export function computeFormulaValueMap(cells = []) {
  const cellMap = new Map()
  for (const cell of cells) {
    cellMap.set(`${Number(cell.row_index)}:${Number(cell.col_index)}`, cell)
  }

  const values = new Map()
  const visiting = new Set()

  const evaluateCell = (row, col) => {
    const key = `${Number(row)}:${Number(col)}`
    const cell = cellMap.get(key)
    if (!cell) return 0
    if (cell.formula) {
      if (visiting.has(key)) return 0
      visiting.add(key)
      const value = evaluateFormula(cell.formula, evaluateCell)
      visiting.delete(key)
      values.set(key, formatFormulaResult(value))
      return Number(value) || 0
    }
    return parseFormulaNumber(cell.value ?? cell.raw_value)
  }

  for (const cell of cells) {
    if (!cell.formula) continue
    const key = `${Number(cell.row_index)}:${Number(cell.col_index)}`
    values.set(key, formatFormulaResult(evaluateCell(cell.row_index, cell.col_index)))
  }

  return values
}

export function formatLedgerDisplayText(value) {
  const text = String(value ?? '')
  const fullDate = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/)
  if (fullDate) return `${Number(fullDate[1])}/${Number(fullDate[2])}/${Number(fullDate[3])}`
  const shortDate = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/)
  if (shortDate) {
    const year = Number(shortDate[3]) >= 70 ? 1900 + Number(shortDate[3]) : 2000 + Number(shortDate[3])
    return `${year}/${Number(shortDate[1])}/${Number(shortDate[2])}`
  }
  return text
}

export function evaluateFormula(formula, evaluateCell) {
  let expression = String(formula || '').trim().replace(/^=/, '')
  if (!expression) return ''
  expression = expression.replace(/SUM\(([^)]+)\)/gi, (_, rangeText) => String(sumFormulaRange(rangeText, evaluateCell)))
  expression = expression.replace(/\$?([A-Z]{1,3})\$?(\d+)/gi, (_, colText, rowText) => String(evaluateCell(Number(rowText), decodeColName(colText))))
  expression = expression.replace(/(\d+(?:\.\d+)?)%/g, '($1/100)')
  if (!/^[0-9+\-*/().\s]+$/.test(expression)) return ''
  try {
    const result = Function(`"use strict"; return (${expression})`)()
    return Number.isFinite(result) ? result : ''
  } catch {
    return ''
  }
}

export function parseFormulaNumber(value) {
  const text = String(value ?? '').replace(/,/g, '').trim()
  if (!text) return 0
  if (text.endsWith('%')) {
    const percent = Number(text.slice(0, -1))
    return Number.isFinite(percent) ? percent / 100 : 0
  }
  const number = Number(text)
  return Number.isFinite(number) ? number : 0
}

export function formatFormulaResult(value) {
  if (value === '' || value === null || value === undefined) return ''
  const number = Number(value)
  if (!Number.isFinite(number)) return ''
  if (Number.isInteger(number)) return String(number)
  return String(Number(number.toFixed(6)))
}

function sumFormulaRange(rangeText, evaluateCell) {
  const [startRef, endRef] = String(rangeText || '').split(':').map(part => part.trim())
  const start = parseCellRef(startRef)
  const end = parseCellRef(endRef || startRef)
  if (!start || !end) return 0
  const rowStart = Math.min(start.row, end.row)
  const rowEnd = Math.max(start.row, end.row)
  const colStart = Math.min(start.col, end.col)
  const colEnd = Math.max(start.col, end.col)
  let total = 0
  for (let row = rowStart; row <= rowEnd; row++) {
    for (let col = colStart; col <= colEnd; col++) {
      total += Number(evaluateCell(row, col)) || 0
    }
  }
  return total
}

function parseCellRef(refText) {
  const match = String(refText || '').match(/^\$?([A-Z]{1,3})\$?(\d+)$/i)
  if (!match) return null
  return { col: decodeColName(match[1]), row: Number(match[2]) }
}

function decodeColName(name) {
  return String(name || '').toUpperCase().split('').reduce((total, char) => {
    const code = char.charCodeAt(0)
    if (code < 65 || code > 90) return total
    return total * 26 + (code - 64)
  }, 0)
}
