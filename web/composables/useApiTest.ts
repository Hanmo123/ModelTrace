import { createOpenAI } from '@ai-sdk/openai'
import { generateText, type LanguageModel } from 'ai'
import { generateChallenges } from '@/lib/challenge'
import {
  analyzeGlobalOutputs,
  parseNumbers,
  type AnalysisResult,
  type UnifiedBank,
} from '@/lib/fingerprint'
import type { EndpointPreset } from '@/composables/usePresets'

export type StepState = 'pending' | 'working' | 'done' | 'invalid' | 'error' | 'skipped'
export type RunStatus = 'running' | 'success' | 'failed'

export interface PresetRunState {
  status: RunStatus
  steps: StepState[]
  validCount: number
  errors: string[]
  result: AnalysisResult | null
  message: string
}

const TARGET_VALID = 3
const MAX_ATTEMPTS = 6
const BATCH_CONCURRENCY = 2

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const detail = (error as { responseBody?: string }).responseBody
    if (detail && detail.length < 300) return `${error.message}：${detail}`
    return error.message
  }
  return String(error)
}

export function useApiTest() {
  const { bank } = useBank()
  const runStates = useState<Record<string, PresetRunState>>('modeltrace:run-states', () => ({}))
  const batchRunning = useState<boolean>('modeltrace:batch-running', () => false)

  function isRunning(presetId: string): boolean {
    return runStates.value[presetId]?.status === 'running'
  }

  function clearRun(presetId: string) {
    const rest = { ...runStates.value }
    delete rest[presetId]
    runStates.value = rest
  }

  async function probeOnce(
    preset: EndpointPreset,
    model: LanguageModel,
    prompt: string,
  ): Promise<string> {
    const { text } = await generateText({
      model,
      prompt,
      temperature: preset.temperature ?? undefined,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(180_000),
    })
    return text
  }

  async function runPreset(preset: EndpointPreset): Promise<PresetRunState> {
    if (!bank.value) throw new Error('指纹库尚未加载完成')
    if (isRunning(preset.id)) return runStates.value[preset.id]

    const challenges = generateChallenges(MAX_ATTEMPTS)
    const state: PresetRunState = {
      status: 'running',
      steps: challenges.map(() => 'pending'),
      validCount: 0,
      errors: [],
      result: null,
      message: '已生成独立挑战，准备调用模型',
    }
    runStates.value = { ...runStates.value, [preset.id]: state }

    const openai = createOpenAI({ baseURL: preset.baseUrl, apiKey: preset.apiKey })
    const model = preset.apiType === 'responses' ? openai.responses(preset.model) : openai.chat(preset.model)
    const outputs: { text: string; expected_count: number }[] = []

    for (let index = 0; index < challenges.length && outputs.length < TARGET_VALID; index += 1) {
      const challenge = challenges[index]
      state.steps[index] = 'working'
      state.message = `正在进行第 ${index + 1} 次尝试，等待模型完整输出……`
      try {
        const text = await probeOnce(preset, model, challenge.prompt)
        const minimum = Math.max(80, Math.ceil(challenge.expected_count * 0.55))
        const parsed = parseNumbers(text).length
        if (parsed >= minimum) {
          outputs.push({ text, expected_count: challenge.expected_count })
          state.steps[index] = 'done'
          state.validCount = outputs.length
        } else {
          state.steps[index] = 'invalid'
          state.errors.push(`尝试 ${index + 1}：有效数字 ${parsed}/${minimum}`)
        }
      } catch (error) {
        state.steps[index] = 'error'
        state.errors.push(`尝试 ${index + 1}：${describeError(error)}`)
      }
      state.message = `当前已有 ${outputs.length}/${TARGET_VALID} 份有效回答`
    }

    if (outputs.length === TARGET_VALID) {
      state.steps = state.steps.map((step) => (step === 'pending' ? 'skipped' : step))
    }

    if (!outputs.length) {
      state.status = 'failed'
      state.message = `没有获得可分析输出。${state.errors[0] || ''}`
      return state
    }

    state.message = '模型回答已收齐，正在本地计算归因概率……'
    try {
      // 同步重计算前让出一帧
      await new Promise((resolve) => requestAnimationFrame(resolve))
      state.result = analyzeGlobalOutputs(outputs, bank.value)
      state.status = 'success'
      state.message = `测试完成：${outputs.length}/${TARGET_VALID} 份有效回答进入归因`
    } catch (error) {
      state.status = 'failed'
      state.message = describeError(error)
    }
    return state
  }

  async function runBatch(presets: EndpointPreset[]) {
    if (batchRunning.value) return
    batchRunning.value = true
    try {
      const queue = presets.filter((preset) => !isRunning(preset.id))
      const workers = Array.from(
        { length: Math.min(BATCH_CONCURRENCY, queue.length) },
        async () => {
          while (queue.length) {
            const preset = queue.shift()
            if (preset) await runPreset(preset)
          }
        },
      )
      await Promise.all(workers)
    } finally {
      batchRunning.value = false
    }
  }

  return { runStates, batchRunning, isRunning, runPreset, runBatch, clearRun }
}
