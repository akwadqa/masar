<script setup lang="ts">
// Sprints were renamed back to Batches (client decision 2026-10-31): links and bookmarks made while
// they were called Sprints open the same Batch page.
definePageMeta({
  redirect: (to) => {
    const rest = ([] as string[]).concat(to.params.path ?? []).filter(Boolean).join('/')
    return { path: rest ? `/batches/${rest}` : '/batches', query: to.query }
  }
})
</script>

<template>
  <div />
</template>
