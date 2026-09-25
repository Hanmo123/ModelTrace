<script setup lang="ts">
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
</script>

<template>
  <div class="min-h-screen bg-background">
    <AppHeader />
    <main class="container py-8">
      <Tabs default-value="manual">
        <TabsList>
          <TabsTrigger value="manual">手动检测</TabsTrigger>
          <TabsTrigger value="presets">Endpoint 预设</TabsTrigger>
        </TabsList>
        <TabsContent value="manual" class="mt-6">
          <ManualTest />
        </TabsContent>
        <TabsContent value="presets" class="mt-6">
          <EndpointPresets />
        </TabsContent>
      </Tabs>
    </main>
  </div>
</template>
