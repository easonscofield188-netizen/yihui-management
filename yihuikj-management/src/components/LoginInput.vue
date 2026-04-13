<template>
  <div class="space-y-2">
    <div class="flex justify-between items-center px-1">
      <label class="text-[10px] font-bold uppercase tracking-[0.2em] text-on-surface-variant/80 ml-1">{{ label }}</label>
      <slot name="extra" />
    </div>
    <div class="relative group">
      <div class="absolute left-4 top-1/2 -translate-y-1/2 text-outline transition-colors z-10 flex items-center group-focus-within:text-secondary">
        <slot name="icon" />
      </div>
      <input 
        :type="inputType" 
        :value="modelValue"
        class="w-full bg-surface-container-lowest border border-outline-variant/20 rounded-lg py-4 pl-12 pr-12 text-on-surface placeholder:text-outline/50 focus:ring-1 focus:ring-secondary/30 focus:border-secondary transition-all outline-none text-sm"
        :placeholder="placeholder" 
        @input="$emit('update:modelValue', $event.target.value)"
      >
      <!-- Password Toggle -->
      <button 
        v-if="type === 'password'"
        type="button"
        class="absolute right-4 top-1/2 -translate-y-1/2 text-outline/40 hover:text-secondary transition-colors z-10 flex items-center"
        @click="toggleVisibility"
      >
        <el-icon size="18">
          <View v-if="isVisible" />
          <Hide v-else />
        </el-icon>
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { View, Hide } from '@element-plus/icons-vue'

const props = defineProps({
  modelValue: {
    type: String,
    default: ''
  },
  label: {
    type: String,
    default: ''
  },
  placeholder: {
    type: String,
    default: ''
  },
  type: {
    type: String,
    default: 'text'
  }
})
defineEmits(['update:modelValue'])

const isVisible = ref(false)
const inputType = computed(() => {
  if (props.type === 'password') {
    return isVisible.value ? 'text' : 'password'
  }
  return props.type
})

const toggleVisibility = () => {
  isVisible.value = !isVisible.value
}
</script>
