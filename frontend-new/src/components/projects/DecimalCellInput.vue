<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  modelValue: { type: [Number, String], default: '' },
  placeholder: { type: String, default: '' }
})

const emit = defineEmits(['update:modelValue', 'change'])

const draft = ref(formatValue(props.modelValue))

watch(() => props.modelValue, value => {
  const next = formatValue(value)
  if (next !== draft.value) draft.value = next
})

function formatValue(value) {
  if (value === undefined || value === null) return ''
  return String(value)
}

function onInput(value) {
  const safe = String(value || '').replace(/[^\d.-]/g, '')
  draft.value = safe
  if (['', '-', '.', '-.'].includes(safe)) {
    emit('update:modelValue', safe)
    return
  }
  const num = Number(safe)
  emit('update:modelValue', Number.isFinite(num) ? num : safe)
}

function onBlur() {
  if (['', '-', '.', '-.'].includes(draft.value)) {
    draft.value = ''
    emit('update:modelValue', '')
    emit('change', '')
    return
  }
  const num = Number(draft.value)
  if (!Number.isFinite(num)) return
  draft.value = String(num)
  emit('update:modelValue', num)
  emit('change', num)
}
</script>

<template>
  <el-input
    :model-value="draft"
    :placeholder="placeholder"
    inputmode="decimal"
    @input="onInput"
    @blur="onBlur"
  />
</template>
