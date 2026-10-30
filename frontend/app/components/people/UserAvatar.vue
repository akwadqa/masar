<script setup lang="ts">
import { avatarStyle } from '~/utils/userColor'

// A person's avatar with their own soft colour (client revisions 2 and 3): photo when there is one, otherwise
// initials on a colour that stays the same for that person everywhere.
defineProps<{ user: { name: string, fullName: string, image?: string | null } | null | undefined, size?: '3xs' | '2xs' | 'xs' | 'sm' | 'md' | 'lg' }>()
</script>

<template>
  <UAvatar
    :src="user?.image ?? undefined"
    :alt="user?.fullName ?? '?'"
    :size="size"
    :class="user?.image ? undefined : 'masar-avatar'"
    :style="user?.image ? undefined : avatarStyle(user?.name)"
  />
</template>
