<script setup lang="ts">
import type { EditorEmojiMenuItem, EditorMentionMenuItem, EditorToolbarItem } from '@nuxt/ui'
import type { MentionOptions } from '@tiptap/extension-mention'
import type { Editor } from '@tiptap/vue-3'
import type { AttachmentRef, TaskComment } from '~/types/api'
import type { MasarApiError } from '~/utils/apiError'
import { nameUploadedFile, transferFiles } from '~/utils/transferFiles'

// Rich-text composer for new comments and edits (ADR-052). The server sanitises everything; this
// component only produces HTML, keeps drafts and uploads pasted or dropped files.
const props = defineProps<{ task: string, comment?: TaskComment, autofocus?: boolean }>()
const emit = defineEmits<{ saved: [comment: TaskComment], cancel: [] }>()

const editing = computed(() => !!props.comment)
const draftKey = computed(() => `masar:comment-draft:${props.task}`)
const html = ref(props.comment?.content ?? '')
// Composer uploads that this comment will reference (images are also inserted inline).
const files = ref<AttachmentRef[]>([])
const uploading = ref<Array<{ id: string, name: string, percent: number }>>([])
const error = ref<string | null>(null)
const { create, update } = useCommentMutations()
const toast = useToast()
let requestId: string = crypto.randomUUID()

// ---- drafts: text, uploads and the request id survive closing the panel, reloads and failed sends
interface Draft { html: string, files: AttachmentRef[], requestId: string }
function readDraft(): Draft | null {
  try { return JSON.parse(localStorage.getItem(draftKey.value) ?? 'null') as Draft | null } catch { return null }
}
function writeDraft() {
  if (editing.value) return
  try {
    if (isEmpty(html.value) && !files.value.length) localStorage.removeItem(draftKey.value)
    else localStorage.setItem(draftKey.value, JSON.stringify({ html: html.value, files: files.value, requestId }))
  } catch { /* storage unavailable: the draft lives only in memory */ }
}
onMounted(() => {
  const draft = editing.value ? null : readDraft()
  if (draft) {
    html.value = draft.html
    files.value = draft.files ?? []
    requestId = draft.requestId ?? requestId
  }
})
let draftTimer: ReturnType<typeof setTimeout> | undefined
watch([html, files], () => {
  clearTimeout(draftTimer)
  draftTimer = setTimeout(writeDraft, 300)
}, { deep: true })
onBeforeUnmount(() => {
  clearTimeout(draftTimer)
  writeDraft()
})

function isEmpty(value: string) {
  return !value.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() && !/<img/i.test(value)
}

// ---- mentions: current members of the Task's Space only (server-provided)
const mentionTerm = ref('')
const mentionItems = ref<EditorMentionMenuItem[]>([])
watch(mentionTerm, async (term) => {
  try {
    const users = await fetchMentionCandidates(props.task, term)
    mentionItems.value = users.map(u => ({ id: u.name, label: u.fullName, avatar: { src: u.image ?? undefined, alt: u.fullName } }))
  } catch {
    mentionItems.value = []
  }
}, { immediate: true })
// Nuxt UI's default mention markup drops the user id; store it so mentions stay tied to the account.
const mentionOptions: Partial<Omit<MentionOptions, 'suggestion' | 'suggestions'>> = {
  renderHTML({ node }) {
    return ['span', { 'data-type': 'mention', 'class': 'mention', 'data-id': node.attrs.id ?? '', 'data-label': node.attrs.label ?? '' }, `@${node.attrs.label ?? node.attrs.id}`]
  }
}

const emojiItems: EditorEmojiMenuItem[] = [
  ['thumbsup', '👍', ['+1', 'like']], ['heart', '❤️', ['love']], ['tada', '🎉', ['party', 'celebrate']],
  ['smile', '😄', ['happy']], ['eyes', '👀', ['look']], ['white_check_mark', '✅', ['done', 'check']],
  ['rocket', '🚀', ['ship', 'launch']], ['fire', '🔥', ['hot']], ['thinking', '🤔', ['hmm']],
  ['pray', '🙏', ['thanks', 'please']], ['clap', '👏', ['bravo']], ['warning', '⚠️', ['caution']],
  ['bug', '🐛', ['defect']], ['bulb', '💡', ['idea']], ['wave', '👋', ['hello']], ['ok_hand', '👌', ['ok']]
].map(([name, emoji, tags]) => ({ name: name as string, emoji: emoji as string, shortcodes: [name as string], tags: tags as string[] }))

const toolbar: EditorToolbarItem[][] = [
  [
    { kind: 'mark', mark: 'bold', icon: 'i-lucide-bold', tooltip: { text: 'Bold' }, 'aria-label': 'Bold' },
    { kind: 'mark', mark: 'italic', icon: 'i-lucide-italic', tooltip: { text: 'Italic' }, 'aria-label': 'Italic' },
    { kind: 'mark', mark: 'strike', icon: 'i-lucide-strikethrough', tooltip: { text: 'Strikethrough' }, 'aria-label': 'Strikethrough' },
    { kind: 'mark', mark: 'code', icon: 'i-lucide-code', tooltip: { text: 'Inline code' }, 'aria-label': 'Inline code' }
  ],
  [
    { kind: 'bulletList', icon: 'i-lucide-list', tooltip: { text: 'Bullet list' }, 'aria-label': 'Bullet list' },
    { kind: 'orderedList', icon: 'i-lucide-list-ordered', tooltip: { text: 'Numbered list' }, 'aria-label': 'Numbered list' }
  ],
  [{ slot: 'link', icon: 'i-lucide-link', 'aria-label': 'Link' }]
]

// ---- links without window.prompt
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

// ---- paste / drop uploads (composer files are bound to the comment when it is posted)
const editorComponent = ref<{ editor?: Editor | { value?: Editor } } | null>(null)
// UEditor exposes its TipTap instance (a shallow ref unwrapped by the component proxy).
const tiptap = (): Editor | null => {
  const exposed = editorComponent.value?.editor as Editor | { value?: Editor } | undefined
  return (exposed && 'value' in exposed ? exposed.value : exposed as Editor | undefined) ?? null
}
async function uploadFiles(list: File[]) {
  for (const file of list) {
    const id = crypto.randomUUID()
    const named = nameUploadedFile(file)
    uploading.value = [...uploading.value, { id, name: named.name, percent: 0 }]
    try {
      const stored = await uploadAttachment(props.task, named, 'Comment', (percent) => {
        uploading.value = uploading.value.map(u => (u.id === id ? { ...u, percent } : u))
      })
      files.value = [...files.value, stored]
      if (stored.isImage) tiptap()?.chain().focus().setImage({ src: stored.url, alt: stored.fileName }).run()
    } catch (caught) {
      toast.add({ title: `${file.name || 'The file'} could not be uploaded`, description: (caught as Error).message, color: 'error', icon: 'i-lucide-circle-alert' })
    } finally {
      uploading.value = uploading.value.filter(u => u.id !== id)
    }
  }
}
const editorProps = {
  handlePaste: (_view: unknown, event: ClipboardEvent) => {
    const pasted = transferFiles(event.clipboardData)
    if (!pasted.length || editing.value) return false
    void uploadFiles(pasted)
    return true
  },
  handleDrop: (_view: unknown, event: DragEvent) => {
    const dropped = transferFiles(event.dataTransfer)
    if (!dropped.length || editing.value) return false
    event.preventDefault()
    void uploadFiles(dropped)
    return true
  }
}
const picker = ref<HTMLInputElement | null>(null)
function removeFile(file: AttachmentRef) {
  files.value = files.value.filter(f => f.name !== file.name)
  tiptap()?.commands.setContent(html.value.replace(new RegExp(`<img[^>]*src="${file.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`, 'g'), ''))
}

// Formatting buttons must not take focus from the editor (otherwise, e.g. after toggling bold off,
// the next keystrokes land on the button): suppress focus on mouse down, as rich-text toolbars do.
// Keyboard users still Tab to the buttons. The link and attach buttons need focus and are exempt.
function keepEditorFocus(event: MouseEvent) {
  const button = (event.target as HTMLElement).closest('button')
  if (button && !['Add link', 'Attach files'].includes(button.getAttribute('aria-label') ?? '')) event.preventDefault()
}

// ---- submit
const pending = computed(() => create.pending.value || update.pending.value)
async function submit() {
  error.value = null
  if (uploading.value.length) return void (error.value = 'Wait for the uploads to finish.')
  if (isEmpty(html.value)) return void (error.value = 'Write something first.')
  try {
    if (props.comment) {
      emit('saved', await update.execute({ comment: props.comment, content: html.value }))
      return
    }
    const result = await create.execute({ task: props.task, content: html.value, clientRequestId: requestId, attachments: files.value.map(f => f.name) })
    html.value = ''
    files.value = []
    requestId = crypto.randomUUID()
    try { localStorage.removeItem(draftKey.value) } catch { /* ignore */ }
    tiptap()?.commands.clearContent()
    emit('saved', result.comment)
  } catch (caught) {
    const apiError = caught as MasarApiError
    // The draft (and its request id) is kept: sending again cannot create a second comment.
    error.value = apiError.kind === 'conflict'
      ? 'This comment was changed elsewhere. Copy your text, cancel, and edit the latest version.'
      : apiError.message
  }
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault()
    void submit()
  } else if (event.key === 'Escape' && editing.value) {
    emit('cancel')
  }
}
</script>

<template>
  <div class="rounded-lg border border-default bg-default focus-within:border-primary" @keydown="onKeydown">
    <UEditor
      ref="editorComponent"
      v-slot="{ editor }"
      v-model="html"
      content-type="html"
      :mention="mentionOptions"
      :editor-props="editorProps"
      :autofocus="autofocus ? 'end' : false"
      :placeholder="editing ? 'Edit your comment…' : 'Write a comment… Use @ to mention, : for emoji, paste images'"
      class="min-h-20"
      :ui="{ base: 'px-3 sm:px-3 py-2 text-sm min-h-20 max-h-80 overflow-y-auto *:my-1 [&_p]:leading-6 [&_img]:max-h-48 [&_img]:rounded-md' }"
      aria-label="Comment"
      data-testid="comment-editor"
    >
      <UEditorMentionMenu v-model:search-term="mentionTerm" :editor="editor" :items="mentionItems" ignore-filter :limit="8" />
      <UEditorEmojiMenu :editor="editor" :items="emojiItems" :limit="8" />
      <div class="flex flex-wrap items-center gap-1 border-t border-default px-2 py-1.5">
        <UEditorToolbar :editor="editor" :items="toolbar" size="xs" @mousedown="keepEditorFocus">
          <template #link>
            <UPopover v-model:open="linkOpen">
              <UButton icon="i-lucide-link" color="neutral" variant="ghost" size="xs" square aria-label="Add link" :class="editor.isActive('link') ? 'bg-elevated' : ''" />
              <template #content>
                <form class="flex items-center gap-2 p-2" @submit.prevent="applyLink(editor)">
                  <UInput v-model="linkUrl" placeholder="https://…" size="sm" aria-label="Link address" autofocus />
                  <UButton type="submit" size="sm" label="Apply" />
                </form>
              </template>
            </UPopover>
          </template>
        </UEditorToolbar>
        <template v-if="!editing">
          <input ref="picker" type="file" multiple class="hidden" aria-hidden="true" @change="uploadFiles([...(($event.target as HTMLInputElement).files ?? [])]); ($event.target as HTMLInputElement).value = ''">
          <UButton icon="i-lucide-paperclip" color="neutral" variant="ghost" size="xs" square aria-label="Attach files" @click="picker?.click()" />
        </template>
        <div class="ms-auto flex items-center gap-2">
          <span class="hidden text-xs text-dimmed sm:inline"><UKbd value="meta" size="sm" /> <UKbd value="enter" size="sm" /></span>
          <UButton v-if="editing" color="neutral" variant="ghost" size="sm" label="Cancel" @click="emit('cancel')" />
          <UButton size="sm" :label="editing ? 'Save' : 'Comment'" :loading="pending" :disabled="!!uploading.length" @click="submit" />
        </div>
      </div>
    </UEditor>
    <div v-if="uploading.length || files.length" class="flex flex-wrap gap-2 border-t border-default px-3 py-2" aria-live="polite">
      <UBadge v-for="u in uploading" :key="u.id" color="neutral" variant="subtle" icon="i-lucide-loader-circle" :label="`${u.name} ${u.percent}%`" :ui="{ leadingIcon: 'animate-spin' }" />
      <UBadge v-for="f in files" :key="f.name" color="neutral" variant="outline" :icon="f.isImage ? 'i-lucide-image' : 'i-lucide-file'">
        {{ f.fileName }}
        <UButton icon="i-lucide-x" color="neutral" variant="link" size="xs" square :aria-label="`Remove ${f.fileName}`" @click="removeFile(f)" />
      </UBadge>
    </div>
    <p v-if="error" class="px-3 pb-2 text-sm text-error" role="alert">{{ error }}</p>
  </div>
</template>
