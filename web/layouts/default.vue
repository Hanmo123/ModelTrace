<script setup lang="ts">
import { Toaster } from '@/components/ui/sonner'
import '@fontsource-variable/inter'
import '~/assets/css/tailwind.css'
</script>

<template>
  <div class="flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
    <AppHeader />
    <slot />
    <Toaster position="top-right" rich-colors close-button />
  </div>
</template>
