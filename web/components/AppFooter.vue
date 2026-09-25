<script setup lang="ts">
import { Separator } from '@/components/ui/separator'
</script>

<template>
  <footer class="border-t">
    <div class="container flex flex-col items-center justify-between gap-3 py-6 text-xs text-muted-foreground sm:flex-row">
      <p>ModelTrace · 全部计算在浏览器本地完成，API Key 不会离开浏览器</p>
      <div class="flex items-center gap-3">
        <span>测试结果仅供参考</span>
        <Separator orientation="vertical" class="h-3" />
        <a
          href="https://github.com/xqy2006/ModelTrace"
          target="_blank"
          rel="noopener noreferrer"
          class="transition-colors hover:text-foreground"
        >
          GitHub
        </a>
        <Separator orientation="vertical" class="h-3" />
        <a
          href="https://linux.do/"
          target="_blank"
          rel="noopener noreferrer"
          class="transition-colors hover:text-foreground"
        >
          LINUX DO
        </a>
      </div>
    </div>
  </footer>
</template>
