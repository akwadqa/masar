<script setup lang="ts">
import type { EditorToolbarItem } from '@nuxt/ui'
import type { Editor } from '@tiptap/vue-3'

// Task description as rich text stored as Markdown (client revision 2): the same editor as comments,
// with Markdown shortcuts (**bold**, - lists, # headings, `code`). The server keeps Markdown and
// removes any raw HTML. Changes are saved when the editor loses focus.
const props = defineProps<{ value: string | null, editable: boolean }>()
const emit = defineEmits<{ save: [markdown: string | null] }>()

const markdown = ref(props.value ?? '')
const focused = ref(false)
// Follow the server value except while the user is writing.
watch(() => props.value, (value) => { if (!focused.value) markdown.value = value ?? '' })

const toolbar: EditorToolbarItem[][] = [
  [
    { kind: 'heading', level: 3, icon: 'i-lucide-heading', tooltip: { text: 'Heading' }, 'aria-label': 'Heading' },
    { kind: 'mark', mark: 'bold', icon: 'i-lucide-bold', tooltip: { text: 'Bold' }, 'aria-label': 'Bold' },
    { kind: 'mark', mark: 'italic', icon: 'i-lucide-italic', tooltip: { text: 'Italic' }, 'aria-label': 'Italic' },
    { kind: 'mark', mark: 'strike', icon: 'i-lucide-strikethrough', tooltip: { text: 'Strikethrough' }, 'aria-label': 'Strikethrough' },
    { kind: 'mark', mark: 'code', icon: 'i-lucide-code', tooltip: { text: 'Inline code' }, 'aria-label': 'Inline code' }
  ],
  [
    { kind: 'bulletList', icon: 'i-lucide-list', tooltip: { text: 'Bullet list' }, 'aria-label': 'Bullet list' },
    { kind: 'orderedList', icon: 'i-lucide-list-ordered', tooltip: { text: 'Numbered list' }, 'aria-label': 'Numbered list' },
    { kind: 'blockquote', icon: 'i-lucide-text-quote', tooltip: { text: 'Quote' }, 'aria-label': 'Quote' },
    { kind: 'codeBlock', icon: 'i-lucide-square-code', tooltip: { text: 'Code block' }, 'aria-label': 'Code block' }
  ],
  [{ slot: 'link', icon: 'i-lucide-link', 'aria-label': 'Link' }]
]

const linkOpen = ref(false)
const linkUrl = ref('')
function applyLink(editor: Editor) {
  const href = linkUrl.value.trim()
  linkOpen.value = false
  if (!href) return void editor.chain().focus().unsetLink().run()
  const safe = /^(https?:|mailto:)/i.test(href) ? href : `https://${href}`
  editor.chain().focus().extendMarkRange('link').setLink({ href: safe }).run()
  linkUrl.value = ''
}
// Toolbar buttons keep the editor focused (see CommentComposer); the link button needs focus.
function keepEditorFocus(event: MouseEvent) {
  const button = (event.target as HTMLElement).closest('button')
  if (button && button.getAttribute('aria-label') !== 'Add link') event.preventDefault()
}

function onFocusOut(event: FocusEvent) {
  // Moving focus to the toolbar or the link popover stays inside the description.
  const next = event.relatedTarget as HTMLElement | null
  if (next && (event.currentTarget as HTMLElement).contains(next)) return
  if (linkOpen.value) return
  focused.value = false
  const value = markdown.value.trim()
  if (value !== (props.value ?? '').trim()) emit('save', value || null)
}
</script>

<template>
  <section class="space-y-2" aria-labelledby="description-heading">
    <h3 id="description-heading" class="text-section text-highlighted">Description</h3>
    <div
      class="rounded-card border bg-default transition-colors"
      :class="editable ? 'border-default focus-within:border-primary hover:border-accented' : 'border-transparent'"
      @focusin="focused = true"
      @focusout="onFocusOut"
    >
      <UEditor
        v-slot="{ editor }"
        v-model="markdown"
        content-type="markdown"
        :editable="editable"
        :placeholder="editable ? 'Add more detail… Markdown works: **bold**, - lists, # headings' : 'No description.'"
        :ui="{ base: 'px-4 sm:px-4 py-3 text-sm min-h-28 *:my-1.5 [&_p]:leading-6 [&_h3]:text-base [&_h3]:font-semibold [&_pre]:rounded-md [&_pre]:bg-elevated [&_pre]:p-3 [&_blockquote]:border-s-2 [&_blockquote]:border-accented [&_blockquote]:ps-3 [&_blockquote]:text-muted' }"
        aria-label="Description"
        data-testid="task-description"
      >
        <!-- The toolbar groups wrap only when the toolbar (20rem) would stand past the row's end padding,
             i.e. a content box under 19.5rem (QA-D09): on a 320 px phone "Add link" stood past the editor's edge. -->
        <div v-if="editable" class="@container flex flex-wrap items-center gap-1 border-t border-default px-2 py-1.5">
          <UEditorToolbar :editor="editor" :items="toolbar" size="sm" :ui="{ base: '@max-[19.5rem]:flex-wrap' }" @mousedown="keepEditorFocus">
            <template #link>
              <UPopover v-model:open="linkOpen">
                <UButton icon="i-lucide-link" color="neutral" variant="ghost" size="sm" square aria-label="Add link" :class="editor.isActive('link') ? 'bg-elevated' : ''" />
                <template #content>
                  <form class="flex items-center gap-2 p-2" @submit.prevent="applyLink(editor)">
                    <UInput v-model="linkUrl" placeholder="https://…" aria-label="Link address" autofocus />
                    <UButton type="submit" label="Apply" />
                  </form>
                </template>
              </UPopover>
            </template>
          </UEditorToolbar>
        </div>
      </UEditor>
    </div>
  </section>
</template>
