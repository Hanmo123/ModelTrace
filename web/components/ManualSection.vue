<script setup lang="ts">
import { ClipboardCopy, Loader2, RefreshCw, ScanSearch, Sparkles } from 'lucide-vue-next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { generateChallenges, type Challenge } from '@/lib/challenge'
import { analyzeGlobalOutputs, parseNumbers, type AnalysisResult } from '@/lib/fingerprint'
import { cn } from '@/lib/utils'

const { bank, load: loadBank } = useBank()
const { openConfig } = useProviderOnboarding()

const challenges = ref<Challenge[]>([])
const outputs = ref<string[]>([])
const analyzing = ref(false)
const errorMessage = ref('')
const result = ref<AnalysisResult | null>(null)
const copyHintOpen = ref(false)

const minimums = computed(() =>
  challenges.value.map((challenge) => Math.max(80, Math.ceil(challenge.expected_count * 0.55))),
)
// 展示用：实际解析出的数字个数；签名用：封顶到阈值，避免多余数字触发重算
const parsedCounts = computed(() => outputs.value.map((text) => parseNumbers(text || '').length))
const signature = computed(() =>
  parsedCounts.value.map((count, index) => Math.min(count, minimums.value[index] ?? 80)).join(','),
)
const allComplete = computed(
  () =>
    challenges.value.length > 0 &&
    parsedCounts.value.every((count, index) => count >= (minimums.value[index] ?? 80)),
)
const hasResult = computed(() => result.value !== null)

let autoTimer: ReturnType<typeof setTimeout> | undefined
watch(
  signature,
  () => {
    if (autoTimer) clearTimeout(autoTimer)
    if (!allComplete.value) {
      result.value = null
      return
    }
    // 输入停顿 700ms 后自动计算，无需点击按钮
    autoTimer = setTimeout(() => {
      void compute()
    }, 700)
  },
)

function regenerate() {
  challenges.value = generateChallenges(3)
  outputs.value = challenges.value.map(() => '')
  result.value = null
  errorMessage.value = ''
}

async function copyPrompt(prompt: string) {
  try {
    await navigator.clipboard.writeText(prompt)
  } catch {
    // 剪贴板不可用时仍展示引导
  }
  copyHintOpen.value = true
}

async function compute() {
  if (!bank.value || !allComplete.value) return
  analyzing.value = true
  errorMessage.value = ''
  // 让出一帧渲染加载态，再做同步重计算
  await new Promise((resolve) => requestAnimationFrame(resolve))
  try {
    result.value = analyzeGlobalOutputs(
      challenges.value.map((challenge, index) => ({
        text: outputs.value[index] || '',
        expected_count: challenge.expected_count,
      })),
      bank.value,
    )
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '无法完成归因。'
  } finally {
    analyzing.value = false
  }
}

function startConfigure() {
  copyHintOpen.value = false
  openConfig(true)
}

onMounted(async () => {
  await loadBank()
  if (bank.value) regenerate()
})
</script>

<template>
  <div
    :class="
      cn(
        'mx-auto w-full px-4 transition-[max-width] duration-500 ease-out sm:px-6',
        hasResult ? 'max-w-[1400px]' : 'max-w-3xl',
      )
    "
  >
    <div :class="cn('grid items-start gap-6', hasResult && 'xl:grid-cols-[minmax(0,1fr)_400px]')">
      <!-- 三条挑战 -->
      <div class="flex flex-col gap-4">
        <Card
          v-for="(challenge, index) in challenges"
          :key="challenge.id"
          class="rounded-2xl shadow-sm"
        >
          <CardContent class="flex flex-col gap-3 p-5">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2.5">
                <span
                  class="brand-mark flex size-7 items-center justify-center rounded-lg text-xs font-bold"
                >
                  {{ index + 1 }}
                </span>
                <strong class="text-sm">挑战 {{ index + 1 }}</strong>
                <Badge variant="secondary" class="tnum font-normal">
                  {{ challenge.expected_count }} 个数字
                </Badge>
                <Badge
                  v-if="parsedCounts[index]"
                  variant="outline"
                  :class="
                    cn(
                      'tnum font-normal',
                      parsedCounts[index] >= minimums[index]
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                        : 'text-muted-foreground',
                    )
                  "
                >
                  已识别 {{ parsedCounts[index] }}/{{ minimums[index] }}
                </Badge>
              </div>
              <Button variant="ghost" size="sm" @click="copyPrompt(challenge.prompt)">
                <ClipboardCopy data-icon="inline-start" />
                复制提示词
              </Button>
            </div>
            <pre
              class="max-h-28 overflow-auto whitespace-pre-wrap rounded-xl bg-muted/60 p-3 font-mono text-xs leading-relaxed text-muted-foreground"
            >{{ challenge.prompt }}</pre>
            <Textarea
              v-model="outputs[index]"
              spellcheck="false"
              placeholder="把模型的完整输出粘贴到这里（保留文字、标点与完整数字序列）"
              class="min-h-28 rounded-xl font-mono text-xs"
            />
          </CardContent>
        </Card>

        <!-- 底部操作行：按钮保留，但输入完成后会自动触发 -->
        <div class="flex flex-wrap items-center justify-between gap-3 px-1">
          <p class="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Sparkles class="size-3.5" />
            {{ analyzing ? '正在本地计算…' : '三份输出满足长度后自动计算，无需点击' }}
          </p>
          <div class="flex items-center gap-2">
            <Button variant="outline" :disabled="!bank" @click="regenerate">
              <RefreshCw data-icon="inline-start" />
              重新生成挑战
            </Button>
            <Button :disabled="!bank || analyzing || !allComplete" @click="compute">
              <Loader2 v-if="analyzing" class="animate-spin" data-icon="inline-start" />
              <ScanSearch v-else data-icon="inline-start" />
              计算概率
            </Button>
          </div>
        </div>

        <p v-if="errorMessage" class="px-1 text-sm text-destructive">{{ errorMessage }}</p>
      </div>

      <!-- 右侧结果栏 -->
      <Card v-if="result" class="rounded-2xl shadow-sm xl:sticky xl:top-24">
        <CardContent class="p-6">
          <ResultPanel :result="result" />
        </CardContent>
      </Card>
    </div>

    <!-- 复制后的引导弹窗 -->
    <Dialog :open="copyHintOpen" @update:open="copyHintOpen = $event">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>提示词已复制</DialogTitle>
          <DialogDescription class="leading-relaxed">
            也可以直接填写 Endpoint 和 API Key，由页面自动发送挑战并完成归因——更方便，也便于后续批量测试多个服务商。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter class="gap-2 sm:justify-between">
          <Button variant="ghost" @click="copyHintOpen = false">我不需要</Button>
          <Button @click="startConfigure">
            <Sparkles data-icon="inline-start" />
            开始配置
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
