<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Button, Combobox, debounce, useCall } from 'frappe-ui'

// Search dropdown for report filters: the typed text searches `url`, the picked value is the model.
// `url` must return `[{ value, label, description }]` for a `txt` param.
interface Option {
  value: string
  label: string
  description?: string
}

const props = defineProps<{
  label: string
  placeholder?: string
  url: string
  // Extra params sent with every search, for example the picked company.
  params?: Record<string, string>
}>()

const model = defineModel<string>({ default: '' })

const query = ref('')
const search = ref('')
const picked = ref<Option | null>(null)
watch(
  query,
  debounce((txt: string) => (search.value = txt), 300),
)
watch(model, (value) => {
  if (!value) picked.value = null
})

const results = useCall<Option[], Record<string, string>>({
  url: props.url,
  params: () => ({ txt: search.value, ...props.params }),
  refetch: true,
})

// Keep the picked option in the list so the box still shows its label after the results change.
const options = computed(() => {
  const list = results.data ?? []
  const current = picked.value
  return current && !list.some((o) => o.value === current.value) ? [current, ...list] : list
})

function onOpen(open: boolean) {
  if (open) query.value = ''
}

function clear() {
  model.value = ''
  query.value = ''
}
</script>

<template>
  <div class="flex items-end gap-1">
    <Combobox
      v-model="model"
      v-model:query="query"
      :label="label"
      :placeholder="placeholder"
      :options="options"
      :loading="results.loading"
      :filterable="false"
      open-on-focus
      class="w-56"
      @update:open="onOpen"
      @update:selected-option="(option) => (picked = option as Option | null)"
    />
    <Button
      v-if="model"
      icon="lucide-x"
      variant="ghost"
      :aria-label="`Clear ${label}`"
      @click="clear"
    />
  </div>
</template>
