<script setup lang="ts">
import { FlaskConical, Fingerprint, ShieldCheck, Zap } from 'lucide-vue-next'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
</script>

<template>
  <main class="container flex flex-col gap-8 py-10">
    <section class="flex flex-col gap-4">
      <div class="flex items-center gap-2 text-xs font-medium text-primary">
        <Fingerprint class="size-4" />
        <span class="uppercase tracking-widest">Active Model Attribution</span>
      </div>
      <h1 class="max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
        识别屏幕背后的<span class="text-primary">真实模型</span>
      </h1>
      <p class="max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
        通过三条独立的长整数生成挑战提取输出指纹，在统一候选库中判断模型家族与具体版本。
        归因计算全程在浏览器本地完成。
      </p>
      <div class="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span class="flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5">
          <Zap class="size-3.5 text-primary" />
          Chat Completions / Responses 双协议
        </span>
        <span class="flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5">
          <ShieldCheck class="size-3.5 text-primary" />
          密钥仅存浏览器
        </span>
        <span class="flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5">
          <FlaskConical class="size-3.5 text-primary" />
          本地指纹归因
        </span>
      </div>
    </section>

    <Tabs default-value="auto">
      <TabsList class="grid w-full max-w-md grid-cols-2">
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
</template>
