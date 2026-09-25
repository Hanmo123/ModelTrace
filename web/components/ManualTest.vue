<script setup lang="ts">
import { ClipboardCopy, RefreshCw, ScanSearch } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { generateChallenges, type Challenge } from '@/lib/challenge'
import { analyzeGlobalOutputs, type AnalysisResult } from '@/lib/fingerprint'

const { bank, load: loadBank } = useBank()

const challenges = ref<Challenge[]>([])
const outputs = ref<string[]>([])
const analyzing = ref(false)
const errorMessage = ref('')
const result = ref<AnalysisResult | null>(null)

function regenerate() {
  challenges.value = generateChallenges(3)
  outputs.value = challenges.value.map(() => '')
  result.value = null
  errorMessage.value = ''
}

async function copyPrompt(prompt: string) {
  try {
    await navigator.clipboard.writeText(prompt)
    toast.success('提示词已复制')
  } catch {
    toast.error('复制失败，请手动选择文本复制')
  }
}

async function analyze() {
  if (!bank.value) return
  analyzing.value = true
  errorMessage.value = ''
  result.value = null
  // 让出一帧渲染加载态，再做同步重计算
  await new Promise((resolve) => requestAnimationFrame(resolve))
  try {
    const analysis = analyzeGlobalOutputs(
      challenges.value.map((challenge, index) => ({
        text: outputs.value[index] || '',
        expected_count: challenge.expected_count,
      })),
      bank.value,
    )
    result.value = analysis
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '无法完成归因。'
  } finally {
    analyzing.value = false
  }
}

onMounted(async () => {
  await loadBank()
  if (bank.value) regenerate()
})
</script>

<template>
  <div class="flex flex-col gap-6">
    <Card>
      <CardHeader>
        <div class="flex items-center justify-between">
          <div>
            <CardTitle>手动检测</CardTitle>
            <CardDescription>
              复制三条挑战发送给同一个待测模型，再粘贴每次的完整输出，归因计算全部在浏览器本地完成。
            </CardDescription>
          </div>
          <Button variant="outline" :disabled="!bank" @click="regenerate">
            <RefreshCw data-icon="inline-start" />
            重新生成挑战
          </Button>
        </div>
      </CardHeader>
      <CardContent class="flex flex-col gap-4">
        <div
          v-for="(challenge, index) in challenges"
          :key="challenge.id"
          class="flex flex-col gap-3 rounded-lg border p-4"
        >
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <strong class="text-sm">挑战 {{ index + 1 }}</strong>
              <Badge variant="secondary">{{ challenge.expected_count }} 个数字</Badge>
            </div>
            <Button variant="ghost" size="sm" @click="copyPrompt(challenge.prompt)">
              <ClipboardCopy data-icon="inline-start" />
              复制提示词
            </Button>
          </div>
          <div class="grid gap-4 md:grid-cols-2">
            <div class="flex flex-col gap-2">
              <Label>发送给待测模型</Label>
              <pre
                class="whitespace-pre-wrap rounded-md bg-muted p-3 text-xs leading-relaxed text-muted-foreground"
              >{{ challenge.prompt }}</pre>
            </div>
            <div class="flex flex-col gap-2">
              <Label :for="`output-${index}`">粘贴完整输出</Label>
              <Textarea
                :id="`output-${index}`"
                v-model="outputs[index]"
                spellcheck="false"
                placeholder="保留文字、标点、代码块和完整数字序列"
                class="min-h-32 font-mono text-xs"
              />
            </div>
          </div>
        </div>

        <Alert v-if="errorMessage" variant="destructive">
          <AlertDescription>{{ errorMessage }}</AlertDescription>
        </Alert>

        <div>
          <Button :disabled="!bank || analyzing" @click="analyze">
            <ScanSearch data-icon="inline-start" />
            {{ analyzing ? '正在本地计算……' : '计算归因概率' }}
          </Button>
        </div>
      </CardContent>
    </Card>

    <AttributionResult v-if="result" :result="result" />
  </div>
</template>
