<script setup lang="ts">
import type { SpaceDetail } from '~/types/api'

const props = defineProps<{ space: SpaceDetail }>()

// Settings are for Managers and administrators; the server enforces every operation.
watch(() => props.space.permissions.canManageMembers, (allowed) => {
  if (!allowed) void navigateTo(`/spaces/${props.space.name}/summary`, { replace: true })
}, { immediate: true })
</script>

<template>
  <!-- grid-cols-1 below lg (QA-D03): an implicit column grew to the widest member row and pushed every card past a phone screen. -->
  <div v-if="space.permissions.canManageMembers" class="masar-boxed mx-auto grid w-full max-w-5xl grid-cols-1 gap-6 p-4 sm:p-6 lg:grid-cols-5">
    <div class="space-y-6 lg:col-span-3">
      <SpaceDetailsEditor :space="space" />
    </div>
    <div class="space-y-6 lg:col-span-2">
      <SpaceLifecycleCard :space="space" />
    </div>
    <div id="members" class="lg:col-span-5">
      <SpaceMembersManager :space="space" />
    </div>
    <div id="labels" class="lg:col-span-5">
      <SpaceLabelsManager :space="space" />
    </div>
  </div>
</template>
