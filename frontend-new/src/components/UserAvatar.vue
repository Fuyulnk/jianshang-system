<template>
  <div v-if="avatarUrl" class="user-avatar" :style="avatarStyle">
    <img :src="avatarUrl" :style="imgStyle" @error="onError" />
  </div>
  <div v-else class="user-avatar" :style="avatarStyle" :title="username">
    {{ initial }}
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  username: { type: String, default: '?' },
  avatarUrl: { type: String, default: '' },
  size: { type: Number, default: 32 },
})

const hasError = ref(false)

const initial = computed(() => (props.username || '?')[0].toUpperCase())
const colors = [
  '#4f6df5', '#d97706', '#10b981', '#ef4444', '#8b5cf6',
  '#06b6d4', '#f59e0b', '#ec4899', '#6366f1', '#14b8a6',
]
const colorIndex = computed(() => {
  let hash = 0
  for (const c of props.username) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff
  return hash % colors.length
})
const bgGradient = computed(() => {
  const c = colors[colorIndex.value]
  return `linear-gradient(135deg, ${c}, ${colors[(colorIndex.value + 1) % colors.length]})`
})

const avatarStyle = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  lineHeight: `${props.size}px`,
  fontSize: `${Math.max(11, props.size * 0.42)}px`,
  background: props.avatarUrl && !hasError.value ? 'transparent' : bgGradient.value,
}))

const imgStyle = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  borderRadius: '50%',
  objectFit: 'cover',
}))

function onError() { hasError.value = true }
</script>

<style scoped>
.user-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: #fff;
  font-weight: 600;
  flex-shrink: 0;
  overflow: hidden;
  vertical-align: middle;
}
img {
  display: block;
}
</style>
