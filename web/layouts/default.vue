<script setup lang="ts">
</script>

<template>
  <div class="relative flex min-h-screen flex-col bg-background">
    <div class="bg-scene" aria-hidden="true" />
    <AppHeader />
    <div class="flex-1">
      <slot />
    </div>
    <AppFooter />
    <Toaster rich-colors position="top-right" />
  </div>
</template>
