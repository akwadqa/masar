<template>
  <span class="inline-flex items-center gap-2 font-display text-lg font-extrabold tracking-tight text-highlighted">
    <!-- The Masar app tile from the brand kit (client_file/masar-brand-kit/app-icon): violet tile, route M and its dot. -->
    <svg viewBox="0 0 64 64" class="size-6 shrink-0" aria-hidden="true">
      <rect width="64" height="64" rx="16" fill="#5B3FD9" />
      <path d="M18 45.5 V18.5 L32 34 L46 18.5 V34" fill="none" stroke="#FFFFFF" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round" />
      <circle cx="46" cy="45" r="4" fill="#FFFFFF" />
    </svg>
    <span v-if="!collapsed">Masar</span>
  </span>
</template>

<script setup lang="ts">
defineProps<{ collapsed?: boolean }>()
</script>
