import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { generateChallenges, type Challenge } from "@/lib/challenge";
import {
  analyzeGlobalOutputs,
  parseNumbers,
  type AnalysisResult,
} from "@/lib/fingerprint";
import type { EndpointPreset } from "@/composables/usePresets";

export type StepState =
  "pending" | "working" | "done" | "invalid" | "error" | "skipped";
export type RunStatus = "running" | "success" | "failed";

export interface PresetRunState {
  status: RunStatus;
  steps: StepState[];
  challenges: Challenge[];
  outputs: string[];
  parsedCounts: number[];
  stepErrors: string[];
  validCount: number;
  errors: string[];
  result: AnalysisResult | null;
  message: string;
  startedAt: number;
  finishedAt: number | null;
}

const TARGET_VALID = 3;
const MAX_ATTEMPTS = 6;
const BATCH_CONCURRENCY = 2;

function describeError(error: unknown, apiKey: string): string {
  const message = error instanceof Error ? error.message : String(error);
  // 不把服务端可能回显的密钥展示到错误区域。
  return (apiKey ? message.split(apiKey).join("[已隐藏密钥]") : message).slice(
    0,
    600,
  );
}

export function useApiTest() {
  const { bank } = useBank();
  const runStates = useState<Record<string, PresetRunState>>(
    "modeltrace:run-states",
    () => ({}),
  );
  const batchRunning = useState<boolean>(
    "modeltrace:batch-running",
    () => false,
  );
  const queuedIds = useState<string[]>("modeltrace:queued-presets", () => []);

  function isRunning(presetId: string): boolean {
    return runStates.value[presetId]?.status === "running";
  }

  function clearRun(presetId: string) {
    if (isRunning(presetId) || queuedIds.value.includes(presetId)) return;
    const rest = { ...runStates.value };
    delete rest[presetId];
    runStates.value = rest;
  }

  async function runPreset(input: EndpointPreset): Promise<PresetRunState> {
    if (!bank.value) throw new Error("指纹库尚未加载完成");
    if (isRunning(input.id)) return runStates.value[input.id]!;
    // 固定本轮配置与指纹库，不受后续编辑影响。
    const preset = { ...input };
    const currentBank = bank.value;
    const challenges = generateChallenges(MAX_ATTEMPTS);
    // 必须通过代理更新，不能修改放入 useState 前的原始对象。
    const state = reactive<PresetRunState>({
      status: "running",
      steps: challenges.map(() => "pending"),
      challenges,
      outputs: challenges.map(() => ""),
      parsedCounts: challenges.map(() => 0),
      stepErrors: challenges.map(() => ""),
      validCount: 0,
      errors: [],
      result: null,
      message: "已生成独立挑战，准备调用模型",
      startedAt: Date.now(),
      finishedAt: null,
    });
    runStates.value = { ...runStates.value, [preset.id]: state };

    try {
      const openai = createOpenAI({
        baseURL: preset.baseUrl,
        apiKey: preset.apiKey,
      });
      const model =
        preset.apiType === "responses"
          ? openai.responses(preset.model)
          : openai.chat(preset.model);

      for (
        let index = 0;
        index < challenges.length && state.validCount < TARGET_VALID;
        index += 1
      ) {
        const challenge = challenges[index]!;
        state.steps[index] = "working";
        state.message = `正在请求挑战 ${index + 1}，已有 ${state.validCount}/${TARGET_VALID} 份有效回答`;
        try {
          const { text } = await generateText({
            model,
            prompt: challenge.prompt,
            temperature: preset.temperature ?? undefined,
            maxRetries: 1,
            abortSignal: AbortSignal.timeout(180_000),
          });
          state.outputs[index] = text;
          state.parsedCounts[index] = parseNumbers(text).length;
          const minimum = Math.max(
            80,
            Math.ceil(challenge.expected_count * 0.55),
          );
          if (state.parsedCounts[index]! >= minimum) {
            state.steps[index] = "done";
            state.validCount += 1;
            // 一份有效回答即可先出结果；保留尝试序号以对应诊断。
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            state.result = analyzeGlobalOutputs(
              challenges.slice(0, index + 1).map((item, step) => ({
                text: state.outputs[step]!,
                expected_count: item.expected_count,
              })),
              currentBank,
            );
          } else {
            state.steps[index] = "invalid";
            state.stepErrors[index] =
              `有效数字 ${state.parsedCounts[index]}/${minimum}，未达到分析长度`;
            state.errors.push(`挑战 ${index + 1}：${state.stepErrors[index]}`);
          }
        } catch (error) {
          state.steps[index] = "error";
          state.stepErrors[index] = describeError(error, preset.apiKey);
          state.errors.push(`挑战 ${index + 1}：${state.stepErrors[index]}`);
          const statusCode = (error as { statusCode?: number } | null)
            ?.statusCode;
          if (statusCode === 401 || statusCode === 403) break;
        }
      }
      state.status = state.result ? "success" : "failed";
      state.message = state.result
        ? `测试完成：${state.validCount}/${TARGET_VALID} 份有效回答进入归因`
        : `没有获得可分析输出。${state.errors[0] || ""}`;
    } catch (error) {
      state.status = "failed";
      state.message = describeError(error, preset.apiKey);
    } finally {
      state.steps = state.steps.map((step) =>
        step === "pending" ? "skipped" : step,
      );
      state.finishedAt = Date.now();
    }
    return state;
  }

  async function runBatch(presets: EndpointPreset[]) {
    if (batchRunning.value) return;
    if (!bank.value) throw new Error("指纹库尚未加载完成");
    const queue = presets
      .filter((preset) => !isRunning(preset.id))
      .map((preset) => ({ ...preset }));
    batchRunning.value = true;
    queuedIds.value = queue.map((preset) => preset.id);
    try {
      await Promise.all(
        Array.from(
          { length: Math.min(BATCH_CONCURRENCY, queue.length) },
          async () => {
            while (queue.length) {
              const preset = queue.shift()!;
              queuedIds.value = queuedIds.value.filter(
                (id) => id !== preset.id,
              );
              await runPreset(preset);
            }
          },
        ),
      );
    } finally {
      batchRunning.value = false;
      queuedIds.value = [];
    }
  }

  return {
    runStates,
    batchRunning,
    queuedIds,
    isRunning,
    runPreset,
    runBatch,
    clearRun,
  };
}
