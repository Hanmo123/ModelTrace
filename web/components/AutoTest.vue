<script setup lang="ts">
import { Info, Loader2, Zap } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

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
  toast.success(
    `批量检测完成：成功 ${successCount.value} 组，失败 ${failedCount.value} 组`,
  )
}

onMounted(loadBank)
</script>

<template>
  <div class="flex flex-col gap-6">
    <Card>
      <CardHeader>
        <div class="flex items-center justify-between">
          <div>
            <CardTitle>API 自动检测</CardTitle>
            <CardDescription>
              由浏览器直接向各 Endpoint 发起请求（纯前端，无后端中转），支持 OpenAI Chat Completions 与 Responses 两种协议。
            </CardDescription>
          </div>
          <Button :disabled="!presets.length || batchRunning" @click="handleBatch">
            <Loader2 v-if="batchRunning" class="animate-spin" data-icon="inline-start" />
            <Zap v-else data-icon="inline-start" />
            {{ batchRunning ? '批量检测中…' : `批量测试全部（${presets.length}）` }}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Alert>
          <Info class="size-4" />
          <AlertDescription>
            请求从浏览器直连目标 Endpoint，目标服务需允许跨域（CORS）；API Key 仅用于当前页面发起的请求，不会离开浏览器。
          </AlertDescription>
        </Alert>
      </CardContent>
    </Card>

    <EndpointPresets />
  </div>
</template>
