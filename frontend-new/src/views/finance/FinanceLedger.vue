<template>
  <div class="finance-ledger" :class="{ 'ledger-fullscreen': fullscreen }">
    <el-card class="ledger-head" shadow="never">
      <div>
        <div class="kicker">财务工作台</div>
        <h2>入账登记表</h2>
        <p>导入 Excel 后保留工作表、单元格内容和原备注；右键单元格可新增或修改备注。</p>
      </div>
      <div class="head-actions">
        <input ref="fileInput" class="hidden-input" type="file" accept=".xlsx,.xls" @change="onImportFile" />
        <div class="action-row action-row-search">
          <el-input
            v-model="searchKeyword"
            class="ledger-search"
            clearable
            placeholder="搜索客户、金额、备注"
            :disabled="!activeSheet"
            @input="resetSearchCursor"
            @keyup.enter="focusSearchMatch(1)"
          />
          <span v-if="searchKeyword" class="search-count">{{ searchMatchLabel }}</span>
          <el-button :disabled="!searchMatches.length" @click="focusSearchMatch(-1)">上一个</el-button>
          <el-button :disabled="!searchMatches.length" @click="focusSearchMatch(1)">下一个</el-button>
          <el-checkbox v-model="filterToSearch" :disabled="!searchKeyword || !searchMatches.length" @change="resetSearchCursor">只看匹配行</el-checkbox>
        </div>
        <div class="action-row action-row-tools">
          <el-button :disabled="!workbook" @click="toggleFullscreen">{{ fullscreen ? '退出全屏' : '全屏填表' }}</el-button>
          <el-button :disabled="!workbook" @click="zoomOut">缩小</el-button>
          <el-button :disabled="!workbook" @click="zoomIn">放大</el-button>
          <el-popover placement="bottom-end" trigger="click" width="260" :disabled="!workbook">
            <template #reference>
              <el-button :disabled="!workbook">视图设置</el-button>
            </template>
            <div class="view-controls">
              <label>
                <span>行高</span>
                <el-slider v-model="rowHeightScale" :min="0.8" :max="1.8" :step="0.05" />
              </label>
              <label>
                <span>列宽</span>
                <el-slider v-model="colWidthScale" :min="0.75" :max="1.8" :step="0.05" />
              </label>
              <small>只影响当前工作表</small>
            </div>
          </el-popover>
          <el-dropdown :disabled="!workbook" @command="handleToolbarCommand">
            <el-button :disabled="!workbook">表格工具</el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="merge" :disabled="!activeSheet || !canMergeSelection">合并单元格</el-dropdown-item>
                <el-dropdown-item command="unmerge" :disabled="!activeSheet || !selectedRange">拆开单元格</el-dropdown-item>
                <el-dropdown-item divided command="freeze-row">冻结首行</el-dropdown-item>
                <el-dropdown-item command="freeze-col">冻结首列</el-dropdown-item>
                <el-dropdown-item command="freeze-both">冻结首行首列</el-dropdown-item>
                <el-dropdown-item command="freeze-selection" :disabled="!selectedRange">按选区冻结</el-dropdown-item>
                <el-dropdown-item command="freeze-clear">取消冻结</el-dropdown-item>
                <el-dropdown-item divided command="export">导出原格式</el-dropdown-item>
                <el-dropdown-item command="delete">删除当前表</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-popover placement="bottom-end" trigger="click" width="320" :disabled="!activeSheet">
            <template #reference>
              <el-button :disabled="!activeSheet">单元格样式</el-button>
            </template>
            <div class="cell-style-panel">
              <div class="style-panel-head">
                <strong>{{ selectedSingleCellLabel || '先点击一个单元格' }}</strong>
                <span>样式只作用于当前单元格</span>
              </div>
              <div class="style-group">
                <span>水平</span>
                <div class="style-button-row">
                  <button type="button" :class="{ active: activeCellStyle.horizontal === 'left' }" @click="applySelectedCellStyle({ horizontal: 'left' })">左</button>
                  <button type="button" :class="{ active: activeCellStyle.horizontal === 'center' }" @click="applySelectedCellStyle({ horizontal: 'center' })">中</button>
                  <button type="button" :class="{ active: activeCellStyle.horizontal === 'right' }" @click="applySelectedCellStyle({ horizontal: 'right' })">右</button>
                </div>
              </div>
              <div class="style-group">
                <span>垂直</span>
                <div class="style-button-row">
                  <button type="button" :class="{ active: activeCellStyle.vertical === 'top' }" @click="applySelectedCellStyle({ vertical: 'top' })">上</button>
                  <button type="button" :class="{ active: activeCellStyle.vertical === 'middle' }" @click="applySelectedCellStyle({ vertical: 'middle' })">中</button>
                  <button type="button" :class="{ active: activeCellStyle.vertical === 'bottom' }" @click="applySelectedCellStyle({ vertical: 'bottom' })">下</button>
                </div>
              </div>
              <div class="style-group">
                <span>底色</span>
                <div class="fill-swatch-row">
                  <button
                    v-for="color in fillColors"
                    :key="color"
                    type="button"
                    class="fill-swatch"
                    :class="{ active: activeCellStyle.backgroundColor === color }"
                    :style="{ backgroundColor: color }"
                    @click="applySelectedCellStyle({ backgroundColor: color })"
                  ></button>
                  <button type="button" class="fill-clear" @click="applySelectedCellStyle({ backgroundColor: '' })">清除</button>
                </div>
              </div>
            </div>
          </el-popover>
          <el-button type="primary" :loading="importing" @click="fileInput?.click()">导入入账登记表</el-button>
        </div>
      </div>
      <el-button v-if="fullscreen" class="fullscreen-exit" type="primary" @click="toggleFullscreen">退出全屏</el-button>
    </el-card>

    <div class="ledger-layout">
      <el-card class="workbook-list" shadow="never" v-loading="loadingList">
        <template #header>已导入表格</template>
        <button
          v-for="item in workbooks"
          :key="item.id"
          type="button"
          class="workbook-item"
          :class="{ active: workbook?.id === item.id }"
          @click="loadWorkbook(item.id)"
        >
          <strong>{{ item.title }}</strong>
          <span>{{ item.sheet_count }} 个工作表 · {{ item.comment_count }} 条备注</span>
          <small>{{ item.source_file_name }}</small>
        </button>
        <el-empty v-if="!loadingList && !workbooks.length" description="还没有导入入账登记表" :image-size="80" />
      </el-card>

      <el-card class="sheet-card" shadow="never" v-loading="loadingDetail">
        <template #header>
          <div class="sheet-head">
            <div>
              <strong>{{ workbook?.title || '选择左侧表格' }}</strong>
              <span v-if="activeSheet">当前工作表：{{ activeSheet.name }}，右键单元格可备注</span>
              <span v-if="selectedRange" class="selection-hint">已选：{{ selectedRangeLabel }}</span>
              <span v-if="freezeRows || freezeCols" class="selection-hint">冻结：{{ freezeLabel }}</span>
            </div>
            <el-tag v-if="activeSheet" type="info" size="small">显示前 {{ maxRows }} 行 / {{ maxCols }} 列</el-tag>
          </div>
        </template>

        <template v-if="activeSheet">
          <el-tabs :model-value="String(activeSheetId)" @tab-change="loadSheet">
            <el-tab-pane v-for="sheet in sheets" :key="sheet.id" :name="String(sheet.id)" :label="sheet.name" />
          </el-tabs>

          <div
            ref="gridViewport"
            class="ledger-grid-wrap"
            :style="{ '--ledger-zoom': zoom }"
            @scroll="onGridScroll"
          >
            <div class="ledger-grid-canvas" :style="{ width: `${gridWidth}px`, height: `${gridHeight}px` }">
              <div
                class="grid-corner"
                :style="{ transform: `translate(${scrollState.left}px, ${scrollState.top}px)` }"
              ></div>
              <div
                v-for="col in visibleCols"
                :key="`h-${col}`"
                class="grid-col-header"
                :class="{ frozen: isFrozenCol(col) }"
                :style="{ transform: `translate(${positionedLeft(col)}px, ${scrollState.top}px)`, width: `${colWidth(col)}px`, height: `${headerHeightPx}px` }"
              >
                <span>{{ colName(col) }}</span>
                <button
                  type="button"
                  class="col-resize-handle"
                  title="拖动调整这一列宽度，双击恢复"
                  @mousedown.stop.prevent="startColResize(col, $event)"
                  @dblclick.stop.prevent="resetColWidth(col)"
                ></button>
              </div>
              <div
                v-for="row in visibleRows"
                :key="`r-${row}`"
                class="grid-row-header"
                :class="{ frozen: isFrozenRow(row) }"
                :style="{ transform: `translate(${scrollState.left}px, ${positionedTop(row)}px)`, width: `${rowHeaderWidthPx}px`, height: `${rowHeight(row)}px` }"
              >
                <span>{{ row }}</span>
                <button
                  type="button"
                  class="row-resize-handle"
                  title="拖动调整这一行高度，双击恢复"
                  @mousedown.stop.prevent="startRowResize(row, $event)"
                  @dblclick.stop.prevent="resetRowHeight(row)"
                ></button>
              </div>
              <div
                v-for="item in visibleCellItems"
                :key="item.key"
                class="ledger-cell"
                :class="{
                  commented: Boolean(commentFor(item.row, item.col)),
                  selected: isItemSelected(item),
                  merged: Boolean(item.merge),
                  'search-hit': isSearchHit(item.row, item.col),
                  'search-active': isActiveSearchHit(item.row, item.col),
                  'frozen-row': isFrozenRow(item.row),
                  'frozen-col': isFrozenCol(item.col),
                  'frozen-corner-cell': isFrozenRow(item.row) && isFrozenCol(item.col),
                  [`align-${cellStyleFor(item.row, item.col).horizontal}`]: true,
                  [`valign-${cellStyleFor(item.row, item.col).vertical}`]: true
                }"
                :title="commentFor(item.row, item.col) || ''"
                :style="{
                  transform: `translate(${positionedLeft(item.col)}px, ${positionedTop(item.row)}px)`,
                  width: `${item.width}px`,
                  height: `${item.height}px`,
                  '--cell-fill': cellStyleFor(item.row, item.col).backgroundColor || 'var(--bg-card)'
                }"
                @click="selectCell(item.row, item.col, $event)"
                @dblclick="editCell(item.row, item.col)"
                @contextmenu.prevent="editComment(item.row, item.col)"
              >
                <span v-if="editingCell !== item.row+'-'+item.col" class="cell-text">
                  <span class="cell-content">{{ displayCellValue(cellFor(item.row, item.col)) }}</span>
                </span>
                <textarea
                  v-else
                  :value="editableCellValue(cellFor(item.row, item.col))"
                  @change="updateCell(item.row, item.col, $event.target.value)"
                  @keydown.enter.exact.prevent="$event.target.blur()"
                  @blur="editingCell = ''"
                />
                <i v-if="commentFor(item.row, item.col)" class="comment-dot"></i>
              </div>
            </div>
          </div>
        </template>
        <el-empty v-else description="请选择或导入一份入账登记表" :image-size="96" />
      </el-card>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getAuthToken } from '../../utils/authSession'

const workbooks = ref([])
const workbook = ref(null)
const sheets = ref([])
const activeSheetId = ref(0)
const cells = ref([])
const comments = ref([])
const merges = ref([])
const fileInput = ref(null)
const gridViewport = ref(null)
const loadingList = ref(false)
const loadingDetail = ref(false)
const importing = ref(false)
const exporting = ref(false)
const fullscreen = ref(false)
const activeCacheKey = ref('')
const detailCache = new Map()
const sheetViewSettings = reactive({})
const sheetViewDefaults = {
  zoom: 1,
  searchKeyword: '',
  activeSearchIndex: -1,
  filterToSearch: false,
  freezeRows: 0,
  freezeCols: 0,
  rowHeightScale: 1,
  colWidthScale: 1,
  rowHeights: {},
  colWidths: {}
}
const maxRows = 160
const maxCols = 26
const baseRowHeight = 38
const baseColWidth = 136
const baseRowHeaderWidth = 56
const baseHeaderHeight = 30
const minRowHeightUnit = 24
const maxRowHeightUnit = 220
const minColWidthUnit = 56
const maxColWidthUnit = 420
const overscan = 4
const defaultCellStyle = Object.freeze({ horizontal: 'left', vertical: 'top', backgroundColor: '' })
const fillColors = ['#fef3c7', '#dbeafe', '#dcfce7', '#fee2e2', '#ede9fe', '#fce7f3', '#e0f2fe', '#f8fafc']
const scrollState = reactive({ top: 0, left: 0, width: 900, height: 520 })
const resizingGrid = ref(null)
let scrollFrame = 0

const activeSheet = computed(() => sheets.value.find(sheet => Number(sheet.id) === Number(activeSheetId.value)) || null)
const activeSheetViewKey = computed(() => {
  if (!workbook.value?.id || !activeSheetId.value) return ''
  return `${workbook.value.id}:${activeSheetId.value}`
})
const activeSheetView = computed(() => getSheetView(activeSheetViewKey.value))
const zoom = sheetViewModel('zoom')
const searchKeyword = sheetViewModel('searchKeyword')
const activeSearchIndex = sheetViewModel('activeSearchIndex')
const filterToSearch = sheetViewModel('filterToSearch')
const freezeRows = sheetViewModel('freezeRows')
const freezeCols = sheetViewModel('freezeCols')
const rowHeightScale = sheetViewModel('rowHeightScale')
const colWidthScale = sheetViewModel('colWidthScale')
const rowHeights = sheetViewModel('rowHeights')
const colWidths = sheetViewModel('colWidths')
// 根据实际数据范围计算可见行列，不渲染空白格子
const dataRange = computed(() => {
  let maxR = 0, maxC = 0
  for (const cell of cells.value) {
    if (cell.row_index > maxR) maxR = cell.row_index
    if (cell.col_index > maxC) maxC = cell.col_index
  }
  return { rows: Math.min(Math.max(maxR + 2, 10), maxRows), cols: Math.min(Math.max(maxC + 2, 5), maxCols) }
})
const rows = computed(() => Array.from({ length: dataRange.value.rows }, (_, i) => i + 1))
const columns = computed(() => Array.from({ length: dataRange.value.cols }, (_, i) => i + 1))
const editingCell = ref('')
function editCell(row, col) { editingCell.value = `${row}-${col}` }
const selectedRange = ref(null)

const defaultRowHeightUnit = computed(() => Math.round(baseRowHeight * rowHeightScale.value))
const defaultColWidthUnit = computed(() => Math.round(baseColWidth * colWidthScale.value))
const rowHeightPx = computed(() => Math.round(defaultRowHeightUnit.value * zoom.value))
const colWidthPx = computed(() => Math.round(defaultColWidthUnit.value * zoom.value))
const rowHeaderWidthPx = computed(() => Math.round(baseRowHeaderWidth * zoom.value))
const headerHeightPx = computed(() => Math.round(baseHeaderHeight * zoom.value))
const gridWidth = computed(() => colOffsetState.value.total)
const gridHeight = computed(() => rowOffsetState.value.total)

const normalizedSearchKeyword = computed(() => searchKeyword.value.trim().toLowerCase())
const searchMatches = computed(() => {
  const keyword = normalizedSearchKeyword.value
  if (!keyword) return []
  const matches = []
  const seen = new Set()
  const pushMatch = (row, col) => {
    const key = `${row}:${col}`
    if (seen.has(key)) return
    seen.add(key)
    matches.push({ row: Number(row), col: Number(col), key })
  }
  for (const cell of cells.value) {
    const text = `${displayCellValue(cell)} ${cell.address || ''}`.toLowerCase()
    if (text.includes(keyword)) pushMatch(cell.row_index, cell.col_index)
  }
  for (const comment of comments.value) {
    const text = `${comment.comment_text || ''} ${comment.address || ''}`.toLowerCase()
    if (text.includes(keyword)) pushMatch(comment.row_index, comment.col_index)
  }
  return matches.sort((a, b) => a.row - b.row || a.col - b.col)
})
const searchMatchSet = computed(() => new Set(searchMatches.value.map(item => item.key)))
const currentSearchMatch = computed(() => {
  if (!searchMatches.value.length) return null
  const index = activeSearchIndex.value >= 0 ? activeSearchIndex.value : 0
  return searchMatches.value[index % searchMatches.value.length] || null
})
const searchMatchLabel = computed(() => {
  if (!normalizedSearchKeyword.value) return ''
  if (!searchMatches.value.length) return '0 项'
  const index = activeSearchIndex.value >= 0 ? activeSearchIndex.value + 1 : 1
  return `${index}/${searchMatches.value.length} 项`
})
const matchedRows = computed(() => [...new Set(searchMatches.value.map(item => item.row))].sort((a, b) => a - b))
const tableRows = computed(() => {
  if (filterToSearch.value && normalizedSearchKeyword.value && matchedRows.value.length) return matchedRows.value
  return rows.value
})
const rowPositionMap = computed(() => {
  const map = new Map()
  tableRows.value.forEach((row, index) => map.set(row, index + 1))
  return map
})
const rowOffsetState = computed(() => {
  const map = new Map()
  let top = headerHeightPx.value
  for (const row of tableRows.value) {
    map.set(Number(row), top)
    top += rowHeight(row)
  }
  return { map, total: top }
})
const colOffsetState = computed(() => {
  const map = new Map()
  let left = rowHeaderWidthPx.value
  for (const col of columns.value) {
    map.set(Number(col), left)
    left += colWidth(col)
  }
  return { map, total: left }
})
const frozenRows = computed(() => tableRows.value.slice(0, Math.min(freezeRows.value, tableRows.value.length)))
const frozenCols = computed(() => columns.value.slice(0, Math.min(freezeCols.value, columns.value.length)))
const freezeLabel = computed(() => {
  if (!freezeRows.value && !freezeCols.value) return '未冻结'
  const parts = []
  if (freezeRows.value) parts.push(`前 ${freezeRows.value} 行`)
  if (freezeCols.value) parts.push(`前 ${freezeCols.value} 列`)
  return parts.join('、')
})

const visibleBounds = computed(() => {
  const rowRange = visibleIndexRange(tableRows.value, rowOffsetState.value.map, rowHeight, scrollState.top, scrollState.top + scrollState.height)
  const colRange = visibleIndexRange(columns.value, colOffsetState.value.map, colWidth, scrollState.left, scrollState.left + scrollState.width)
  const rowStart = Math.max(1, rowRange.start - overscan)
  const rowEnd = Math.min(tableRows.value.length, rowRange.end + overscan)
  const colStart = Math.max(1, colRange.start - overscan)
  const colEnd = Math.min(dataRange.value.cols, colRange.end + overscan)
  return { rowStart, rowEnd, colStart, colEnd }
})
const visibleRows = computed(() => {
  const { rowStart, rowEnd } = visibleBounds.value
  const rowsInView = tableRows.value.slice(rowStart - 1, rowEnd)
  return unionNumbers(rowsInView, frozenRows.value)
})
const visibleCols = computed(() => {
  const { colStart, colEnd } = visibleBounds.value
  const colsInView = Array.from({ length: Math.max(0, colEnd - colStart + 1) }, (_, i) => colStart + i)
  return unionNumbers(colsInView, frozenCols.value)
})

const cellMap = computed(() => {
  const map = new Map()
  for (const cell of cells.value) map.set(`${cell.row_index}:${cell.col_index}`, cell)
  return map
})
const cellStyleMap = computed(() => {
  const map = new Map()
  for (const cell of cells.value) map.set(`${cell.row_index}:${cell.col_index}`, parseCellStyle(cell.style_json))
  return map
})
const formulaValueMap = computed(() => {
  const values = new Map()
  const visiting = new Set()
  const evaluateCell = (row, col) => {
    const key = `${Number(row)}:${Number(col)}`
    const cell = cellMap.value.get(key)
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
  for (const cell of cells.value) {
    if (!cell.formula) continue
    const key = `${cell.row_index}:${cell.col_index}`
    values.set(key, formatFormulaResult(evaluateCell(cell.row_index, cell.col_index)))
  }
  return values
})
const commentMap = computed(() => {
  const map = new Map()
  for (const comment of comments.value) map.set(`${comment.row_index}:${comment.col_index}`, comment)
  return map
})
const mergeMasterMap = computed(() => {
  const map = new Map()
  for (const merge of merges.value) map.set(`${merge.start_row}:${merge.start_col}`, merge)
  return map
})
const mergeOwnerMap = computed(() => {
  const map = new Map()
  for (const merge of merges.value) {
    const owner = { row: Number(merge.start_row), col: Number(merge.start_col), merge }
    for (let row = Number(merge.start_row); row <= Number(merge.end_row); row++) {
      for (let col = Number(merge.start_col); col <= Number(merge.end_col); col++) {
        map.set(`${row}:${col}`, owner)
      }
    }
  }
  return map
})
const coveredCellSet = computed(() => {
  const set = new Set()
  for (const merge of merges.value) {
    for (let row = Number(merge.start_row); row <= Number(merge.end_row); row++) {
      for (let col = Number(merge.start_col); col <= Number(merge.end_col); col++) {
        if (row === Number(merge.start_row) && col === Number(merge.start_col)) continue
        set.add(`${row}:${col}`)
      }
    }
  }
  return set
})
const visibleCellItems = computed(() => {
  const bounds = visibleBounds.value
  const items = new Map()
  for (const row of visibleRows.value) {
    for (const col of visibleCols.value) {
      if (coveredCellSet.value.has(`${row}:${col}`)) continue
      const merge = mergeMasterMap.value.get(`${row}:${col}`)
      items.set(`${row}:${col}`, makeCellItem(row, col, merge))
    }
  }
  for (const merge of merges.value) {
    if (!isMergeVisible(merge, bounds)) continue
    const key = `${merge.start_row}:${merge.start_col}`
    if (!items.has(key)) items.set(key, makeCellItem(Number(merge.start_row), Number(merge.start_col), merge))
  }
  return [...items.values()]
})
const selectedRangeLabel = computed(() => {
  if (!selectedRange.value) return ''
  return `${colName(selectedRange.value.startCol)}${selectedRange.value.startRow}:${colName(selectedRange.value.endCol)}${selectedRange.value.endRow}`
})
const selectedSingleCell = computed(() => {
  const range = selectedRange.value
  if (!range) return null
  return resolveCellTarget(range.startRow, range.startCol)
})
const selectedSingleCellLabel = computed(() => {
  if (!selectedSingleCell.value) return ''
  return `${colName(selectedSingleCell.value.col)}${selectedSingleCell.value.row}`
})
const activeCellStyle = computed(() => {
  if (!selectedSingleCell.value) return defaultCellStyle
  return cellStyleFor(selectedSingleCell.value.row, selectedSingleCell.value.col)
})
const canMergeSelection = computed(() => {
  const range = selectedRange.value
  return Boolean(range && (range.startRow !== range.endRow || range.startCol !== range.endCol))
})

function token() { return getAuthToken() }

function createSheetView() {
  return {
    ...sheetViewDefaults,
    rowHeights: {},
    colWidths: {}
  }
}

function getSheetView(key) {
  if (!key) return createSheetView()
  if (!sheetViewSettings[key]) sheetViewSettings[key] = createSheetView()
  return sheetViewSettings[key]
}

function sheetViewModel(field) {
  return computed({
    get: () => activeSheetView.value[field],
    set: value => {
      if (!activeSheetViewKey.value) return
      getSheetView(activeSheetViewKey.value)[field] = value
    }
  })
}

async function fetchWorkbooks() {
  loadingList.value = true
  try {
    const json = await requestJson('/api/finance/ledger/workbooks')
    workbooks.value = json.data || []
    if (!workbook.value && workbooks.value.length) await loadWorkbook(workbooks.value[0].id)
  } catch (err) {
    ElMessage.error(err.message || '入账登记表列表加载失败')
  } finally {
    loadingList.value = false
  }
}

async function loadWorkbook(id, sheetId = 0) {
  const cacheKey = `${id}:${sheetId || 0}`
  if (detailCache.has(cacheKey)) {
    applyWorkbookDetail(detailCache.get(cacheKey), cacheKey)
    return
  }
  loadingDetail.value = true
  try {
    const query = sheetId ? `?sheet_id=${sheetId}` : ''
    const json = await requestJson(`/api/finance/ledger/workbooks/${id}${query}`)
    detailCache.set(cacheKey, json.data)
    applyWorkbookDetail(json.data, cacheKey)
  } catch (err) {
    ElMessage.error(err.message || '入账登记表读取失败')
  } finally {
    loadingDetail.value = false
  }
}

function applyWorkbookDetail(detail, cacheKey = '') {
  workbook.value = detail.workbook
  sheets.value = detail.sheets || []
  activeSheetId.value = detail.active_sheet_id || sheets.value[0]?.id || 0
  cells.value = detail.cells || []
  comments.value = detail.comments || []
  merges.value = detail.merges || []
  activeCacheKey.value = cacheKey
  selectedRange.value = null
  editingCell.value = ''
  activeSearchIndex.value = -1
  nextTick(updateGridViewport)
}

function loadSheet(name) {
  if (!workbook.value) return
  loadWorkbook(workbook.value.id, Number(name))
}

async function onImportFile(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  importing.value = true
  try {
    const json = await requestJson('/api/finance/ledger/workbooks/import', {
      file_name: file.name,
      file_data: await readAsDataUrl(file)
    }, 'POST')
    ElMessage.success('入账登记表已导入')
    detailCache.clear()
    await fetchWorkbooks()
    if (json.data?.workbook?.id) await loadWorkbook(json.data.workbook.id)
  } catch (err) {
    ElMessage.error(err.message || '入账登记表导入失败')
  } finally {
    importing.value = false
  }
}

async function exportWorkbook() {
  if (!workbook.value?.id) {
    ElMessage.warning('请先选择一份入账登记表')
    return
  }
  exporting.value = true
  try {
    await downloadFile(`/api/finance/ledger/workbooks/${workbook.value.id}/export`, `${workbook.value.title || '入账登记表'}-原格式导出.xlsx`)
  } catch (err) {
    ElMessage.error(err.message || '入账登记表导出失败')
  } finally {
    exporting.value = false
  }
}

async function deleteWorkbook() {
  if (!workbook.value?.id) return
  try {
    await ElMessageBox.confirm(`确定删除「${workbook.value.title}」吗？这只删除系统里的导入记录，不会动你电脑上的原始文件。`, '删除入账登记表', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消'
    })
    await requestJson(`/api/finance/ledger/workbooks/${workbook.value.id}`, null, 'DELETE')
    ElMessage.success('入账登记表已删除')
    detailCache.clear()
    workbook.value = null
    sheets.value = []
    activeSheetId.value = 0
    cells.value = []
    comments.value = []
    merges.value = []
    await fetchWorkbooks()
  } catch (err) {
    if (err !== 'cancel') ElMessage.error(err.message || '删除失败')
  }
}

function makeCellItem(row, col, merge = null) {
  return {
    key: merge ? `m-${merge.id || `${row}-${col}`}` : `${row}-${col}`,
    row,
    col,
    merge,
    width: merge ? mergeWidth(merge) : colWidth(col),
    height: merge ? mergeHeight(merge) : rowHeight(row)
  }
}

function rangesOverlap(aStartRow, aEndRow, bStartRow, bEndRow, aStartCol, aEndCol, bStartCol, bEndCol) {
  return !(aEndRow < bStartRow || aStartRow > bEndRow || aEndCol < bStartCol || aStartCol > bEndCol)
}

function unionNumbers(primary = [], pinned = []) {
  return [...new Set([...pinned, ...primary].map(Number).filter(Boolean))].sort((a, b) => a - b)
}

function isMergeVisible(merge, bounds) {
  const startRow = Number(merge.start_row)
  const endRow = Number(merge.end_row)
  const startCol = Number(merge.start_col)
  const endCol = Number(merge.end_col)
  if (!rowPositionMap.value.has(startRow)) return false
  const hasVisibleRow = visibleRows.value.some(row => row >= startRow && row <= endRow)
  const hasVisibleCol = visibleCols.value.some(col => col >= startCol && col <= endCol)
  if (hasVisibleRow && hasVisibleCol) return true
  return rangesOverlap(startRow, endRow, bounds.rowStart, bounds.rowEnd, startCol, endCol, bounds.colStart, bounds.colEnd)
}

function rowHeight(row) {
  const custom = Number(rowHeights.value?.[Number(row)])
  const unit = Number.isFinite(custom) && custom > 0 ? custom : defaultRowHeightUnit.value
  return Math.round(unit * zoom.value)
}

function colWidth(col) {
  const custom = Number(colWidths.value?.[Number(col)])
  const unit = Number.isFinite(custom) && custom > 0 ? custom : defaultColWidthUnit.value
  return Math.round(unit * zoom.value)
}

function visibleIndexRange(items, offsetMap, sizeGetter, startPx, endPx) {
  let start = 1
  let end = Math.max(1, items.length)
  let hasStart = false
  let hasVisible = false
  for (let index = 0; index < items.length; index++) {
    const item = Number(items[index])
    const offset = offsetMap.get(item) ?? 0
    const size = sizeGetter(item)
    if (offset + size >= startPx && offset <= endPx) {
      if (!hasStart) {
        start = index + 1
        hasStart = true
      }
      end = index + 1
      hasVisible = true
    } else if (hasVisible && offset > endPx) {
      break
    }
  }
  return { start, end }
}

function mergeWidth(merge) {
  let width = 0
  for (let col = Number(merge.start_col); col <= Number(merge.end_col); col++) {
    width += colWidth(col)
  }
  return width || colWidth(Number(merge.start_col))
}

function mergeHeight(merge) {
  let height = 0
  for (let row = Number(merge.start_row); row <= Number(merge.end_row); row++) {
    if (!rowPositionMap.value.has(row)) continue
    height += rowHeight(row)
  }
  return height || rowHeight(Number(merge.start_row))
}

function cellLeft(col) {
  return colOffsetState.value.map.get(Number(col)) ?? rowHeaderWidthPx.value
}

function cellTop(row) {
  return rowOffsetState.value.map.get(Number(row)) ?? headerHeightPx.value
}

function isFrozenRow(row) {
  const position = rowPositionMap.value.get(Number(row))
  return Boolean(position && freezeRows.value && position <= freezeRows.value)
}

function isFrozenCol(col) {
  return Boolean(freezeCols.value && Number(col) <= freezeCols.value)
}

function positionedLeft(col) {
  return cellLeft(col) + (isFrozenCol(col) ? scrollState.left : 0)
}

function positionedTop(row) {
  return cellTop(row) + (isFrozenRow(row) ? scrollState.top : 0)
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function setRowHeight(row, nextPixelHeight) {
  const nextUnit = clampNumber(Math.round(nextPixelHeight / zoom.value), minRowHeightUnit, maxRowHeightUnit)
  rowHeights.value = { ...(rowHeights.value || {}), [Number(row)]: nextUnit }
  nextTick(updateGridViewport)
}

function setColWidth(col, nextPixelWidth) {
  const nextUnit = clampNumber(Math.round(nextPixelWidth / zoom.value), minColWidthUnit, maxColWidthUnit)
  colWidths.value = { ...(colWidths.value || {}), [Number(col)]: nextUnit }
  nextTick(updateGridViewport)
}

function resetRowHeight(row) {
  const next = { ...(rowHeights.value || {}) }
  delete next[Number(row)]
  rowHeights.value = next
  nextTick(updateGridViewport)
}

function resetColWidth(col) {
  const next = { ...(colWidths.value || {}) }
  delete next[Number(col)]
  colWidths.value = next
  nextTick(updateGridViewport)
}

function startColResize(col, event) {
  resizingGrid.value = {
    type: 'col',
    index: Number(col),
    startClient: event.clientX,
    startSize: colWidth(col)
  }
  document.body.classList.add('ledger-resizing-col')
  window.addEventListener('mousemove', onGridResizeMove)
  window.addEventListener('mouseup', stopGridResize)
}

function startRowResize(row, event) {
  resizingGrid.value = {
    type: 'row',
    index: Number(row),
    startClient: event.clientY,
    startSize: rowHeight(row)
  }
  document.body.classList.add('ledger-resizing-row')
  window.addEventListener('mousemove', onGridResizeMove)
  window.addEventListener('mouseup', stopGridResize)
}

function onGridResizeMove(event) {
  const state = resizingGrid.value
  if (!state) return
  const currentClient = state.type === 'col' ? event.clientX : event.clientY
  const nextSize = state.startSize + currentClient - state.startClient
  if (state.type === 'col') setColWidth(state.index, nextSize)
  else setRowHeight(state.index, nextSize)
}

function stopGridResize() {
  resizingGrid.value = null
  document.body.classList.remove('ledger-resizing-col', 'ledger-resizing-row')
  window.removeEventListener('mousemove', onGridResizeMove)
  window.removeEventListener('mouseup', stopGridResize)
}

function onGridScroll(event) {
  const target = event.target
  if (scrollFrame) cancelAnimationFrame(scrollFrame)
  scrollFrame = requestAnimationFrame(() => {
    scrollState.top = target.scrollTop
    scrollState.left = target.scrollLeft
    scrollState.width = target.clientWidth
    scrollState.height = target.clientHeight
    scrollFrame = 0
  })
}

function updateGridViewport() {
  const el = gridViewport.value
  if (!el) return
  scrollState.top = el.scrollTop
  scrollState.left = el.scrollLeft
  scrollState.width = el.clientWidth || scrollState.width
  scrollState.height = el.clientHeight || scrollState.height
}

function selectCell(row, col, event) {
  const target = resolveCellTarget(row, col)
  if (event?.shiftKey && selectedRange.value) {
    selectedRange.value = normalizeRange(selectedRange.value.startRow, selectedRange.value.startCol, target.row, target.col)
  } else {
    selectedRange.value = normalizeRange(target.row, target.col, target.row, target.col)
  }
}

function resolveCellTarget(row, col) {
  const owner = mergeOwnerMap.value.get(`${Number(row)}:${Number(col)}`)
  return owner ? { row: owner.row, col: owner.col } : { row: Number(row), col: Number(col) }
}

function normalizeRange(startRow, startCol, endRow, endCol) {
  return {
    startRow: Math.min(Number(startRow), Number(endRow)),
    startCol: Math.min(Number(startCol), Number(endCol)),
    endRow: Math.max(Number(startRow), Number(endRow)),
    endCol: Math.max(Number(startCol), Number(endCol))
  }
}

function isItemSelected(item) {
  const range = selectedRange.value
  if (!range) return false
  const itemEndRow = item.merge ? Number(item.merge.end_row) : item.row
  const itemEndCol = item.merge ? Number(item.merge.end_col) : item.col
  return rangesOverlap(item.row, itemEndRow, range.startRow, range.endRow, item.col, itemEndCol, range.startCol, range.endCol)
}

async function mergeSelectedCells() {
  if (!activeSheet.value || !canMergeSelection.value) return
  try {
    const range = selectedRange.value
    const json = await requestJson('/api/finance/ledger/merges', {
      sheet_id: activeSheetId.value,
      start_row: range.startRow,
      start_col: range.startCol,
      end_row: range.endRow,
      end_col: range.endCol
    }, 'PUT')
    upsertLocal(merges.value, json.data)
    if (activeCacheKey.value && detailCache.has(activeCacheKey.value)) {
      const cached = detailCache.get(activeCacheKey.value)
      if (!Array.isArray(cached.merges)) cached.merges = []
      upsertLocal(cached.merges, json.data)
    }
    ElMessage.success('单元格已合并')
  } catch (err) {
    ElMessage.error(err.message || '合并单元格失败')
  }
}

async function unmergeSelectedCell() {
  if (!activeSheet.value || !selectedRange.value) return
  try {
    const json = await requestJson('/api/finance/ledger/merges', {
      sheet_id: activeSheetId.value,
      row_index: selectedRange.value.startRow,
      col_index: selectedRange.value.startCol
    }, 'DELETE')
    const deletedId = Number(json.data?.id || 0)
    merges.value = merges.value.filter(item => Number(item.id) !== deletedId)
    if (activeCacheKey.value && detailCache.has(activeCacheKey.value)) {
      const cached = detailCache.get(activeCacheKey.value)
      cached.merges = (cached.merges || []).filter(item => Number(item.id) !== deletedId)
    }
    ElMessage.success('合并单元格已拆开')
  } catch (err) {
    ElMessage.error(err.message || '拆开单元格失败')
  }
}

function parseCellStyle(value) {
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

function cellStyleFor(row, col) {
  return cellStyleMap.value.get(`${row}:${col}`) || defaultCellStyle
}

async function applySelectedCellStyle(partial) {
  const target = selectedSingleCell.value
  if (!activeSheet.value || !target) {
    ElMessage.warning('请先点击一个单元格')
    return
  }
  const current = cellStyleFor(target.row, target.col)
  const nextStyle = parseCellStyle({ ...current, ...partial })
  const cell = cellFor(target.row, target.col)
  try {
    const json = await requestJson(`/api/finance/ledger/cells/${cell.id || 0}/style`, {
      sheet_id: activeSheetId.value,
      row_index: target.row,
      col_index: target.col,
      style: nextStyle
    }, 'PUT')
    upsertLocal(cells.value, json.data)
    if (activeCacheKey.value && detailCache.has(activeCacheKey.value)) {
      const cached = detailCache.get(activeCacheKey.value)
      cached.cells = cached.cells || []
      upsertLocal(cached.cells, json.data)
    }
  } catch (err) {
    ElMessage.error(err.message || '单元格样式保存失败')
  }
}

function cellFor(row, col) {
  return cellMap.value.get(`${row}:${col}`) || {
    id: 0,
    sheet_id: activeSheetId.value,
    row_index: row,
    col_index: col,
    address: `${colName(col)}${row}`,
    value: ''
  }
}

function displayCellValue(cell) {
  const key = `${cell?.row_index}:${cell?.col_index}`
  const text = String(cell?.formula ? (formulaValueMap.value.get(key) ?? cell.value ?? '') : (cell?.value ?? ''))
  return formatLedgerDisplayText(text)
}

function editableCellValue(cell) {
  if (cell?.formula) return `=${String(cell.formula).replace(/^=+/, '')}`
  return displayCellValue(cell)
}

function formatLedgerDisplayText(value) {
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

function parseFormulaNumber(value) {
  const text = String(value ?? '').replace(/,/g, '').trim()
  if (!text) return 0
  if (text.endsWith('%')) {
    const percent = Number(text.slice(0, -1))
    return Number.isFinite(percent) ? percent / 100 : 0
  }
  const number = Number(text)
  return Number.isFinite(number) ? number : 0
}

function evaluateFormula(formula, evaluateCell) {
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

function formatFormulaResult(value) {
  if (value === '' || value === null || value === undefined) return ''
  const number = Number(value)
  if (!Number.isFinite(number)) return ''
  if (Number.isInteger(number)) return String(number)
  return String(Number(number.toFixed(6)))
}

function commentFor(row, col) {
  return commentMap.value.get(`${row}:${col}`)?.comment_text || ''
}

async function updateCell(row, col, value) {
  const cell = cellFor(row, col)
  if (String(editableCellValue(cell) || '') === String(value || '')) return
  try {
    const json = await requestJson(`/api/finance/ledger/cells/${cell.id || 0}`, {
      sheet_id: activeSheetId.value,
      row_index: row,
      col_index: col,
      value
    }, 'PUT')
    upsertLocal(cells.value, json.data)
    if (activeCacheKey.value && detailCache.has(activeCacheKey.value)) {
      upsertLocal(detailCache.get(activeCacheKey.value).cells, json.data)
    }
    ElMessage.success('单元格已保存')
  } catch (err) {
    ElMessage.error(err.message || '单元格保存失败')
  }
}

async function editComment(row, col) {
  const oldText = commentFor(row, col)
  try {
    const { value } = await ElMessageBox.prompt(
      `备注 ${colName(col)}${row}`,
      '单元格备注',
      {
        confirmButtonText: '保存备注',
        cancelButtonText: '取消',
        inputType: 'textarea',
        inputValue: oldText
      }
    )
    const json = await requestJson('/api/finance/ledger/comments', {
      sheet_id: activeSheetId.value,
      row_index: row,
      col_index: col,
      comment_text: value
    }, 'PUT')
    upsertLocal(comments.value, json.data)
    if (activeCacheKey.value && detailCache.has(activeCacheKey.value)) {
      upsertLocal(detailCache.get(activeCacheKey.value).comments, json.data)
    }
    ElMessage.success('备注已保存')
  } catch (err) {
    if (err !== 'cancel') ElMessage.error(err.message || '备注保存失败')
  }
}

function upsertLocal(list, row) {
  const index = list.findIndex(item => Number(item.id) === Number(row.id))
  if (index >= 0) list.splice(index, 1, row)
  else list.push(row)
}

async function requestJson(url, body = null, method = 'GET') {
  const options = { method, headers: { Authorization: `Bearer ${token()}` } }
  if (body) {
    options.headers['Content-Type'] = 'application/json'
    options.body = JSON.stringify(body)
  }
  const res = await fetch(url, options)
  const text = await res.text()
  let json = {}
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(text.slice(0, 120) || '服务器返回异常')
  }
  if (!res.ok || !json.success) {
    if (res.status === 404) throw new Error(json.message || '当前服务器还没有这个接口，请同步后端并重启服务')
    throw new Error(json.message || `请求失败（HTTP ${res.status}）`)
  }
  return json
}

async function downloadFile(url, fallbackName) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token()}` }
  })
  if (!res.ok) {
    let message = '下载失败'
    try {
      const json = await res.json()
      message = json.message || message
    } catch {}
    throw new Error(message)
  }
  const blob = await res.blob()
  const disposition = res.headers.get('Content-Disposition') || ''
  const matched = disposition.match(/filename\*=UTF-8''([^;]+)/)
  const fileName = matched ? decodeURIComponent(matched[1]) : fallbackName
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(objectUrl)
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function zoomIn() {
  zoom.value = Math.min(1.35, Math.round((zoom.value + 0.1) * 10) / 10)
  nextTick(updateGridViewport)
}

function zoomOut() {
  zoom.value = Math.max(0.8, Math.round((zoom.value - 0.1) * 10) / 10)
  nextTick(updateGridViewport)
}

function toggleFullscreen() {
  fullscreen.value = !fullscreen.value
  nextTick(updateGridViewport)
}

function resetSearchCursor() {
  activeSearchIndex.value = searchMatches.value.length ? 0 : -1
  if (filterToSearch.value && !normalizedSearchKeyword.value) filterToSearch.value = false
  nextTick(updateGridViewport)
}

function focusSearchMatch(step = 1) {
  if (!searchMatches.value.length) return
  const total = searchMatches.value.length
  const current = activeSearchIndex.value >= 0 ? activeSearchIndex.value : (step > 0 ? -1 : 0)
  activeSearchIndex.value = (current + step + total) % total
  const match = searchMatches.value[activeSearchIndex.value]
  const target = resolveCellTarget(match.row, match.col)
  selectedRange.value = normalizeRange(target.row, target.col, target.row, target.col)
  nextTick(() => scrollToCell(target.row, target.col))
}

function scrollToCell(row, col) {
  const el = gridViewport.value
  if (!el) return
  const top = Math.max(0, cellTop(row) - headerHeightPx.value - rowHeight(row))
  const left = Math.max(0, cellLeft(col) - rowHeaderWidthPx.value - colWidth(col))
  el.scrollTo({ top, left, behavior: 'smooth' })
}

function isSearchHit(row, col) {
  return Boolean(normalizedSearchKeyword.value && searchMatchSet.value.has(`${row}:${col}`))
}

function isActiveSearchHit(row, col) {
  const match = currentSearchMatch.value
  return Boolean(match && Number(match.row) === Number(row) && Number(match.col) === Number(col))
}

function handleToolbarCommand(command) {
  const range = selectedRange.value
  switch (command) {
    case 'merge':
      mergeSelectedCells()
      break
    case 'unmerge':
      unmergeSelectedCell()
      break
    case 'freeze-row':
      freezeRows.value = 1
      freezeCols.value = 0
      break
    case 'freeze-col':
      freezeRows.value = 0
      freezeCols.value = 1
      break
    case 'freeze-both':
      freezeRows.value = 1
      freezeCols.value = 1
      break
    case 'freeze-selection':
      freezeRows.value = range ? Math.max(0, range.startRow - 1) : 0
      freezeCols.value = range ? Math.max(0, range.startCol - 1) : 0
      break
    case 'freeze-clear':
      freezeRows.value = 0
      freezeCols.value = 0
      break
    case 'export':
      exportWorkbook()
      break
    case 'delete':
      deleteWorkbook()
      break
  }
  nextTick(updateGridViewport)
}

function colName(index) {
  let n = Number(index)
  let name = ''
  while (n > 0) {
    const mod = (n - 1) % 26
    name = String.fromCharCode(65 + mod) + name
    n = Math.floor((n - mod) / 26)
  }
  return name || 'A'
}

onMounted(() => {
  window.addEventListener('resize', updateGridViewport)
  fetchWorkbooks()
  nextTick(updateGridViewport)
})
onUnmounted(() => {
  window.removeEventListener('resize', updateGridViewport)
  stopGridResize()
  if (scrollFrame) cancelAnimationFrame(scrollFrame)
})
</script>

<style scoped>
.finance-ledger {
  display: grid;
  gap: 16px;
}
.ledger-fullscreen {
  position: fixed;
  inset: 0;
  z-index: 1000;
  padding: 10px 12px;
  overflow: hidden;
  background: var(--bg-page);
}
.ledger-fullscreen .ledger-layout {
  grid-template-columns: 220px minmax(0, 1fr);
  height: calc(100dvh - 94px);
}
.ledger-fullscreen .sheet-card,
.ledger-fullscreen .workbook-list {
  min-height: 0;
}
.ledger-fullscreen .ledger-grid-wrap {
  height: calc(100dvh - 206px);
}
.ledger-fullscreen .ledger-head :deep(.el-card__body) {
  align-items: flex-start;
}
.ledger-fullscreen .ledger-head p {
  display: none;
}
.ledger-fullscreen .head-actions {
  max-width: min(980px, 70vw);
  max-height: none;
  overflow: visible;
  flex-wrap: nowrap;
  padding-bottom: 2px;
}
.ledger-head {
  border: 1px solid var(--border-light);
}
.ledger-head :deep(.el-card__body) {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.kicker {
  color: var(--color-primary);
  font-size: 12px;
  font-weight: 700;
}
.ledger-head h2 {
  margin: 4px 0;
  color: var(--text-primary);
}
.ledger-head p {
  margin: 0;
  color: var(--text-secondary);
}
.hidden-input {
  display: none;
}
.head-actions {
  display: grid;
  justify-items: end;
  gap: 8px;
}
.action-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}
.action-row-tools {
  padding-top: 2px;
}
.ledger-search {
  width: 240px;
}
.search-count {
  min-width: 54px;
  color: var(--text-secondary);
  font-size: 12px;
  text-align: center;
}
.view-controls {
  display: grid;
  gap: 10px;
}
.view-controls label {
  display: grid;
  gap: 4px;
  color: var(--text-secondary);
  font-size: 12px;
}
.cell-style-panel {
  display: grid;
  gap: 14px;
}
.style-panel-head {
  display: grid;
  gap: 2px;
}
.style-panel-head strong {
  color: var(--text-primary);
  font-size: 14px;
}
.style-panel-head span,
.style-group > span {
  color: var(--text-secondary);
  font-size: 12px;
}
.style-group {
  display: grid;
  gap: 8px;
}
.style-button-row,
.fill-swatch-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.style-button-row button,
.fill-clear {
  min-width: 42px;
  height: 30px;
  border: 1px solid var(--border-light);
  border-radius: 7px;
  background: var(--bg-card);
  color: var(--text-primary);
  cursor: pointer;
}
.style-button-row button.active,
.fill-clear:hover {
  border-color: color-mix(in srgb, var(--color-primary) 70%, var(--border-light));
  color: var(--color-primary);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-primary) 30%, transparent);
}
.fill-swatch {
  width: 28px;
  height: 28px;
  border: 1px solid var(--border-light);
  border-radius: 50%;
  cursor: pointer;
}
.fill-swatch.active {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 16%, transparent);
}
.fullscreen-exit {
  position: fixed;
  right: 24px;
  bottom: 18px;
  z-index: 1100;
  box-shadow: 0 10px 28px rgba(37, 99, 235, 0.22);
}
.ledger-layout {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 16px;
}
.workbook-list,
.sheet-card {
  border: 1px solid var(--border-light);
}
.workbook-item {
  width: 100%;
  display: grid;
  gap: 4px;
  margin-bottom: 8px;
  padding: 10px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
}
.workbook-item.active {
  border-color: color-mix(in srgb, var(--color-primary) 50%, var(--border-light));
  background: color-mix(in srgb, var(--color-primary) 8%, var(--bg-card));
}
.workbook-item span,
.workbook-item small,
.sheet-head span {
  color: var(--text-secondary);
  font-size: 12px;
}
.sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.sheet-head strong,
.sheet-head span {
  display: block;
}
.selection-hint {
  margin-top: 3px;
  color: var(--color-primary) !important;
  font-weight: 700;
}
.ledger-grid-wrap {
  position: relative;
  overflow: auto;
  height: calc(100vh - 276px);
  height: calc(100dvh - 276px);
  min-height: 420px;
  border: 1px solid color-mix(in srgb, var(--border-light) 72%, #64748b);
  border-radius: var(--radius-sm);
  will-change: transform;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  background: var(--bg-card);
  contain: strict;
}
.ledger-grid-canvas {
  position: relative;
  min-width: 100%;
  min-height: 100%;
  font-size: calc(13px * var(--ledger-zoom, 1));
}
.grid-corner,
.grid-col-header,
.grid-row-header,
.ledger-cell {
  position: absolute;
  box-sizing: border-box;
  border: 1px solid color-mix(in srgb, var(--border-light) 64%, #64748b);
  background: var(--cell-fill, var(--bg-card));
  overflow: hidden;
  transform-origin: top left;
}
.grid-corner {
  z-index: 20;
  width: calc(56px * var(--ledger-zoom, 1));
  height: calc(30px * var(--ledger-zoom, 1));
  background: color-mix(in srgb, var(--bg-page) 88%, var(--bg-card));
}
.grid-col-header,
.grid-row-header {
  z-index: 6;
  display: grid;
  place-items: center;
  user-select: none;
  background: color-mix(in srgb, var(--bg-page) 86%, var(--bg-card));
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 700;
}
.grid-col-header span,
.grid-row-header span {
  pointer-events: none;
}
.grid-row-header {
  z-index: 7;
}
.col-resize-handle,
.row-resize-handle {
  position: absolute;
  z-index: 3;
  padding: 0;
  border: 0;
  background: transparent;
  opacity: 0;
}
.col-resize-handle {
  top: 0;
  right: -4px;
  width: 8px;
  height: 100%;
  cursor: col-resize;
}
.row-resize-handle {
  right: 0;
  bottom: -4px;
  left: 0;
  height: 8px;
  cursor: row-resize;
}
.grid-col-header:hover .col-resize-handle,
.grid-row-header:hover .row-resize-handle {
  opacity: 1;
}
.grid-col-header:hover .col-resize-handle {
  background: linear-gradient(90deg, transparent 3px, var(--color-primary) 3px, var(--color-primary) 5px, transparent 5px);
}
.grid-row-header:hover .row-resize-handle {
  background: linear-gradient(180deg, transparent 3px, var(--color-primary) 3px, var(--color-primary) 5px, transparent 5px);
}
:global(body.ledger-resizing-col),
:global(body.ledger-resizing-col *) {
  cursor: col-resize !important;
  user-select: none !important;
}
:global(body.ledger-resizing-row),
:global(body.ledger-resizing-row *) {
  cursor: row-resize !important;
  user-select: none !important;
}
.grid-col-header.frozen {
  z-index: 18;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);
}
.grid-row-header.frozen {
  z-index: 19;
  box-shadow: 2px 0 8px rgba(15, 23, 42, 0.08);
}
.ledger-cell {
  z-index: 1;
  color: var(--text-primary);
}
.ledger-cell.frozen-row {
  z-index: 12;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.06);
}
.ledger-cell.frozen-col {
  z-index: 13;
  box-shadow: 2px 0 8px rgba(15, 23, 42, 0.06);
}
.ledger-cell.frozen-corner-cell {
  z-index: 14;
}
.ledger-cell.selected {
  z-index: 16;
  box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--color-primary) 62%, transparent);
  background: color-mix(in srgb, var(--color-primary) 6%, var(--cell-fill, var(--bg-card)));
}
.ledger-cell.search-hit {
  background: color-mix(in srgb, #facc15 22%, var(--cell-fill, var(--bg-card)));
}
.ledger-cell.search-active {
  z-index: 17;
  box-shadow:
    inset 0 0 0 2px #f59e0b,
    0 0 0 2px rgba(245, 158, 11, 0.18);
}
.ledger-cell.merged {
  background: color-mix(in srgb, var(--cell-fill, var(--bg-card)) 92%, #dbeafe);
}
.cell-text {
  display: flex;
  align-items: flex-start;
  height: 100%;
  min-height: 28px;
  padding: 8px 9px;
  font-size: 13px;
  line-height: 1.35;
  cursor: default;
  white-space: pre-wrap;
  overflow: hidden;
}
.cell-content {
  width: 100%;
}
.ledger-cell.align-center .cell-text,
.ledger-cell.align-center textarea {
  justify-content: center;
  text-align: center;
}
.ledger-cell.align-right .cell-text,
.ledger-cell.align-right textarea {
  justify-content: flex-end;
  text-align: right;
}
.ledger-cell.valign-middle .cell-text {
  align-items: center;
}
.ledger-cell.valign-bottom .cell-text {
  align-items: flex-end;
}
.ledger-cell textarea {
  width: 100%;
  height: 100%;
  padding: 8px;
  border: 0;
  resize: none;
  background: transparent;
  color: var(--text-primary);
  caret-color: #2563eb;
  font: inherit;
  outline: none;
}
.ledger-cell textarea::selection {
  color: #0f172a;
  background: rgba(37, 99, 235, 0.22);
}
.ledger-cell textarea:focus {
  background: color-mix(in srgb, var(--color-primary) 6%, var(--bg-card));
  box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--color-primary) 50%, transparent);
}
.ledger-cell.commented {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, #f59e0b 24%, transparent);
}
.comment-dot {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 0;
  height: 0;
  border-top: 9px solid #f59e0b;
  border-left: 9px solid transparent;
  pointer-events: none;
}
:global(html.dark) .ledger-grid-wrap {
  border-color: rgba(148, 163, 184, 0.34);
  background: #0f172a;
}
:global(html.dark) .grid-corner,
:global(html.dark) .grid-col-header,
:global(html.dark) .grid-row-header {
  border-color: rgba(148, 163, 184, 0.34);
  background: #182235;
  color: #dbe5f4;
}
:global(html.dark) .ledger-cell {
  border-color: rgba(148, 163, 184, 0.34);
  background: var(--cell-fill, #111827);
  color: #f4f7fb;
}
:global(html.dark) .ledger-cell.merged {
  background: color-mix(in srgb, var(--cell-fill, #111827) 90%, #334155);
}
:global(html.dark) .ledger-cell.selected {
  background: color-mix(in srgb, var(--color-primary) 16%, var(--cell-fill, #111827));
}
:global(html.dark) .ledger-cell.search-hit {
  background: color-mix(in srgb, #facc15 30%, var(--cell-fill, #111827));
  color: #111827;
}
:global(html.dark) .ledger-cell.search-active {
  box-shadow:
    inset 0 0 0 2px #fbbf24,
    0 0 0 2px rgba(251, 191, 36, 0.22);
}
:global(html.dark) .cell-text,
:global(html.dark) .ledger-cell textarea {
  color: inherit;
  -webkit-text-fill-color: currentColor;
}
:global(html.dark) .ledger-cell textarea:focus {
  background: color-mix(in srgb, var(--color-primary) 14%, transparent);
}
@media (max-width: 980px) {
  .ledger-head :deep(.el-card__body),
  .sheet-head {
    align-items: flex-start;
    flex-direction: column;
  }
  .ledger-layout {
    grid-template-columns: 1fr;
  }
  .ledger-search {
    width: min(100%, 280px);
  }
}
</style>
