<script setup lang="ts">
import { Toaster } from '@/components/ui/sonner'
</script>

<template>
  <div class="min-h-screen bg-background">
    <NuxtPage />
    <Toaster rich-colors position="top-right" />
  </div>
</template>
