<script setup lang="ts">
import type { SpaceDetail, SpaceIconColor } from '~/types/api'
import { SPACE_ICON_COLORS } from '~/types/api'
import { SPACE_ICONS, spaceIconColor, spaceIconName } from '~/utils/spaceIdentity'

// Space icon and colour (Managers): a curated set, saved immediately, shown in the sidebar and lists.
// Client revision 5: a preview, then the colours and an even grid of icons tinted with the chosen colour.
const props = defineProps<{ space: SpaceDetail }>()
const { update } = useSpaceMutations()
const currentIcon = computed(() => spaceIconName(props.space))
const currentColor = computed(() => spaceIconColor(props.space))
const tint = computed(() => `var(--masar-space-${currentColor.value})`)
const title = (value: string) => value.charAt(0).toUpperCase() + value.slice(1).replaceAll('-', ' ')

async function choose(changes: { icon?: string, iconColor?: SpaceIconColor }) {
  await update.execute({ space: props.space, changes }).catch(() => invalidateQueries(`space:${props.space.name}`))
}
</script>

<template>
  <!-- min-w-0 (QA-D03): a fieldset is at least as wide as its content by default, which pushed the
       sixth icon column and the last colours past a 320 px screen. -->
  <fieldset class="min-w-0 space-y-4" :disabled="update.pending.value">
    <legend class="sr-only">Icon and colour</legend>
    <div class="flex items-center gap-3 rounded-card border border-default bg-elevated/40 p-3">
      <SpaceIcon :space="space" size="lg" />
      <div class="min-w-0">
        <p class="truncate text-sm font-medium text-highlighted">{{ space.title }}</p>
        <p class="text-xs text-muted">Icon and colour shown in the sidebar and lists</p>
      </div>
      <UIcon v-if="update.pending.value" name="i-lucide-loader" class="ms-auto size-4 animate-spin text-muted" />
    </div>

    <div class="space-y-2">
      <p class="text-meta text-muted" aria-hidden="true">Colour</p>
      <div class="flex flex-wrap gap-2.5" role="radiogroup" aria-label="Space colour">
        <UTooltip v-for="color in SPACE_ICON_COLORS" :key="color" :text="title(color)">
          <button
            type="button"
            role="radio"
            :aria-checked="currentColor === color"
            :aria-label="title(color)"
            class="grid size-8 place-items-center rounded-full text-white ring-offset-2 ring-offset-(--ui-bg) transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            :class="currentColor === color ? 'ring-2 ring-(--ui-border-inverted)' : ''"
            :style="{ backgroundColor: `var(--masar-space-${color})` }"
            @click="choose({ iconColor: color })"
          >
            <UIcon v-if="currentColor === color" name="i-lucide-check" class="size-4" />
          </button>
        </UTooltip>
      </div>
    </div>

    <div class="space-y-2">
      <p class="text-meta text-muted" aria-hidden="true">Icon</p>
      <div class="grid grid-cols-6 gap-2 sm:grid-cols-8" role="radiogroup" aria-label="Space icon">
        <UTooltip v-for="icon in SPACE_ICONS" :key="icon" :text="title(icon)">
          <button
            type="button"
            role="radio"
            :aria-checked="currentIcon === icon"
            :aria-label="title(icon)"
            class="grid aspect-square w-full place-items-center rounded-lg border transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
            :class="currentIcon === icon ? 'border-transparent' : 'border-default text-muted hover:border-accented hover:bg-elevated hover:text-highlighted'"
            :style="currentIcon === icon ? { color: tint, backgroundColor: `color-mix(in oklab, ${tint} 14%, transparent)`, boxShadow: `inset 0 0 0 1.5px ${tint}` } : undefined"
            @click="choose({ icon })"
          >
            <UIcon :name="`i-lucide-${icon}`" class="size-5" />
          </button>
        </UTooltip>
      </div>
    </div>
  </fieldset>
</template>
