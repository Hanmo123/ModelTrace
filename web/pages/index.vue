<script setup lang="ts">
import { Separator } from '@/components/ui/separator'
</script>

<template>
  <main class="flex flex-col gap-10 py-8">
    <ManualSection />
    <div class="container max-w-[1400px]">
      <Separator />
    </div>
    <div class="container max-w-[1400px]">
      <ProvidersSection />
    </div>
  </main>
</template>
