<script setup lang="ts">
import type { ReactionKey, TaskComment } from '~/types/api'
import { REACTIONS } from '~/types/api'
import { formatDateTime, formatRelative } from '~/utils/format'

// One comment: author, time, sanitised content (server-side, ADR-052), files, reactions and actions.
// The user's own comments sit on the right in a primary-tinted bubble with a "You" label (client
// revision 2), so they are told apart by position, colour and text. The time reads relatively
// ("3 hours ago") with the exact time on hover; `now` comes from the timeline's single clock.
const props = defineProps<{ comment: TaskComment, highlighted?: boolean, now?: Date }>()
const emit = defineEmits<{ changed: [comment: TaskComment] }>()
const { remove, react } = useCommentMutations()
const { user } = useSession()
const editing = ref(false)
const confirmDelete = ref(false)
const emoji = (key: ReactionKey) => REACTIONS.find(r => r.key === key)?.emoji ?? key

const copyLink = useCopyLink()

async function toggle(key: ReactionKey) {
  const current = props.comment.reactions.find(r => r.emoji === key)
  const active = !current?.mine
  try {
    emit('changed', await react.execute({ comment: props.comment, emoji: key, active }))
  } catch { /* reported by the mutation */ }
}

async function onDelete() {
  try {
    emit('changed', await remove.execute({ comment: props.comment }))
  } finally {
    confirmDelete.value = false
  }
}
const moderating = computed(() => props.comment.author?.name !== user.value?.user)
const mine = computed(() => !!props.comment.author && props.comment.author.name === user.value?.user)
const menu = computed(() => [
  [{ label: 'Copy link', icon: 'i-lucide-link', onSelect: () => copyLink(`/tasks/${props.comment.task}?comment=${props.comment.name}`, 'Comment link copied') }],
  [
    ...(props.comment.permissions.canEdit ? [{ label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => { editing.value = true } }] : []),
    ...(props.comment.permissions.canDelete ? [{ label: moderating.value ? 'Remove (moderation)' : 'Delete', icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: () => { confirmDelete.value = true } }] : [])
  ]
].filter(group => group.length))
</script>

<template>
  <article
    :id="`comment-${comment.name}`"
    class="group flex gap-3 rounded-card px-2 py-2 transition-colors"
    :class="[highlighted ? 'bg-primary/10 ring-2 ring-primary/40' : '', mine ? 'flex-row-reverse' : '']"
    :aria-label="`Comment by ${comment.author?.fullName ?? 'a member'}${mine ? ' (you)' : ''}`"
    :data-comment="comment.name"
  >
    <UserAvatar :user="comment.author" size="sm" class="mt-0.5" />
    <div class="flex min-w-0 flex-1 flex-col" :class="mine ? 'items-end' : 'items-start'">
      <div class="flex w-full items-baseline gap-2 text-sm" :class="mine ? 'flex-row-reverse' : ''">
        <span class="font-semibold text-highlighted">{{ mine ? 'You' : comment.author?.fullName }}</span>
        <time class="text-xs text-muted" :datetime="comment.createdAt" :title="formatDateTime(comment.createdAt)">{{ formatRelative(comment.createdAt, now) }}</time>
        <span v-if="comment.editedAt && !comment.isDeleted" class="text-xs text-muted" :title="`Edited ${formatDateTime(comment.editedAt)}`">(edited)</span>
        <UDropdownMenu v-if="!comment.isDeleted" :items="menu" :content="{ align: 'end' }">
          <UButton icon="i-lucide-ellipsis" color="neutral" variant="ghost" size="xs" square :class="mine ? 'me-auto' : 'ms-auto'" class="opacity-60 group-hover:opacity-100 focus-visible:opacity-100" :aria-label="`Comment actions for ${comment.author?.fullName ?? 'comment'}`" />
        </UDropdownMenu>
      </div>

      <p v-if="comment.isDeleted" class="mt-1 w-fit rounded-2xl border border-dashed border-default px-3 py-1.5 text-sm italic text-muted">
        This comment was {{ comment.deletedBy && comment.deletedBy.name !== comment.author?.name ? `removed by ${comment.deletedBy.fullName}` : 'deleted' }}.
      </p>
      <CommentComposer v-else-if="editing" :task="comment.task" :comment="comment" autofocus class="mt-1 w-full" @saved="(c) => { editing = false; emit('changed', c) }" @cancel="editing = false" />
      <!-- eslint-disable-next-line vue/no-v-html -- server-sanitised with an allow-list (ADR-052) -->
      <div
        v-else
        class="masar-prose mt-1 w-fit max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm text-default"
        :class="mine ? 'rounded-se-sm bg-primary/12 ring-1 ring-primary/30' : 'rounded-ss-sm bg-elevated'"
        v-html="comment.content"
      />

      <div v-if="comment.attachments.length && !editing" class="mt-2 flex flex-wrap gap-2">
        <ULink v-for="file in comment.attachments.filter(f => !f.isImage || !comment.content?.includes(f.url))" :key="file.name" :href="file.url" target="_blank" class="inline-flex items-center gap-1 rounded-md border border-default px-2 py-1 text-xs hover:bg-elevated">
          <UIcon :name="file.isImage ? 'i-lucide-image' : 'i-lucide-file'" class="size-3.5" /> {{ file.fileName }}
        </ULink>
      </div>

      <div v-if="!comment.isDeleted" class="mt-1.5 flex flex-wrap items-center gap-1" role="group" aria-label="Reactions">
        <UTooltip v-for="r in comment.reactions" :key="r.emoji" :text="r.users.join(', ')">
          <UButton
            size="xs"
            :color="r.mine ? 'primary' : 'neutral'"
            :variant="r.mine ? 'soft' : 'outline'"
            :disabled="!comment.permissions.canReact"
            :aria-pressed="r.mine"
            :aria-label="`${REACTIONS.find(x => x.key === r.emoji)?.label}: ${r.count}${r.mine ? ', including you' : ''}`"
            @click="toggle(r.emoji)"
          >
            <span aria-hidden="true">{{ emoji(r.emoji) }}</span> <span class="tabular-nums">{{ r.count }}</span>
          </UButton>
        </UTooltip>
        <UPopover v-if="comment.permissions.canReact">
          <UButton icon="i-lucide-smile-plus" size="xs" color="neutral" variant="ghost" square aria-label="Add reaction" class="opacity-60 group-hover:opacity-100 focus-visible:opacity-100" />
          <template #content>
            <div class="flex gap-1 p-1" role="group" aria-label="Choose a reaction">
              <UButton v-for="r in REACTIONS" :key="r.key" size="sm" color="neutral" variant="ghost" :aria-label="r.label" @click="toggle(r.key)">
                <span aria-hidden="true" class="text-base">{{ r.emoji }}</span>
              </UButton>
            </div>
          </template>
        </UPopover>
      </div>
    </div>

    <UModal v-model:open="confirmDelete" :title="moderating ? 'Remove this comment?' : 'Delete your comment?'" :description="moderating ? 'As a Space Manager you can remove it. The text and its files are deleted; the history records who removed it.' : 'The text and its files are deleted. This cannot be undone.'">
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" label="Cancel" @click="confirmDelete = false" />
          <UButton color="error" :label="moderating ? 'Remove comment' : 'Delete comment'" :loading="remove.pending.value" @click="onDelete" />
        </div>
      </template>
    </UModal>
  </article>
</template>
