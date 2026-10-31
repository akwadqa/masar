<script setup lang="ts">
// Sprints were renamed back to Batches (client decision 2026-10-31): old links open the Space's Batches tab.
definePageMeta({ redirect: to => `/spaces/${String(to.params.space)}/batches` })
</script>

<template>
  <div />
</template>
