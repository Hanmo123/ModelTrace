import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { generateChallenges, type Challenge } from "@/lib/challenge";
import {
  analyzeGlobalOutputs,
  parseNumbers,
  type AnalysisResult,
} from "@/lib/fingerprint";
import type { EndpointPreset } from "@/composables/usePresets";
import { createTaskQueue } from "../lib/task-queue";
import { classifyRequestError } from "../lib/direct-routing";
import { useDirectRouting } from "./useDirectRouting";
import {
  classifyDegradation,
  DEGRADATION_PROMPT,
  type DegradationVerdict,
} from "../lib/degradation";

export type StepState =
  "pending" | "working" | "done" | "invalid" | "error" | "skipped";
export type RunStatus = "running" | "success" | "failed";

export interface PresetRunState {
  status: RunStatus;
  transport: "direct" | "proxy";
  directNetworkFailed: boolean;
  earlyStopped: boolean;
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

export interface DegradationRunState {
  status: RunStatus;
  transport: "direct" | "proxy";
  verdict: DegradationVerdict | null;
  error: string | null;
}

type TestMode = "fingerprint" | "degradation";
type ModelRunState = PresetRunState | DegradationRunState;

const TARGET_VALID = 3;
const MAX_ATTEMPTS = 3;
const SUCCESS_PROBABILITY = 0.99;
const BATCH_CONCURRENCY = 2;
// Shared by every useApiTest() instance, including single-model clicks.
const testQueue = createTaskQueue<ModelRunState>(BATCH_CONCURRENCY);

function modelForPreset(preset: EndpointPreset, proxyURL?: string) {
  const openai = createOpenAI({
    baseURL: proxyURL || preset.baseUrl,
    apiKey: preset.apiKey,
    ...(proxyURL
      ? { headers: { "X-ModelTrace-Endpoint": preset.baseUrl } }
      : {}),
  });
  return preset.apiType === "responses"
    ? openai.responses(preset.model)
    : openai.chat(preset.model);
}

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
  const { isDirectBlocked, markDirectFailure, clearDirectFailures } =
    useDirectRouting();
  const runStates = useState<Record<string, PresetRunState>>(
    "modeltrace:run-states",
    () => ({}),
  );
  const degradationRuns = useState<Record<string, DegradationRunState>>(
    "modeltrace:degradation-runs",
    () => ({}),
  );
  const jobs = useState<Record<string, { mode: TestMode; token: string }>>(
    "modeltrace:model-jobs",
    () => ({}),
  );
  const batchRunning = useState<boolean>(
    "modeltrace:batch-running",
    () => false,
  );
  const queuedIds = useState<string[]>("modeltrace:queued-presets", () => []);

  function isRunning(presetId: string): boolean {
    return isBusy(presetId) && !queuedIds.value.includes(presetId);
  }

  function clearRun(presetId: string) {
    if (isBusy(presetId)) return;
    const rest = { ...runStates.value };
    delete rest[presetId];
    runStates.value = rest;
    const diagnostics = { ...degradationRuns.value };
    delete diagnostics[presetId];
    degradationRuns.value = diagnostics;
  }

  function isBusy(id: string) {
    return Object.hasOwn(jobs.value, id);
  }

  function hasDegradationJobs() {
    return Object.values(jobs.value).some((job) => job.mode === "degradation");
  }

  function schedule<T extends ModelRunState>(
    id: string,
    mode: TestMode,
    task: () => Promise<T>,
  ): Promise<T> {
    // Join duplicate clicks only within the same mode, never return a
    // fingerprint result to a diagnostic caller (or vice versa).
    if (testQueue.has(id)) {
      if (jobs.value[id]?.mode !== mode)
        return Promise.reject(new Error("此模型正在执行其他测试，请等待完成。"));
      return testQueue.enqueue(id, task) as Promise<T>;
    }
    const token = crypto.randomUUID();
    jobs.value = { ...jobs.value, [id]: { mode, token } };
    queuedIds.value = [...queuedIds.value, id];
    const promise = testQueue.enqueue(id, () => {
      queuedIds.value = queuedIds.value.filter((queued) => queued !== id);
      return task();
    }) as Promise<T>;
    const release = () => {
      if (jobs.value[id]?.token !== token) return;
      const rest = { ...jobs.value };
      delete rest[id];
      jobs.value = rest;
    };
    void promise.then(release, release);
    return promise;
  }

  function runPreset(
    input: EndpointPreset,
    proxyBaseURL?: string,
  ): Promise<PresetRunState> {
    // Explicit single-model tests retain their existing selected transport.
    return enqueuePreset(input, proxyBaseURL, false);
  }

  function enqueuePreset(
    input: EndpointPreset,
    proxyBaseURL: string | undefined,
    directFirst: boolean,
  ): Promise<PresetRunState> {
    if (!bank.value) return Promise.reject(new Error("指纹库尚未加载完成"));
    // Freeze connection, model and bank when enqueued, not when a slot opens.
    const preset = { ...input };
    const currentBank = bank.value;
    return schedule(preset.id, "fingerprint", () =>
      executePreset(preset, proxyBaseURL, currentBank, directFirst),
    );
  }

  async function executePreset(
    preset: EndpointPreset,
    proxyBaseURL: string | undefined,
    currentBank: NonNullable<typeof bank.value>,
    directFirst: boolean,
  ): Promise<PresetRunState> {
    const challenges = generateChallenges(MAX_ATTEMPTS);
    // 必须通过代理更新，不能修改放入 useState 前的原始对象。
    const state = reactive<PresetRunState>({
      status: "running",
      // A cached failure never grants proxy permission. A direct-only batch
      // still tries direct, and can clear an old failure after recovery.
      transport:
        proxyBaseURL && (!directFirst || isDirectBlocked(preset))
          ? "proxy"
          : "direct",
      directNetworkFailed: false,
      earlyStopped: false,
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
      let model = modelForPreset(
        preset,
        state.transport === "proxy" ? proxyBaseURL : undefined,
      );

      async function requestChallenge(challenge: Challenge, index: number) {
        const call = () =>
          generateText({
            model,
            prompt: challenge.prompt,
            temperature: preset.temperature ?? undefined,
            // Don't retry a failed direct probe before switching routes. The
            // fallback reuses this exact challenge, inside the same queue slot.
            maxRetries: directFirst && state.transport === "direct" ? 0 : 1,
            abortSignal: AbortSignal.timeout(180_000),
          });
        try {
          const response = await call();
          if (
            directFirst &&
            state.transport === "direct" &&
            isDirectBlocked(preset)
          )
            clearDirectFailures([preset.id]);
          return response;
        } catch (error) {
          if (!directFirst || state.transport !== "direct") throw error;
          const { kind } = classifyRequestError(error);
          if (kind === "http" && isDirectBlocked(preset))
            clearDirectFailures([preset.id]);
          if (kind !== "network") throw error;
          state.directNetworkFailed = true;
          markDirectFailure(preset);
          if (!proxyBaseURL) throw error;
          state.transport = "proxy";
          state.message = `直连网络失败，已记录标记，正在通过已授权的代理重试挑战 ${index + 1}`;
          model = modelForPreset(preset, proxyBaseURL);
          return call();
        }
      }

      for (
        let index = 0;
        index < challenges.length && state.validCount < TARGET_VALID;
        index += 1
      ) {
        const challenge = challenges[index]!;
        state.steps[index] = "working";
        state.message = `正在请求挑战 ${index + 1}，已有 ${state.validCount}/${TARGET_VALID} 份有效回答`;
        try {
          const { text } = await requestChallenge(challenge, index);
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
            // 使用未四舍五入的模型概率，而不是展示值或家族概率。
            if (state.result.probability >= SUCCESS_PROBABILITY) {
              state.earlyStopped = index < challenges.length - 1;
              break;
            }
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
          const { kind, statusCode } = classifyRequestError(error);
          if (kind === "network" && state.transport === "direct")
            state.directNetworkFailed = true;
          if (
            statusCode === 401 ||
            statusCode === 403 ||
            kind === "network" ||
            kind === "aborted"
          )
            break;
        }
      }
      state.status = state.result ? "success" : "failed";
      state.message = state.result
        ? state.result.probability >= SUCCESS_PROBABILITY
          ? `测试完成：成功检验，归因概率 ≥99%。${state.earlyStopped ? "已停止后续挑战；" : ""}${state.validCount}/${TARGET_VALID} 份有效回答进入归因`
          : `测试完成：${state.validCount}/${TARGET_VALID} 份有效回答进入归因`
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

  function runDegradation(
    input: EndpointPreset,
    proxyBaseURL?: string,
  ): Promise<DegradationRunState> {
    const preset = { ...input };
    return schedule(preset.id, "degradation", async () => {
      const state = reactive<DegradationRunState>({
        status: "running",
        transport: proxyBaseURL ? "proxy" : "direct",
        verdict: null,
        error: null,
      });
      degradationRuns.value = { ...degradationRuns.value, [preset.id]: state };
      try {
        // Exactly one fixed question and one SDK call. No bank analysis,
        // retries, automatic fallback, raw-answer storage or attribution.
        const { text } = await generateText({
          model: modelForPreset(preset, proxyBaseURL),
          prompt: DEGRADATION_PROMPT,
          temperature: preset.temperature ?? undefined,
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(180_000),
        });
        state.verdict = classifyDegradation(text);
        state.status = "success";
      } catch (error) {
        const { kind, statusCode } = classifyRequestError(error);
        state.status = "failed";
        // Error bodies can contain keys or model output; don't display them.
        state.error = kind === "network"
          ? "网络或 CORS 请求失败，可检查连接或授权代理后重试。本次不做判定。"
          : kind === "aborted"
            ? "请求超时或已取消，本次不做判定。"
            : statusCode
              ? `服务商返回 HTTP ${statusCode}，请检查密钥、权限或限流设置。本次不做判定。`
              : "请求未完成，请检查服务商与协议配置。本次不做判定。";
      }
      return state;
    });
  }

  async function runBatch(presets: EndpointPreset[], proxyBaseURL?: string) {
    if (batchRunning.value) return [];
    if (!bank.value) throw new Error("指纹库尚未加载完成");
    const targets: EndpointPreset[] = [];
    const seen = new Set<string>();
    for (const preset of presets) {
      if (testQueue.has(preset.id) || seen.has(preset.id)) continue;
      seen.add(preset.id);
      targets.push({ ...preset });
    }
    batchRunning.value = true;
    try {
      return await Promise.all(
        targets.map((preset) => enqueuePreset(preset, proxyBaseURL, true)),
      );
    } finally {
      batchRunning.value = false;
    }
  }

  return {
    runStates,
    degradationRuns,
    batchRunning,
    queuedIds,
    isRunning,
    isBusy,
    hasDegradationJobs,
    runPreset,
    runBatch,
    runDegradation,
    clearRun,
  };
}
