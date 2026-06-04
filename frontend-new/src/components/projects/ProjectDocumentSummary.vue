<script setup>
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Collection, DocumentChecked, Warning } from '@element-plus/icons-vue'

const props = defineProps({
  project: { type: Object, required: true }
})

const loading = ref(false)
const attachments = ref([])

const documentRules = [
  {
    key: 'survey',
    stage: '勘察',
    label: '现场勘察表',
    directorFiles: ['现场勘察表.pptx'],
    desc: '记录现场照片、基层问题、整改建议、是否具备进场条件。',
    rx: /现场勘察|基层勘察|基层工勘|工勘|勘查|勘察|复勘/i,
    requiredFields: [
      { key: 'survey_date', label: '勘察日期' },
      { key: 'survey_report', label: '勘察记录' }
    ],
    nextAction: '由工程部上传或生成现场勘察表，并同步勘察日期/记录。'
  },
  {
    key: 'remeasure',
    stage: '复尺',
    label: '基层二次勘察/复尺表',
    directorFiles: ['基层二次勘察表.pptx', '二次勘察复核面积.xls'],
    desc: '记录面积修正、基层复核、整改后能否进场。',
    rx: /二次|复尺|复核面积|质检复核|基层二次/i,
    requiredFields: [
      { key: 'condition_note', label: '复尺/开工条件复核' }
    ],
    nextAction: '补复尺或基层复核附件；若只先走系统，可先填写复尺/开工条件复核记录。'
  },
  {
    key: 'briefing',
    stage: '交底',
    label: '施工交底单',
    directorFiles: ['施工交底单.xls', '工勘交底单.xlsx'],
    desc: '确认施工范围、工艺、面积、颜色、班组交底和进场注意事项。',
    rx: /施工交底|工勘交底|成本交底|交底单/i,
    requiredFields: [
      { key: 'briefing_date', label: '交底日期' },
      { key: 'team_leader', label: '班组长' },
      { key: 'assignee_user_id', label: '施工负责人' }
    ],
    nextAction: '上传施工交底单，并确认班组长、施工负责人和交底日期。'
  },
  {
    key: 'warehouse',
    stage: '仓库',
    label: '材料出库/回库表',
    directorFiles: ['材料出库表.xlsx', '材料回库表.xlsx'],
    desc: '记录主材、辅材、工具、运输、出库数量和回库数量。',
    rx: /出库|回库|材料单|材料出库|涂料进场/i,
    requiredFields: [
      { key: 'material_out_status', label: '材料出库状态', pass: value => value === 'done' },
      { key: 'material_return_status', label: '材料回库状态', pass: value => value === 'done' }
    ],
    nextAction: '交底完成后从材料出库联动发起申请；验收后补回库状态和余料说明。'
  },
  {
    key: 'labor',
    stage: '工费',
    label: '施工班组工费结算单',
    directorFiles: ['施工班组工费结算单.xls'],
    desc: '记录班组长、施工面积、单价、工费合计和付款状态。',
    rx: /班组|工费|人工|工资|施工班组/i,
    requiredFields: [
      { key: 'team_leader', label: '班组长' }
    ],
    requiresAttachment: true,
    nextAction: '上传班组工费结算单；V2 后续再结构化面积、单价和工费合计。'
  },
  {
    key: 'cost',
    stage: '成本',
    label: '完工成本核算表',
    directorFiles: ['完工成本核算表.xls'],
    desc: '核对工程款、人工、材料、辅材、工具、运输和利润率。',
    rx: /完工成本|成本核算|成本表/i,
    requiredFields: [
      { key: 'settlement_amount', label: '结算金额', pass: value => Number(value) > 0 }
    ],
    requiresAttachment: true,
    nextAction: '上传完工成本核算表；金额字段只做辅助判断，不能替代成本表。'
  },
  {
    key: 'finance',
    stage: '财务',
    label: '财务结算/对账凭证',
    directorFiles: ['收款记录', '付款记录', '尾款对账'],
    desc: '核对收款、付款、未付、尾款和最终对账结果。',
    rx: /结算|付款|收款|财务|尾款|对账/i,
    requiredFields: [
      { key: 'total_amount', label: '合同金额', pass: value => Number(value) > 0 },
      { key: 'deposit_amount', label: '定金/已收款', pass: value => Number(value) > 0 },
      { key: 'settlement_amount', label: '最终结算金额', pass: value => Number(value) > 0 }
    ],
    nextAction: '补最终结算金额和财务凭证；只有合同金额/定金不能视为财务闭环。'
  }
]

const rows = computed(() => documentRules.map(rule => {
  const files = attachments.value.filter(file => rule.rx.test(file.original_name || ''))
  const fields = rule.requiredFields.map(field => {
    const value = props.project?.[field.key]
    const ok = typeof field.pass === 'function' ? field.pass(value, props.project) : hasFieldValue(value)
    return { ...field, value, ok }
  })
  const completedFields = fields.filter(field => field.ok)
  const hasFile = files.length > 0
  const hasAllFields = fields.length > 0 && completedFields.length === fields.length
  const complete = rule.requiresAttachment ? hasFile && hasAllFields : hasFile || hasAllFields
  const partial = !complete && (hasFile || completedFields.length > 0)
  return {
    ...rule,
    files,
    fields,
    completedFields,
    complete,
    partial,
    status: complete ? '已具备' : partial ? '部分具备' : '待补',
    statusType: complete ? 'success' : partial ? 'warning' : 'danger'
  }
}))

const completedCount = computed(() => rows.value.filter(row => row.complete).length)
const partialCount = computed(() => rows.value.filter(row => row.partial).length)
const missingRows = computed(() => rows.value.filter(row => !row.complete))
const attachmentHitCount = computed(() => rows.value.filter(row => row.files.length).length)
const healthType = computed(() => missingRows.value.length ? 'warning' : 'success')
const healthLabel = computed(() => missingRows.value.length ? `待补 ${missingRows.value.length} 项` : '资料链完整')

watch(() => props.project?.id, fetchAttachments, { immediate: true })

function token() {
  return localStorage.getItem('token')
}

function hasFieldValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '' && Number(value) !== 0
}

async function fetchAttachments() {
  if (!props.project?.id) return
  loading.value = true
  try {
    const params = new URLSearchParams({
      entity_type: 'project',
      entity_id: String(props.project.id)
    })
    const res = await fetch(`/api/files?${params}`, {
      headers: { Authorization: `Bearer ${token()}` }
    })
    const json = await res.json()
    if (json.success) attachments.value = json.data || []
    else ElMessage.warning(json.message || '单据附件读取失败')
  } catch {
    ElMessage.warning('单据附件读取失败')
  } finally {
    loading.value = false
  }
}

function money(value) {
  const n = Number(value || 0)
  if (!Number.isFinite(n) || n <= 0) return '未填写'
  return `￥${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
</script>

<template>
  <el-card class="document-summary" shadow="never" v-loading="loading">
    <template #header>
      <div class="summary-head">
        <div>
          <div class="kicker">项目单据链 V2</div>
          <h3>总监表格字段映射</h3>
          <p>按总监真实工作树拆成附件、关键字段和下一步补资料动作。</p>
        </div>
        <el-tag :type="healthType">{{ healthLabel }}</el-tag>
      </div>
    </template>

    <div class="summary-top">
      <div class="metric">
        <span>完整节点</span>
        <strong>{{ completedCount }}/{{ rows.length }}</strong>
      </div>
      <div class="metric">
        <span>部分节点</span>
        <strong>{{ partialCount }}</strong>
      </div>
      <div class="metric">
        <span>附件命中</span>
        <strong>{{ attachmentHitCount }}</strong>
      </div>
      <div class="metric">
        <span>结算金额</span>
        <strong>{{ money(project.settlement_amount) }}</strong>
      </div>
    </div>

    <div class="chain-grid">
      <article v-for="row in rows" :key="row.key" class="chain-card" :class="{ complete: row.complete, partial: row.partial }">
        <div class="chain-title">
          <el-icon><DocumentChecked v-if="row.complete" /><Warning v-else /></el-icon>
          <div>
            <span>{{ row.stage }}</span>
            <strong>{{ row.label }}</strong>
          </div>
          <el-tag size="small" :type="row.statusType">{{ row.status }}</el-tag>
        </div>

        <p>{{ row.desc }}</p>

        <div class="file-patterns">
          <span>总监文件</span>
          <b>{{ row.directorFiles.join(' / ') }}</b>
        </div>

        <div class="field-list">
          <span v-for="field in row.fields" :key="field.key" :class="['field-pill', { ok: field.ok }]">
            {{ field.label }}
          </span>
        </div>

        <div class="chain-evidence">
          <span v-if="row.files.length">
            附件命中：{{ row.files.slice(0, 2).map(file => file.original_name).join('、') }}{{ row.files.length > 2 ? ` 等 ${row.files.length} 个` : '' }}
          </span>
          <span v-else-if="row.completedFields.length">字段命中：{{ row.completedFields.map(field => field.label).join('、') }}</span>
          <span v-else>暂无可识别资料</span>
        </div>

        <div v-if="!row.complete" class="next-action">
          {{ row.nextAction }}
        </div>
      </article>
    </div>

    <div v-if="missingRows.length" class="summary-warning">
      <el-icon><Collection /></el-icon>
      <span>优先补齐：{{ missingRows.map(row => row.label).join('、') }}。本轮只做识别和缺项提示，不做自动成本核算。</span>
    </div>
  </el-card>
</template>

<style scoped>
.document-summary {
  margin-bottom: 20px;
  border: 1px solid color-mix(in srgb, var(--color-primary) 18%, var(--border-light));
}

.summary-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}

.kicker {
  margin-bottom: 4px;
  color: var(--color-primary);
  font-size: 12px;
  font-weight: 800;
}

.summary-head h3 {
  margin: 0 0 5px;
  color: var(--text-primary);
  font-size: 18px;
}

.summary-head p {
  margin: 0;
  color: var(--text-tertiary);
  font-size: 13px;
}

.summary-top {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 14px;
}

.metric {
  min-width: 0;
  padding: 12px;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--bg-card) 84%, var(--bg-page));
  border: 1px solid var(--border-light);
}

.metric span {
  display: block;
  color: var(--text-tertiary);
  font-size: 12px;
  margin-bottom: 4px;
}

.metric strong {
  color: var(--text-primary);
  font-size: 18px;
}

.chain-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.chain-card {
  padding: 12px;
  border: 1px solid color-mix(in srgb, #ef4444 18%, var(--border-light));
  border-radius: var(--radius-md);
  background: color-mix(in srgb, #ef4444 6%, var(--bg-card));
}

.chain-card.partial {
  border-color: color-mix(in srgb, #f59e0b 25%, var(--border-light));
  background: color-mix(in srgb, #f59e0b 7%, var(--bg-card));
}

.chain-card.complete {
  border-color: color-mix(in srgb, #22c55e 25%, var(--border-light));
  background: color-mix(in srgb, #22c55e 7%, var(--bg-card));
}

.chain-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 7px;
}

.chain-title > div {
  flex: 1;
  min-width: 0;
}

.chain-title span {
  display: block;
  color: var(--text-tertiary);
  font-size: 12px;
}

.chain-title strong {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
}

.chain-card p {
  margin: 0 0 8px;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.5;
}

.file-patterns {
  display: grid;
  gap: 3px;
  margin-bottom: 8px;
  color: var(--text-tertiary);
  font-size: 12px;
}

.file-patterns b {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
  font-weight: 600;
}

.field-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.field-pill {
  padding: 3px 7px;
  border: 1px solid var(--border-light);
  border-radius: 999px;
  color: var(--text-tertiary);
  background: var(--bg-card);
  font-size: 12px;
}

.field-pill.ok {
  color: #15803d;
  border-color: color-mix(in srgb, #22c55e 35%, var(--border-light));
  background: color-mix(in srgb, #22c55e 10%, var(--bg-card));
}

.chain-evidence {
  color: var(--text-tertiary);
  font-size: 12px;
  line-height: 1.45;
}

.next-action {
  margin-top: 8px;
  padding: 8px 9px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--bg-card) 80%, var(--bg-page));
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.45;
}

.summary-warning {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  margin-top: 14px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, #f59e0b 12%, var(--bg-card));
  color: #b45309;
  font-size: 13px;
  line-height: 1.5;
}

@media (max-width: 860px) {
  .summary-top,
  .chain-grid {
    grid-template-columns: 1fr;
  }
}
</style>
