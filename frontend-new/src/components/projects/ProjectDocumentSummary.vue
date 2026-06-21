<script setup>
import { getAuthToken } from '../../utils/authSession'
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Collection, DocumentChecked, Download, UploadFilled, View, MagicStick, MoreFilled, Delete } from '@element-plus/icons-vue'
import DecimalCellInput from './DecimalCellInput.vue'
import SystemSheetTable from './SystemSheetTable.vue'

const props = defineProps({
  project: { type: Object, required: true },
  refreshKey: { type: [Number, String], default: 0 },
  currentStepKey: { type: String, default: '' }
})

const emit = defineEmits(['project-updated', 'chain-updated'])

const loading = ref(false)
const saving = ref(false)
const chain = ref(null)
const activeNode = ref(null)
const activeData = ref({})
const dialogVisible = ref(false)
const importInput = ref(null)
const surveyInput = ref(null)
const importingType = ref('')
const activeSheet = ref('overview')
const products = ref([])
const surveyPreviewUrls = ref({})

const gridSize = ref(150) // min-width for survey image thumbnails
const dragIndex = ref(-1)
const previewImageUrl = ref('')
const previewImageVisible = ref(false)
// 累计上传的图片数据（含 base64），用于追加上传时合并
const sessionImageData = ref([])

const nodes = computed(() => chain.value?.nodes || [])
const visibleNodes = computed(() => {
  if (!props.currentStepKey) return nodes.value
  return nodes.value.filter(node => {
    if (node.key === props.currentStepKey) return true
    if (node.status === '已确认') return true
    if (node.attachment_count > 0) return true
    if (node.status === '按需') return false
    return false
  })
})
const metrics = computed(() => chain.value?.metrics || {})
const finance = computed(() => chain.value?.finance || {})
const missingLabel = computed(() => metrics.value.missing_count ? `待处理 ${metrics.value.missing_count} 项` : '资料链完整')
const missingType = computed(() => metrics.value.missing_count ? 'warning' : 'success')
const uniqAttachments = computed(() => {
  const seen = new Set()
  // 已作为现场图片展示的 attachment_id，不再重复显示在关联附件
  const imageIds = new Set(
    surveyImages(activeData.value)
      .filter(img => img.attachment_id)
      .map(img => Number(img.attachment_id))
  )
  return (activeNode.value?.attachments || []).filter(f => {
    if (seen.has(f.id)) return false
    if (imageIds.has(Number(f.id))) return false
    seen.add(f.id)
    return true
  })
})

watch(() => [props.project?.id, props.refreshKey], fetchChain, { immediate: true })
watch(dialogVisible, visible => {
  if (!visible) {
    revokeSurveyPreviewUrls()
    sessionImageData.value = []
  }
})

const briefingColumns = [
  { key: 'space_name', label: '空间', width: 110 },
  { key: 'texture_name', label: '纹理/产品', width: 150 },
  { key: 'process', label: '工艺', width: 110 },
  { key: 'color_no', label: '颜色', width: 110 },
  { key: 'planned_area', label: '预收面积', type: 'number', width: 110 },
  { key: 'actual_area', label: '复尺面积', type: 'number', width: 110 },
  { key: 'unit_price', label: '单价', type: 'number', width: 100 },
  { key: 'subtotal', label: '小计', type: 'number', width: 110 }
]

const quotationColumns = [
  { key: 'area_group', label: '区域', width: 110 },
  { key: 'position', label: '位置', width: 110 },
  { key: 'product_name', label: '产品', width: 150 },
  { key: 'process', label: '工艺', width: 110 },
  { key: 'color_no', label: '色号', width: 110 },
  { key: 'area', label: '面积', type: 'number', width: 100 },
  { key: 'list_amount', label: '标价金额', type: 'number', width: 120 },
  { key: 'final_amount', label: '成交金额', type: 'number', width: 120 }
]

const materialColumns = [
  { key: 'category', label: '类别', width: 110 },
  { key: 'out_date', label: '出库时间', width: 120 },
  { key: 'material_name', label: '材料名', width: 160 },
  { key: 'unit', label: '单位', width: 80 },
  { key: 'out_quantity', label: '出库', type: 'number', width: 90 },
  { key: 'usage_quantity', label: '用量', type: 'number', width: 90 },
  { key: 'unit_price', label: '单价', type: 'number', width: 100 },
  { key: 'amount', label: '金额', type: 'number', width: 110 },
  { key: 'remark', label: '备注', width: 180 }
]

const materialOutColumns = [
  { key: 'material_name', label: '材料名', width: 170 },
  { key: 'category', label: '分类', width: 120 },
  { key: 'unit', label: '单位', width: 80 },
  { key: 'out_quantity', label: '出库数量', type: 'number', width: 110 },
  { key: 'unit_price', label: '单价', type: 'number', width: 100 },
  { key: 'amount', label: '金额', type: 'number', width: 110 },
  { key: 'remark', label: '备注', width: 220 }
]

const materialReturnColumns = [
  { key: 'material_name', label: '材料名', width: 170 },
  { key: 'unit', label: '单位', width: 80 },
  { key: 'return_quantity', label: '回库数量', type: 'number', width: 110 },
  { key: 'return_date', label: '回库日期', width: 120 },
  { key: 'remark', label: '回库备注', width: 260 }
]

const materialBalanceColumns = [
  { key: 'material_name', label: '材料名', width: 170 },
  { key: 'unit', label: '单位', width: 80 },
  { key: 'out_quantity', label: '出库数量', type: 'number', width: 110 },
  { key: 'usage_quantity', label: '实耗数量', type: 'number', width: 110 },
  { key: 'expected_remaining', label: '应余数量', type: 'number', width: 110 },
  { key: 'return_quantity', label: '已回库', type: 'number', width: 100 },
  { key: 'difference_quantity', label: '未回/差异', type: 'number', width: 120 },
  { key: 'remark', label: '备注', width: 220 }
]

const laborColumns = [
  { key: 'space_name', label: '空间', width: 120 },
  { key: 'texture_name', label: '纹理', width: 140 },
  { key: 'process', label: '工艺', width: 110 },
  { key: 'area', label: '面积', type: 'number', width: 100 },
  { key: 'unit_price', label: '单价', type: 'number', width: 100 },
  { key: 'amount', label: '小计', type: 'number', width: 110 },
  { key: 'remark', label: '备注', width: 220 }
]

const costColumns = [
  { key: 'name', label: '费用名称', width: 160 },
  { key: 'amount', label: '金额', type: 'number', width: 110 },
  { key: 'ratio', label: '占比', type: 'number', width: 100 },
  { key: 'area_average', label: '面积均摊', type: 'number', width: 110 },
  { key: 'remark', label: '备注', width: 240 }
]

function token() {
  return getAuthToken() || ''
}

async function fetchChain() {
  if (!props.project?.id) return
  loading.value = true
  try {
    const json = await requestJson(`/api/projects/${props.project.id}/delivery-chain`, null, 'GET')
    chain.value = json.data
    emit('chain-updated', json.data)
  } catch (err) {
    ElMessage.warning(err.message || '项目交付资料链读取失败')
  } finally {
    loading.value = false
  }
}

async function fetchProducts() {
  try {
    const json = await requestJson('/api/products', null, 'GET')
    products.value = json.data || []
  } catch (err) {
    console.warn('产品价格记忆加载失败', err)
    products.value = []
  }
}

function openNode(node) {
  try {
    activeNode.value = node
    activeData.value = normalizeDocumentData(node, clonePlainData(node.table_data || {}))
    activeSheet.value = node.key === 'material_io' ? 'overview' : 'form'
    loadSurveyPreviews(activeData.value)
    fetchProducts()
    dialogVisible.value = true
  } catch (err) {
    ElMessage.error(err.message || '打开系统版表格失败')
  }
}

function openDocument(key) {
  const node = nodes.value.find(item => item.key === key)
  if (!node) return false
  openNode(node)
  return true
}

defineExpose({ openDocument })

function openImport(node) {
  importingType.value = node.key
  importInput.value?.click()
}

async function onImportFile(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file || !importingType.value) return
  if (!/\.(csv|xls|xlsx|ppt|pptx)$/i.test(file.name)) {
    ElMessage.warning('暂只支持 CSV / XLS / XLSX / PPT / PPTX')
    return
  }
  if (file.size > 50 * 1024 * 1024) {
    ElMessage.warning('单个文件不能超过 50MB')
    return
  }
  saving.value = true
  try {
    const body = {
      file_name: file.name,
      file_data: await readAsDataUrl(file)
    }
    const parsed = await requestJson(`/api/projects/${props.project.id}/delivery-chain/${importingType.value}/parse`, body)
    activeNode.value = nodes.value.find(node => node.key === importingType.value) || { key: importingType.value, label: parsed.data.document_label }
    activeData.value = normalizeDocumentData(activeNode.value, parsed.data.confirmed_data || {})
    loadSurveyPreviews(activeData.value)
    activeNode.value.parsed_data = parsed.data
    activeNode.value.pending_file = {
      name: file.name,
      mime_type: file.type,
      size: file.size,
      data: body.file_data
    }
    dialogVisible.value = true
    ElMessage.success('单据已解析，请核对后保存')
  } catch (err) {
    ElMessage.error(err.message || '单据解析失败')
  } finally {
    saving.value = false
  }
}

function openSurveyImages(node) {
  importingType.value = node.key
  // 预加载已有图片，保障追加上传时不覆盖
  const existingImages = node?.table_data?.survey?.images
  if (Array.isArray(existingImages) && existingImages.length) {
    sessionImageData.value = existingImages.map(img => ({
      attachment_id: img.attachment_id,
      name: img.name || img.original_name || img.note || '',
      mime_type: img.mime_type || 'image/jpeg',
      note: img.note || '',
    }))
  } else {
    sessionImageData.value = []
  }
  surveyInput.value?.click()
}

function openPptUpload(node) {
  importingType.value = node.key
  importInput.value?.click()
}

const MAX_IMAGES = 24
const MAX_TOTAL_SIZE_MB = 50

async function onSurveyImages(event) {
  const files = Array.from(event.target.files || []).filter(file => file.type.startsWith('image/')).slice(0, 12)
  event.target.value = ''
  if (!files.length) {
    ElMessage.warning('请选择现场图片')
    return
  }
  // 检查图片数量上限
  if (sessionImageData.value.length + files.length > MAX_IMAGES) {
    ElMessage.warning(`图片总数不能超过 ${MAX_IMAGES} 张（已有 ${sessionImageData.value.length} 张）`)
    return
  }
  saving.value = true
  try {
    const newImages = []
    for (const file of files) {
      if (file.size > 50 * 1024 * 1024) {
        ElMessage.warning(`"${file.name}" 超过 50MB，已跳过`)
        continue
      }
      newImages.push({
        name: file.name,
        mime_type: file.type,
        note: file.name.replace(/\.[^.]+$/, ''),
        size: file.size,
        data: await readAsDataUrl(file)
      })
    }
    if (!newImages.length) { saving.value = false; return }
    // 检查总大小上限
    const currentTotal = sessionImageData.value.reduce((sum, img) => sum + (img.size || (img.data ? img.data.length : 0)), 0)
    const newTotal = newImages.reduce((sum, img) => sum + img.size, 0)
    if ((currentTotal + newTotal) > MAX_TOTAL_SIZE_MB * 1024 * 1024) {
      ElMessage.warning(`图片总大小不能超过 ${MAX_TOTAL_SIZE_MB}MB（当前 ${(currentTotal / 1024 / 1024).toFixed(1)}MB），请删减后重试`)
      saving.value = false
      return
    }
    for (const img of newImages) {
      sessionImageData.value.push(img)
    }
    const body = {
      document_type: importingType.value === 'survey_recheck' ? 'survey_recheck' : 'survey_initial',
      survey_date: new Date().toISOString().slice(0, 10),
      conclusion: '现场图片已上传，请工程部补充勘察结论和整改意见。',
      entry_judgment: '',
      need_recheck: importingType.value === 'survey_recheck',
      images: sessionImageData.value
    }
    const json = await requestJson(`/api/projects/${props.project.id}/delivery-chain/survey/images`, body)
    chain.value = json.data.chain
    emit('chain-updated', json.data.chain)
    const updatedNode = nodes.value.find(node => node.key === body.document_type)
    if (updatedNode) {
      activeNode.value = updatedNode
      activeData.value = normalizeDocumentData(updatedNode, clonePlainData(updatedNode.table_data || {}))
      activeSheet.value = 'ppt'
      loadSurveyPreviews(activeData.value)
      dialogVisible.value = true
    }
    ElMessage.success(`已上传 ${sessionImageData.value.length} 张现场图片，可继续编辑说明后生成 PPT`)
  } catch (err) {
    ElMessage.error(err.message || '上传现场图片失败')
  } finally {
    saving.value = false
  }
}

async function generateSurveyPpt(node = activeNode.value) {
  if (!node) return
  const documentType = node.key === 'survey_recheck' ? 'survey_recheck' : 'survey_initial'
  const currentData = activeData.value?.survey ? activeData.value : normalizeDocumentData(node, clonePlainData(node.table_data || {}))
  const images = surveyImages(currentData)
  if (!images.length) {
    ElMessage.warning('请先上传现场图片，再生成 PPT')
    return
  }
  saving.value = true
  try {
    const body = {
      document_type: documentType,
      ...currentData.survey,
      images
    }
    const json = await requestJson(`/api/projects/${props.project.id}/delivery-chain/survey/generate-ppt`, body)
    chain.value = json.data.chain
    emit('chain-updated', json.data.chain)
    const updatedNode = nodes.value.find(item => item.key === documentType)
    if (updatedNode) {
      activeNode.value = updatedNode
      activeData.value = normalizeDocumentData(updatedNode, clonePlainData(updatedNode.table_data || {}))
      activeSheet.value = 'ppt'
      loadSurveyPreviews(activeData.value)
      dialogVisible.value = true
    }
    ElMessage.success(`已用 ${images.length} 张现场图片生成 PPT`)
  } catch (err) {
    ElMessage.error(err.message || '生成勘察 PPT 失败')
  } finally {
    saving.value = false
  }
}

async function saveActiveNode() {
  if (!activeNode.value) return
  saving.value = true
  try {
    const body = buildActiveNodePayload()
    const json = await requestJson(`/api/projects/${props.project.id}/delivery-chain/${activeNode.value.key}/save`, body)
    chain.value = json.data.chain
    emit('chain-updated', json.data.chain)
    dialogVisible.value = false
    ElMessage.success('系统版单据已保存')
  } catch (err) {
    ElMessage.error(err.message || '保存项目单据失败')
  } finally {
    saving.value = false
  }
}

function buildActiveNodePayload() {
  return {
    parsed_data: activeNode.value.parsed_data || activeNode.value.document?.parsed_data || {},
    confirmed_data: activeData.value,
    warnings: activeNode.value.parsed_data?.warnings || activeNode.value.document?.warnings || [],
    source_attachment_id: activeNode.value.document?.source_attachment_id || 0,
    file: activeNode.value.pending_file || null
  }
}

async function downloadFirstAttachment(node) {
  const file = preferredAttachment(node)
  if (!file) {
    ElMessage.warning('当前节点还没有附件')
    return
  }
  await downloadAttachment(file)
}

async function exportOriginalDocument(node) {
  if (!node?.key) return
  try {
    const fallbackName = `${props.project?.name || props.project?.customer || '项目'}-${node.label || '单据'}-原格式导出.xlsx`
    await downloadFile(`/api/projects/${props.project.id}/delivery-chain/${node.key}/export`, fallbackName)
  } catch (err) {
    ElMessage.error(err.message || '原格式导出失败')
  }
}

async function downloadAttachment(file) {
  try {
    await downloadFile(`/api/files/${file.id}/download`, file.original_name || '项目附件')
  } catch (err) {
    ElMessage.error(err.message || '附件下载失败')
  }
}

async function downloadFile(url, fallbackName) {
  try {
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
  } catch (err) {
    throw err
  }
}

function preferredAttachment(node) {
  const files = Array.isArray(node?.attachments) ? node.attachments : []
  return files.find(file => isPptFile(file)) || files[0]
}

function canExportOriginal(node) {
  if (node?.key === 'project_payment_request' && node.document) return true
  const files = Array.isArray(node?.attachments) ? node.attachments : []
  return files.some(file => /\.xlsx$/i.test(file.original_name || ''))
}

function isPptFile(file) {
  return /ppt|presentation/i.test(file?.mime_type || '') || /\.(ppt|pptx)$/i.test(file?.original_name || '')
}

function isImageFile(file) {
  return /^image\//i.test(file?.mime_type || '') || /\.(png|jpe?g|webp|gif)$/i.test(file?.original_name || '')
}

function surveyImages(data = activeData.value) {
  const images = data?.survey?.images
  return Array.isArray(images) ? images.filter(item => item?.attachment_id || item?.data) : []
}

function hasSurveyImages(node = activeNode.value) {
  if (!node) return false
  if (activeNode.value?.key === node.key && activeData.value?.survey) return surveyImages(activeData.value).length > 0
  return surveyImages(node.table_data || {}).length > 0
}

function surveyImageLabel(image, index) {
  const fallback = `现场图片 ${String(index + 1).padStart(2, '0')}`
  const note = String(image?.note || '').trim()
  if (note && !looksLikeMachineImageName(note)) return note
  const original = String(image?.original_name || image?.name || '').trim()
  if (original && !looksLikeMachineImageName(original)) return original.replace(/\.[^.]+$/, '')
  return fallback
}

function surveyImageFileName(image, index) {
  const original = String(image?.original_name || image?.name || '').trim()
  if (original && !looksLikeMachineImageName(original)) return original
  return `现场图片 ${String(index + 1).padStart(2, '0')}${imageExtensionFromMeta(image)}`
}

function surveyImagePreviewUrl(image) {
  if (image?.preview_url) return image.preview_url
  if (image?.data) return image.data
  if (image?.attachment_id) return surveyPreviewUrls.value[image.attachment_id] || ''
  return ''
}

function looksLikeMachineImageName(value) {
  const text = String(value || '').trim()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.(png|jpe?g|webp|gif))?$/i.test(text)
}

function imageExtensionFromMeta(image) {
  const name = String(image?.original_name || image?.name || '').trim()
  const matched = name.match(/\.(png|jpe?g|webp|gif)$/i)
  if (matched) return matched[0].toLowerCase()
  const mime = String(image?.mime_type || '').toLowerCase()
  if (mime.includes('jpeg') || mime.includes('jpg')) return '.jpg'
  if (mime.includes('webp')) return '.webp'
  if (mime.includes('gif')) return '.gif'
  return '.png'
}

function onImageDragStart(index, event) {
  dragIndex.value = index
  if (event?.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(index))
  }
}

function onImageDragOver(e) {
  e.preventDefault()
}

function onImageDrop(index, event) {
  event?.preventDefault?.()
  const fallbackIndex = Number(event?.dataTransfer?.getData('text/plain'))
  const fromIndex = dragIndex.value >= 0 ? dragIndex.value : fallbackIndex
  if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex === index) {
    dragIndex.value = -1
    return
  }
  const images = activeData.value?.survey?.images
  if (!Array.isArray(images)) return
  const [moved] = images.splice(fromIndex, 1)
  images.splice(index, 0, moved)
  dragIndex.value = -1
  // 触发响应式更新
  activeData.value = { ...activeData.value }
  ElMessage.success('现场图片顺序已调整，生成 PPT 会按新顺序输出')
}

function generateSurveyNotes() {
  const images = surveyImages()
  if (!images.length) {
    ElMessage.warning('请先上传现场图片')
    return
  }
  const customer = activeData.value?.project?.customer || props.project?.customer || '客户'
  const address = activeData.value?.project?.address || props.project?.address_detail || props.project?.address || ''
  const templates = [
    `现场整体环境：记录${customer}项目进场前的空间状态，作为工勘留底。`,
    '基层情况：重点核对墙面平整度、开裂、空鼓、返潮及修补位置。',
    '成品保护：记录门窗、柜体、地面、家具等需要保护的位置。',
    '施工条件：核对脚手架、高空作业、二次搬运、水电照明和进场动线。',
    '问题细节：请工程部确认是否需要整改、复勘或补充交底。',
    '补充照片：用于完善现场勘察记录，生成 PPT 前可人工改成更准确的话术。'
  ]
  images.forEach((image, index) => {
    const current = String(image.note || '').trim()
    const looksLikeFilename = current && /^[\w.-]+\.(png|jpe?g|webp)$/i.test(current)
    if (!current || looksLikeFilename || current === image.name) {
      image.note = `${templates[index] || templates[templates.length - 1]}${address ? ` 地址：${address}` : ''}`
    }
  })
  activeData.value = { ...activeData.value }
  ElMessage.success('已生成现场图片说明，请人工检查后再生成 PPT')
}

function deleteImage(index) {
  const images = activeData.value?.survey?.images
  if (!Array.isArray(images)) return
  images.splice(index, 1)
  activeData.value = { ...activeData.value }
  // 如果删完了，释放预览 URL
  if (!images.length) revokeSurveyPreviewUrls()
}

function hasGeneratedSurveyPpt(node = activeNode.value) {
  if (!node) return false
  const sourceId = Number(node.document?.source_attachment_id || 0)
  if (sourceId && (node.attachments || []).some(file => Number(file.id) === sourceId && isPptFile(file))) return true
  return (node.attachments || []).some(file => isPptFile(file) && /PPT|ppt/i.test(file.original_name || ''))
}

async function confirmDeliveryStep(node = activeNode.value) {
  if (!node) return
  if (node.key === 'survey_initial' && !hasGeneratedSurveyPpt(node)) {
    ElMessage.warning('请先生成或上传工勘 PPT，再确认工勘完成')
    return
  }
  saving.value = true
  try {
    if (activeNode.value?.key === node.key) {
      const saved = await requestJson(`/api/projects/${props.project.id}/delivery-chain/${activeNode.value.key}/save`, buildActiveNodePayload())
      chain.value = saved.data.chain
      emit('chain-updated', saved.data.chain)
    }
    const json = await requestJson(`/api/projects/${props.project.id}/delivery-chain/${node.key}/confirm-step`, {})
    chain.value = json.data.chain
    emit('chain-updated', json.data.chain)
    const updatedNode = nodes.value.find(item => item.key === node.key)
    if (updatedNode) {
      activeNode.value = updatedNode
      activeData.value = normalizeDocumentData(updatedNode, clonePlainData(updatedNode.table_data || {}))
      loadSurveyPreviews(activeData.value)
    }
    emit('project-updated')
    ElMessage.success(json.data.message || '该步骤已确认，项目进度已刷新')
  } catch (err) {
    ElMessage.error(err.message || '确认步骤失败')
  } finally {
    saving.value = false
  }
}

function openPreview(url) {
  previewImageUrl.value = url
  previewImageVisible.value = true
}

function revokeSurveyPreviewUrls() {
  for (const url of Object.values(surveyPreviewUrls.value)) {
    if (url) URL.revokeObjectURL(url)
  }
  surveyPreviewUrls.value = {}
}

async function loadSurveyPreviews(data = activeData.value) {
  revokeSurveyPreviewUrls()
  const images = surveyImages(data)
  if (!images.length) return
  const next = {}
  await Promise.all(images.map(async image => {
    if (image.data) {
      image.preview_url = image.data
      return
    }
    if (!image.attachment_id) return
    try {
      const res = await fetch(`/api/files/${image.attachment_id}/download`, {
        headers: { Authorization: `Bearer ${token()}` }
      })
      if (!res.ok) throw new Error('图片读取失败')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      next[image.attachment_id] = url
      image.preview_url = url
    } catch (err) {
      console.warn('现场图片预览加载失败', image, err)
    }
  }))
  surveyPreviewUrls.value = next
}

async function requestJson(url, body = null, method = 'POST') {
  const options = {
    method,
    headers: { Authorization: `Bearer ${token()}` }
  }
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

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function nodeClass(node) {
  return {
    confirmed: node.status === '已确认',
    optional: node.status === '按需',
    warning: node.status === '有差异待确认' || node.status === '已上传'
  }
}

function actionVisible(node, action) {
  return Array.isArray(node.actions) && node.actions.includes(action)
}

function canConfirmNode(node) {
  if (!node) return false
  if (props.currentStepKey && node.key !== props.currentStepKey) return false
  if (node.key === 'material_io') return false
  return ['survey_initial', 'survey_recheck', 'project_payment_request', 'briefing', 'completion_inspection', 'labor_settlement', 'cost_check', 'finance_settlement'].includes(node.key)
}

function confirmButtonLabel(node) {
  return {
    survey_initial: '确认工勘完成',
    survey_recheck: '确认复尺完成',
    project_payment_request: '确认进场款已收',
    briefing: '确认班组交底完成',
    completion_inspection: '确认验收完成',
    labor_settlement: '确认工费结算',
    cost_check: '确认成本核算',
    finance_settlement: '确认财务结算'
  }[node?.key] || '确认完成'
}

function statusType(node) {
  return node.status_type || 'info'
}

function money(value) {
  const n = Number(value || 0)
  return Number.isFinite(n) && n > 0 ? `￥${n.toFixed(2)}` : '未填写'
}

function percent(value) {
  const n = Number(value || 0)
  return Number.isFinite(n) && n ? `${(n * 100).toFixed(2)}%` : '未填写'
}

function shortValue(value) {
  if (value === undefined || value === null || value === '') return '未填写'
  return String(value)
}

function clonePlainData(value) {
  return JSON.parse(JSON.stringify(value || {}))
}

function normalizeDocumentData(node, data) {
  const key = node?.key || ''
  const basic = data.basic || {}
  const construction = data.construction || {}
  const summary = data.summary || {}
  const project = {
    project_name: data.project?.project_name || props.project?.name || basic.customer || '',
    customer: data.project?.customer || basic.customer || props.project?.customer || '',
    phone: data.project?.phone || basic.phone || props.project?.phone || '',
    address: data.project?.address || basic.address_detail || props.project?.address || props.project?.address_detail || '',
    source: data.project?.source || basic.source || props.project?.source || '',
    order_taker: data.project?.order_taker || basic.order_taker || props.project?.order_taker || ''
  }
  const normalized = {
    ...data,
    project,
    items: Array.isArray(data.items) ? data.items : [],
    quotation_items: Array.isArray(data.quotation_items) ? data.quotation_items : [],
    cost_items: Array.isArray(data.cost_items) ? data.cost_items : [],
    summary: {
      contract_amount: summary.contract_amount || data.finance?.estimated_total_amount || props.project?.total_amount || 0,
      delivery_revenue: summary.delivery_revenue || summary.revenue_amount || props.project?.settlement_amount || 0,
      received_amount: summary.received_amount || props.project?.deposit_amount || 0,
      pre_entry_amount: summary.pre_entry_amount || 0,
      pre_entry_ratio: summary.pre_entry_ratio || 0.9,
      tail_amount: summary.tail_amount || 0,
      tail_ratio: summary.tail_ratio || 0.1,
      unpaid_amount: summary.unpaid_amount || 0,
      finance_note: summary.finance_note || '',
      revenue_amount: summary.revenue_amount || summary.delivery_revenue || 0,
      labor_fee: summary.labor_fee || 0,
      material_fee: summary.material_fee || 0,
      auxiliary_fee: summary.auxiliary_fee || 0,
      tool_fee: summary.tool_fee || 0,
      transport_fee: summary.transport_fee || 0,
      total_cost: summary.total_cost || 0,
      gross_profit: summary.gross_profit || 0,
      profit_rate: summary.profit_rate || 0,
      control_result: summary.control_result || '',
      start_date: summary.start_date || props.project?.start_date || '',
      end_date: summary.end_date || props.project?.end_date || '',
      duration: summary.duration || '',
      total_area: summary.total_area || construction.total_area || 0,
      work_note: summary.work_note || '',
      salesperson: summary.salesperson || project.source || '',
      team_leader: summary.team_leader || props.project?.crew_leader_name || '',
      worker_count: summary.worker_count || 0,
      work_days: summary.work_days || '',
      site_overview: summary.site_overview || '',
      payment_status: summary.payment_status || 'pending',
      archive_status: summary.archive_status || 'pending'
    },
    payment_request: {
      request_no: data.payment_request?.request_no || '',
      project_code: data.payment_request?.project_code || '',
      designer: data.payment_request?.designer || '',
      salesperson: data.payment_request?.salesperson || props.project?.order_taker || '',
      sales_phone: data.payment_request?.sales_phone || '',
      expected_start_date: data.payment_request?.expected_start_date || props.project?.start_date || '',
      expected_duration: data.payment_request?.expected_duration || '',
      entry_method: data.payment_request?.entry_method || '',
      total_area: data.payment_request?.total_area || summary.total_area || 0,
      needs_recheck: data.payment_request?.needs_recheck || '',
      car_plate_report_required: data.payment_request?.car_plate_report_required || '',
      director_signed: !!data.payment_request?.director_signed,
      store_notified: !!data.payment_request?.store_notified,
      pre_entry_payment_confirmed: !!data.payment_request?.pre_entry_payment_confirmed || summary.payment_status === 'pre_entry_paid',
      payment_confirmed_at: data.payment_request?.payment_confirmed_at || '',
      payment_confirmed_by: data.payment_request?.payment_confirmed_by || '',
      note: data.payment_request?.note || ''
    },
    survey: {
      survey_date: data.survey?.survey_date || props.project?.survey_date || '',
      surveyor: data.survey?.surveyor || '',
      surveyor_phone: data.survey?.surveyor_phone || '',
      conclusion: data.survey?.conclusion || props.project?.survey_report || '',
      entry_judgment: data.survey?.entry_judgment || '',
      need_recheck: !!data.survey?.need_recheck,
      repair_required: !!data.survey?.repair_required,
      issues: Array.isArray(data.survey?.issues) ? data.survey.issues : [],
      images: Array.isArray(data.survey?.images) ? data.survey.images : [],
      image_count: data.survey?.image_count || 0,
      ppt_title: data.survey?.ppt_title || `${project.customer || '项目'}${node?.label || '勘察表'}`,
      ppt_layout: data.survey?.ppt_layout || 'two-column'
    }
  }
  if (key === 'material_io') {
    normalized.items = normalized.items.map(item => normalizeMaterialItem(item))
    refreshMaterialSummary(normalized)
  }
  if (key === 'briefing') {
    normalized.summary.revenue_amount = normalized.summary.revenue_amount || construction.total_amount || data.finance?.estimated_total_amount || 0
  }
  if (key === 'project_payment_request') {
    if (!normalized.summary.contract_amount) normalized.summary.contract_amount = props.project?.total_amount || 0
    if (!normalized.summary.pre_entry_amount && normalized.summary.contract_amount) normalized.summary.pre_entry_amount = roundMoneyValue(normalized.summary.contract_amount * 0.9)
    if (!normalized.summary.tail_amount && normalized.summary.contract_amount) normalized.summary.tail_amount = roundMoneyValue(normalized.summary.contract_amount * 0.1)
    if (normalized.payment_request.pre_entry_payment_confirmed && normalized.summary.payment_status === 'pending') {
      normalized.summary.payment_status = 'pre_entry_paid'
    }
  }
  return normalized
}

function normalizeMaterialItem(item = {}) {
  const out = toNumber(item.out_quantity)
  const returned = toNumber(item.return_quantity)
  const usage = item.usage_quantity === undefined || item.usage_quantity === '' ? Math.max(out - returned, 0) : toNumber(item.usage_quantity)
  const expected = Math.max(out - usage, 0)
  const materialName = item.material_name || item.product_name || item.name || ''
  return {
    category: item.category || '',
    out_date: item.out_date || '',
    material_name: materialName,
    product_name: item.product_name || materialName,
    unit: item.unit || '',
    out_quantity: out || item.out_quantity || '',
    return_quantity: returned || item.return_quantity || '',
    return_date: item.return_date || '',
    usage_quantity: usage || item.usage_quantity || '',
    expected_remaining: expected,
    difference_quantity: roundNumber(expected - returned),
    unit_price: item.unit_price || '',
    amount: item.amount || '',
    remark: item.remark || ''
  }
}

function onMaterialCellChange({ row, column }) {
  if (column.key === 'material_name') applyProductMatch(row)
  if (['out_quantity', 'return_quantity', 'usage_quantity', 'unit_price', 'unit'].includes(column.key)) {
    recalcMaterialRow(row)
    refreshMaterialSummary(activeData.value)
  }
}

function applyProductMatch(row) {
  const name = String(row.material_name || '').trim()
  if (!name) return
  const matched = products.value.find(item => String(item.name || '').trim() === name)
  if (!matched) return
  if (!row.category) row.category = matched.category || ''
  if (!row.unit) row.unit = matched.unit || ''
  if (!row.unit_price && Number(matched.unit_price || 0) > 0) row.unit_price = Number(matched.unit_price)
}

function recalcMaterialRow(row) {
  const out = toNumber(row.out_quantity)
  const returned = toNumber(row.return_quantity)
  const usage = row.usage_quantity === '' || row.usage_quantity === undefined ? Math.max(out - returned, 0) : toNumber(row.usage_quantity)
  row.usage_quantity = usage
  row.expected_remaining = roundNumber(Math.max(out - usage, 0))
  row.difference_quantity = roundNumber(row.expected_remaining - returned)
  const price = toNumber(row.unit_price)
  if (price) row.amount = roundMoneyValue(toPriceUnitQuantity(usage || out, row.unit) * price)
}

function toPriceUnitQuantity(value, unit) {
  const n = toNumber(value)
  const text = String(unit || '').toLowerCase()
  if (text === 'g') return n / 1000
  if (text === 'ml') return n / 1000
  return n
}

function refreshMaterialSummary(data) {
  if (!data?.summary || !Array.isArray(data.items)) return
  const totals = data.items.reduce((acc, item) => {
    const amount = toNumber(item.amount)
    const category = String(item.category || '')
    if (/辅|耗/.test(category)) acc.auxiliary += amount
    else if (/工具|梯|刷/.test(category)) acc.tool += amount
    else if (/运|车|搬/.test(category)) acc.transport += amount
    else acc.material += amount
    return acc
  }, { material: 0, auxiliary: 0, tool: 0, transport: 0 })
  data.summary.material_fee = data.summary.material_fee || roundMoneyValue(totals.material)
  data.summary.auxiliary_fee = data.summary.auxiliary_fee || roundMoneyValue(totals.auxiliary)
  data.summary.tool_fee = data.summary.tool_fee || roundMoneyValue(totals.tool)
  data.summary.transport_fee = data.summary.transport_fee || roundMoneyValue(totals.transport)
  data.summary.total_cost = roundMoneyValue(
    toNumber(data.summary.material_fee) +
    toNumber(data.summary.auxiliary_fee) +
    toNumber(data.summary.tool_fee) +
    toNumber(data.summary.transport_fee)
  )
}

function costSubtotals() {
  const summary = activeData.value?.summary || {}
  return [
    { label: '人工小记', value: summary.labor_fee, note: '来自班组工费结算' },
    { label: '材料小记', value: summary.material_fee, note: '主材实际消耗' },
    { label: '辅材小记', value: summary.auxiliary_fee, note: '耗材/辅料' },
    { label: '工具小记', value: summary.tool_fee, note: '工具损耗' },
    { label: '运输小记', value: summary.transport_fee, note: '配送/搬运' },
    { label: '成本合计', value: summary.total_cost, note: '财务快速核对入口' }
  ]
}

function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function roundNumber(value) {
  return Math.round(Number(value || 0) * 1000) / 1000
}

function roundMoneyValue(value) {
  return Math.round(Number(value || 0) * 100) / 100
}
</script>

<template>
  <el-card class="delivery-chain" shadow="never" v-loading="loading || saving">
    <template #header>
      <div class="chain-head">
        <div>
          <div class="kicker">项目交付资料链 V2</div>
          <h3>项目交付资料链</h3>
          <p>从勘察、交底、出入库、工费、成本到财务归档。</p>
        </div>
        <el-tag :type="missingType">{{ missingLabel }}</el-tag>
      </div>
    </template>

    <input ref="importInput" class="hidden-input" type="file" accept=".csv,.xls,.xlsx,.ppt,.pptx" @change="onImportFile" />
    <input ref="surveyInput" class="hidden-input" type="file" accept="image/*" multiple @change="onSurveyImages" />

    <div class="summary-top">
      <div class="metric"><span>已确认节点</span><strong>{{ metrics.confirmed_count || 0 }}/{{ nodes.length }}</strong></div>
      <div class="metric"><span>附件命中</span><strong>{{ metrics.uploaded_count || 0 }}</strong></div>
      <div class="metric"><span>合同报价</span><strong>{{ money(finance.contract_amount) }}</strong></div>
      <div class="metric"><span>交付毛利率</span><strong>{{ percent(finance.profit_rate) }}</strong></div>
    </div>

    <div v-if="finance.differences?.length" class="diff-box">
      <el-icon><Collection /></el-icon>
      <span>{{ finance.differences.join('；') }}</span>
    </div>

    <div v-if="finance.notes?.length" class="note-box">
      <el-icon><Collection /></el-icon>
      <span>{{ finance.notes.join('；') }}</span>
    </div>

    <div class="chain-grid">
      <article v-for="node in visibleNodes" :key="node.key" class="chain-card" :class="[nodeClass(node), { current: node.key === currentStepKey }]">
        <div class="chain-title">
          <el-icon><DocumentChecked /></el-icon>
          <div>
            <span>{{ node.stage }}</span>
            <strong>{{ node.label }}</strong>
          </div>
          <el-tag size="small" :type="statusType(node)">{{ node.status }}</el-tag>
        </div>

        <p>{{ node.desc }}</p>

        <div class="node-summary">
          <span v-for="item in node.summary" :key="item[0]">
            {{ item[0] }}：<b>{{ shortValue(item[1]) }}</b>
          </span>
        </div>

        <div class="chain-evidence">
          <span v-if="node.document_version_count > 1">多版本：{{ node.document_version_count }} 版，最新 {{ node.document_versions?.[0]?.uploader_name || '未知人员' }} 更新</span>
          <span v-else-if="node.document_version_count === 1">已有：{{ node.document_versions?.[0]?.source_file_name || '系统表格' }}</span>
          <span v-if="node.attachments?.length">附件：{{ node.attachments.map(file => file.original_name).slice(0, 2).join('、') }}</span>
          <span v-else-if="node.status === '按需'">当前项目未触发该节点。</span>
          <span v-else-if="!node.document_version_count">缺失：可先查看空表，系统会带入已有项目字段。</span>
        </div>

        <div class="node-actions">
          <el-button size="small" :icon="View" @click="openNode(node)">查看表格</el-button>
          <el-button v-if="actionVisible(node, 'import')" size="small" :icon="UploadFilled" @click="openImport(node)">导入/更新</el-button>
          <el-button v-if="actionVisible(node, 'sync')" size="small" text @click="openNode(node)">同步字段</el-button>
          <el-button v-if="actionVisible(node, 'generate_ppt')" size="small" type="primary" :icon="UploadFilled" @click="openSurveyImages(node)">上传图片</el-button>
          <el-button v-if="actionVisible(node, 'generate_ppt')" size="small" :icon="MagicStick" :disabled="!hasSurveyImages(node)" @click="generateSurveyPpt(node)">生成PPT</el-button>
          <el-button v-if="canConfirmNode(node)" size="small" type="success" :icon="DocumentChecked" @click="confirmDeliveryStep(node)">{{ confirmButtonLabel(node) }}</el-button>
          <el-button v-if="actionVisible(node, 'generate_ppt')" size="small" text @click="openPptUpload(node)">上传PPT</el-button>
          <el-button v-if="node.attachments?.length" size="small" text :icon="Download" @click="downloadFirstAttachment(node)">下载</el-button>
          <el-button v-if="canExportOriginal(node)" size="small" text :icon="Download" @click="exportOriginalDocument(node)">导出原格式</el-button>
        </div>
      </article>
    </div>
  </el-card>

  <el-dialog v-model="dialogVisible" :title="activeNode ? activeNode.label : '项目单据'" width="980px" class="document-dialog">
    <div v-if="activeNode" class="dialog-layout">
      <aside class="dialog-aside">
        <div class="aside-title">{{ activeNode.stage }}</div>
        <h4>{{ activeNode.label }}</h4>
        <p>{{ activeNode.desc }}</p>
        <el-tag :type="statusType(activeNode)">{{ activeNode.status || '草稿' }}</el-tag>
      </aside>
      <section class="table-panel">
        <div class="table-note">系统版表格 V2。界面按总监真实表格拆成可读区域，保存后仍会作为结构化单据入库。</div>
        <div v-if="uniqAttachments.length" class="attachment-strip">
          <span>关联附件</span>
          <button
            v-for="file in uniqAttachments"
            :key="file.id"
            type="button"
            class="attachment-chip"
            @click="downloadAttachment(file)"
          >
            {{ isPptFile(file) ? 'PPT' : isImageFile(file) ? '图片' : '文件' }} · {{ file.original_name }}
          </button>
        </div>

        <div class="mapping-panel">
          <div>
            <strong>进系统结构化</strong>
            <span>{{ activeNode.field_mapping?.structured?.join('、') || '暂无映射' }}</span>
          </div>
          <div>
            <strong>先作为附件保留</strong>
            <span>{{ activeNode.field_mapping?.attachment_only?.join('、') || '暂无附件字段' }}</span>
          </div>
          <div v-if="activeNode.document_versions?.length" class="version-list">
            <strong>版本记录</strong>
            <span v-for="version in activeNode.document_versions" :key="version.id">
              #{{ version.id }} · {{ version.source_file_name || '系统表格' }} · {{ version.uploader_name || '未知人员' }} · {{ version.updated_at || version.created_at }}
            </span>
          </div>
        </div>

        <div class="sheet-block">
          <div class="sheet-title">项目基础信息</div>
          <div class="info-grid">
            <label>项目名称<el-input v-model="activeData.project.project_name" /></label>
            <label>客户姓名<el-input v-model="activeData.project.customer" /></label>
            <label>联系方式<el-input v-model="activeData.project.phone" /></label>
            <label>来源/销售<el-input v-model="activeData.project.source" /></label>
            <label class="wide">项目地址<el-input v-model="activeData.project.address" /></label>
          </div>
        </div>

        <div v-if="['survey_initial', 'survey_recheck', 'completion_inspection'].includes(activeNode.key)" class="sheet-block">
          <div class="sheet-title">{{ activeNode.label }}</div>
          <el-tabs v-model="activeSheet" class="sheet-tabs">
            <el-tab-pane label="表格" name="form">
          <div class="info-grid">
            <label>日期<el-input v-model="activeData.survey.survey_date" placeholder="2026-04-08" /></label>
            <label>勘察/质检人<el-input v-model="activeData.survey.surveyor" /></label>
            <label>联系电话<el-input v-model="activeData.survey.surveyor_phone" /></label>
            <label>工勘结论<el-select v-model="activeData.survey.entry_judgment" style="width:100%"><el-option label="无需复尺，进入收款单" value="ready" /><el-option label="需要复尺/整改复核" value="conditional" /><el-option label="暂不具备进场条件" value="blocked" /></el-select></label>
            <label>需要二次勘察<el-switch v-model="activeData.survey.need_recheck" /></label>
            <label>触发整改/售后<el-switch v-model="activeData.survey.repair_required" /></label>
            <label class="wide">勘察/质检结论<el-input v-model="activeData.survey.conclusion" type="textarea" :rows="4" /></label>
          </div>
          <SystemSheetTable
            :columns="[{ key: 'issue', label: '问题/整改项', width: 520 }]"
            :rows="activeData.survey.issues.map((issue, index) => ({ id: index, issue }))"
            :storage-key="`${activeNode.key}:issues`"
            :min-width="560"
            empty-text="暂无问题项，可在结论中先记录。"
            @cell-change="({ row, value }) => { activeData.survey.issues[row.id] = value }"
          />
          <div class="survey-image-section">
            <div class="sheet-title second">
              现场图片
              <span class="image-grid-tools">
                <el-select v-model="gridSize" size="small" style="width: 90px" @change="activeData = {...activeData}">
                  <el-option :value="100" label="小图" />
                  <el-option :value="150" label="中图" />
                  <el-option :value="220" label="大图" />
                </el-select>
                <span class="img-hint">拖拽可排序</span>
              </span>
            </div>
            <div v-if="surveyImages().length" class="survey-image-grid" :style="{ gridTemplateColumns: `repeat(auto-fill, minmax(${gridSize}px, 1fr))` }">
              <figure
                v-for="(image, index) in surveyImages()"
                :key="image.attachment_id || image.name || index"
                class="survey-image-card"
                :class="{ 'drag-over': dragIndex >= 0 && dragIndex !== index, 'is-dragging': dragIndex === index }"
                draggable="true"
                @dragstart="onImageDragStart(index, $event)"
                @dragover="onImageDragOver"
                @drop="onImageDrop(index, $event)"
                @dragend="dragIndex = -1"
              >
                <img v-if="surveyImagePreviewUrl(image)" :src="surveyImagePreviewUrl(image)" :alt="surveyImageLabel(image, index)" />
                <div v-else class="survey-image-missing">图片预览加载中</div>
                <div class="image-overlay">
                  <el-popover placement="top" :width="180" trigger="click" :hide-after="0">
                    <template #reference>
                      <el-button circle size="small" class="img-action-btn"><el-icon><MoreFilled /></el-icon></el-button>
                    </template>
                    <div class="img-popover-actions">
                      <el-select v-model="gridSize" size="small" style="width: 100%">
                        <el-option :value="100" label="小图展示" />
                        <el-option :value="150" label="中图展示" />
                        <el-option :value="220" label="大图展示" />
                      </el-select>
                      <el-button type="danger" size="small" plain style="width: 100%; margin-top: 8px;" @click="deleteImage(index)">
                        删除此图片
                      </el-button>
                    </div>
                  </el-popover>
                </div>
                <figcaption>
                  <strong>{{ surveyImageLabel(image, index) }}</strong>
                  <span>{{ surveyImageFileName(image, index) }}</span>
                </figcaption>
                <el-input
                  v-model="image.note"
                  class="image-note-input"
                  size="small"
                  placeholder="图片说明，可由 AI 生成后修改"
                />
              </figure>
            </div>
            <el-empty v-else description="暂无现场图片，先上传图片，再生成 PPT。" :image-size="64" />
          </div>
            </el-tab-pane>
            <el-tab-pane label="PPT可视图" name="ppt">
              <div class="ppt-toolbar">
                <el-button type="primary" :icon="UploadFilled" @click="openSurveyImages(activeNode)">上传图片</el-button>
                <el-button :icon="MagicStick" :disabled="!hasSurveyImages(activeNode)" @click="generateSurveyNotes">AI生成说明</el-button>
                <el-button :icon="MagicStick" :disabled="!hasSurveyImages(activeNode)" @click="generateSurveyPpt(activeNode)">生成PPT</el-button>
                <el-button @click="openPptUpload(activeNode)">直接上传PPT</el-button>
                <el-button
                  v-if="canConfirmNode(activeNode)"
                  type="success"
                  :icon="DocumentChecked"
                  @click="confirmDeliveryStep(activeNode)"
                >
                  {{ confirmButtonLabel(activeNode) }}
                </el-button>
                <span>先上传现场图片，再编辑每张图片说明；生成 PPT 时会写入这些说明。</span>
              </div>
              <div class="ppt-preview">
                <div class="ppt-slide">
                  <div class="ppt-slide-head">
                    <el-input v-model="activeData.survey.ppt_title" />
                    <el-select v-model="activeData.survey.ppt_layout" style="width: 140px">
                      <el-option label="左右图文" value="two-column" />
                      <el-option label="图片宫格" value="grid" />
                    </el-select>
                  </div>
                  <div class="ppt-slide-body" :class="activeData.survey.ppt_layout">
                    <div class="ppt-photo-grid">
                      <template v-if="surveyImages().length === 0">
                        <div class="ppt-photo ppt-empty-hint">暂无图片，请先点击“上传图片”</div>
                      </template>
                      <template v-else>
                        <figure
                          v-for="(image, index) in surveyImages()"
                          :key="image.attachment_id || image.name || index"
                          class="ppt-photo is-image"
                          :class="{
                            'is-dragging': dragIndex === index,
                            'drag-over': dragIndex >= 0 && dragIndex !== index,
                            'ppt-photo-full': surveyImages().length <= 2
                          }"
                          draggable="true"
                          @dragstart="onImageDragStart(index, $event)"
                          @dragover="onImageDragOver"
                          @drop="onImageDrop(index, $event)"
                          @dragend="dragIndex = -1"
                        >
                          <img
                            v-if="surveyImagePreviewUrl(image)"
                            :src="surveyImagePreviewUrl(image)"
                            :alt="surveyImageLabel(image, index)"
                            class="ppt-photo-img"
                            @click.stop="openPreview(surveyImagePreviewUrl(image))"
                          />
                          <span v-else>{{ surveyImageLabel(image, index) }}</span>
                          <el-input
                            v-model="image.note"
                            class="ppt-note-input"
                            size="small"
                            placeholder="图片说明，可由 AI 生成后修改"
                            @click.stop
                          />
                          <div class="image-overlay ppt-overlay">
                            <el-button circle size="small" class="img-action-btn" @click.stop="deleteImage(index)">
                              <el-icon><Delete /></el-icon>
                            </el-button>
                          </div>
                        </figure>
                      </template>
                    </div>
                    <div class="ppt-text">
                      <strong>{{ activeData.project.customer || '客户' }} · {{ activeData.survey.survey_date || '勘察日期' }}</strong>
                      <el-input v-model="activeData.survey.conclusion" type="textarea" :rows="5" />
                    </div>
                  </div>
                </div>
              </div>
            </el-tab-pane>
          </el-tabs>
        </div>

        <div v-if="activeNode.key === 'project_payment_request'" class="sheet-block">
          <div class="sheet-title">项目结算收款单</div>
          <div class="finance-note">
            财务根据工勘/复尺结果制作收款单，交总监打印签字后通知门店收取进场前 90% 款项；尾款 10% 留到完工内检后再收。
          </div>
          <div class="info-grid">
            <label>收款单号<el-input v-model="activeData.payment_request.request_no" placeholder="如 JSTZ 26-05-25" /></label>
            <label>项目编号<el-input v-model="activeData.payment_request.project_code" /></label>
            <label>设计师<el-input v-model="activeData.payment_request.designer" /></label>
            <label>销售顾问/门店接单人<el-input v-model="activeData.payment_request.salesperson" /></label>
            <label>销售电话<el-input v-model="activeData.payment_request.sales_phone" /></label>
            <label>预计开工<el-input v-model="activeData.payment_request.expected_start_date" placeholder="2026-01-01" /></label>
            <label>预计工期<el-input v-model="activeData.payment_request.expected_duration" /></label>
            <label>施工面积<DecimalCellInput v-model="activeData.payment_request.total_area" /></label>
            <label class="wide">收款/签字备注<el-input v-model="activeData.payment_request.note" type="textarea" :rows="3" placeholder="打印签字、门店收款、凭证位置等" /></label>
          </div>
          <div class="money-grid finance-grid">
            <label>结算总金额<DecimalCellInput v-model="activeData.summary.contract_amount" /></label>
            <label>进场前90%<DecimalCellInput v-model="activeData.summary.pre_entry_amount" /></label>
            <label>尾款10%<DecimalCellInput v-model="activeData.summary.tail_amount" /></label>
            <label>已收款<DecimalCellInput v-model="activeData.summary.received_amount" /></label>
            <label>收款状态<el-select v-model="activeData.summary.payment_status" style="width:100%"><el-option label="待确认" value="pending" /><el-option label="进场款已收" value="pre_entry_paid" /><el-option label="部分到账" value="partial" /></el-select></label>
            <label>总监已签字<el-switch v-model="activeData.payment_request.director_signed" /></label>
            <label>已通知门店收款<el-switch v-model="activeData.payment_request.store_notified" /></label>
            <label>90%进场款已确认
              <el-switch
                v-model="activeData.payment_request.pre_entry_payment_confirmed"
                @change="activeData.summary.payment_status = activeData.payment_request.pre_entry_payment_confirmed ? 'pre_entry_paid' : 'pending'"
              />
            </label>
          </div>
        </div>

        <div v-if="activeNode.key === 'briefing'" class="sheet-block">
          <div class="sheet-title">施工项目详情</div>
          <SystemSheetTable :columns="briefingColumns" :rows="activeData.items" :storage-key="`${activeNode.key}:items`" empty-text="暂无施工明细。" />
          <div class="sheet-title second">销售/报价明细</div>
          <SystemSheetTable :columns="quotationColumns" :rows="activeData.quotation_items" :storage-key="`${activeNode.key}:quotation`" empty-text="暂无销售报价明细。" />
        </div>

        <div v-if="activeNode.key === 'material_io'" class="sheet-block">
          <div class="sheet-title">{{ project.status === 'inspection_done' ? '材料回库' : '材料出库单' }}</div>
          <el-tabs v-model="activeSheet" class="sheet-tabs">
            <el-tab-pane label="出库总览" name="overview">
              <SystemSheetTable :columns="materialColumns" :rows="activeData.items" :storage-key="`${activeNode.key}:overview`" empty-text="暂无材料明细，可导入材料出库表生成。" @cell-change="onMaterialCellChange" />
            </el-tab-pane>
            <el-tab-pane label="出库明细" name="out">
              <SystemSheetTable :columns="materialOutColumns" :rows="activeData.items" :storage-key="`${activeNode.key}:out`" empty-text="暂无出库明细。" @cell-change="onMaterialCellChange" />
            </el-tab-pane>
            <el-tab-pane v-if="project.status === 'inspection_done'" label="回库明细" name="return">
              <SystemSheetTable :columns="materialReturnColumns" :rows="activeData.items" :storage-key="`${activeNode.key}:return`" empty-text="暂无回库明细。" @cell-change="onMaterialCellChange" />
            </el-tab-pane>
            <el-tab-pane v-if="project.status === 'inspection_done'" label="剩余/差异" name="balance">
              <SystemSheetTable :columns="materialBalanceColumns" :rows="activeData.items" :storage-key="`${activeNode.key}:balance`" empty-text="暂无剩余差异。" @cell-change="onMaterialCellChange" />
            </el-tab-pane>
          </el-tabs>
          <div class="money-grid">
            <label>材料费<DecimalCellInput v-model="activeData.summary.material_fee" /></label>
            <label>辅材费<DecimalCellInput v-model="activeData.summary.auxiliary_fee" /></label>
            <label>工具费<DecimalCellInput v-model="activeData.summary.tool_fee" /></label>
            <label>运输费<DecimalCellInput v-model="activeData.summary.transport_fee" /></label>
            <label>总计<DecimalCellInput v-model="activeData.summary.total_cost" /></label>
          </div>
        </div>

        <div v-if="activeNode.key === 'labor_settlement'" class="sheet-block">
          <div class="sheet-title">施工班组工费结算</div>
          <div class="info-grid">
            <label>开工时间<el-input v-model="activeData.summary.start_date" /></label>
            <label>完工时间<el-input v-model="activeData.summary.end_date" /></label>
            <label>销售顾问<el-input v-model="activeData.summary.salesperson" /></label>
            <label>班组长<el-input v-model="activeData.summary.team_leader" /></label>
            <label>人数/工数<DecimalCellInput v-model="activeData.summary.worker_count" /></label>
            <label>总工期<el-input v-model="activeData.summary.duration" /></label>
            <label>施工面积<DecimalCellInput v-model="activeData.summary.total_area" /></label>
            <label>人工费合计<DecimalCellInput v-model="activeData.summary.labor_fee" /></label>
            <label class="wide">施工现场概况<el-input v-model="activeData.summary.site_overview" type="textarea" :rows="3" /></label>
            <label class="wide">点工/包工说明<el-input v-model="activeData.summary.work_note" /></label>
          </div>
          <SystemSheetTable :columns="laborColumns" :rows="activeData.items" :storage-key="`${activeNode.key}:items`" empty-text="暂无工费明细，可导入工费结算单生成。" />
        </div>

        <div v-if="activeNode.key === 'cost_check'" class="sheet-block">
          <div class="sheet-title">完工成本核算</div>
          <div class="money-grid">
            <label>合同报价<el-input :model-value="finance.contract_amount" disabled /></label>
            <label>交付核算收入<DecimalCellInput v-model="activeData.summary.revenue_amount" /></label>
            <label>人工费<DecimalCellInput v-model="activeData.summary.labor_fee" /></label>
            <label>材料费<DecimalCellInput v-model="activeData.summary.material_fee" /></label>
            <label>辅材费<DecimalCellInput v-model="activeData.summary.auxiliary_fee" /></label>
            <label>工具费<DecimalCellInput v-model="activeData.summary.tool_fee" /></label>
            <label>运输费<DecimalCellInput v-model="activeData.summary.transport_fee" /></label>
            <label>成本合计<DecimalCellInput v-model="activeData.summary.total_cost" /></label>
            <label>毛利润<DecimalCellInput v-model="activeData.summary.gross_profit" /></label>
            <label>利润率<DecimalCellInput v-model="activeData.summary.profit_rate" /></label>
            <label>成本控制<el-input v-model="activeData.summary.control_result" /></label>
          </div>
          <div class="cost-subtotal">
            <div v-for="item in costSubtotals()" :key="item.label" class="subtotal-card">
              <span>{{ item.label }}</span>
              <strong>{{ money(item.value) }}</strong>
              <small>{{ item.note }}</small>
            </div>
          </div>
          <SystemSheetTable v-if="activeData.cost_items?.length" :columns="costColumns" :rows="activeData.cost_items" :storage-key="`${activeNode.key}:costs`" />
        </div>

        <div v-if="activeNode.key === 'finance_settlement'" class="sheet-block">
          <div class="sheet-title">财务结算/归档</div>
          <div class="finance-note">
            财务归档只看收款、尾款、付款凭证和最终对账，不再重复展示成本费用明细。
          </div>
          <div class="money-grid finance-grid">
            <label>合同报价<DecimalCellInput v-model="activeData.summary.contract_amount" /></label>
            <label>交付核算收入<DecimalCellInput v-model="activeData.summary.delivery_revenue" /></label>
            <label>已收款<DecimalCellInput v-model="activeData.summary.received_amount" /></label>
            <label>未收/尾款<DecimalCellInput v-model="activeData.summary.unpaid_amount" /></label>
            <label>收款状态<el-select v-model="activeData.summary.payment_status" style="width:100%"><el-option label="待确认" value="pending" /><el-option label="已收齐" value="paid" /><el-option label="有尾款" value="partial" /></el-select></label>
            <label>归档状态<el-select v-model="activeData.summary.archive_status" style="width:100%"><el-option label="未归档" value="pending" /><el-option label="已归档" value="archived" /></el-select></label>
            <label class="wide">财务备注/凭证说明<el-input v-model="activeData.summary.finance_note" type="textarea" :rows="3" /></label>
          </div>
        </div>
      </section>
    </div>
    <template #footer>
      <el-button @click="dialogVisible = false">关闭</el-button>
      <el-button type="primary" :loading="saving" @click="saveActiveNode">保存单据</el-button>
    </template>
  </el-dialog>

  <!-- 图片放大预览 -->
  <el-dialog v-model="previewImageVisible" title="图片预览" width="auto" align-center :close-on-click-modal="true" destroy-on-close
    :style="{ maxWidth: '90vw' }" class="preview-dialog">
    <div class="preview-dialog-body">
      <img v-if="previewImageUrl" :src="previewImageUrl" class="preview-full-img" />
    </div>
  </el-dialog>
</template>

<style scoped>
.delivery-chain {
  margin-bottom: 20px;
  border: 1px solid color-mix(in srgb, var(--color-primary) 18%, var(--border-light));
}

.hidden-input {
  display: none;
}

.chain-head {
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

.chain-head h3 {
  margin: 0 0 5px;
  color: var(--text-primary);
  font-size: 18px;
}

.chain-head p {
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
  margin-bottom: 4px;
  color: var(--text-tertiary);
  font-size: 12px;
}

.metric strong {
  color: var(--text-primary);
  font-size: 18px;
}

.diff-box {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  margin-bottom: 14px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, #f59e0b 12%, var(--bg-card));
  color: #b45309;
  font-size: 13px;
  line-height: 1.5;
}

.note-box {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  margin-bottom: 14px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, #3b82f6 10%, var(--bg-card));
  color: #1d4ed8;
  font-size: 13px;
  line-height: 1.5;
}

.chain-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.chain-card {
  display: flex;
  flex-direction: column;
  min-height: 214px;
  padding: 12px;
  border: 1px solid color-mix(in srgb, #ef4444 18%, var(--border-light));
  border-radius: var(--radius-md);
  background: color-mix(in srgb, #ef4444 6%, var(--bg-card));
}

.chain-card.confirmed {
  border-color: color-mix(in srgb, #22c55e 28%, var(--border-light));
  background: color-mix(in srgb, #22c55e 7%, var(--bg-card));
}

.chain-card.current {
  border-color: color-mix(in srgb, var(--color-primary) 52%, var(--border-light));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 10%, transparent);
}

.chain-card.warning {
  border-color: color-mix(in srgb, #f59e0b 28%, var(--border-light));
  background: color-mix(in srgb, #f59e0b 7%, var(--bg-card));
}

.chain-card.optional {
  border-color: var(--border-light);
  background: color-mix(in srgb, var(--bg-card) 88%, var(--bg-page));
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

.node-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.node-summary span {
  max-width: 100%;
  padding: 4px 7px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text-tertiary);
  font-size: 12px;
}

.node-summary b {
  color: var(--text-secondary);
}

.chain-evidence {
  display: grid;
  gap: 3px;
  min-height: 34px;
  color: var(--text-tertiary);
  font-size: 12px;
  line-height: 1.45;
}

.node-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: auto;
  padding-top: 10px;
}

.dialog-layout {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 16px;
}

.dialog-aside {
  padding: 12px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  background: var(--bg-page);
}

.aside-title {
  color: var(--color-primary);
  font-size: 12px;
  font-weight: 800;
}

.dialog-aside h4 {
  margin: 6px 0;
  color: var(--text-primary);
  font-size: 17px;
}

.dialog-aside p,
.table-note {
  color: var(--text-tertiary);
  font-size: 13px;
  line-height: 1.5;
}

.table-note {
  margin-bottom: 8px;
}

.table-panel {
  min-width: 0;
  max-height: 65vh;
  overflow: auto;
  padding-right: 4px;
}

.sheet-block {
  margin-bottom: 14px;
  padding: 12px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  background: var(--bg-card);
}

.sheet-title {
  margin-bottom: 10px;
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 800;
}

.sheet-title.second {
  margin-top: 14px;
}

.sheet-tabs {
  width: 100%;
}

.info-grid,
.money-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.money-grid {
  grid-template-columns: repeat(5, minmax(0, 1fr));
  margin-top: 10px;
}

.info-grid label,
.money-grid label {
  display: grid;
  gap: 5px;
  min-width: 0;
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 700;
}

.info-grid .wide,
.money-grid .wide {
  grid-column: 1 / -1;
}

.finance-note {
  margin-bottom: 10px;
  padding: 9px 10px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, #3b82f6 8%, var(--bg-card));
  color: #1d4ed8;
  font-size: 13px;
}

.attachment-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin: 0 0 12px;
  padding: 10px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--bg-page) 78%, var(--bg-card));
}

.attachment-strip > span {
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 700;
}

.attachment-chip {
  max-width: 260px;
  padding: 6px 9px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  color: var(--text-secondary);
  font-size: 12px;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.attachment-chip:hover {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.mapping-panel {
  display: grid;
  gap: 8px;
  margin: 0 0 12px;
  padding: 10px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--color-primary) 5%, var(--bg-card));
}

.mapping-panel div {
  display: grid;
  gap: 4px;
}

.mapping-panel strong {
  color: var(--text-primary);
  font-size: 12px;
}

.mapping-panel span {
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.5;
}

.version-list {
  padding-top: 6px;
  border-top: 1px dashed var(--border-light);
}

.survey-image-section {
  margin-top: 12px;
}

.survey-image-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
}

.survey-image-card {
  display: grid;
  grid-template-rows: minmax(120px, auto) auto auto;
  margin: 0;
  overflow: hidden;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
}

.survey-image-card img {
  display: block;
  width: 100%;
  min-height: 120px;
  max-height: 260px;
  object-fit: contain;
  background: var(--bg-page);
}

.survey-image-missing {
  display: grid;
  place-items: center;
  aspect-ratio: 4 / 3;
  background: var(--bg-page);
  color: var(--text-tertiary);
  font-size: 12px;
}

.survey-image-card figcaption {
  display: grid;
  gap: 3px;
  padding: 8px;
  min-width: 0;
}

.survey-image-card figcaption strong,
.survey-image-card figcaption span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.survey-image-card figcaption strong {
  color: var(--text-primary);
  font-size: 13px;
}

.survey-image-card figcaption span {
  color: var(--text-tertiary);
  font-size: 12px;
}

.image-note-input {
  padding: 0 8px 8px;
}

/* 交互：悬浮遮罩 */
.survey-image-card {
  position: relative;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.survey-image-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(0,0,0,0.12);
}
.survey-image-card.is-dragging {
  opacity: 0.4;
  outline: 2px dashed var(--color-primary);
}
.survey-image-card.drag-over {
  outline: 2px dashed var(--color-primary);
  outline-offset: 2px;
}
.image-overlay {
  position: absolute;
  top: 6px;
  right: 6px;
  opacity: 0;
  transition: opacity 0.15s ease;
  z-index: 2;
}
.survey-image-card:hover .image-overlay,
.ppt-photo:hover .image-overlay {
  opacity: 1;
}
.img-action-btn {
  background: rgba(0,0,0,0.55) !important;
  color: #fff !important;
  border: none !important;
  backdrop-filter: blur(4px);
}
.img-action-btn:hover {
  background: rgba(0,0,0,0.75) !important;
}
.img-popover-actions {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.image-grid-tools {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-left: 12px;
}
.img-hint {
  font-weight: 400;
  font-size: 11px;
  color: var(--text-tertiary);
}
/* PPT 内图片交互 */
.ppt-photo.is-image {
  position: relative;
  transition: opacity 0.15s ease;
  cursor: grab;
}
.ppt-photo.is-image:active {
  cursor: grabbing;
}
.ppt-photo.is-image.is-dragging {
  opacity: 0.3;
  outline: 2px dashed var(--color-primary);
}
.ppt-photo.is-image.drag-over {
  outline: 2px dashed var(--color-primary);
  outline-offset: 2px;
}
.ppt-overlay {
  top: 4px;
  right: 4px;
}

.ppt-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
  color: var(--text-tertiary);
  font-size: 12px;
}

.ppt-preview {
  padding: 12px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  background: var(--bg-page);
  overflow: auto;
  max-height: 580px;
}

.ppt-slide {
  width: min(100%, 920px);
  min-height: 360px;
  margin: 0 auto;
  padding: 18px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: #fff;
  color: #111827;
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.08);
}

.ppt-slide-head {
  display: flex;
  gap: 10px;
  margin-bottom: 14px;
}

.ppt-slide-body {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(240px, 0.75fr);
  gap: 14px;
  min-height: 260px;
  align-items: start;
}

.ppt-slide-body.grid {
  grid-template-columns: 1fr;
}

.ppt-photo-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 10px;
}

.ppt-photo {
  display: grid;
  place-items: center;
  min-height: 92px;
  border: 1px dashed #cbd5e1;
  border-radius: 6px;
  background: #f8fafc;
  color: #64748b;
  font-size: 13px;
}

.ppt-empty-hint {
  grid-column: 1 / -1;
  min-height: 180px;
}

.ppt-photo.is-image {
  overflow: hidden;
  border-style: solid;
  padding: 8px;
  align-content: start;
}
.ppt-photo-img {
  display: block;
  width: 100%;
  height: auto;
  min-height: 110px;
  max-height: 260px;
  object-fit: contain;
  border-radius: 4px;
  background: #eef2f7;
  transition: transform 0.25s ease;
  cursor: zoom-in;
}
.ppt-photo-img:hover {
  transform: scale(1.04);
  z-index: 3;
}
.ppt-photo-full .ppt-photo-img:hover {
  transform: scale(1.04);
}
/* 图片数≤2时宽一点 */
.ppt-photo-full {
  grid-column: span 1;
}
.ppt-photo-full:only-child {
  grid-column: 1 / -1;
}

.ppt-note-input {
  width: 100%;
  margin: 8px 0 0;
}
.ppt-photo-full:only-child .ppt-photo-img {
  max-height: 340px;
  object-fit: contain;
}
.preview-dialog {
  display: flex;
  align-items: center;
  justify-content: center;
}
.preview-dialog :deep(.el-dialog__body) {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 12px;
  overflow: hidden;
}
.preview-dialog-body {
  display: flex;
  justify-content: center;
  align-items: center;
  max-width: 100%;
}
.preview-full-img {
  display: block;
  max-width: 82vw;
  max-height: 78vh;
  width: auto;
  height: auto;
  object-fit: contain;
  border-radius: 4px;
}

.ppt-text {
  display: grid;
  align-content: start;
  gap: 10px;
}

.cost-subtotal {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin: 12px 0;
}

.subtotal-card {
  padding: 10px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--bg-card) 86%, var(--bg-page));
}

.subtotal-card span,
.subtotal-card small {
  display: block;
  color: var(--text-tertiary);
  font-size: 12px;
}

.subtotal-card strong {
  display: block;
  margin: 4px 0;
  color: var(--text-primary);
  font-size: 17px;
}

.data-table {
  width: 100%;
  min-width: 760px;
  border-collapse: collapse;
  overflow: hidden;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  font-size: 12px;
}

.data-table th,
.data-table td {
  padding: 7px;
  border: 1px solid var(--border-light);
  color: var(--text-secondary);
  vertical-align: middle;
}

.data-table th {
  background: color-mix(in srgb, var(--bg-page) 85%, var(--color-primary));
  color: var(--text-primary);
  font-weight: 800;
  white-space: nowrap;
}

.data-table td {
  background: var(--bg-card);
}

.data-table :deep(.el-input__wrapper),
.info-grid :deep(.el-input__wrapper),
.money-grid :deep(.el-input__wrapper) {
  min-height: 30px;
  box-shadow: 0 0 0 1px var(--border-light) inset;
}

@media (max-width: 860px) {
  .summary-top,
  .chain-grid,
  .dialog-layout,
  .info-grid,
  .money-grid,
  .cost-subtotal {
    grid-template-columns: 1fr;
  }

  .ppt-slide-body {
    grid-template-columns: 1fr;
  }
}
</style>
