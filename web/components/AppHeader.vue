<script setup lang="ts">
import { Database, MessagesSquare, Moon, PenLine, Sun, Zap } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'

const { isDark, toggle } = useTheme()
const { bank, modelCount, fingerprintCount, load } = useBank()

onMounted(load)
</script>

<template>
  <header class="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-lg">
    <div class="flex h-16 items-center gap-3 px-4 lg:px-6">
      <a href="/" class="mr-2 flex items-center gap-2.5">
        <span class="brand-mark flex size-8 items-center justify-center rounded-lg text-sm font-extrabold">
          MT
        </span>
        <span class="hidden sm:block">
          <span class="block text-sm font-bold leading-tight tracking-tight">ModelTrace</span>
          <span class="block text-[11px] leading-tight text-muted-foreground">模型指纹归因</span>
        </span>
      </a>

      <!-- 胶囊式切换：手动 / 自动（自动暂未开放） -->
      <nav class="flex items-center gap-1" aria-label="测试模式">
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-full bg-foreground px-4 py-1.5 text-sm font-medium text-background shadow-sm"
        >
          <PenLine class="size-3.5" />
          手动测试
        </button>
        <button
          type="button"
          disabled
          title="即将推出"
          class="inline-flex cursor-not-allowed items-center gap-1.5 rounded-full px-4 py-1.5 text-sm text-muted-foreground opacity-60"
        >
          <Zap class="size-3.5" />
          自动测试
          <span class="rounded-full border px-1.5 py-px text-[10px] leading-none">即将推出</span>
        </button>
      </nav>

      <div class="ml-auto flex items-center gap-2">
        <div
          class="hidden items-center gap-2 rounded-full border bg-card px-3.5 py-1.5 text-xs text-muted-foreground md:flex"
        >
          <Database class="size-3.5" />
          <span v-if="bank" class="tnum">{{ modelCount }} 个候选模型 · {{ fingerprintCount }} 条指纹</span>
          <span v-else>指纹库加载中…</span>
          <span class="relative flex size-2">
            <span
              :class="[
                'absolute inline-flex size-full rounded-full opacity-60',
                bank ? 'animate-ping bg-emerald-400' : 'animate-ping bg-amber-400',
              ]"
            />
            <span
              :class="[
                'relative inline-flex size-2 rounded-full',
                bank ? 'bg-emerald-500' : 'bg-amber-500',
              ]"
            />
          </span>
        </div>

        <Button variant="ghost" size="icon" aria-label="切换主题" @click="toggle">
          <Sun v-if="isDark" class="size-4" />
          <Moon v-else class="size-4" />
        </Button>
        <Button variant="ghost" size="icon" as-child>
          <a href="https://linux.do/t/topic/1545335" target="_blank" rel="noreferrer" aria-label="LINUX DO">
            <MessagesSquare class="size-4" />
          </a>
        </Button>
      </div>
    </div>
  </header>
</template>
