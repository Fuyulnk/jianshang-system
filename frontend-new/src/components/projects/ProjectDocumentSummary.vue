<script setup>
import { computed, onMounted, ref, watch } from 'vue'
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
    label: '现场勘察',
    desc: '现场照片、基层问题、整改建议、是否具备进场条件。',
    rx: /现场勘察|基层勘察|基层工勘|工勘|勘查|勘察|复勘/i,
    systemFields: ['survey_report', 'survey_date']
  },
  {
    key: 'remeasure',
    label: '二次勘察/复尺',
    desc: '面积修正、基层复核、整改后能否进场。',
    rx: /二次|复尺|复核面积|质检复核/i,
    systemFields: []
  },
  {
    key: 'handover',
    label: '施工交底',
    desc: '施工范围、工艺、面积、颜色、班组交底。',
    rx: /施工交底|工勘交底|成本交底|交底单/i,
    systemFields: ['briefing_date']
  },
  {
    key: 'warehouse',
    label: '材料出库/回库',
    desc: '主材、辅材、工具、运输、回库数量。',
    rx: /出库|回库|材料单|材料出库|涂料进场/i,
    systemFields: ['material_out_status', 'material_return_status']
  },
  {
    key: 'labor',
    label: '班组工费结算',
    desc: '班组长、施工面积、单价、工费合计。',
    rx: /班组|工费|人工|工资/i,
    systemFields: ['team_leader']
  },
  {
    key: 'cost',
    label: '完工成本核算',
    desc: '工程款、人工、材料、辅材、工具、运输、利润率。',
    rx: /完工成本|成本核算/i,
    systemFields: ['settlement_amount']
  },
  {
    key: 'finance',
    label: '财务结算',
    desc: '收款、付款、未付、尾款、对账。',
    rx: /结算|付款|收款|财务/i,
    systemFields: ['total_amount', 'deposit_amount', 'settlement_amount']
  }
]

const rows = computed(() => documentRules.map(rule => {
  const files = attachments.value.filter(file => rule.rx.test(file.original_name || ''))
  const fieldHits = rule.systemFields.filter(field => hasFieldValue(field))
  const done = files.length > 0 || fieldHits.length > 0
  return {
    ...rule,
    files,
    fieldHits,
    done,
    status: done ? '已具备' : '待补',
    statusType: done ? 'success' : 'warning'
  }
}))

const completedCount = computed(() => rows.value.filter(row => row.done).length)
const missingRows = computed(() => rows.value.filter(row => !row.done))
const healthType = computed(() => missingRows.value.length ? 'warning' : 'success')
const healthLabel = computed(() => missingRows.value.length ? `待补 ${missingRows.value.length} 项` : '资料链完整')

watch(() => props.project?.id, fetchAttachments, { immediate: true })
onMounted(fetchAttachments)

function token() {
  return localStorage.getItem('token')
}

function hasFieldValue(field) {
  const value = props.project?.[field]
  if (field === 'material_out_status' || field === 'material_return_status') return value && value !== 'pending'
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
          <div class="kicker">项目单据链汇总</div>
          <h3>从总监工作树反推的标准闭环</h3>
          <p>先看这单有没有走完勘察、交底、出库、工费、成本和财务结算。</p>
        </div>
        <el-tag :type="healthType">{{ healthLabel }}</el-tag>
      </div>
    </template>

    <div class="summary-top">
      <div class="metric">
        <span>完成节点</span>
        <strong>{{ completedCount }}/{{ rows.length }}</strong>
      </div>
      <div class="metric">
        <span>合同金额</span>
        <strong>{{ money(project.total_amount) }}</strong>
      </div>
      <div class="metric">
        <span>定金</span>
        <strong>{{ money(project.deposit_amount) }}</strong>
      </div>
      <div class="metric">
        <span>结算金额</span>
        <strong>{{ money(project.settlement_amount) }}</strong>
      </div>
    </div>

    <div class="chain-grid">
      <article v-for="row in rows" :key="row.key" class="chain-card" :class="{ done: row.done }">
        <div class="chain-title">
          <el-icon><DocumentChecked v-if="row.done" /><Warning v-else /></el-icon>
          <strong>{{ row.label }}</strong>
          <el-tag size="small" :type="row.statusType">{{ row.status }}</el-tag>
        </div>
        <p>{{ row.desc }}</p>
        <div class="chain-evidence">
          <span v-if="row.files.length">
            附件：{{ row.files.slice(0, 2).map(file => file.original_name).join('、') }}{{ row.files.length > 2 ? ` 等 ${row.files.length} 个` : '' }}
          </span>
          <span v-else-if="row.fieldHits.length">系统字段：{{ row.fieldHits.join('、') }}</span>
          <span v-else>暂无可识别资料</span>
        </div>
      </article>
    </div>

    <div v-if="missingRows.length" class="summary-warning">
      <el-icon><Collection /></el-icon>
      <span>建议补齐：{{ missingRows.map(row => row.label).join('、') }}。这部分后续可以由工作树导入或工程部表单自动补。</span>
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
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, #f59e0b 7%, var(--bg-card));
}

.chain-card.done {
  background: color-mix(in srgb, #22c55e 7%, var(--bg-card));
}

.chain-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 7px;
}

.chain-title strong {
  flex: 1;
  color: var(--text-primary);
}

.chain-card p {
  margin: 0 0 8px;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.5;
}

.chain-evidence {
  color: var(--text-tertiary);
  font-size: 12px;
  line-height: 1.45;
}

.summary-warning {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 14px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, #f59e0b 10%, var(--bg-card));
  color: #b45309;
  font-size: 13px;
}

@media (max-width: 900px) {
  .summary-top,
  .chain-grid {
    grid-template-columns: 1fr;
  }
}
</style>
