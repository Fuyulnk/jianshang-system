<script setup>
import { getAuthToken } from '../../utils/authSession'
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { UploadFilled, WarningFilled, Plus } from '@element-plus/icons-vue'

const props = defineProps({
  project: { type: Object, required: true },
  canApply: { type: Boolean, default: false }
})

const emit = defineEmits(['applied'])

const collapsed = ref(false)
const loading = ref(false)
const parsing = ref(false)
const saving = ref(false)
const fileInput = ref(null)
const pickedFile = ref(null)
const document = ref(null)
const parsedData = ref(null)
const warnings = ref([])
const form = ref(emptyBriefingForm())

const hasDocument = computed(() => !!document.value)
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
  const list = [...warnings.value, ...missingFields.value.map(item => `缺核心资料：${item}`)]
  return [...new Set(list.filter(Boolean))]
})
const summary = computed(() => ({
  customer: form.value.basic.customer || props.project.customer || '未填写',
  address: form.value.basic.address_detail || props.project.address_detail || props.project.address || '未填写',
  area: form.value.construction.total_area || '未填写',
  teamLeader: form.value.construction.team_leader || props.project.team_leader || '未安排',
  itemCount: form.value.items.length
}))
const canSave = computed(() => props.canApply && !saving.value)

watch(() => props.project?.id, () => {
  loadBriefing()
}, { immediate: true })

function token() {
  return getAuthToken()
}

function emptyBriefingForm() {
  return {
    basic: {
      source: props.project?.source || '',
      order_taker: props.project?.order_taker || '',
      order_date: props.project?.order_date || '',
      customer: props.project?.customer || '',
      phone: props.project?.phone || '',
      address_province: props.project?.address_province || '',
      address_city: props.project?.address_city || '',
      address_detail: props.project?.address_detail || props.project?.address || '',
      external_order_no: props.project?.external_order_no || '',
      handover_note: props.project?.handover_note || ''
    },
    construction: {
      expected_start_date: props.project?.start_date || '',
      expected_duration: '',
      entry_method: '',
      total_area: 0,
      remeasure: '',
      plate_needed: '',
      team_leader: props.project?.team_leader || '',
      briefing_date: props.project?.briefing_date || '',
      total_amount: Number(props.project?.total_amount || 0)
    },
    finance: {
      estimated_total_amount: Number(props.project?.total_amount || 0),
      received_summary: '',
      unpaid_summary: '',
      rebate_note: '',
      pricing_note: '',
      raw_lines: []
    },
    site: {
      base_condition: props.project?.condition_note || '',
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

async function loadBriefing() {
  if (!props.project?.id) return
  loading.value = true
  try {
    const res = await fetch(`/api/projects/${props.project.id}/briefing`, {
      headers: { Authorization: `Bearer ${token()}` }
    })
    const json = await readJson(res)
    if (!res.ok || !json.success) throw new Error(json.message || '读取班组交底单失败')
    document.value = json.data
    if (json.data?.confirmed_data) {
      form.value = normalizeBriefingForm(json.data.confirmed_data)
      warnings.value = json.data.warnings || []
      parsedData.value = json.data.parsed_data || null
      collapsed.value = true
    } else {
      form.value = emptyBriefingForm()
      warnings.value = []
      parsedData.value = null
      collapsed.value = false
    }
  } catch (err) {
    ElMessage.error(err.message || '读取班组交底单失败')
  } finally {
    loading.value = false
  }
}

function openPicker() {
  fileInput.value?.click()
}

function onFileChange(event) {
  const file = event.target.files?.[0]
  if (!file) return
  if (!/\.(csv|xls|xlsx)$/i.test(file.name)) {
    ElMessage.warning('班组交底单暂只支持 CSV / XLS / XLSX')
    event.target.value = ''
    return
  }
  if (file.size > 50 * 1024 * 1024) {
    ElMessage.warning('单个文件不能超过 50MB')
    event.target.value = ''
    return
  }
  pickedFile.value = file
  parseFile()
}

async function parseFile() {
  if (!pickedFile.value) return
  parsing.value = true
  try {
    const res = await fetch('/api/briefing-imports/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({
        file_name: pickedFile.value.name,
        file_data: await readAsDataUrl(pickedFile.value)
      })
    })
    const json = await readJson(res)
    if (!res.ok || !json.success) throw new Error(json.message || '班组交底单解析失败')
    parsedData.value = json.data
    form.value = normalizeBriefingForm(json.data.form_data)
    warnings.value = json.data.warnings || []
    collapsed.value = false
    ElMessage.success('班组交底单已解析，可核对后保存')
  } catch (err) {
    ElMessage.error(err.message || '班组交底单解析失败')
  } finally {
    parsing.value = false
  }
}

async function saveBriefing() {
  if (!props.canApply) {
    ElMessage.warning('当前账号只能查看，不能保存班组交底单')
    return
  }
  saving.value = true
  try {
    const res = await fetch(`/api/projects/${props.project.id}/briefing/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({
        parsed_data: parsedData.value || document.value?.parsed_data || {},
        confirmed_data: form.value,
        warnings: warnings.value,
        source_attachment_id: document.value?.source_attachment_id || 0,
        file: pickedFile.value ? {
          name: pickedFile.value.name,
          mime_type: pickedFile.value.type,
          size: pickedFile.value.size,
          data: await readAsDataUrl(pickedFile.value)
        } : null
      })
    })
    const json = await readJson(res)
    if (!res.ok || !json.success) throw new Error(json.message || '保存失败')
    ElMessage.success('班组交底单已保存')
    pickedFile.value = null
    if (fileInput.value) fileInput.value.value = ''
    await loadBriefing()
    emit('applied')
  } catch (err) {
    ElMessage.error(err.message || '保存失败')
  } finally {
    saving.value = false
  }
}

function addItem() {
  form.value.items.push(addableItem())
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
  <el-card class="briefing-panel" shadow="never" v-loading="loading">
    <template #header>
      <div class="panel-head">
        <button class="collapse-btn" type="button" @click="collapsed = !collapsed">
          <span>{{ collapsed ? '展开' : '收起' }}</span>
        </button>
        <div class="head-main">
          <div class="kicker">项目核心单据</div>
          <h3>班组交底单</h3>
          <p>系统版可编辑班组交底单。原始 Excel 会作为工单附件保留，保存后不会自动推进状态。</p>
        </div>
        <div class="head-actions">
          <el-tag v-if="hasDocument" type="success">已保存</el-tag>
          <el-tag v-else type="warning">未上传</el-tag>
          <el-button size="small" @click="openPicker" :loading="parsing">导入/更新</el-button>
          <input ref="fileInput" class="hidden-input" type="file" accept=".csv,.xls,.xlsx" @change="onFileChange" />
        </div>
      </div>
    </template>

    <div class="briefing-summary">
      <div><span>客户</span><strong>{{ summary.customer }}</strong></div>
      <div><span>地址</span><strong>{{ summary.address }}</strong></div>
      <div><span>施工面积</span><strong>{{ summary.area }}</strong></div>
      <div><span>班组长</span><strong>{{ summary.teamLeader }}</strong></div>
      <div><span>施工明细</span><strong>{{ summary.itemCount }} 条</strong></div>
      <div><span>缺失项</span><strong>{{ missingFields.length }} 项</strong></div>
    </div>

    <div v-if="displayWarnings.length" class="warning-list">
      <div v-for="warning in displayWarnings" :key="warning">
        <el-icon><WarningFilled /></el-icon>
        <span>{{ warning }}</span>
      </div>
    </div>

    <template v-if="!collapsed">
      <div v-if="!hasDocument && !pickedFile" class="empty-hint">
        <el-icon><UploadFilled /></el-icon>
        <span>还没有班组交底单。可以导入总监表格，也可以直接在下面补系统版字段。</span>
      </div>

      <el-form label-position="top" class="briefing-form">
        <div class="form-section">基础信息</div>
        <el-row :gutter="12">
          <el-col :span="6"><el-form-item label="来源门店/渠道"><el-input v-model="form.basic.source" :disabled="!canApply" /></el-form-item></el-col>
          <el-col :span="6"><el-form-item label="门店接单人"><el-input v-model="form.basic.order_taker" :disabled="!canApply" /></el-form-item></el-col>
          <el-col :span="6"><el-form-item label="接单日期"><el-input v-model="form.basic.order_date" :disabled="!canApply" /></el-form-item></el-col>
          <el-col :span="6"><el-form-item label="门店单号/合同号"><el-input v-model="form.basic.external_order_no" :disabled="!canApply" /></el-form-item></el-col>
          <el-col :span="6"><el-form-item label="客户姓名"><el-input v-model="form.basic.customer" :disabled="!canApply" /></el-form-item></el-col>
          <el-col :span="6"><el-form-item label="客户联系方式"><el-input v-model="form.basic.phone" :disabled="!canApply" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="详细地址"><el-input v-model="form.basic.address_detail" :disabled="!canApply" /></el-form-item></el-col>
          <el-col :span="24"><el-form-item label="门店交底备注"><el-input v-model="form.basic.handover_note" type="textarea" :rows="2" :disabled="!canApply" /></el-form-item></el-col>
        </el-row>

        <div class="form-section">施工信息</div>
        <el-row :gutter="12">
          <el-col :span="6"><el-form-item label="预计开工"><el-input v-model="form.construction.expected_start_date" :disabled="!canApply" /></el-form-item></el-col>
          <el-col :span="6"><el-form-item label="预计总工期"><el-input v-model="form.construction.expected_duration" :disabled="!canApply" /></el-form-item></el-col>
          <el-col :span="6"><el-form-item label="施工总面积"><el-input v-model="form.construction.total_area" type="number" :disabled="!canApply" /></el-form-item></el-col>
          <el-col :span="6"><el-form-item label="班组交底日期"><el-input v-model="form.construction.briefing_date" :disabled="!canApply" /></el-form-item></el-col>
          <el-col :span="6"><el-form-item label="进入方式"><el-input v-model="form.construction.entry_method" :disabled="!canApply" /></el-form-item></el-col>
          <el-col :span="6"><el-form-item label="是否复尺"><el-input v-model="form.construction.remeasure" :disabled="!canApply" /></el-form-item></el-col>
          <el-col :span="6"><el-form-item label="车牌报备"><el-input v-model="form.construction.plate_needed" :disabled="!canApply" /></el-form-item></el-col>
          <el-col :span="6"><el-form-item label="班组长"><el-input v-model="form.construction.team_leader" :disabled="!canApply" /></el-form-item></el-col>
        </el-row>

        <div class="form-section">现场情况</div>
        <el-row :gutter="12">
          <el-col :span="8"><el-form-item label="基层情况"><el-input v-model="form.site.base_condition" :disabled="!canApply" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="高空作业"><el-input v-model="form.site.high_work" :disabled="!canApply" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="脚手架"><el-input v-model="form.site.scaffold" :disabled="!canApply" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="二次搬运"><el-input v-model="form.site.second_transfer" :disabled="!canApply" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="进场条件"><el-input v-model="form.site.entry_condition" :disabled="!canApply" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="室内状况"><el-input v-model="form.site.site_status" :disabled="!canApply" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="现场联系人"><el-input v-model="form.site.site_contact_name" :disabled="!canApply" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="现场联系电话"><el-input v-model="form.site.site_contact_phone" :disabled="!canApply" /></el-form-item></el-col>
        </el-row>

        <div class="form-section with-action">
          <span>施工项目详情</span>
          <el-button size="small" :icon="Plus" :disabled="!canApply" @click="addItem">新增明细</el-button>
        </div>
        <div class="sub-section-title">交底施工范围</div>
        <div class="items-table">
          <div class="item-row item-head">
            <span>空间</span><span>纹理/产品</span><span>工艺</span><span>颜色</span><span>预收</span><span>复尺</span><span>备注</span><span></span>
          </div>
          <div v-for="(item, index) in form.items" :key="index" class="item-row">
            <el-input v-model="item.space_name" :disabled="!canApply" />
            <el-input v-model="item.texture_name" :disabled="!canApply" />
            <el-input v-model="item.process" :disabled="!canApply" />
            <el-input v-model="item.color_no" :disabled="!canApply" />
            <el-input v-model="item.planned_area" type="number" :disabled="!canApply" />
            <el-input v-model="item.actual_area" type="number" :disabled="!canApply" />
            <el-input v-model="item.remark" :disabled="!canApply" />
            <el-button text type="danger" :disabled="!canApply" @click="removeItem(index)">删</el-button>
          </div>
          <el-empty v-if="!form.items.length" description="暂无施工明细，可手动新增" :image-size="70" />
        </div>

        <div class="sub-section-title">销售/报价明细</div>
        <div class="quote-table">
          <div class="quote-row quote-head">
            <span>区域</span><span>位置</span><span>产品</span><span>工艺</span><span>色号</span><span>面积</span><span>标价金额</span><span>成交金额</span>
          </div>
          <div v-for="(item, index) in form.quotation_items" :key="index" class="quote-row">
            <el-input v-model="item.area_group" :disabled="!canApply" />
            <el-input v-model="item.position" :disabled="!canApply" />
            <el-input v-model="item.product_name" :disabled="!canApply" />
            <el-input v-model="item.process" :disabled="!canApply" />
            <el-input v-model="item.color_no" :disabled="!canApply" />
            <el-input v-model="item.area" type="number" :disabled="!canApply" />
            <el-input v-model="item.list_amount" type="number" :disabled="!canApply" />
            <el-input v-model="item.final_amount" type="number" :disabled="!canApply" />
          </div>
          <el-empty v-if="!form.quotation_items.length" description="暂无销售/报价明细" :image-size="70" />
        </div>

        <div class="form-section">收款和其他事项</div>
        <el-row :gutter="12">
          <el-col :span="6"><el-form-item label="预估总金额"><el-input v-model="form.finance.estimated_total_amount" type="number" :disabled="!canApply" /></el-form-item></el-col>
          <el-col :span="18"><el-form-item label="已收款"><el-input v-model="form.finance.received_summary" :disabled="!canApply" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="未收款"><el-input v-model="form.finance.unpaid_summary" :disabled="!canApply" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="返点/退款"><el-input v-model="form.finance.rebate_note" :disabled="!canApply" /></el-form-item></el-col>
          <el-col :span="24"><el-form-item label="报价说明"><el-input v-model="form.finance.pricing_note" type="textarea" :rows="2" :disabled="!canApply" /></el-form-item></el-col>
        </el-row>

        <div class="form-section">图片资料</div>
        <div class="image-note">
          <strong>表内图片：{{ form.images.embedded_count || 0 }} 张</strong>
          <span>{{ form.images.note || '未检测到表内图片。' }}</span>
          <span>{{ form.images.attachment_note || '现场图片、工艺参考图、签字图片可作为工单附件单独上传。' }}</span>
        </div>

        <div class="form-section">签字/确认</div>
        <el-row :gutter="12">
          <el-col :span="8"><el-form-item label="交底人"><el-input v-model="form.signatures.briefer" :disabled="!canApply" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="确认人"><el-input v-model="form.signatures.confirmer" :disabled="!canApply" /></el-form-item></el-col>
          <el-col :span="8"><el-form-item label="确认时间"><el-input v-model="form.signatures.confirmed_at" :disabled="!canApply" /></el-form-item></el-col>
        </el-row>
      </el-form>

      <div class="save-bar">
        <span>材料出库表、成本核算表等其他单据后续在对应流程节点处理；这里先固定班组交底单。</span>
        <el-button type="primary" :disabled="!canSave" :loading="saving" @click="saveBriefing">
          {{ canApply ? '保存班组交底单' : '无保存权限' }}
        </el-button>
      </div>
    </template>
  </el-card>
</template>

<style scoped>
.briefing-panel {
  margin-bottom: 16px;
}

.panel-head {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

.collapse-btn {
  width: 54px;
  height: 32px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: var(--bg-page);
  color: var(--text-secondary);
  cursor: pointer;
}

.head-main {
  flex: 1;
  min-width: 0;
}

.kicker {
  color: var(--color-primary);
  font-size: 12px;
  font-weight: 700;
  margin-bottom: 4px;
}

.head-main h3 {
  margin: 0 0 5px;
  color: var(--text-primary);
}

.head-main p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 13px;
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.hidden-input {
  display: none;
}

.briefing-summary {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
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
  word-break: break-word;
}

.warning-list {
  display: grid;
  gap: 6px;
  margin-top: 12px;
  color: #b45309;
  font-size: 13px;
}

.warning-list div,
.empty-hint {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, #f59e0b 12%, var(--bg-card));
}

.empty-hint {
  margin-top: 12px;
  color: #b45309;
}

.briefing-form {
  margin-top: 14px;
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

.form-section.with-action,
.save-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
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

.save-bar {
  margin-top: 14px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--color-primary) 8%, var(--bg-card));
  color: var(--text-secondary);
  font-size: 13px;
}

@media (max-width: 1100px) {
  .briefing-summary {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .items-table,
  .quote-table {
    margin-right: -4px;
  }
}

@media (max-width: 760px) {
  .panel-head,
  .head-actions,
  .save-bar {
    align-items: stretch;
    flex-direction: column;
  }

  .briefing-summary {
    grid-template-columns: 1fr;
  }
}
</style>
