<script setup lang="ts">
import { Github } from 'lucide-vue-next'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'

const { modelCount, fingerprintCount, loading, error } = useBank()
</script>

<template>
  <header class="border-b">
    <div class="container flex h-14 items-center justify-between">
      <div class="flex items-center gap-3">
        <span
          class="flex size-8 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground"
        >MT</span>
        <div class="flex flex-col">
          <strong class="text-sm font-semibold leading-tight">ModelTrace</strong>
          <span class="text-xs text-muted-foreground">模型指纹归因</span>
        </div>
      </div>
      <div class="flex items-center gap-3">
        <Badge v-if="modelCount" variant="secondary" class="font-normal">
          {{ modelCount }} 个候选模型 · {{ fingerprintCount }} 条指纹
        </Badge>
        <Badge v-else-if="loading" variant="outline" class="font-normal">指纹库加载中…</Badge>
        <Badge v-else-if="error" variant="destructive" class="font-normal">指纹库加载失败</Badge>
        <Separator orientation="vertical" class="h-5" />
        <a
          href="https://github.com/xqy2006/ModelTrace"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="在新标签页打开 ModelTrace 的 GitHub 仓库"
          class="text-muted-foreground transition-colors hover:text-foreground"
        >
          <Github class="size-5" />
        </a>
      </div>
    </div>
  </header>
</template>
