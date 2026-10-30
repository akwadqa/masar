<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { frappeLoginUrl } from '~/utils/redirect'

defineProps<{ collapsed?: boolean }>()

const { user, clear } = useSession()
const preferences = usePreferences()
const signingOut = ref(false)

async function signOut() {
  signingOut.value = true
  try {
    // Frappe's logout endpoint (v1 envelope); invalidates the server session.
    await $fetch('/api/method/logout', {
      method: 'POST',
      baseURL: SITE_ROOT,
      credentials: 'same-origin',
      headers: { 'X-Frappe-CSRF-Token': user.value?.csrfToken ?? '' }
    })
  } catch {
    // Even if the request fails, local state is cleared and Frappe's login page re-checks the session.
  }
  try {
    for (const key of Object.keys(sessionStorage)) if (key.startsWith('masar:')) sessionStorage.removeItem(key)
  } catch { /* storage unavailable */ }
  clear()
  preferences.reset()
  clearNuxtData()
  // Frappe's login page; signing in again returns to Masar.
  await navigateTo(frappeLoginUrl(useRouter().resolve('/').href), { external: true, replace: true })
  signingOut.value = false
}

const items = computed<DropdownMenuItem[][]>(() => {
  const groups: DropdownMenuItem[][] = [[{ type: 'label', label: user.value?.fullName ?? '', avatar: { src: user.value?.userImage ?? undefined, alt: user.value?.fullName } }]]
  if (user.value?.hasDeskAccess) {
    // Desk is a separate Frappe interface reserved for company administrators.
    groups.push([{ label: 'Administration (Desk)', icon: 'i-lucide-shield', to: '/desk', external: true, target: '_self' }])
  }
  // Design theme and light/dark appearance are separate personal settings (client revision).
  groups.push([{
    label: 'Design theme',
    icon: 'i-lucide-palette',
    children: [DESIGN_THEMES.map(theme => ({
      label: theme.label,
      description: theme.description,
      type: 'checkbox' as const,
      checked: preferences.theme.value === theme.value,
      onSelect: (event: Event) => { event.preventDefault(); preferences.setTheme(theme.value) }
    }))]
  }, {
    label: 'Appearance',
    icon: APPEARANCES.find(mode => mode.value === preferences.appearance.value)?.icon ?? 'i-lucide-monitor',
    children: [APPEARANCES.map(mode => ({
      label: mode.label,
      icon: mode.icon,
      type: 'checkbox' as const,
      checked: preferences.appearance.value === mode.value,
      onSelect: (event: Event) => { event.preventDefault(); preferences.setAppearance(mode.value) }
    }))]
  }, {
    // Boxed pages (Task details, Feature, Release, settings) can use the whole window (client revision 2).
    label: 'Full-width pages',
    icon: 'i-lucide-move-horizontal',
    type: 'checkbox' as const,
    checked: preferences.fullWidth.value,
    onSelect: (event: Event) => { event.preventDefault(); preferences.toggleFullWidth() }
  }])
  groups.push([{ label: 'Sign out', icon: 'i-lucide-log-out', onSelect: signOut, disabled: signingOut.value }])
  return groups
})
</script>

<template>
  <UDropdownMenu :items="items" :content="{ align: 'start', side: 'top' }" :ui="{ content: 'w-60' }">
    <UButton
      color="neutral"
      variant="ghost"
      block
      :square="collapsed"
      :label="collapsed ? undefined : user?.fullName"
      :avatar="{ src: user?.userImage ?? undefined, alt: user?.fullName }"
      :trailing-icon="collapsed ? undefined : 'i-lucide-chevrons-up-down'"
      class="data-[state=open]:bg-elevated"
      :class="collapsed ? 'justify-center' : ''"
      :ui="{ trailingIcon: 'text-dimmed ms-auto' }"
      :aria-label="user?.fullName ? `${user.fullName}, account menu` : 'Account menu'"
    />
  </UDropdownMenu>
</template>
