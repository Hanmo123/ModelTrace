<script setup lang="ts">
import { Copy, Loader2, RefreshCw, ScanSearch, Sparkles } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'
import { generateChallenges, type Challenge } from '@/lib/challenge'
import { analyzeGlobalOutputs, parseNumbers, type AnalysisResult } from '@/lib/fingerprint'
import { cn } from '@/lib/utils'

const { bank, load: loadBank } = useBank()

const challenges = ref<Challenge[]>([])
const outputs = ref<string[]>([])
const analyzing = ref(false)
const errorMessage = ref('')
const result = ref<AnalysisResult | null>(null)

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

let autoTimer: ReturnType<typeof setTimeout> | undefined
watch(signature, () => {
  if (autoTimer) clearTimeout(autoTimer)
  if (!allComplete.value) {
    result.value = null
    return
  }
  // 输入停顿 700ms 后自动计算，无需点击按钮
  autoTimer = setTimeout(() => {
    void compute()
  }, 700)
})

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

onMounted(loadBank)
// 指纹库可能由 Header 先发起加载；就绪后再生成挑战，避免竞态
watch(bank, (ready) => {
  if (ready && !challenges.value.length) regenerate()
}, { immediate: true })
</script>

<template>
  <!-- 大框架：左 61.8% 题目区 / 右 38.2% 结果区 -->
  <div
    class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-card lg:grid lg:grid-cols-[61.8fr_38.2fr] lg:grid-rows-[minmax(0,1fr)]"
  >
    <!-- 左侧：三道题目，垂直均分高度，放不下时题目文本内部滚动 -->
    <section class="flex min-h-0 flex-1 flex-col p-4 lg:border-r lg:p-5">
      <div class="mb-3 flex shrink-0 items-center justify-between">
        <div class="flex items-baseline gap-2">
          <h1 class="text-sm font-semibold tracking-tight">数值挑战</h1>
          <span class="text-xs text-muted-foreground">全部计算在浏览器本地完成</span>
        </div>
        <Button variant="ghost" size="sm" :disabled="!bank" @click="regenerate">
          <RefreshCw data-icon="inline-start" />
          换一组
        </Button>
      </div>

      <div class="flex min-h-0 flex-1 flex-col gap-3">
        <div
          v-for="(challenge, index) in challenges"
          :key="challenge.id"
          class="group relative flex min-h-[240px] flex-1 flex-col rounded-xl border bg-muted/30 p-4 lg:min-h-0"
        >
          <!-- hover 浮现的复制按钮 -->
          <button
            type="button"
            class="absolute right-3 top-3 z-10 inline-flex items-center gap-1 rounded-lg border bg-background px-2 py-1 text-xs text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
            @click="copyPrompt(challenge.prompt)"
          >
            <Copy class="size-3.5" />
            复制
          </button>

          <div class="mb-2 flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
            <span class="font-semibold text-foreground/70">题目 {{ index + 1 }}</span>
            <span aria-hidden="true">·</span>
            <span class="tnum">{{ challenge.expected_count }} 个数字</span>
            <template v-if="parsedCounts[index]">
              <span aria-hidden="true">·</span>
              <span
                :class="
                  cn(
                    'tnum',
                    parsedCounts[index] >= minimums[index]
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : '',
                  )
                "
              >
                已识别 {{ parsedCounts[index] }}/{{ minimums[index] }}
              </span>
            </template>
          </div>

          <!-- 纯文本题目：13 号灰色、无装饰 -->
          <div class="min-h-0 flex-1 overflow-y-auto pr-1">
            <p class="text-[13px] leading-relaxed text-muted-foreground">{{ challenge.prompt }}</p>
          </div>

          <Textarea
            v-model="outputs[index]"
            spellcheck="false"
            placeholder="把模型的完整回答粘贴到这里"
            class="mt-3 h-16 shrink-0 resize-none rounded-lg bg-background font-mono text-xs"
          />
        </div>
      </div>

      <div class="mt-3 flex shrink-0 items-center justify-between gap-3 border-t pt-3">
        <p class="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Sparkles class="size-3.5" />
          {{ analyzing ? '正在本地计算…' : '三份回答满足长度后自动计算，无需点击' }}
        </p>
        <Button size="sm" :disabled="!bank || analyzing || !allComplete" @click="compute">
          <Loader2 v-if="analyzing" class="animate-spin" data-icon="inline-start" />
          计算概率
        </Button>
      </div>
      <p v-if="errorMessage" class="mt-2 shrink-0 text-xs text-destructive">{{ errorMessage }}</p>
    </section>

    <!-- 右侧：结果区 -->
    <aside class="flex min-h-0 flex-col overflow-y-auto bg-muted/20 p-4 lg:p-6">
      <template v-if="result">
        <ResultPanel :result="result" />
      </template>

      <template v-else>
        <div class="flex min-h-[360px] flex-1 flex-col">
          <div class="flex flex-1 flex-col items-center justify-center gap-3 py-10 text-center">
            <span
              class="flex size-12 items-center justify-center rounded-full border bg-background text-muted-foreground"
            >
              <ScanSearch class="size-5" />
            </span>
            <div class="flex flex-col gap-1">
              <p class="text-sm font-medium">等待三份回答</p>
              <p class="max-w-[260px] text-xs leading-relaxed text-muted-foreground">
                把模型的完整输出粘贴到左侧输入框，满足长度后自动开始归因分析
              </p>
            </div>
          </div>

          <!-- 实时解析进度 -->
          <div class="flex shrink-0 flex-col gap-2.5 border-t pt-4">
            <div
              v-for="(challenge, index) in challenges"
              :key="challenge.id"
              class="flex items-center gap-3"
            >
              <span class="w-12 shrink-0 text-xs text-muted-foreground">回答 {{ index + 1 }}</span>
              <Progress
                :model-value="Math.min((parsedCounts[index] / minimums[index]) * 100, 100)"
                class="h-1 flex-1"
              />
              <span
                :class="
                  cn(
                    'tnum w-16 shrink-0 text-right text-[11px]',
                    parsedCounts[index] >= minimums[index]
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-muted-foreground',
                  )
                "
              >
                {{ parsedCounts[index] }}/{{ minimums[index] }}
              </span>
            </div>
          </div>
        </div>
      </template>
    </aside>
  </div>
</template>
