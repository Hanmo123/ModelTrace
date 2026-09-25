<script setup lang="ts">
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
</script>

<template>
  <div class="min-h-screen bg-background">
    <AppHeader />
    <main class="container py-8">
      <Tabs default-value="auto">
        <TabsList>
          <TabsTrigger value="auto">API 自动检测</TabsTrigger>
          <TabsTrigger value="manual">手动检测</TabsTrigger>
        </TabsList>
        <TabsContent value="auto" class="mt-6">
          <AutoTest />
        </TabsContent>
        <TabsContent value="manual" class="mt-6">
          <ManualTest />
        </TabsContent>
      </Tabs>
    </main>
  </div>
</template>
