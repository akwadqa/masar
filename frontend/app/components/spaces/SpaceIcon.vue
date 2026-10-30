<script setup lang="ts">
import type { SpaceIconColor } from '~/types/api'
import { spaceIconColor, spaceIconName } from '~/utils/spaceIdentity'

// Decorative Space identity (icon on a subtle tint); the Space title is always shown or announced next to it.
const props = withDefaults(defineProps<{
  space: { name: string, icon?: string | null, iconColor?: SpaceIconColor | null }
  size?: 'xs' | 'sm' | 'md' | 'lg'
}>(), { size: 'sm' })

const sizes = {
  xs: { box: 'size-4 rounded', icon: 'size-2.5' },
  sm: { box: 'size-5 rounded-md', icon: 'size-3' },
  md: { box: 'size-7 rounded-lg', icon: 'size-4' },
  lg: { box: 'size-10 rounded-xl', icon: 'size-5' }
}
const color = computed(() => `var(--masar-space-${spaceIconColor(props.space)})`)
</script>

<template>
  <span
    class="inline-grid shrink-0 place-items-center"
    :class="sizes[size].box"
    :style="{ color, backgroundColor: `color-mix(in oklab, ${color} 14%, transparent)` }"
    aria-hidden="true"
  >
    <UIcon :name="`i-lucide-${spaceIconName(space)}`" :class="sizes[size].icon" />
  </span>
</template>
