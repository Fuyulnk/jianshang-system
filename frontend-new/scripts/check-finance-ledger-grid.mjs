import assert from 'node:assert/strict'
import {
  buildMergeOwnerMap,
  defaultLedgerCellStyle,
  parseLedgerCellStyle,
  resolveLedgerCellStyle,
  resolveLedgerCellTarget
} from '../src/utils/financeLedgerGrid.js'

const mergeOwnerMap = buildMergeOwnerMap([
  { id: 1, start_row: 2, start_col: 2, end_row: 4, end_col: 3 }
])

assert.deepEqual(resolveLedgerCellTarget(2, 2, mergeOwnerMap), { row: 2, col: 2 })
assert.deepEqual(resolveLedgerCellTarget(3, 3, mergeOwnerMap), { row: 2, col: 2 })
assert.deepEqual(resolveLedgerCellTarget(5, 3, mergeOwnerMap), { row: 5, col: 3 })

const styleMap = new Map([
  ['2:2', { horizontal: 'center', vertical: 'middle', backgroundColor: '#dbeafe' }]
])
assert.deepEqual(resolveLedgerCellStyle(3, 3, mergeOwnerMap, styleMap), {
  horizontal: 'center',
  vertical: 'middle',
  backgroundColor: '#dbeafe'
})
assert.deepEqual(resolveLedgerCellStyle(5, 3, mergeOwnerMap, styleMap), defaultLedgerCellStyle)

assert.deepEqual(parseLedgerCellStyle('{"horizontal":"center","vertical":"middle","backgroundColor":"#dbeafe"}'), {
  horizontal: 'center',
  vertical: 'middle',
  backgroundColor: '#dbeafe'
})
assert.deepEqual(parseLedgerCellStyle({ horizontal: 'right', vertical: 'bottom', backgroundColor: '#fff' }), {
  horizontal: 'right',
  vertical: 'bottom',
  backgroundColor: '#fff'
})
assert.deepEqual(parseLedgerCellStyle({ horizontal: 'middle', vertical: 'center', backgroundColor: 'red' }), defaultLedgerCellStyle)
assert.deepEqual(parseLedgerCellStyle('{bad json'), defaultLedgerCellStyle)

console.log('finance ledger grid checks passed')
