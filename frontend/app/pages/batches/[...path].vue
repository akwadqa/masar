<script setup lang="ts">
// Batches were renamed Sprints (client revision 4): old links and bookmarks open the same page.
definePageMeta({
  redirect: (to) => {
    const rest = ([] as string[]).concat(to.params.path ?? []).filter(Boolean).join('/')
    return { path: rest ? `/sprints/${rest}` : '/sprints', query: to.query }
  }
})
</script>

<template>
  <div />
</template>
