import assert from 'node:assert/strict'
import {
  computeFormulaValueMap,
  evaluateFormula,
  formatFormulaResult,
  formatLedgerDisplayText,
  parseFormulaNumber
} from '../src/utils/financeLedgerFormula.js'

const makeCell = (row, col, value = '', formula = '') => ({
  row_index: row,
  col_index: col,
  value,
  raw_value: value,
  formula
})

assert.equal(parseFormulaNumber('25%'), 0.25)
assert.equal(parseFormulaNumber('1,234.5'), 1234.5)
assert.equal(formatLedgerDisplayText('1/6/25'), '2025/1/6')
assert.equal(formatLedgerDisplayText('2025-01-06 00:00:00'), '2025/1/6')

assert.equal(evaluateFormula('SUM(B1:C1)', (row, col) => ({ '1:2': 10, '1:3': 15 }[`${row}:${col}`] || 0)), 25)
assert.equal(evaluateFormula('B1+C1*2', (row, col) => ({ '1:2': 10, '1:3': 15 }[`${row}:${col}`] || 0)), 40)
assert.equal(formatFormulaResult(evaluateFormula('B1*(1+10%)', (row, col) => ({ '1:2': 100 }[`${row}:${col}`] || 0))), '110')

let cells = [
  makeCell(1, 1, '', 'B1+C1'),
  makeCell(1, 2, '10'),
  makeCell(1, 3, '15')
]
assert.equal(computeFormulaValueMap(cells).get('1:1'), '25')

cells = [
  makeCell(1, 1, '', 'B1+C1'),
  makeCell(1, 2, '20'),
  makeCell(1, 3, '15')
]
assert.equal(computeFormulaValueMap(cells).get('1:1'), '35')

cells = [
  makeCell(1, 1, '', 'SUM(B1:C2)'),
  makeCell(1, 2, '1'),
  makeCell(1, 3, '2'),
  makeCell(2, 2, '3'),
  makeCell(2, 3, '4')
]
assert.equal(computeFormulaValueMap(cells).get('1:1'), '10')

console.log('finance ledger formula checks passed')
