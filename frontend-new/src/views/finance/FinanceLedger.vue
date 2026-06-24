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
        <el-button :disabled="!workbook" @click="toggleFullscreen">{{ fullscreen ? '退出全屏' : '全屏填表' }}</el-button>
        <el-button :disabled="!workbook" @click="zoomOut">缩小</el-button>
        <el-button :disabled="!workbook" @click="zoomIn">放大</el-button>
        <el-button :disabled="!activeSheet || !canMergeSelection" @click="mergeSelectedCells">合并单元格</el-button>
        <el-button :disabled="!activeSheet || !selectedRange" @click="unmergeSelectedCell">拆开单元格</el-button>
        <el-button :disabled="!workbook" :loading="exporting" @click="exportWorkbook">导出原格式</el-button>
        <el-button :disabled="!workbook" type="danger" plain @click="deleteWorkbook">删除</el-button>
        <el-button type="primary" :loading="importing" @click="fileInput?.click()">导入入账登记表</el-button>
      </div>
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
                :style="{ transform: `translate(${cellLeft(col)}px, ${scrollState.top}px)`, width: `${colWidthPx}px`, height: `${headerHeightPx}px` }"
              >
                {{ colName(col) }}
              </div>
              <div
                v-for="row in visibleRows"
                :key="`r-${row}`"
                class="grid-row-header"
                :style="{ transform: `translate(${scrollState.left}px, ${cellTop(row)}px)`, width: `${rowHeaderWidthPx}px`, height: `${rowHeightPx}px` }"
              >
                {{ row }}
              </div>
              <div
                v-for="item in visibleCellItems"
                :key="item.key"
                class="ledger-cell"
                :class="{
                  commented: Boolean(commentFor(item.row, item.col)),
                  selected: isItemSelected(item),
                  merged: Boolean(item.merge)
                }"
                :title="commentFor(item.row, item.col) || ''"
                :style="{
                  transform: `translate(${cellLeft(item.col)}px, ${cellTop(item.row)}px)`,
                  width: `${item.width}px`,
                  height: `${item.height}px`
                }"
                @click="selectCell(item.row, item.col, $event)"
                @dblclick="editCell(item.row, item.col)"
                @contextmenu.prevent="editComment(item.row, item.col)"
              >
                <span v-if="editingCell !== item.row+'-'+item.col" class="cell-text">{{ displayCellValue(cellFor(item.row, item.col)) }}</span>
                <textarea
                  v-else
                  :value="displayCellValue(cellFor(item.row, item.col))"
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
const zoom = ref(1)
const activeCacheKey = ref('')
const detailCache = new Map()
const maxRows = 160
const maxCols = 26
const baseRowHeight = 38
const baseColWidth = 136
const baseRowHeaderWidth = 56
const baseHeaderHeight = 30
const overscan = 4
const scrollState = reactive({ top: 0, left: 0, width: 900, height: 520 })
let scrollFrame = 0

const activeSheet = computed(() => sheets.value.find(sheet => Number(sheet.id) === Number(activeSheetId.value)) || null)
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

const rowHeightPx = computed(() => Math.round(baseRowHeight * zoom.value))
const colWidthPx = computed(() => Math.round(baseColWidth * zoom.value))
const rowHeaderWidthPx = computed(() => Math.round(baseRowHeaderWidth * zoom.value))
const headerHeightPx = computed(() => Math.round(baseHeaderHeight * zoom.value))
const gridWidth = computed(() => rowHeaderWidthPx.value + dataRange.value.cols * colWidthPx.value)
const gridHeight = computed(() => headerHeightPx.value + dataRange.value.rows * rowHeightPx.value)

const visibleBounds = computed(() => {
  const rowStart = Math.max(1, Math.floor(Math.max(0, scrollState.top - headerHeightPx.value) / rowHeightPx.value) + 1 - overscan)
  const rowEnd = Math.min(dataRange.value.rows, Math.ceil(Math.max(0, scrollState.top + scrollState.height - headerHeightPx.value) / rowHeightPx.value) + overscan)
  const colStart = Math.max(1, Math.floor(Math.max(0, scrollState.left - rowHeaderWidthPx.value) / colWidthPx.value) + 1 - overscan)
  const colEnd = Math.min(dataRange.value.cols, Math.ceil(Math.max(0, scrollState.left + scrollState.width - rowHeaderWidthPx.value) / colWidthPx.value) + overscan)
  return { rowStart, rowEnd, colStart, colEnd }
})
const visibleRows = computed(() => {
  const { rowStart, rowEnd } = visibleBounds.value
  return Array.from({ length: Math.max(0, rowEnd - rowStart + 1) }, (_, i) => rowStart + i)
})
const visibleCols = computed(() => {
  const { colStart, colEnd } = visibleBounds.value
  return Array.from({ length: Math.max(0, colEnd - colStart + 1) }, (_, i) => colStart + i)
})

const cellMap = computed(() => {
  const map = new Map()
  for (const cell of cells.value) map.set(`${cell.row_index}:${cell.col_index}`, cell)
  return map
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
  for (let row = bounds.rowStart; row <= bounds.rowEnd; row++) {
    for (let col = bounds.colStart; col <= bounds.colEnd; col++) {
      if (coveredCellSet.value.has(`${row}:${col}`)) continue
      const merge = mergeMasterMap.value.get(`${row}:${col}`)
      items.set(`${row}:${col}`, makeCellItem(row, col, merge))
    }
  }
  for (const merge of merges.value) {
    if (!rangesOverlap(
      Number(merge.start_row), Number(merge.end_row),
      bounds.rowStart, bounds.rowEnd,
      Number(merge.start_col), Number(merge.end_col),
      bounds.colStart, bounds.colEnd
    )) continue
    const key = `${merge.start_row}:${merge.start_col}`
    if (!items.has(key)) items.set(key, makeCellItem(Number(merge.start_row), Number(merge.start_col), merge))
  }
  return [...items.values()]
})
const selectedRangeLabel = computed(() => {
  if (!selectedRange.value) return ''
  return `${colName(selectedRange.value.startCol)}${selectedRange.value.startRow}:${colName(selectedRange.value.endCol)}${selectedRange.value.endRow}`
})
const canMergeSelection = computed(() => {
  const range = selectedRange.value
  return Boolean(range && (range.startRow !== range.endRow || range.startCol !== range.endCol))
})

function token() { return getAuthToken() }

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
    width: merge ? (Number(merge.end_col) - Number(merge.start_col) + 1) * colWidthPx.value : colWidthPx.value,
    height: merge ? (Number(merge.end_row) - Number(merge.start_row) + 1) * rowHeightPx.value : rowHeightPx.value
  }
}

function rangesOverlap(aStartRow, aEndRow, bStartRow, bEndRow, aStartCol, aEndCol, bStartCol, bEndCol) {
  return !(aEndRow < bStartRow || aStartRow > bEndRow || aEndCol < bStartCol || aStartCol > bEndCol)
}

function cellLeft(col) {
  return rowHeaderWidthPx.value + (Number(col) - 1) * colWidthPx.value
}

function cellTop(row) {
  return headerHeightPx.value + (Number(row) - 1) * rowHeightPx.value
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
  if (event?.shiftKey && selectedRange.value) {
    selectedRange.value = normalizeRange(selectedRange.value.startRow, selectedRange.value.startCol, row, col)
  } else {
    selectedRange.value = normalizeRange(row, col, row, col)
  }
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
  const text = String(cell?.value ?? '')
  const dateMatch = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/)
  if (!dateMatch) return text
  return `${dateMatch[1]}年${dateMatch[2].padStart(2, '0')}月${dateMatch[3].padStart(2, '0')}日`
}

function commentFor(row, col) {
  return commentMap.value.get(`${row}:${col}`)?.comment_text || ''
}

async function updateCell(row, col, value) {
  const cell = cellFor(row, col)
  if (String(cell.value || '') === String(value || '')) return
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
  if (!res.ok || !json.success) throw new Error(json.message || `请求失败（HTTP ${res.status}）`)
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
  z-index: 3000;
  padding: 10px 12px;
  overflow: hidden;
  background: var(--bg-page);
}
.ledger-fullscreen .ledger-layout {
  grid-template-columns: 220px minmax(0, 1fr);
  height: calc(100dvh - 88px);
}
.ledger-fullscreen .sheet-card,
.ledger-fullscreen .workbook-list {
  min-height: 0;
}
.ledger-fullscreen .ledger-grid-wrap {
  height: calc(100dvh - 190px);
}
.ledger-fullscreen .ledger-head :deep(.el-card__body) {
  align-items: flex-start;
}
.ledger-fullscreen .ledger-head p {
  display: none;
}
.ledger-fullscreen .head-actions {
  max-width: min(760px, 62vw);
  max-height: 42px;
  overflow-x: auto;
  overflow-y: hidden;
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
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
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
  background: var(--bg-card);
  overflow: hidden;
  transform-origin: top left;
}
.grid-corner {
  z-index: 8;
  width: calc(56px * var(--ledger-zoom, 1));
  height: calc(30px * var(--ledger-zoom, 1));
  background: color-mix(in srgb, var(--bg-page) 88%, var(--bg-card));
}
.grid-col-header,
.grid-row-header {
  z-index: 6;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, var(--bg-page) 86%, var(--bg-card));
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 700;
}
.grid-row-header {
  z-index: 7;
}
.ledger-cell {
  z-index: 1;
  color: var(--text-primary);
}
.ledger-cell.selected {
  z-index: 3;
  box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--color-primary) 62%, transparent);
  background: color-mix(in srgb, var(--color-primary) 6%, var(--bg-card));
}
.ledger-cell.merged {
  background: color-mix(in srgb, var(--bg-card) 92%, #dbeafe);
}
.cell-text {
  display: block;
  height: 100%;
  min-height: 28px;
  padding: 8px 9px;
  font-size: 13px;
  line-height: 1.35;
  cursor: default;
  white-space: pre-wrap;
  overflow: hidden;
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
  background: color-mix(in srgb, #f59e0b 8%, var(--bg-card));
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
@media (max-width: 980px) {
  .ledger-head :deep(.el-card__body),
  .sheet-head {
    align-items: flex-start;
    flex-direction: column;
  }
  .ledger-layout {
    grid-template-columns: 1fr;
  }
}
</style>
