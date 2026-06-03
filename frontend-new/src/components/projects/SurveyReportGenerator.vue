<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Check, Download, Picture, Printer, RefreshLeft } from '@element-plus/icons-vue'

const STORAGE_KEY = 'jianshang-survey-report-draft'

const weatherOptions = ['晴', '阴', '小雨', '大雨', '潮湿', '闷热']
const categoryOptions = [
  '墙面基层',
  '地面保护',
  '柜体/门窗',
  '踢脚线',
  '材料堆放',
  '现场卫生',
  '水电照明',
  '其他问题'
]
const entryOptions = [
  { label: '可进场', value: 'ready', type: 'success' },
  { label: '有条件进场', value: 'conditional', type: 'warning' },
  { label: '暂不建议进场', value: 'blocked', type: 'danger' }
]

const form = reactive({
  projectAddress: '',
  customerName: '',
  customerPhone: '',
  surveyor: '',
  surveyorPhone: '',
  surveyDate: new Date().toISOString().slice(0, 10),
  salesperson: '',
  salesPhone: '',
  weather: '晴',
  surveyType: '现场基层勘察',
  entryJudgment: 'conditional',
  summary: '',
  solution: ''
})

const images = ref([])
const fileInput = ref(null)
const projects = ref([])
const selectedProjectId = ref('')
const loadingProjects = ref(false)
const linkingProject = ref(false)

const entryInfo = computed(() => entryOptions.find(item => item.value === form.entryJudgment) || entryOptions[1])
const selectedProject = computed(() => projects.value.find(item => item.id === selectedProjectId.value))
const issueItems = computed(() => images.value.filter(item => item.issue || item.note || item.category))
const generatedSummary = computed(() => {
  const categories = [...new Set(issueItems.value.map(item => item.category).filter(Boolean))]
  const base = categories.length
    ? `现场重点问题集中在${categories.join('、')}。`
    : '现场照片已整理，暂无明确问题标签。'
  const action = form.entryJudgment === 'ready'
    ? '现场条件基本满足进场要求，可按排期安排施工。'
    : form.entryJudgment === 'blocked'
      ? '现场仍存在影响施工的问题，建议整改完成并复查后再安排进场。'
      : '现场可在整改项落实后安排进场，进场前需再次确认作业面。'
  return `${base}${action}`
})
const generatedSolution = computed(() => {
  if (!issueItems.value.length) return '请结合现场照片补充整改项，确认施工面、保护、柜体门窗和基层状态。'
  const lines = issueItems.value.slice(0, 8).map((item, index) => {
    const issue = item.issue || item.note || item.category || '现场问题'
    return `${index + 1}. ${issue}，请责任方处理并在进场前复核。`
  })
  return lines.join('\n')
})
const reportSummary = computed(() => form.summary.trim() || generatedSummary.value)
const reportSolution = computed(() => form.solution.trim() || generatedSolution.value)
const canExport = computed(() => form.projectAddress.trim() || form.customerName.trim() || images.value.length)

watch([form, images], saveDraft, { deep: true })
loadDraft()
onMounted(fetchProjects)

function openPicker() {
  fileInput.value?.click()
}

function onFileChange(event) {
  addFiles(event.target.files)
  event.target.value = ''
}

function addFiles(fileList) {
  const files = Array.from(fileList || []).filter(file => file.type.startsWith('image/'))
  if (!files.length) {
    ElMessage.warning('请选择现场图片')
    return
  }
  for (const file of files) {
    const reader = new FileReader()
    reader.onload = () => {
      images.value.push({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name: file.name,
        url: reader.result,
        category: '墙面基层',
        area: '',
        issue: '',
        note: ''
      })
    }
    reader.readAsDataURL(file)
  }
}

function removeImage(id) {
  images.value = images.value.filter(item => item.id !== id)
}

function fillGeneratedText() {
  form.summary = generatedSummary.value
  form.solution = generatedSolution.value
  ElMessage.success('已生成勘察汇总')
}

function resetDraft() {
  Object.assign(form, {
    projectAddress: '',
    customerName: '',
    customerPhone: '',
    surveyor: '',
    surveyorPhone: '',
    surveyDate: new Date().toISOString().slice(0, 10),
    salesperson: '',
    salesPhone: '',
    weather: '晴',
    surveyType: '现场基层勘察',
    entryJudgment: 'conditional',
    summary: '',
    solution: ''
  })
  images.value = []
  localStorage.removeItem(STORAGE_KEY)
}

async function fetchProjects() {
  loadingProjects.value = true
  try {
    const res = await fetch('/api/projects', {
      headers: { Authorization: `Bearer ${token()}` }
    })
    const json = await res.json()
    if (json.success && Array.isArray(json.data)) projects.value = json.data
  } catch (err) {
    ElMessage.warning(err.message || '工单列表加载失败，仍可先生成勘察表')
  } finally {
    loadingProjects.value = false
  }
}

function applyProjectInfo() {
  const project = selectedProject.value
  if (!project) return
  const address = formatProjectAddress(project)
  form.projectAddress = address || form.projectAddress
  form.customerName = project.customer || form.customerName
  form.customerPhone = project.phone || form.customerPhone
}

async function confirmToProject() {
  if (!selectedProjectId.value) {
    ElMessage.warning('请先选择要关联的项目工单')
    return
  }
  if (!canExport.value) {
    ElMessage.warning('请先填写或上传勘察内容')
    return
  }
  linkingProject.value = true
  try {
    const html = buildExportHtml()
    const fileName = safeFileName(`现场勘察表-${form.projectAddress || form.customerName || selectedProject.value?.name || '项目'}.html`)
    await requestJson('/api/files/upload', {
      entity_type: 'project',
      entity_id: selectedProjectId.value,
      name: fileName,
      mime_type: 'text/html',
      size: new Blob([html]).size,
      data: toBase64DataUrl(html, 'text/html')
    })
    await requestJson(`/api/projects/${selectedProjectId.value}`, {
      survey_date: form.surveyDate,
      survey_report: reportSummary.value,
      condition_note: `${entryInfo.value.label}：${reportSolution.value}`
    }, 'PUT')
    ElMessage.success('勘察表已关联到项目工单')
  } catch (err) {
    ElMessage.error(err.message || '关联工单失败')
  } finally {
    linkingProject.value = false
  }
}

function printReport() {
  window.print()
}

function downloadHtml() {
  if (!canExport.value) {
    ElMessage.warning('请先填写或上传勘察内容')
    return
  }
  const html = buildExportHtml()
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${form.projectAddress || form.customerName || '现场勘察表'}.html`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

async function requestJson(url, body, method = 'POST') {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
    body: JSON.stringify(body)
  })
  const text = await res.text()
  let json = {}
  try {
    json = text ? JSON.parse(text) : {}
  } catch {
    throw new Error(text.slice(0, 120) || '服务器返回异常')
  }
  if (!res.ok || !json.success) throw new Error(json.message || '请求失败')
  return json
}

function token() {
  return localStorage.getItem('token') || ''
}

function formatProjectAddress(project) {
  return [project.address_province, project.address_city, project.address_detail]
    .filter(Boolean)
    .join('') || project.address || ''
}

function projectOptionLabel(project) {
  const bits = [project.name, project.customer, formatProjectAddress(project)].filter(Boolean)
  return bits.join(' / ')
}

function safeFileName(value) {
  return String(value || '现场勘察表.html').replace(/[\\/:*?"<>|]/g, '_').slice(0, 100)
}

function toBase64DataUrl(text, mimeType) {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `data:${mimeType};base64,${btoa(binary)}`
}

function saveDraft() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ form: { ...form }, images: images.value }))
  } catch {}
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const draft = JSON.parse(raw)
    if (draft.form) Object.assign(form, draft.form)
    if (Array.isArray(draft.images)) images.value = draft.images
  } catch {}
}

function buildExportHtml() {
  const photoHtml = images.value.map((item, index) => `
    <figure>
      <img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.name)}" />
      <figcaption>
        <strong>${index + 1}. ${escapeHtml(item.category || '现场图片')}</strong>
        <span>${escapeHtml(item.area || '未标注区域')}</span>
        <p>${escapeHtml(item.issue || item.note || '暂无说明')}</p>
      </figcaption>
    </figure>
  `).join('')

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(form.projectAddress || '现场勘察表')}</title>
  <style>
    body { margin: 0; padding: 32px; font-family: "PingFang SC", "Microsoft YaHei", sans-serif; color: #1f2937; background: #f7f2ea; }
    .sheet { max-width: 980px; margin: 0 auto; background: #fff; padding: 32px; border: 1px solid #e5ded4; }
    h1 { margin: 0 0 10px; font-size: 28px; }
    .sub { color: #6b7280; margin-bottom: 24px; }
    .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 24px; }
    .cell { padding: 10px; border: 1px solid #eee4d8; background: #fffaf4; }
    .cell span { display: block; color: #8a6d55; font-size: 12px; margin-bottom: 4px; }
    .cell strong { font-size: 14px; }
    h2 { margin: 26px 0 10px; font-size: 18px; }
    .photos { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
    figure { margin: 0; border: 1px solid #eee4d8; background: #fffaf4; }
    img { width: 100%; height: 260px; object-fit: cover; display: block; }
    figcaption { padding: 10px; }
    figcaption span { display: block; color: #6b7280; font-size: 12px; margin: 3px 0; }
    pre { white-space: pre-wrap; background: #fffaf4; border: 1px solid #eee4d8; padding: 14px; line-height: 1.7; }
    @media print { body { background: #fff; padding: 0; } .sheet { border: 0; } }
  </style>
</head>
<body>
  <main class="sheet">
    <h1>简尚交付现场基层勘察表</h1>
    <div class="sub">${escapeHtml(form.surveyType)} / ${escapeHtml(entryInfo.value.label)}</div>
    <section class="grid">
      ${infoCell('项目地址', form.projectAddress)}
      ${infoCell('客户名称', form.customerName)}
      ${infoCell('客户电话', form.customerPhone)}
      ${infoCell('勘察人员', form.surveyor)}
      ${infoCell('勘察电话', form.surveyorPhone)}
      ${infoCell('勘察日期', form.surveyDate)}
      ${infoCell('销售人员', form.salesperson)}
      ${infoCell('天气状况', form.weather)}
    </section>
    <h2>项目勘察汇总</h2>
    <pre>${escapeHtml(reportSummary.value)}</pre>
    <h2>建议解决方案</h2>
    <pre>${escapeHtml(reportSolution.value)}</pre>
    <h2>现场勘察图片</h2>
    <section class="photos">${photoHtml || '<p>暂无图片</p>'}</section>
  </main>
</body>
</html>`
}

function infoCell(label, value) {
  return `<div class="cell"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || '未填写')}</strong></div>`
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}
</script>

<template>
  <el-card class="survey-generator" shadow="never">
    <template #header>
      <div class="generator-head">
        <div>
          <div class="kicker">工程部工具</div>
          <h3>现场勘察表生成器</h3>
          <p>按总监现有 PPT 习惯生成标准勘察表，V1 先人工标注，后续再接 AI 识图。</p>
        </div>
        <el-tag :type="entryInfo.type">{{ entryInfo.label }}</el-tag>
      </div>
    </template>

    <section class="project-link-panel">
      <div>
        <strong>关联项目工单</strong>
        <span>选择工单后确认，勘察表会进入项目附件，并同步工勘记录。</span>
      </div>
      <div class="project-link-controls">
        <el-select
          v-model="selectedProjectId"
          :loading="loadingProjects"
          filterable
          clearable
          placeholder="选择项目工单"
          @change="applyProjectInfo"
        >
          <el-option
            v-for="item in projects"
            :key="item.id"
            :label="projectOptionLabel(item)"
            :value="item.id"
          />
        </el-select>
        <el-button type="primary" :icon="Check" :loading="linkingProject" @click="confirmToProject">
          确认关联
        </el-button>
      </div>
    </section>

    <div class="generator-grid">
      <section class="form-panel">
        <el-form :model="form" label-position="top">
          <el-row :gutter="12">
            <el-col :xs="24" :sm="12">
              <el-form-item label="项目地址">
                <el-input v-model="form.projectAddress" placeholder="福田区栖棠映山4栋1802" />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item label="客户名称">
                <el-input v-model="form.customerName" placeholder="朱总" />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item label="客户电话">
                <el-input v-model="form.customerPhone" />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item label="勘察类型">
                <el-input v-model="form.surveyType" />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item label="勘察人员">
                <el-input v-model="form.surveyor" />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item label="勘察电话">
                <el-input v-model="form.surveyorPhone" />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item label="勘察日期">
                <el-input v-model="form.surveyDate" placeholder="2026-06-03" />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item label="天气">
                <el-select v-model="form.weather" style="width:100%">
                  <el-option v-for="item in weatherOptions" :key="item" :label="item" :value="item" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item label="销售/对接人">
                <el-input v-model="form.salesperson" />
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item label="销售电话">
                <el-input v-model="form.salesPhone" />
              </el-form-item>
            </el-col>
          </el-row>

          <el-form-item label="进场判断">
            <el-segmented v-model="form.entryJudgment" :options="entryOptions" />
          </el-form-item>

          <el-form-item label="勘察汇总">
            <el-input v-model="form.summary" type="textarea" :rows="3" :placeholder="generatedSummary" />
          </el-form-item>

          <el-form-item label="整改建议">
            <el-input v-model="form.solution" type="textarea" :rows="5" :placeholder="generatedSolution" />
          </el-form-item>
        </el-form>

        <div class="generator-actions">
          <el-button type="primary" plain @click="fillGeneratedText">生成汇总</el-button>
          <el-button :icon="Printer" @click="printReport">打印/PDF</el-button>
          <el-button :icon="Download" @click="downloadHtml">导出 HTML</el-button>
          <el-button :icon="RefreshLeft" text @click="resetDraft">清空草稿</el-button>
        </div>
      </section>

      <section class="photo-panel">
        <div class="upload-zone" @click="openPicker">
          <el-icon :size="30"><Picture /></el-icon>
          <strong>导入现场图片</strong>
          <span>支持多选，先生成固定模板，AI 识图放 V2</span>
          <input ref="fileInput" type="file" accept="image/*" multiple @change="onFileChange" />
        </div>

        <div v-if="images.length" class="photo-list">
          <article v-for="item in images" :key="item.id" class="photo-item">
            <img :src="item.url" :alt="item.name" />
            <div class="photo-fields">
              <el-select v-model="item.category" size="small" placeholder="类型">
                <el-option v-for="category in categoryOptions" :key="category" :label="category" :value="category" />
              </el-select>
              <el-input v-model="item.area" size="small" placeholder="区域，如主卧墙面" />
              <el-input v-model="item.issue" size="small" placeholder="问题，如点补未打磨" />
              <el-input v-model="item.note" size="small" placeholder="补充说明" />
              <el-button size="small" text type="danger" @click="removeImage(item.id)">移除</el-button>
            </div>
          </article>
        </div>
        <el-empty v-else description="还没有现场图片" :image-size="56" />
      </section>
    </div>
  </el-card>
</template>

<style scoped>
.survey-generator {
  border: 1px solid color-mix(in srgb, var(--color-primary) 18%, var(--border-light));
  margin-bottom: 24px;
}

.generator-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.kicker {
  margin-bottom: 4px;
  color: var(--color-primary);
  font-size: 12px;
  font-weight: 800;
}

.generator-head h3 {
  margin: 0 0 5px;
  color: var(--text-primary);
  font-size: 18px;
}

.generator-head p {
  margin: 0;
  color: var(--text-tertiary);
  font-size: 13px;
}

.generator-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 390px;
  gap: 18px;
  align-items: start;
}

.project-link-panel {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 520px);
  gap: 14px;
  align-items: center;
  margin-bottom: 18px;
  padding: 14px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--color-primary) 6%, var(--bg-card));
}

.project-link-panel strong,
.project-link-panel span {
  display: block;
}

.project-link-panel strong {
  margin-bottom: 4px;
  color: var(--text-primary);
}

.project-link-panel span {
  color: var(--text-tertiary);
  font-size: 13px;
}

.project-link-controls {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

.form-panel,
.photo-panel {
  min-width: 0;
}

.generator-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.upload-zone {
  position: relative;
  display: grid;
  place-items: center;
  min-height: 132px;
  padding: 18px;
  border: 1px dashed color-mix(in srgb, var(--color-primary) 48%, var(--border-light));
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--color-primary) 6%, var(--bg-card));
  color: var(--text-secondary);
  text-align: center;
  cursor: pointer;
}

.upload-zone strong {
  color: var(--text-primary);
}

.upload-zone span {
  color: var(--text-tertiary);
  font-size: 12px;
}

.upload-zone input {
  display: none;
}

.photo-list {
  display: grid;
  gap: 12px;
  margin-top: 12px;
  max-height: 620px;
  overflow: auto;
  padding-right: 2px;
}

.photo-item {
  display: grid;
  grid-template-columns: 112px minmax(0, 1fr);
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--bg-card) 88%, var(--bg-page));
}

.photo-item img {
  width: 112px;
  height: 112px;
  object-fit: cover;
  border-radius: var(--radius-sm);
  background: var(--bg-page);
}

.photo-fields {
  min-width: 0;
  display: grid;
  gap: 6px;
}

@media (max-width: 900px) {
  .generator-grid {
    grid-template-columns: 1fr;
  }

  .project-link-panel {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 560px) {
  .project-link-controls {
    grid-template-columns: 1fr;
  }

  .photo-item {
    grid-template-columns: 1fr;
  }

  .photo-item img {
    width: 100%;
    height: 180px;
  }
}
</style>
