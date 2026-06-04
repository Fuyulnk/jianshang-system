<script setup>
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { UploadFilled, WarningFilled } from '@element-plus/icons-vue'

const props = defineProps({
  project: { type: Object, required: true }
})

const emit = defineEmits(['applied'])

const fileInput = ref(null)
const pickedFile = ref(null)
const parsing = ref(false)
const applying = ref(false)
const result = ref(null)
const fieldValues = ref({})
const selectedFields = ref([])

const hasResult = computed(() => !!result.value)
const fieldRows = computed(() => result.value?.fields || [])
const selectedPayload = computed(() => {
  const payload = {}
  for (const key of selectedFields.value) {
    const value = String(fieldValues.value[key] ?? '').trim()
    if (value) payload[key] = value
  }
  return payload
})
const canApply = computed(() => Object.keys(selectedPayload.value).length > 0 && !applying.value)

function token() {
  return localStorage.getItem('token')
}

function openPicker() {
  fileInput.value?.click()
}

function onFileChange(event) {
  const file = event.target.files?.[0]
  if (!file) return
  if (!/\.(csv|xls|xlsx)$/i.test(file.name)) {
    ElMessage.warning('施工交底单导入暂只支持 CSV / XLS / XLSX')
    event.target.value = ''
    return
  }
  if (file.size > 10 * 1024 * 1024) {
    ElMessage.warning('单个文件不能超过 10MB')
    event.target.value = ''
    return
  }
  pickedFile.value = file
  result.value = null
}

async function parseFile() {
  if (!pickedFile.value) {
    ElMessage.warning('请先选择施工交底单')
    return
  }
  parsing.value = true
  try {
    const res = await fetch(`/api/projects/${props.project.id}/document-imports/briefing/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({
        file_name: pickedFile.value.name,
        file_data: await readAsDataUrl(pickedFile.value)
      })
    })
    const json = await readJson(res)
    if (!res.ok || !json.success) throw new Error(json.message || '施工交底单解析失败')
    result.value = json.data
    fieldValues.value = Object.fromEntries((json.data.fields || []).map(field => [field.key, field.value || '']))
    selectedFields.value = (json.data.fields || [])
      .filter(field => field.value && !String(json.data.current?.[field.key] || '').trim())
      .map(field => field.key)
    ElMessage.success('施工交底单已解析，请人工确认字段')
  } catch (err) {
    ElMessage.error(err.message || '施工交底单解析失败')
  } finally {
    parsing.value = false
  }
}

async function applySelected() {
  if (!canApply.value) return
  applying.value = true
  try {
    const res = await fetch(`/api/projects/${props.project.id}/document-imports/briefing/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({ fields: selectedPayload.value })
    })
    const json = await readJson(res)
    if (!res.ok || !json.success) throw new Error(json.message || '写入失败')
    ElMessage.success('已写入施工交底单字段')
    emit('applied')
  } catch (err) {
    ElMessage.error(err.message || '写入失败')
  } finally {
    applying.value = false
  }
}

function toggleField(key, checked) {
  if (checked && !selectedFields.value.includes(key)) selectedFields.value.push(key)
  if (!checked) selectedFields.value = selectedFields.value.filter(item => item !== key)
}

function currentValue(key) {
  return result.value?.current?.[key] || '未填写'
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

async function readJson(res) {
  const text = await res.text()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return { success: false, message: text.slice(0, 120) || '服务器返回异常' }
  }
}
</script>

<template>
  <el-card class="document-import" shadow="never">
    <template #header>
      <div class="panel-head">
        <div>
          <div class="kicker">总监表格字段映射 V2</div>
          <h3>施工交底单导入预览</h3>
          <p>先解析字段和施工明细，勾选确认后才写入当前项目工单。</p>
        </div>
        <el-tag type="info">第一张真实表</el-tag>
      </div>
    </template>

    <div class="import-actions">
      <div class="upload-box" @click="openPicker">
        <input ref="fileInput" class="hidden-input" type="file" accept=".csv,.xls,.xlsx" @change="onFileChange" />
        <el-icon :size="26"><UploadFilled /></el-icon>
        <div>
          <strong>{{ pickedFile?.name || '选择施工交底单' }}</strong>
          <span>支持总监工作树里的 .xls / .xlsx / .csv，暂不直接改原文件。</span>
        </div>
      </div>
      <el-button type="primary" :loading="parsing" @click="parseFile">解析预览</el-button>
    </div>

    <template v-if="hasResult">
      <div v-if="result.warnings?.length" class="warning-list">
        <div v-for="warning in result.warnings" :key="warning">
          <el-icon><WarningFilled /></el-icon>
          <span>{{ warning }}</span>
        </div>
      </div>

      <div class="field-table">
        <div class="field-row table-head">
          <span>写入</span>
          <span>字段</span>
          <span>当前值</span>
          <span>识别值</span>
          <span>来源</span>
        </div>
        <div v-for="field in fieldRows" :key="field.key" class="field-row">
          <el-checkbox
            :model-value="selectedFields.includes(field.key)"
            :disabled="!fieldValues[field.key]"
            @change="checked => toggleField(field.key, checked)"
          />
          <strong>{{ field.label }}</strong>
          <span class="current-value">{{ currentValue(field.key) }}</span>
          <el-input v-model="fieldValues[field.key]" size="small" clearable />
          <span class="source-cell">
            {{ field.source }}
            <em v-if="field.caution">{{ field.caution }}</em>
          </span>
        </div>
      </div>

      <div v-if="result.summary" class="briefing-summary">
        <div><span>施工总面积</span><strong>{{ result.summary.total_area || '未识别' }}</strong></div>
        <div><span>是否复尺</span><strong>{{ result.summary.remeasure || '未识别' }}</strong></div>
        <div><span>进入方式</span><strong>{{ result.summary.entry_method || '未识别' }}</strong></div>
        <div><span>车牌报备</span><strong>{{ result.summary.plate_needed || '未识别' }}</strong></div>
      </div>

      <div v-if="result.items?.length" class="items-section">
        <div class="section-title">施工项目明细</div>
        <el-table :data="result.items" size="small" border max-height="260">
          <el-table-column prop="space_name" label="空间" min-width="150" />
          <el-table-column prop="texture_name" label="纹理/产品" min-width="120" />
          <el-table-column prop="process" label="工艺" min-width="90" />
          <el-table-column prop="color_no" label="颜色" min-width="130" />
          <el-table-column prop="planned_area" label="预收面积" width="90" />
          <el-table-column prop="actual_area" label="实际面积" width="90" />
          <el-table-column prop="remark" label="备注" min-width="120" />
        </el-table>
      </div>

      <div class="apply-bar">
        <span>已选择 {{ Object.keys(selectedPayload).length }} 个有效字段。明细本轮只预览，不自动写入成本或仓库。</span>
        <el-button type="primary" :disabled="!canApply" :loading="applying" @click="applySelected">确认写入工单</el-button>
      </div>
    </template>
  </el-card>
</template>

<style scoped>
.document-import {
  margin-bottom: 16px;
}

.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.kicker {
  color: var(--color-primary);
  font-size: 12px;
  font-weight: 700;
  margin-bottom: 4px;
}

.panel-head h3 {
  margin: 0 0 5px;
  color: var(--text-primary);
}

.panel-head p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 13px;
}

.import-actions {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
}

.upload-box {
  min-height: 72px;
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  cursor: pointer;
  color: var(--text-secondary);
  background: var(--bg-page);
}

.upload-box strong,
.upload-box span {
  display: block;
}

.upload-box strong {
  color: var(--text-primary);
  margin-bottom: 4px;
}

.hidden-input {
  display: none;
}

.warning-list {
  display: grid;
  gap: 6px;
  margin-top: 12px;
  color: #b45309;
  font-size: 13px;
}

.warning-list div {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 9px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, #f59e0b 12%, var(--bg-card));
}

.field-table {
  margin-top: 14px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.field-row {
  display: grid;
  grid-template-columns: 52px 110px minmax(120px, 1fr) minmax(160px, 1.3fr) minmax(150px, 1fr);
  gap: 10px;
  align-items: center;
  padding: 9px 11px;
  border-top: 1px solid var(--border-light);
  font-size: 13px;
}

.field-row:first-child {
  border-top: 0;
}

.table-head {
  background: var(--bg-page);
  color: var(--text-tertiary);
  font-weight: 700;
}

.current-value {
  color: var(--text-secondary);
}

.source-cell {
  color: var(--text-tertiary);
  line-height: 1.45;
}

.source-cell em {
  display: block;
  color: #b45309;
  font-style: normal;
  font-size: 12px;
}

.briefing-summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-top: 14px;
}

.briefing-summary div {
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: var(--bg-page);
}

.briefing-summary span {
  display: block;
  color: var(--text-tertiary);
  font-size: 12px;
  margin-bottom: 4px;
}

.briefing-summary strong {
  color: var(--text-primary);
}

.items-section {
  margin-top: 14px;
}

.section-title {
  color: var(--text-primary);
  font-weight: 700;
  margin-bottom: 8px;
}

.apply-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 14px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--color-primary) 8%, var(--bg-card));
  color: var(--text-secondary);
  font-size: 13px;
}

@media (max-width: 980px) {
  .import-actions,
  .briefing-summary {
    grid-template-columns: 1fr;
  }

  .field-row {
    grid-template-columns: 42px 90px minmax(0, 1fr);
  }

  .field-row > :nth-child(4),
  .field-row > :nth-child(5) {
    grid-column: 2 / -1;
  }

  .apply-bar {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
