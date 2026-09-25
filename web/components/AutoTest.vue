<script setup lang="ts">
import { Loader2, ShieldCheck, Zap } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'

const { presets } = usePresets()
const { batchRunning, runStates, runBatch } = useApiTest()
const { bank, load: loadBank } = useBank()

const successCount = computed(
  () => Object.values(runStates.value).filter((state) => state.status === 'success').length,
)
const failedCount = computed(
  () => Object.values(runStates.value).filter((state) => state.status === 'failed').length,
)

async function handleBatch() {
  if (!bank.value) {
    toast.error('指纹库尚未加载完成，请稍后再试')
    return
  }
  toast.info(`开始批量检测 ${presets.value.length} 组预设（并发 2）`)
  await runBatch(presets.value)
  toast.success(`批量检测完成：成功 ${successCount.value} 组，失败 ${failedCount.value} 组`)
}

onMounted(loadBank)
</script>

<template>
  <div class="flex flex-col gap-6">
    <div
      class="relative overflow-hidden rounded-xl border bg-gradient-to-br from-primary/10 via-card to-sky-500/10 p-6"
    >
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div class="flex max-w-xl flex-col gap-2">
          <div class="flex items-center gap-2">
            <span class="brand-mark flex size-8 items-center justify-center rounded-lg">
              <Zap class="size-4 text-white" />
            </span>
            <h2 class="text-lg font-semibold tracking-tight">一键批量检测</h2>
          </div>
          <p class="text-sm leading-relaxed text-muted-foreground">
            浏览器直连各 Endpoint（无后端中转），支持 OpenAI Chat Completions 与 Responses 两种协议。
            目标服务需允许跨域（CORS）。
          </p>
          <p class="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck class="size-3.5 text-emerald-500" />
            API Key 仅用于当前页面发起的请求，不会离开浏览器
          </p>
        </div>
        <Button
          size="lg"
          :disabled="!presets.length || batchRunning"
          class="shrink-0 shadow-lg shadow-primary/25"
          @click="handleBatch"
        >
          <Loader2 v-if="batchRunning" class="animate-spin" data-icon="inline-start" />
          <Zap v-else data-icon="inline-start" />
          {{ batchRunning ? '批量检测中…' : `批量测试全部${presets.length ? `（${presets.length}）` : ''}` }}
        </Button>
      </div>
    </div>

    <EndpointPresets />
  </div>
</template>
