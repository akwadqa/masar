<script setup lang="ts">
const { user } = useSession()
</script>

<template>
  <UDashboardPanel id="no-access">
    <template #body>
      <StatePanel
        icon="i-lucide-lock"
        title="You don't have access to Masar Workspace"
        description="Your account is signed in but has not been given the Masar User role. Ask a Masar administrator to grant access."
      >
        <UButton v-if="user?.hasDeskAccess" to="/desk" external target="_self" color="neutral" variant="outline" label="Open Administration (Desk)" />
      </StatePanel>
    </template>
  </UDashboardPanel>
</template>
