<script setup>
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { UploadFilled, WarningFilled, Plus } from '@element-plus/icons-vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false }
})

const emit = defineEmits(['update:modelValue', 'created'])

const router = useRouter()
const visible = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value)
})

const rawText = ref('')
const pickedFile = ref(null)
const fileInput = ref(null)
const parsing = ref(false)
const confirming = ref(false)
const parsedData = ref(null)
const duplicateMatches = ref([])
const warnings = ref([])
const form = ref(emptyBriefingForm())

const hasParsed = computed(() => !!parsedData.value)
const canConfirm = computed(() => {
  const basic = form.value.basic
  return !!basic.customer && !confirming.value
})
const missingFields = computed(() => {
  const missing = []
  const basic = form.value.basic
  if (!basic.source) missing.push('来源门店/渠道')
  if (!basic.order_taker) missing.push('门店接单人')
  if (!basic.customer) missing.push('客户姓名')
  if (!basic.phone) missing.push('业主联系方式')
  if (!basic.address_detail) missing.push('详细地址')
  if (!form.value.items.length) missing.push('施工项目明细')
  return missing
})
const displayWarnings = computed(() => {
  if (!hasParsed.value) return []
  const list = [...warnings.value, ...missingFields.value.map(item => `缺核心资料：${item}`)]
  return [...new Set(list.filter(Boolean))]
})
const itemCount = computed(() => form.value.items.length)
const summaryValue = value => hasParsed.value ? (value || '未识别') : '待解析'

watch(visible, value => {
  if (value) resetAll()
})

function token() {
  return localStorage.getItem('token')
}

function emptyBriefingForm() {
  return {
    basic: {
      source: '',
      order_taker: '',
      order_date: '',
      customer: '',
      phone: '',
      address_province: '',
      address_city: '',
      address_detail: '',
      external_order_no: '',
      handover_note: ''
    },
    construction: {
      expected_start_date: '',
      expected_duration: '',
      entry_method: '',
      total_area: 0,
      remeasure: '',
      plate_needed: '',
      team_leader: '',
      briefing_date: '',
      total_amount: 0
    },
    finance: {
      estimated_total_amount: 0,
      received_summary: '',
      unpaid_summary: '',
      rebate_note: '',
      pricing_note: '',
      raw_lines: []
    },
    site: {
      base_condition: '',
      high_work: '',
      scaffold: '',
      second_transfer: '',
      entry_condition: '',
      site_status: '',
      site_contact_name: '',
      site_contact_phone: ''
    },
    items: [],
    quotation_items: [],
    images: {
      embedded_count: 0,
      note: '',
      attachment_note: ''
    },
    signatures: {
      briefer: '',
      confirmer: '',
      confirmed_at: '',
      source_file: ''
    }
  }
}

function resetAll() {
  rawText.value = ''
  pickedFile.value = null
  parsedData.value = null
  duplicateMatches.value = []
  warnings.value = []
  form.value = emptyBriefingForm()
  if (fileInput.value) fileInput.value.value = ''
}

function openPicker() {
  fileInput.value?.click()
}

function onFileChange(event) {
  const file = event.target.files?.[0]
  if (!file) return
  if (!/\.(csv|xls|xlsx)$/i.test(file.name)) {
    ElMessage.warning('施工交底单暂只支持 CSV / XLS / XLSX')
    event.target.value = ''
    return
  }
  if (file.size > 50 * 1024 * 1024) {
    ElMessage.warning('单个文件不能超过 50MB')
    event.target.value = ''
    return
  }
  pickedFile.value = file
  rawText.value = ''
}

async function parseBriefing() {
  if (!pickedFile.value && !rawText.value.trim()) {
    ElMessage.warning('请上传施工交底单或粘贴交底内容')
    return
  }
  parsing.value = true
  try {
    const body = pickedFile.value
      ? {
          file_name: pickedFile.value.name,
          file_data: await readAsDataUrl(pickedFile.value)
        }
      : { text: rawText.value }
    const res = await fetch('/api/briefing-imports/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify(body)
    })
    const json = await readJson(res)
    if (!res.ok || !json.success) throw new Error(json.message || '施工交底单解析失败')
    parsedData.value = json.data
    form.value = normalizeBriefingForm(json.data.form_data)
    duplicateMatches.value = json.data.duplicate_matches || []
    warnings.value = json.data.warnings || []
    ElMessage.success('施工交底单已解析，请核对后创建工单')
  } catch (err) {
    ElMessage.error(err.message || '施工交底单解析失败')
  } finally {
    parsing.value = false
  }
}

async function confirmCreate() {
  if (!canConfirm.value) return
  confirming.value = true
  try {
    const res = await fetch('/api/briefing-imports/confirm-create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({
        parsed_data: parsedData.value || {},
        confirmed_data: form.value,
        warnings: warnings.value,
        file: pickedFile.value ? {
          name: pickedFile.value.name,
          mime_type: pickedFile.value.type,
          size: pickedFile.value.size,
          data: await readAsDataUrl(pickedFile.value)
        } : null
      })
    })
    const json = await readJson(res)
    if (!res.ok || !json.success) throw new Error(json.message || `创建失败（HTTP ${res.status}）`)
    ElMessage.success('已由施工交底单创建项目工单')
    emit('created')
    visible.value = false
    if (json.data?.project_id) router.push(`/main/projects/${json.data.project_id}`)
  } catch (err) {
    const message = err.message || '未知原因'
    ElMessage.error(message.startsWith('创建失败') ? message : `创建失败：${message}`)
  } finally {
    confirming.value = false
  }
}

function addItem() {
  form.value.items.push({
    space_name: '',
    texture_name: '',
    process: '',
    color_no: '',
    planned_area: 0,
    actual_area: 0,
    unit_price: 0,
    subtotal: 0,
    remark: ''
  })
}

function removeItem(index) {
  form.value.items.splice(index, 1)
}

function normalizeBriefingForm(input = {}) {
  const base = emptyBriefingForm()
  return {
    basic: { ...base.basic, ...(input.basic || {}) },
    construction: { ...base.construction, ...(input.construction || {}) },
    finance: { ...base.finance, ...(input.finance || {}) },
    site: { ...base.site, ...(input.site || {}) },
    items: Array.isArray(input.items) ? input.items.map(item => ({ ...addableItem(), ...item })) : [],
    quotation_items: Array.isArray(input.quotation_items) ? input.quotation_items.map(item => ({ ...addableQuoteItem(), ...item })) : [],
    images: { ...base.images, ...(input.images || {}) },
    signatures: { ...base.signatures, ...(input.signatures || {}) }
  }
}

function addableItem() {
  return {
    space_name: '',
    texture_name: '',
    process: '',
    color_no: '',
    planned_area: 0,
    actual_area: 0,
    unit_price: 0,
    subtotal: 0,
    remark: ''
  }
}

function addableQuoteItem() {
  return {
    area_group: '',
    position: '',
    product_en: '',
    product_name: '',
    process: '',
    color_no: '',
    area: 0,
    list_unit_price: 0,
    discount_unit_price: 0,
    list_amount: 0,
    final_amount: 0
  }
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
  <el-dialog v-model="visible" title="导入施工交底单" width="1180px" class="briefing-import-dialog" @closed="resetAll">
    <div class="briefing-layout">
      <section class="source-panel">
        <div class="section-title">交底单来源</div>
        <div class="upload-box" @click="openPicker">
          <input ref="fileInput" class="hidden-input" type="file" accept=".csv,.xls,.xlsx" @change="onFileChange" />
          <el-icon :size="28"><UploadFilled /></el-icon>
          <div>
            <strong>{{ pickedFile?.name || '选择施工交底单表格' }}</strong>
            <span>支持总监工作树里的 .xls / .xlsx / .csv，原始文件会保存为工单附件。</span>
          </div>
        </div>
        <el-input
          v-model="rawText"
          class="text-source"
          type="textarea"
          :rows="8"
          resize="none"
          placeholder="没有表格时，可临时粘贴交底文字。正式使用建议上传施工交底单。"
          :disabled="!!pickedFile"
        />
        <div class="source-actions">
          <el-button @click="resetAll" :disabled="parsing || confirming">清空</el-button>
          <el-button type="primary" :loading="parsing" @click="parseBriefing">解析交底单</el-button>
        </div>

        <div class="summary-box">
          <div><span>客户</span><strong>{{ summaryValue(form.basic.customer) }}</strong></div>
          <div><span>地址</span><strong>{{ summaryValue(form.basic.address_detail) }}</strong></div>
          <div><span>施工明细</span><strong>{{ hasParsed ? `${itemCount} 条` : '待解析' }}</strong></div>
          <div><span>缺失项</span><strong>{{ hasParsed ? `${missingFields.length} 项` : '待解析' }}</strong></div>
        </div>

        <div v-if="hasParsed && duplicateMatches.length" class="warning-list">
          <div>
            <el-icon><WarningFilled /></el-icon>
            <span>可能重复：{{ duplicateMatches.map(item => `${item.name || item.customer}#${item.id}`).join('、') }}</span>
          </div>
        </div>
        <div v-if="displayWarnings.length" class="warning-list">
          <div v-for="warning in displayWarnings" :key="warning">
            <el-icon><WarningFilled /></el-icon>
            <span>{{ warning }}</span>
          </div>
        </div>
      </section>

      <section class="form-panel">
        <div class="result-header">
          <div>
            <div class="section-title">系统版施工交底单</div>
            <p>{{ hasParsed ? '核对字段后创建项目工单；不会自动推进项目状态。' : '解析后会在这里生成可编辑交底单。' }}</p>
          </div>
          <el-button type="primary" :disabled="!canConfirm" :loading="confirming" @click="confirmCreate">确认创建工单</el-button>
        </div>

        <el-form label-position="top" class="briefing-form">
          <div class="form-section">基础信息</div>
          <el-row :gutter="12">
            <el-col :span="6"><el-form-item label="来源门店/渠道"><el-input v-model="form.basic.source" /></el-form-item></el-col>
            <el-col :span="6"><el-form-item label="门店接单人"><el-input v-model="form.basic.order_taker" /></el-form-item></el-col>
            <el-col :span="6"><el-form-item label="接单日期"><el-input v-model="form.basic.order_date" placeholder="2026-01-01" /></el-form-item></el-col>
            <el-col :span="6"><el-form-item label="门店单号/合同号"><el-input v-model="form.basic.external_order_no" /></el-form-item></el-col>
            <el-col :span="6"><el-form-item label="客户姓名"><el-input v-model="form.basic.customer" /></el-form-item></el-col>
            <el-col :span="6"><el-form-item label="客户联系方式"><el-input v-model="form.basic.phone" /></el-form-item></el-col>
            <el-col :span="12"><el-form-item label="详细地址"><el-input v-model="form.basic.address_detail" /></el-form-item></el-col>
            <el-col :span="24"><el-form-item label="交接备注"><el-input v-model="form.basic.handover_note" type="textarea" :rows="2" /></el-form-item></el-col>
          </el-row>

          <div class="form-section">施工信息</div>
          <el-row :gutter="12">
            <el-col :span="6"><el-form-item label="预计开工"><el-input v-model="form.construction.expected_start_date" /></el-form-item></el-col>
            <el-col :span="6"><el-form-item label="预计总工期"><el-input v-model="form.construction.expected_duration" /></el-form-item></el-col>
            <el-col :span="6"><el-form-item label="施工总面积"><el-input v-model="form.construction.total_area" type="number" /></el-form-item></el-col>
            <el-col :span="6"><el-form-item label="交底日期"><el-input v-model="form.construction.briefing_date" /></el-form-item></el-col>
            <el-col :span="6"><el-form-item label="进入方式"><el-input v-model="form.construction.entry_method" /></el-form-item></el-col>
            <el-col :span="6"><el-form-item label="是否复尺"><el-input v-model="form.construction.remeasure" /></el-form-item></el-col>
            <el-col :span="6"><el-form-item label="车牌报备"><el-input v-model="form.construction.plate_needed" /></el-form-item></el-col>
            <el-col :span="6"><el-form-item label="班组长"><el-input v-model="form.construction.team_leader" /></el-form-item></el-col>
          </el-row>

          <div class="form-section">现场情况</div>
          <el-row :gutter="12">
            <el-col :span="8"><el-form-item label="基层情况"><el-input v-model="form.site.base_condition" /></el-form-item></el-col>
            <el-col :span="8"><el-form-item label="高空作业"><el-input v-model="form.site.high_work" /></el-form-item></el-col>
            <el-col :span="8"><el-form-item label="脚手架"><el-input v-model="form.site.scaffold" /></el-form-item></el-col>
            <el-col :span="8"><el-form-item label="二次搬运"><el-input v-model="form.site.second_transfer" /></el-form-item></el-col>
            <el-col :span="8"><el-form-item label="进场条件"><el-input v-model="form.site.entry_condition" /></el-form-item></el-col>
            <el-col :span="8"><el-form-item label="室内状况"><el-input v-model="form.site.site_status" /></el-form-item></el-col>
            <el-col :span="8"><el-form-item label="现场联系人"><el-input v-model="form.site.site_contact_name" /></el-form-item></el-col>
            <el-col :span="8"><el-form-item label="现场联系电话"><el-input v-model="form.site.site_contact_phone" /></el-form-item></el-col>
          </el-row>

          <div class="form-section with-action">
            <span>施工项目详情</span>
            <el-button size="small" :icon="Plus" @click="addItem">新增明细</el-button>
          </div>
          <div class="sub-section-title">交底施工范围</div>
          <div class="items-table">
            <div class="item-row item-head">
              <span>空间</span><span>纹理/产品</span><span>工艺</span><span>颜色</span><span>预收</span><span>复尺</span><span>备注</span><span></span>
            </div>
            <div v-for="(item, index) in form.items" :key="index" class="item-row">
              <el-input v-model="item.space_name" />
              <el-input v-model="item.texture_name" />
              <el-input v-model="item.process" />
              <el-input v-model="item.color_no" />
              <el-input v-model="item.planned_area" type="number" />
              <el-input v-model="item.actual_area" type="number" />
              <el-input v-model="item.remark" />
              <el-button text type="danger" @click="removeItem(index)">删</el-button>
            </div>
            <el-empty v-if="!form.items.length" description="暂无施工明细，可手动新增" :image-size="70" />
          </div>

          <div class="sub-section-title">销售/报价明细</div>
          <div class="quote-table">
            <div class="quote-row quote-head">
              <span>区域</span><span>位置</span><span>产品</span><span>工艺</span><span>色号</span><span>面积</span><span>标价金额</span><span>成交金额</span>
            </div>
            <div v-for="(item, index) in form.quotation_items" :key="index" class="quote-row">
              <el-input v-model="item.area_group" />
              <el-input v-model="item.position" />
              <el-input v-model="item.product_name" />
              <el-input v-model="item.process" />
              <el-input v-model="item.color_no" />
              <el-input v-model="item.area" type="number" />
              <el-input v-model="item.list_amount" type="number" />
              <el-input v-model="item.final_amount" type="number" />
            </div>
            <el-empty v-if="!form.quotation_items.length" description="暂无销售/报价明细" :image-size="70" />
          </div>

          <div class="form-section">收款和其他事项</div>
          <el-row :gutter="12">
            <el-col :span="6"><el-form-item label="预估总金额"><el-input v-model="form.finance.estimated_total_amount" type="number" /></el-form-item></el-col>
            <el-col :span="18"><el-form-item label="已收款"><el-input v-model="form.finance.received_summary" /></el-form-item></el-col>
            <el-col :span="12"><el-form-item label="未收款"><el-input v-model="form.finance.unpaid_summary" /></el-form-item></el-col>
            <el-col :span="12"><el-form-item label="返点/退款"><el-input v-model="form.finance.rebate_note" /></el-form-item></el-col>
            <el-col :span="24"><el-form-item label="报价说明"><el-input v-model="form.finance.pricing_note" type="textarea" :rows="2" /></el-form-item></el-col>
          </el-row>

          <div class="form-section">图片资料</div>
          <div class="image-note">
            <strong>表内图片：{{ form.images.embedded_count || 0 }} 张</strong>
            <span>{{ form.images.note || '未检测到表内图片。' }}</span>
            <span>{{ form.images.attachment_note || '现场图片、工艺参考图、签字图片可作为工单附件单独上传。' }}</span>
          </div>

          <div class="form-section">签字/确认</div>
          <el-row :gutter="12">
            <el-col :span="8"><el-form-item label="交底人"><el-input v-model="form.signatures.briefer" /></el-form-item></el-col>
            <el-col :span="8"><el-form-item label="确认人"><el-input v-model="form.signatures.confirmer" /></el-form-item></el-col>
            <el-col :span="8"><el-form-item label="确认时间"><el-input v-model="form.signatures.confirmed_at" /></el-form-item></el-col>
          </el-row>
        </el-form>
      </section>
    </div>
  </el-dialog>
</template>

<style scoped>
.briefing-layout {
  display: grid;
  grid-template-columns: 330px minmax(0, 1fr);
  gap: 18px;
  min-height: 640px;
}

.source-panel,
.form-panel {
  min-width: 0;
}

.section-title {
  font-size: 16px;
  font-weight: 700;
  margin-bottom: 10px;
}

.upload-box {
  min-height: 86px;
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

.text-source {
  margin-top: 12px;
}

.source-actions,
.result-header,
.form-section.with-action {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.source-actions {
  margin-top: 12px;
}

.summary-box {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 14px;
}

.summary-box div {
  padding: 10px;
  border-radius: var(--radius-sm);
  background: var(--bg-page);
}

.summary-box span {
  display: block;
  color: var(--text-tertiary);
  font-size: 12px;
  margin-bottom: 4px;
}

.summary-box strong {
  color: var(--text-primary);
}

.warning-list {
  display: grid;
  gap: 6px;
  margin-top: 10px;
  color: #b45309;
  font-size: 13px;
}

.warning-list div {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 8px 9px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, #f59e0b 12%, var(--bg-card));
}

.result-header {
  margin-bottom: 12px;
}

.result-header p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 13px;
}

.briefing-form {
  max-height: 585px;
  overflow: auto;
  padding-right: 4px;
}

.form-section {
  margin: 12px 0 10px;
  color: var(--text-primary);
  font-weight: 700;
}

.sub-section-title {
  margin: 8px 0;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 700;
}

.items-table {
  max-width: 100%;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-gutter: stable;
}

.quote-table {
  margin-top: 8px;
  max-width: 100%;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-gutter: stable;
}

.item-row {
  display: grid;
  grid-template-columns: 190px 190px 140px 160px 112px 112px 220px 44px;
  gap: 8px;
  align-items: center;
  width: max-content;
  min-width: 100%;
  padding: 8px;
  border-top: 1px solid var(--border-light);
}

.item-row:first-child {
  border-top: 0;
}

.item-head {
  background: var(--bg-page);
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.quote-row {
  display: grid;
  grid-template-columns: 150px 170px 190px 150px 140px 112px 132px 132px;
  gap: 8px;
  align-items: center;
  width: max-content;
  min-width: 100%;
  padding: 8px;
  border-top: 1px solid var(--border-light);
}

.quote-row:first-child {
  border-top: 0;
}

.quote-head {
  background: var(--bg-page);
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}

.item-row :deep(.el-input),
.quote-row :deep(.el-input) {
  width: 100%;
}

.image-note {
  display: grid;
  gap: 5px;
  padding: 10px 12px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: var(--bg-page);
  color: var(--text-secondary);
  font-size: 13px;
}

.image-note strong {
  color: var(--text-primary);
}

@media (max-width: 980px) {
  .briefing-layout {
    grid-template-columns: 1fr;
  }

  .briefing-form {
    max-height: none;
  }

  .items-table,
  .quote-table {
    margin-right: -4px;
  }
}
</style>
