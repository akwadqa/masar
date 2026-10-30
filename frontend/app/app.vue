<template>
  <UApp :toaster="{ position: 'bottom-right' }" :tooltip="{ delayDuration: 300 }">
    <NuxtLoadingIndicator color="var(--ui-primary)" />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
