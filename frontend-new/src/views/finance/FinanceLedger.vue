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
        <el-button :disabled="!workbook" @click="fullscreen = !fullscreen">{{ fullscreen ? '退出全屏' : '全屏填表' }}</el-button>
        <el-button :disabled="!workbook" @click="zoomOut">缩小</el-button>
        <el-button :disabled="!workbook" @click="zoomIn">放大</el-button>
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
            </div>
            <el-tag v-if="activeSheet" type="info" size="small">显示前 {{ maxRows }} 行 / {{ maxCols }} 列</el-tag>
          </div>
        </template>

        <template v-if="activeSheet">
          <el-tabs :model-value="String(activeSheetId)" @tab-change="loadSheet">
            <el-tab-pane v-for="sheet in sheets" :key="sheet.id" :name="String(sheet.id)" :label="sheet.name" />
          </el-tabs>

          <div class="ledger-table-wrap" :style="{ '--ledger-zoom': zoom }">
            <table class="ledger-table">
              <thead>
                <tr>
                  <th class="corner"></th>
                  <th v-for="col in columns" :key="col">{{ colName(col) }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in rows" :key="row">
                  <th>{{ row }}</th>
                  <td
                    v-for="col in columns"
                    :key="`${row}-${col}`"
                    :class="{ commented: Boolean(commentFor(row, col)) }"
                    :title="commentFor(row, col) || ''"
                    @contextmenu.prevent="editComment(row, col)"
                  >
                    <span v-if="editingCell !== row+'-'+col" class="cell-text" @dblclick="editCell(row, col)">{{ displayCellValue(cellFor(row, col)) }}</span>
                    <textarea
                      v-else
                      :value="displayCellValue(cellFor(row, col))"
                      @change="updateCell(row, col, $event.target.value)"
                      @keydown.enter.exact.prevent="$event.target.blur()"
                      @blur="editingCell = ''"
                    />
                    <i v-if="commentFor(row, col)" class="comment-dot"></i>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
        <el-empty v-else description="请选择或导入一份入账登记表" :image-size="96" />
      </el-card>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getAuthToken } from '../../utils/authSession'

const workbooks = ref([])
const workbook = ref(null)
const sheets = ref([])
const activeSheetId = ref(0)
const cells = ref([])
const comments = ref([])
const fileInput = ref(null)
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
  activeCacheKey.value = cacheKey
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
    await fetchWorkbooks()
  } catch (err) {
    if (err !== 'cancel') ElMessage.error(err.message || '删除失败')
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
}

function zoomOut() {
  zoom.value = Math.max(0.8, Math.round((zoom.value - 0.1) * 10) / 10)
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

onMounted(fetchWorkbooks)
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
  padding: 16px;
  overflow: hidden;
  background: var(--bg-page);
}
.ledger-fullscreen .ledger-layout {
  grid-template-columns: 220px minmax(0, 1fr);
  height: calc(100dvh - 116px);
}
.ledger-fullscreen .sheet-card,
.ledger-fullscreen .workbook-list {
  min-height: 0;
}
.ledger-fullscreen .ledger-table-wrap {
  max-height: calc(100dvh - 236px);
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
.ledger-table-wrap {
  overflow: auto;
  max-height: calc(100vh - 260px);
  max-height: calc(100dvh - 260px);
  border: 1px solid color-mix(in srgb, var(--border-light) 72%, #64748b);
  border-radius: var(--radius-sm);
  will-change: transform;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}
.ledger-table {
  border-collapse: collapse;
  width: max-content;
  min-width: 100%;
  background: var(--bg-card);
  font-size: calc(13px * var(--ledger-zoom, 1));
}
.ledger-table th,
.ledger-table td {
  border: 1px solid color-mix(in srgb, var(--border-light) 64%, #64748b);
  min-width: calc(118px * var(--ledger-zoom, 1));
  height: calc(36px * var(--ledger-zoom, 1));
  padding: 0;
  position: relative;
}
.ledger-table th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: color-mix(in srgb, var(--bg-page) 86%, var(--bg-card));
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 700;
}
.ledger-table tbody th {
  left: 0;
  z-index: 1;
  min-width: 54px;
}
.ledger-table .corner {
  left: 0;
  z-index: 3;
  min-width: 54px;
}
.cell-text {
  display: block; min-height: 28px; line-height: 28px; padding: 0 4px;
  font-size: 13px; cursor: default; white-space: nowrap; overflow: hidden;
}
.ledger-table textarea {
  width: 100%;
  height: 100%;
  min-height: calc(36px * var(--ledger-zoom, 1));
  padding: 8px;
  border: 0;
  resize: vertical;
  background: transparent;
  color: var(--text-primary);
  caret-color: #2563eb;
  font: inherit;
  outline: none;
}
.ledger-table textarea::selection {
  color: #0f172a;
  background: rgba(37, 99, 235, 0.22);
}
.ledger-table textarea:focus {
  background: color-mix(in srgb, var(--color-primary) 6%, var(--bg-card));
  box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--color-primary) 50%, transparent);
}
.ledger-table td.commented {
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
