<script setup lang="ts">
import type { CalendarDate } from '@internationalized/date'
import { formatLongDate } from '~/utils/format'

// Date field with a calendar (client revision 3): a button showing the date opens a month calendar.
// The value is a CalendarDate (same model as UInputDate), so callers keep their conversions.
const model = defineModel<CalendarDate | null | undefined>({ default: null })
const props = defineProps<{
  placeholder?: string
  minValue?: CalendarDate
  maxValue?: CalendarDate
  disabled?: boolean
  /** Shows "Clear" in the calendar (optional dates) */
  clearable?: boolean
}>()
const open = ref(false)
const label = computed(() => (model.value ? formatLongDate(model.value.toString()) : (props.placeholder ?? 'Choose a date')))
// The field's name followed by what the button shows, e.g. "Completion date: Choose a date" (QA-D10).
const attrs = useAttrs()
const accessibleName = computed(() => (attrs['aria-label'] ? `${attrs['aria-label']}: ${label.value}` : undefined))

function choose(value: CalendarDate | null | undefined) {
  model.value = value ?? null
  open.value = false
}
</script>

<template>
  <UPopover v-model:open="open" :disabled="disabled" :content="{ align: 'start' }">
    <UButton
      color="neutral"
      variant="outline"
      icon="i-lucide-calendar"
      trailing-icon="i-lucide-chevron-down"
      :disabled="disabled"
      class="justify-start font-normal"
      :class="model ? 'text-highlighted' : 'text-dimmed'"
      :ui="{ trailingIcon: 'ms-auto text-dimmed' }"
      v-bind="$attrs"
      :aria-label="accessibleName"
    >
      {{ label }}
    </UButton>
    <template #content>
      <div class="p-2">
        <UCalendar
          :model-value="model ?? undefined"
          :min-value="minValue"
          :max-value="maxValue"
          @update:model-value="(value) => choose(value as CalendarDate | undefined)"
        />
        <UButton v-if="clearable && model" block color="neutral" variant="ghost" label="Clear date" class="mt-1" @click="choose(null)" />
      </div>
    </template>
  </UPopover>
</template>
