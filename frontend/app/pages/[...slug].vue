<script setup lang="ts">
useHead({ title: 'Not found · Masar' })
</script>

<template>
  <UDashboardPanel id="not-found">
    <template #body>
      <StatePanel icon="i-lucide-map-pin-off" title="Page not found" description="The page you are looking for does not exist.">
        <UButton to="/spaces" label="Go to Spaces" />
      </StatePanel>
    </template>
  </UDashboardPanel>
</template>
