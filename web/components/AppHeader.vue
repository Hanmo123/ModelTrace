<script setup lang="ts">
import { Database, Github, Moon, Sun } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'

const { modelCount, fingerprintCount, loading } = useBank()
const { isDark, toggle } = useTheme()
</script>

<template>
  <header class="sticky top-0 z-40 border-b bg-background/70 backdrop-blur-xl">
    <div class="container flex h-16 items-center justify-between">
      <NuxtLink to="/" class="flex items-center gap-3">
        <span class="brand-mark flex size-9 items-center justify-center rounded-lg text-sm font-bold text-white">
          MT
        </span>
        <div class="flex flex-col">
          <strong class="text-base font-semibold leading-tight tracking-tight">ModelTrace</strong>
          <span class="text-xs text-muted-foreground">模型指纹归因</span>
        </div>
      </NuxtLink>

      <div class="flex items-center gap-2">
        <div
          v-if="modelCount"
          class="hidden items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs text-muted-foreground sm:flex"
        >
          <Database class="size-3.5" />
          <span class="tnum">{{ modelCount }} 个候选模型 · {{ fingerprintCount }} 条指纹</span>
          <span class="relative flex size-2">
            <span class="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span class="relative inline-flex size-2 rounded-full bg-emerald-500" />
          </span>
        </div>
        <div
          v-else-if="loading"
          class="hidden items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs text-muted-foreground sm:flex"
        >
          指纹库加载中…
        </div>

        <Button variant="ghost" size="icon" aria-label="切换深浅色主题" @click="toggle()">
          <Sun v-if="isDark" class="size-4" />
          <Moon v-else class="size-4" />
        </Button>
        <Button variant="ghost" size="icon" as-child>
          <a
            href="https://github.com/xqy2006/ModelTrace"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="在新标签页打开 ModelTrace 的 GitHub 仓库"
          >
            <Github class="size-4" />
          </a>
        </Button>
      </div>
    </div>
  </header>
</template>
