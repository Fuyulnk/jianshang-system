<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import DecimalCellInput from './DecimalCellInput.vue'
import { safeJsonParse, safeLocalStorageGet, safeLocalStorageSet } from '../../utils/authSession'

const props = defineProps({
  columns: { type: Array, required: true },
  rows: { type: Array, default: () => [] },
  storageKey: { type: String, default: '' },
  emptyText: { type: String, default: '暂无数据' },
  minWidth: { type: Number, default: 920 }
})

const emit = defineEmits(['cell-change'])

const widths = ref({})
let resizing = null

const tableWidth = computed(() => {
  const total = props.columns.reduce((sum, col) => sum + columnWidth(col), 0)
  return Math.max(props.minWidth, total)
})

watch(() => props.storageKey, loadWidths, { immediate: true })

function loadWidths() {
  widths.value = {}
  if (!props.storageKey) return
  widths.value = safeJsonParse(safeLocalStorageGet(`sheet-widths:${props.storageKey}`, '{}'), {}) || {}
}

function saveWidths() {
  if (!props.storageKey) return
  safeLocalStorageSet(`sheet-widths:${props.storageKey}`, JSON.stringify(widths.value))
}

function columnWidth(col) {
  return Number(widths.value[col.key] || col.width || 120)
}

function startResize(event, col) {
  event.preventDefault()
  resizing = {
    key: col.key,
    startX: event.clientX,
    startWidth: columnWidth(col)
  }
  document.body.classList.add('sheet-resizing')
  window.addEventListener('mousemove', onResize)
  window.addEventListener('mouseup', stopResize)
}

function onResize(event) {
  if (!resizing) return
  const next = Math.max(72, Math.min(520, resizing.startWidth + event.clientX - resizing.startX))
  widths.value = { ...widths.value, [resizing.key]: next }
}

function stopResize() {
  if (!resizing) return
  resizing = null
  document.body.classList.remove('sheet-resizing')
  window.removeEventListener('mousemove', onResize)
  window.removeEventListener('mouseup', stopResize)
  saveWidths()
}

function updateCell(row, col, value, rowIndex) {
  row[col.key] = value
  emit('cell-change', { row, column: col, value, rowIndex })
}

onBeforeUnmount(stopResize)
</script>

<template>
  <div class="system-sheet-wrap">
    <table class="system-sheet" :style="{ minWidth: `${tableWidth}px` }">
      <colgroup>
        <col v-for="col in columns" :key="col.key" :style="{ width: `${columnWidth(col)}px` }">
      </colgroup>
      <thead>
        <tr>
          <th v-for="col in columns" :key="col.key">
            <span>{{ col.label }}</span>
            <i class="resize-handle" @mousedown="startResize($event, col)" />
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, rowIndex) in rows" :key="row.id || rowIndex">
          <td v-for="col in columns" :key="col.key">
            <DecimalCellInput
              v-if="col.type === 'number'"
              :model-value="row[col.key]"
              @update:model-value="value => updateCell(row, col, value, rowIndex)"
            />
            <el-input
              v-else
              :model-value="row[col.key]"
              @input="value => updateCell(row, col, value, rowIndex)"
            />
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td class="empty-cell" :colspan="columns.length">{{ emptyText }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.system-sheet-wrap {
  width: 100%;
  max-width: 100%;
  overflow: auto;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
}

.system-sheet {
  table-layout: fixed;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 12px;
}

.system-sheet th,
.system-sheet td {
  min-width: 0;
  border-right: 1px solid var(--border-light);
  border-bottom: 1px solid var(--border-light);
  vertical-align: middle;
}

.system-sheet th {
  position: sticky;
  top: 0;
  z-index: 1;
  height: 36px;
  padding: 0 18px 0 8px;
  background: color-mix(in srgb, var(--bg-page) 82%, var(--color-primary));
  color: var(--text-primary);
  font-weight: 800;
  white-space: nowrap;
  text-align: left;
}

.system-sheet td {
  padding: 6px;
  background: var(--bg-card);
}

.system-sheet th:last-child,
.system-sheet td:last-child {
  border-right: 0;
}

.system-sheet tr:last-child td {
  border-bottom: 0;
}

.resize-handle {
  position: absolute;
  top: 0;
  right: 0;
  width: 9px;
  height: 100%;
  cursor: col-resize;
}

.empty-cell {
  padding: 18px !important;
  color: var(--text-tertiary);
  text-align: center;
}

.system-sheet :deep(.el-input__wrapper) {
  min-height: 30px;
  box-shadow: 0 0 0 1px var(--border-light) inset;
}
</style>

<style>
.sheet-resizing {
  user-select: none;
  cursor: col-resize;
}
</style>
