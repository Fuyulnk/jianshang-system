<script setup>
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { UploadFilled, WarningFilled } from '@element-plus/icons-vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false }
})

const emit = defineEmits(['update:modelValue', 'created'])

const visible = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value)
})

const rawText = ref('')
const pickedFile = ref(null)
const fileInput = ref(null)
const parsing = ref(false)
const confirming = ref(false)
const batchId = ref(0)
const items = ref([])
const selectedIds = ref([])

const canConfirm = computed(() => selectedIds.value.length > 0 && !confirming.value)
const selectedItems = computed(() => items.value.filter(item => selectedIds.value.includes(item.id) && item.status !== 'created'))

watch(visible, value => {
  if (value && !items.value.length) resetInputOnly()
})

function token() {
  return localStorage.getItem('token')
}

function resetAll() {
  resetInputOnly()
  batchId.value = 0
  items.value = []
  selectedIds.value = []
}

function resetInputOnly() {
  rawText.value = ''
  pickedFile.value = null
  if (fileInput.value) fileInput.value.value = ''
}

function openPicker() {
  fileInput.value?.click()
}

function onFileChange(event) {
  const file = event.target.files?.[0]
  if (!file) return
  if (!/\.(csv|xls|xlsx)$/i.test(file.name)) {
    ElMessage.warning('V1 只支持 CSV / XLS / XLSX')
    event.target.value = ''
    return
  }
  if (file.size > 10 * 1024 * 1024) {
    ElMessage.warning('单个文件不能超过 10MB')
    event.target.value = ''
    return
  }
  pickedFile.value = file
}

async function parseImport() {
  if (!rawText.value.trim() && !pickedFile.value) {
    ElMessage.warning('请粘贴交接内容或选择表格')
    return
  }
  parsing.value = true
  try {
    const body = pickedFile.value
      ? {
          file_name: pickedFile.value.name,
          mime_type: pickedFile.value.type,
          file_data: await readAsDataUrl(pickedFile.value)
        }
      : { text: rawText.value }
    const res = await fetch('/api/project-imports/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify(body)
    })
    const json = await readJson(res)
    if (!res.ok || !json.success) throw new Error(json.message || 'AI 解析失败')
    batchId.value = json.data.id
    items.value = (json.data.items || []).map(normalizeItem)
    selectedIds.value = items.value.filter(item => item.status !== 'created').map(item => item.id)
    ElMessage.success(`已识别 ${items.value.length} 条工单草稿`)
  } catch (err) {
    ElMessage.error(err.message || 'AI 解析失败')
  } finally {
    parsing.value = false
  }
}

async function confirmSelected() {
  const rows = selectedItems.value
  if (!batchId.value || !rows.length) return
  confirming.value = true
  try {
    const res = await fetch(`/api/project-imports/${batchId.value}/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({
        items: rows.map(item => ({ id: item.id, draft: item.draft }))
      })
    })
    const json = await readJson(res)
    if (!res.ok || !json.success) throw new Error(json.message || '创建失败')
    const resultMap = new Map((json.data.results || []).map(result => [result.id, result]))
    items.value = items.value.map(item => {
      const result = resultMap.get(item.id)
      if (!result) return item
      if (!result.success) return { ...item, status: 'error', error_message: result.message || '创建失败' }
      return {
        ...item,
        status: 'created',
        project_id: result.project_id,
        missing_fields: result.missing_fields || item.missing_fields,
        duplicate_matches: result.duplicate_matches || item.duplicate_matches
      }
    })
    selectedIds.value = selectedIds.value.filter(id => !resultMap.get(id)?.success)
    const okCount = (json.data.results || []).filter(item => item.success).length
    ElMessage.success(`已创建 ${okCount} 条项目工单`)
    emit('created')
  } catch (err) {
    ElMessage.error(err.message || '创建失败')
  } finally {
    confirming.value = false
  }
}

function normalizeItem(item) {
  return {
    ...item,
    draft: { ...(item.confirmed_draft || item.ai_draft || {}) },
    missing_fields: item.missing_fields || [],
    duplicate_matches: item.duplicate_matches || []
  }
}

function toggleSelected(id, checked) {
  if (checked && !selectedIds.value.includes(id)) selectedIds.value.push(id)
  if (!checked) selectedIds.value = selectedIds.value.filter(item => item !== id)
}

function removeItem(id) {
  items.value = items.value.filter(item => item.id !== id)
  selectedIds.value = selectedIds.value.filter(item => item !== id)
}

function statusLabel(item) {
  if (item.status === 'created') return '已创建'
  if (item.status === 'error') return '失败'
  if (item.duplicate_matches?.length) return '可能重复'
  if (item.missing_fields?.length) return '缺核心'
  return '可创建'
}

function statusType(item) {
  if (item.status === 'created') return 'success'
  if (item.status === 'error') return 'danger'
  if (item.duplicate_matches?.length) return 'warning'
  if (item.missing_fields?.length) return 'danger'
  return 'success'
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
  <el-dialog v-model="visible" title="AI 导入项目工单" width="1180px" class="project-import-dialog" @closed="resetAll">
    <div class="import-layout">
      <section class="import-source">
        <div class="section-title">原始交接内容</div>
        <el-input
          v-model="rawText"
          type="textarea"
          :rows="12"
          resize="none"
          placeholder="粘贴微信/电话/门店交接内容，AI 会自动拆成工单草稿"
          :disabled="!!pickedFile"
        />
        <div class="upload-box" @click="openPicker">
          <input ref="fileInput" class="hidden-input" type="file" accept=".csv,.xls,.xlsx" @change="onFileChange" />
          <el-icon :size="28"><UploadFilled /></el-icon>
          <div>
            <strong>{{ pickedFile?.name || '选择 CSV / XLS / XLSX' }}</strong>
            <span>上传表格后会优先解析表格，暂不支持图片 OCR</span>
          </div>
        </div>
        <div class="source-actions">
          <el-button @click="resetInputOnly" :disabled="parsing">清空输入</el-button>
          <el-button type="primary" :loading="parsing" @click="parseImport">AI 解析</el-button>
        </div>
      </section>

      <section class="import-result">
        <div class="result-header">
          <div>
            <div class="section-title">工单草稿</div>
            <p>{{ items.length ? `已识别 ${items.length} 条，勾选后批量创建` : '解析后在这里确认字段' }}</p>
          </div>
          <el-button type="primary" :disabled="!canConfirm" :loading="confirming" @click="confirmSelected">批量创建</el-button>
        </div>

        <div v-if="items.length" class="draft-list">
          <article v-for="item in items" :key="item.id" class="draft-card" :class="{ created: item.status === 'created' }">
            <header class="draft-head">
              <el-checkbox
                :model-value="selectedIds.includes(item.id)"
                :disabled="item.status === 'created'"
                @change="checked => toggleSelected(item.id, checked)"
              />
              <el-tag :type="statusType(item)" size="small">{{ statusLabel(item) }}</el-tag>
              <strong>#{{ item.item_index }}</strong>
              <el-button text type="danger" :disabled="item.status === 'created'" @click="removeItem(item.id)">移除</el-button>
            </header>

            <div v-if="item.duplicate_matches.length" class="warning-line">
              <el-icon><WarningFilled /></el-icon>
              可能重复：{{ item.duplicate_matches.map(match => `${match.name || match.customer}(${match.phone || match.external_order_no || match.id})`).join('、') }}
            </div>
            <div v-if="item.missing_fields.length" class="missing-line">
              缺核心资料：{{ item.missing_fields.join('、') }}
            </div>
            <div v-if="item.error_message" class="missing-line">{{ item.error_message }}</div>

            <div class="draft-grid">
              <el-input v-model="item.draft.name" placeholder="工单名称" />
              <el-input v-model="item.draft.customer" placeholder="业主/客户" />
              <el-input v-model="item.draft.phone" placeholder="电话" />
              <el-input v-model="item.draft.source" placeholder="来源门店/渠道" />
              <el-input v-model="item.draft.order_taker" placeholder="门店接单人" />
              <el-input v-model="item.draft.order_date" placeholder="接单日期" />
              <el-input v-model="item.draft.external_order_no" placeholder="门店单号/合同号" />
              <el-input v-model="item.draft.address_province" placeholder="省" />
              <el-input v-model="item.draft.address_city" placeholder="市" />
              <el-input v-model="item.draft.address_detail" class="wide" placeholder="详细地址" />
              <el-input v-model="item.draft.total_amount" placeholder="金额" type="number" />
              <div class="switch-row">
                <el-switch v-model="item.draft.needs_construction" active-text="施工" />
                <el-switch v-model="item.draft.needs_stock" active-text="备货" />
              </div>
              <el-input v-model="item.draft.handover_note" class="wide" type="textarea" :rows="2" placeholder="交接备注" />
              <el-input v-model="item.draft.stock_note" class="wide" placeholder="备货备注" />
            </div>
          </article>
        </div>
        <el-empty v-else description="暂无草稿" :image-size="90" />
      </section>
    </div>
  </el-dialog>
</template>

<style scoped>
.import-layout {
  display: grid;
  grid-template-columns: 330px minmax(0, 1fr);
  gap: 18px;
  min-height: 620px;
}
.import-source,
.import-result {
  min-width: 0;
}
.section-title {
  font-size: 16px;
  font-weight: 700;
  margin-bottom: 10px;
}
.upload-box {
  margin-top: 12px;
  min-height: 86px;
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
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
.source-actions,
.result-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.source-actions {
  margin-top: 14px;
}
.result-header {
  margin-bottom: 12px;
}
.result-header p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 13px;
}
.draft-list {
  display: grid;
  gap: 12px;
  max-height: 570px;
  overflow-y: auto;
  padding-right: 4px;
}
.draft-card {
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  padding: 12px;
}
.draft-card.created {
  opacity: 0.72;
}
.draft-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.draft-head .el-button {
  margin-left: auto;
}
.warning-line,
.missing-line {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 9px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  margin-bottom: 8px;
}
.warning-line {
  background: #fff7ed;
  color: #b45309;
}
.missing-line {
  background: #fef2f2;
  color: #b91c1c;
}
.draft-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.draft-grid .wide {
  grid-column: span 2;
}
.switch-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 32px;
}

@media (max-width: 900px) {
  .import-layout {
    grid-template-columns: 1fr;
  }
  .draft-grid {
    grid-template-columns: 1fr;
  }
  .draft-grid .wide {
    grid-column: span 1;
  }
}
</style>
