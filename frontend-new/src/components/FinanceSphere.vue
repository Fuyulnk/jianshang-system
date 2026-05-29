<template>
  <el-card class="chart-card" shadow="never">
    <div class="chart-head">
      <h3>{{ title }}</h3>
      <span class="chart-total">{{ formatMoney(total) }}</span>
    </div>
    <div class="chart-body" v-if="items.length">
      <canvas ref="canvasRef" :width="canvasSize" :height="canvasSize" class="chart-canvas"></canvas>
      <div class="chart-legend">
        <div class="legend-item" v-for="(item, i) in items" :key="item.name">
          <span class="legend-dot" :style="{ background: colors[i % colors.length] }"></span>
          <span class="legend-name">{{ item.name }}</span>
          <span class="legend-pct">{{ item.pct }}%</span>
          <span class="legend-amount">{{ formatMoney(item.amount) }}</span>
        </div>
      </div>
    </div>
    <el-empty v-else description="暂无数据" :image-size="60" />
  </el-card>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'

const props = defineProps({
  title: { type: String, default: '' },
  accounts: { type: Array, default: () => [] },
  type: { type: String, default: 'income' }, // income | expense
})

const colors = [
  '#4f6df5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1',
]

const canvasRef = ref(null)
const canvasSize = ref(160)

const items = computed(() => {
  const field = props.type === 'income' ? 'total_income' : 'total_expense'
  const raw = props.accounts.filter(a => Number(a[field]) > 0)
  const total = raw.reduce((s, a) => s + Number(a[field]), 0)
  if (total === 0) return []
  return raw.map(a => ({
    name: a.name,
    amount: Number(a[field]),
    pct: ((Number(a[field]) / total) * 100).toFixed(1),
  }))
})

const total = computed(() => items.value.reduce((s, i) => s + i.amount, 0))

function formatMoney(v) {
  const n = Number(v) || 0
  return (n >= 0 ? '' : '-') + '¥' + n.toLocaleString('zh-CN', { minimumFractionDigits: 2 })
}

function drawChart() {
  const canvas = canvasRef.value
  if (!canvas || !items.value.length) return
  const ctx = canvas.getContext('2d')
  const dpr = window.devicePixelRatio || 1
  const size = canvasSize.value
  canvas.width = size * dpr
  canvas.height = size * dpr
  ctx.scale(dpr, dpr)

  const cx = size / 2
  const cy = size / 2
  const outerR = size / 2 - 6
  const innerR = outerR * 0.55
  const data = items.value
  const totalVal = data.reduce((s, i) => s + i.amount, 0)

  ctx.clearRect(0, 0, size, size)

  // 背景圆环
  ctx.beginPath()
  ctx.arc(cx, cy, outerR, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(128,128,128,0.06)'
  ctx.fill()

  if (totalVal === 0) return

  // 画分段环形
  let startAngle = -Math.PI / 2
  data.forEach((item, i) => {
    const slice = (item.amount / totalVal) * Math.PI * 2
    const endAngle = startAngle + slice

    ctx.beginPath()
    ctx.arc(cx, cy, outerR, startAngle, endAngle)
    ctx.arc(cx, cy, innerR, endAngle, startAngle, true)
    ctx.closePath()
    ctx.fillStyle = colors[i % colors.length]
    ctx.fill()

    // 描边
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'
    ctx.lineWidth = 1
    ctx.stroke()

    startAngle = endAngle
  })

  // 中间圆心白色遮罩
  ctx.beginPath()
  ctx.arc(cx, cy, innerR, 0, Math.PI * 2)
  ctx.fillStyle = 'transparent'
  ctx.fill()
}

onMounted(drawChart)
watch(() => props.accounts, drawChart, { deep: true })
</script>

<style scoped>
.chart-card {
  border-radius: var(--radius-md) !important;
  border: 1px solid var(--border-light) !important;
  height: 100%;
}

.chart-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.chart-head h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.chart-total {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
}

.chart-body {
  display: flex;
  gap: 20px;
  align-items: center;
}

.chart-canvas {
  flex-shrink: 0;
}

.chart-legend {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}

.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.legend-name {
  color: var(--text-primary);
  min-width: 48px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.legend-pct {
  color: var(--text-tertiary);
  min-width: 36px;
  text-align: right;
}

.legend-amount {
  color: var(--text-primary);
  font-weight: 500;
  margin-left: auto;
  white-space: nowrap;
}
</style>
