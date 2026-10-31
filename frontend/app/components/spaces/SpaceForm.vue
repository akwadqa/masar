<script setup lang="ts">
import { parseDate, type CalendarDate } from '@internationalized/date'
import type { EditorToolbarItem, FormError } from '@nuxt/ui'
import { SPACE_TYPES, type SpaceType, type UserRef } from '~/types/api'

export interface SpaceFormState {
  title: string
  category: string
  owner?: string
  spaceType: SpaceType
  completionDate: string | null
  gameplanUrl: string
  details: string
}

// Shared fields for creating a Space and editing its details. `withOwner` adds the owner picker.
const props = defineProps<{ withOwner?: boolean, ownerInitial?: UserRef | null, submitLabel: string, pending?: boolean }>()
const state = defineModel<SpaceFormState>({ required: true })
const emit = defineEmits<{ submit: [], cancel: [] }>()

function validate(value: SpaceFormState): FormError[] {
  const errors: FormError[] = []
  if (!value.title.trim()) errors.push({ name: 'title', message: 'Enter a title.' })
  if (value.title.length > 140) errors.push({ name: 'title', message: 'Use at most 140 characters.' })
  if (props.withOwner && !value.owner) errors.push({ name: 'owner', message: 'Choose the Space owner.' })
  if (value.gameplanUrl.trim() && !/^https:\/\/\S+$/.test(value.gameplanUrl.trim())) {
    errors.push({ name: 'gameplanUrl', message: 'Use a full https:// link.' })
  }
  return errors
}

const completionDate = computed<CalendarDate | null>({
  get: () => (state.value.completionDate ? parseDate(state.value.completionDate) : null),
  set: (value) => { state.value.completionDate = value ? value.toString() : null }
})
const typeItems = SPACE_TYPES.map(value => ({ label: value, value }))
// The Task description toolbar, without links (Markdown links can be typed).
const detailsToolbar: EditorToolbarItem[][] = [
  [
    { kind: 'heading', level: 3, icon: 'i-lucide-heading', tooltip: { text: 'Heading' }, 'aria-label': 'Heading' },
    { kind: 'mark', mark: 'bold', icon: 'i-lucide-bold', tooltip: { text: 'Bold' }, 'aria-label': 'Bold' },
    { kind: 'mark', mark: 'italic', icon: 'i-lucide-italic', tooltip: { text: 'Italic' }, 'aria-label': 'Italic' },
    { kind: 'mark', mark: 'code', icon: 'i-lucide-code', tooltip: { text: 'Inline code' }, 'aria-label': 'Inline code' }
  ],
  [
    { kind: 'bulletList', icon: 'i-lucide-list', tooltip: { text: 'Bullet list' }, 'aria-label': 'Bullet list' },
    { kind: 'orderedList', icon: 'i-lucide-list-ordered', tooltip: { text: 'Numbered list' }, 'aria-label': 'Numbered list' },
    { kind: 'blockquote', icon: 'i-lucide-text-quote', tooltip: { text: 'Quote' }, 'aria-label': 'Quote' },
    { kind: 'codeBlock', icon: 'i-lucide-square-code', tooltip: { text: 'Code block' }, 'aria-label': 'Code block' }
  ]
]
</script>

<template>
  <UForm :state="state" :validate="validate" class="space-y-4" @submit="emit('submit')">
    <UFormField label="Title" name="title" required>
      <UInput v-model="state.title" placeholder="e.g. ERP Core Platform" class="w-full" maxlength="140" :autofocus="withOwner" />
    </UFormField>

    <UFormField v-if="withOwner" label="Owner" name="owner" required help="The owner becomes the first Space Manager.">
      <UserPicker v-model="state.owner" :initial="ownerInitial" placeholder="Choose the owner" aria-label="Owner" />
    </UFormField>

    <div class="grid gap-4 sm:grid-cols-2">
      <UFormField label="Category" name="category">
        <SpaceCategoryInput v-model="state.category" />
      </UFormField>
      <UFormField label="Completion date" name="completionDate">
        <DatePicker v-model="completionDate" clearable class="w-full" aria-label="Completion date" />
      </UFormField>
      <UFormField label="Type" name="spaceType" required>
        <USelect v-model="state.spaceType" :items="typeItems" class="w-full" aria-label="Type" />
      </UFormField>
    </div>

    <UFormField label="Gameplan link" name="gameplanUrl" help="A link only. Masar does not sync with Gameplan.">
      <UInput v-model="state.gameplanUrl" type="url" placeholder="https://" class="w-full" icon="i-lucide-link" />
    </UFormField>

    <!-- Markdown, edited with the same editor as Task descriptions (the server keeps Markdown, no HTML). -->
    <UFormField label="Details" name="details">
      <div class="rounded-md border border-default focus-within:border-primary">
        <UEditor
          v-slot="{ editor }"
          v-model="state.details"
          content-type="markdown"
          placeholder="What is this Space about? Markdown works: **bold**, - lists, # headings"
          :ui="{ base: 'px-3 py-2 text-sm min-h-24 *:my-1.5 [&_p]:leading-6 [&_h3]:text-base [&_h3]:font-semibold [&_pre]:rounded-md [&_pre]:bg-elevated [&_pre]:p-3 [&_blockquote]:border-s-2 [&_blockquote]:border-accented [&_blockquote]:ps-3 [&_blockquote]:text-muted' }"
          aria-label="Details"
        >
          <div class="flex flex-wrap items-center gap-1 border-t border-default px-2 py-1.5">
            <UEditorToolbar :editor="editor" :items="detailsToolbar" size="sm" @mousedown.prevent />
          </div>
        </UEditor>
      </div>
    </UFormField>

    <div class="flex justify-end gap-2 pt-2">
      <UButton color="neutral" variant="outline" label="Cancel" @click="emit('cancel')" />
      <UButton type="submit" :label="submitLabel" :loading="pending" />
    </div>
  </UForm>
</template>
