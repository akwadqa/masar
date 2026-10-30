<script setup lang="ts">
const route = useRoute()
await navigateTo(`/spaces/${route.params.space}/tasks`, { replace: true })
</script>

<template>
  <div />
</template>
