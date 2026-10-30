<script setup lang="ts">
// Batches were renamed Sprints (client revision 4): old links open the Space's Sprints tab.
definePageMeta({ redirect: to => `/spaces/${String(to.params.space)}/sprints` })
</script>

<template>
  <div />
</template>
