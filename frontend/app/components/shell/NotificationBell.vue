<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import type { MasarNotification, NotificationKind } from '~/types/api'
import { formatAge } from '~/utils/format'

// The bell (client revision 5): the person's notifications with read / unread state, the e-mail
// preference and push notifications for this device. `placement` tells the sidebar bell (wide screens)
// from the top-bar bell (phones and tablets), so a link like ?notifications=1 opens only the visible one.
const props = defineProps<{ placement: 'sidebar' | 'navbar' }>()

const KINDS: Record<NotificationKind, { icon: string, tone: string }> = {
  'Assigned': { icon: 'i-lucide-user-plus', tone: 'text-primary bg-primary/10' },
  'Task Owner': { icon: 'i-lucide-crown', tone: 'text-warning bg-warning/10' },
  'Overdue': { icon: 'i-lucide-alarm-clock', tone: 'text-error bg-error/10' },
  'Mention': { icon: 'i-lucide-at-sign', tone: 'text-info bg-info/10' },
  'Comment': { icon: 'i-lucide-message-square', tone: 'text-toned bg-elevated' },
  'Space Member': { icon: 'i-lucide-users', tone: 'text-success bg-success/10' },
  'Space Role': { icon: 'i-lucide-shield', tone: 'text-toned bg-elevated' },
  'Space Owner': { icon: 'i-lucide-crown', tone: 'text-warning bg-warning/10' }
}

const router = useRouter()
const route = useRoute()
const wide = useMediaQuery('(min-width: 1024px)')
const notifications = useNotifications()
const { items, unread, nextBefore, loaded, loading } = notifications
const preferences = usePreferences()
const push = usePushNotifications()
const toast = useToast()

const open = ref(false)
const view = ref<'all' | 'unread' | 'settings'>('all')
const shown = computed(() => (view.value === 'unread' ? items.value.filter(item => !item.isRead) : items.value))
const badge = computed(() => (unread.value > 99 ? '99+' : String(unread.value)))
const label = computed(() => (unread.value ? `Notifications, ${unread.value} unread` : 'Notifications'))

watch(open, (value) => {
  if (!value) return
  void notifications.load().catch(() => undefined)
  void push.check()
})

// E-mail footers and the generic push notice link to ?notifications=1: open the bell's settings.
watch(() => [route.query.notifications, wide.value] as const, ([flag, isWide]) => {
  if (flag !== '1' || isWide !== (props.placement === 'sidebar')) return
  view.value = 'settings'
  open.value = true
  const query = { ...route.query }
  delete query.notifications
  void router.replace({ query })
}, { immediate: true })

async function follow(item: MasarNotification) {
  open.value = false
  if (!item.isRead) void notifications.markRead([item.name])
  if (item.link) await router.push(item.link)
}

async function markAll() {
  try {
    await notifications.markAllRead()
  } catch {
    void notifications.load()
  }
}

async function setEmail(value: boolean) {
  try {
    await preferences.setEmailNotifications(value)
  } catch {
    toast.add({ title: 'The setting could not be saved', color: 'error', icon: 'i-lucide-cloud-off' })
  }
}

async function setPush(value: boolean) {
  try {
    await (value ? push.enable() : push.disable())
  } catch {
    toast.add({ title: 'Push notifications could not be changed', description: 'Please try again.', color: 'error', icon: 'i-lucide-bell-off' })
  }
}

// iPhones and iPads allow push notifications only for the app added to the Home Screen.
const needsHomeScreen = computed(() => import.meta.client && push.state.value === 'unsupported' && /iPhone|iPad|iPod/.test(navigator.userAgent) && !isStandalone())
</script>

<template>
  <UPopover v-model:open="open" :content="{ align: placement === 'sidebar' ? 'start' : 'end', sideOffset: 8 }" :ui="{ content: 'w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden' }">
    <!-- pointer-events-none (QA-D08): the badge lies inside the bell button's area; a tap on it now reaches the button. -->
    <UChip :show="unread > 0" :text="badge" size="3xl" color="error" inset :ui="{ base: 'pointer-events-none px-1 font-semibold tabular-nums ring-2 ring-(--ui-bg)' }">
      <UButton icon="i-lucide-bell" color="neutral" variant="ghost" square :aria-label="label" data-testid="notification-bell" />
    </UChip>

    <template #content>
      <section class="flex max-h-[min(36rem,75svh)] flex-col" aria-label="Notifications">
        <header class="flex items-center gap-2 border-b border-default px-4 py-3">
          <template v-if="view === 'settings'">
            <UButton icon="i-lucide-arrow-left" color="neutral" variant="ghost" size="sm" square aria-label="Back to notifications" @click="view = 'all'" />
            <h2 class="text-section text-highlighted">Notification settings</h2>
          </template>
          <template v-else>
            <h2 class="text-section text-highlighted">Notifications</h2>
            <UButton
              class="ms-auto"
              label="Mark all read"
              icon="i-lucide-check-check"
              color="neutral"
              variant="ghost"
              size="xs"
              :disabled="!unread"
              @click="markAll"
            />
            <UButton icon="i-lucide-settings-2" color="neutral" variant="ghost" size="sm" square aria-label="Notification settings" @click="view = 'settings'" />
          </template>
        </header>

        <div v-if="view === 'settings'" class="space-y-1 p-2">
          <label class="flex cursor-pointer items-start gap-3 rounded-md p-3 hover:bg-elevated/60">
            <UIcon name="i-lucide-mail" class="mt-0.5 size-5 shrink-0 text-muted" />
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-medium text-highlighted">E-mail notifications</span>
              <span class="block text-xs text-muted">An e-mail for each notification. The list here is kept either way.</span>
            </span>
            <USwitch :model-value="preferences.emailNotifications.value" aria-label="E-mail notifications" @update:model-value="setEmail" />
          </label>
          <label class="flex items-start gap-3 rounded-md p-3" :class="push.state.value === 'off' || push.state.value === 'on' ? 'cursor-pointer hover:bg-elevated/60' : ''">
            <UIcon name="i-lucide-smartphone" class="mt-0.5 size-5 shrink-0 text-muted" />
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-medium text-highlighted">Push notifications on this device</span>
              <span class="block text-xs text-muted">
                <template v-if="push.state.value === 'blocked'">Blocked in this browser's settings. Allow notifications for Masar there, then try again.</template>
                <template v-else-if="needsHomeScreen">On iPhone and iPad: tap Share, then “Add to Home Screen”, and open Masar from there.</template>
                <template v-else-if="push.state.value === 'unsupported'">This browser does not support push notifications.</template>
                <template v-else>Alerts on this device, even when Masar is closed.</template>
              </span>
            </span>
            <USwitch
              :model-value="push.state.value === 'on'"
              :disabled="push.state.value === 'unsupported' || push.state.value === 'blocked'"
              :loading="push.busy.value"
              aria-label="Push notifications on this device"
              @update:model-value="setPush"
            />
          </label>
        </div>

        <template v-else>
          <div class="px-4 pt-2">
            <UTabs v-model="view" :items="[{ label: 'All', value: 'all' }, { label: unread ? `Unread · ${unread}` : 'Unread', value: 'unread' }]" :content="false" size="xs" variant="link" :ui="{ trigger: 'data-[state=inactive]:text-toned' }" />
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
            <div v-if="loading && !loaded" class="space-y-2 p-4">
              <USkeleton v-for="i in 4" :key="i" class="h-14" />
            </div>
            <div v-else-if="!shown.length" class="flex flex-col items-center gap-2 px-6 py-12 text-center">
              <span class="grid size-11 place-items-center rounded-full bg-elevated text-muted">
                <UIcon name="i-lucide-bell-off" class="size-5" />
              </span>
              <p class="text-sm font-medium text-highlighted">{{ view === 'unread' ? 'You’re all caught up' : 'No notifications yet' }}</p>
              <p class="text-xs text-muted">Assignments, mentions, overdue tasks and Space changes appear here.</p>
            </div>
            <ul v-else>
              <li v-for="item in shown" :key="item.name" class="group relative">
                <button
                  type="button"
                  class="flex w-full items-start gap-3 px-4 py-3 text-start transition-colors hover:bg-elevated/60 focus-visible:bg-elevated/60 focus-visible:outline-none"
                  :data-unread="!item.isRead || undefined"
                  @click="follow(item)"
                >
                  <span class="relative shrink-0">
                    <UserAvatar v-if="item.actor" :user="item.actor" size="md" />
                    <span v-else class="grid size-8 place-items-center rounded-full" :class="KINDS[item.kind].tone">
                      <UIcon :name="KINDS[item.kind].icon" class="size-4" />
                    </span>
                    <span v-if="item.actor" class="absolute -bottom-1 -end-1 grid size-4.5 place-items-center rounded-full ring-2 ring-(--ui-bg)" :class="KINDS[item.kind].tone">
                      <UIcon :name="KINDS[item.kind].icon" class="size-2.5" />
                    </span>
                  </span>
                  <span class="min-w-0 flex-1 pe-6">
                    <span class="block text-sm leading-snug" :class="item.isRead ? 'text-toned' : 'font-medium text-highlighted'">{{ item.subject }}</span>
                    <span v-if="item.detail" class="mt-0.5 line-clamp-2 block text-xs text-muted">{{ item.detail }}</span>
                    <time class="mt-1 block text-xs text-dimmed" :datetime="item.at">{{ formatAge(item.at) }}</time>
                  </span>
                </button>
                <span v-if="!item.isRead" class="pointer-events-none absolute end-4 top-4 size-2 rounded-full bg-primary group-hover:opacity-0 group-focus-within:opacity-0" aria-hidden="true" />
                <UTooltip :text="item.isRead ? 'Mark as unread' : 'Mark as read'">
                  <UButton
                    class="absolute end-2 top-2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 max-lg:hidden"
                    :icon="item.isRead ? 'i-lucide-mail' : 'i-lucide-mail-open'"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    square
                    :aria-label="item.isRead ? 'Mark as unread' : 'Mark as read'"
                    @click.stop="notifications.markRead([item.name], !item.isRead)"
                  />
                </UTooltip>
              </li>
            </ul>
            <div v-if="nextBefore && view === 'all'" class="px-4 py-2">
              <UButton block color="neutral" variant="ghost" size="sm" label="Show older" :loading="loading" @click="notifications.load(true)" />
            </div>
          </div>
        </template>
      </section>
    </template>
  </UPopover>
</template>
