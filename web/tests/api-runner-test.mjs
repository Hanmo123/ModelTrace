// Exercise the real runner with deterministic SDK / attribution responses.
import assert from "node:assert/strict";
import { build } from "esbuild";
import { resolve } from "node:path";

const output = await build({
  stdin: {
    contents: `export { useApiTest } from './app/composables/useApiTest';
      export { useDirectRouting } from './app/composables/useDirectRouting';
      export { usePresets } from './app/composables/usePresets';
      export { providerTargets } from './app/lib/providers';
      export { classifyRequestError, decodeDirectFailures, DIRECT_FAILURE_STORAGE_KEY } from './app/lib/direct-routing';`,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  plugins: [
    {
      name: "runner-fixtures",
      setup(build) {
        const modules = {
          ai: `export async function generateText(options) {
          const s = globalThis.runnerScenario;
          const call = { ...options.model, prompt: options.prompt, maxRetries: options.maxRetries };
          s.calls.push(call);
          s.active++; s.peak = Math.max(s.peak, s.active);
          await new Promise(resolve => setTimeout(resolve, 5));
          s.active--;
          const failure = s.failure?.(call);
          if (failure) throw failure;
          if (s.failModels?.includes(options.model.id)) throw Object.assign(new Error('mock auth failure'), {statusCode: 401});
          const text = s.textByModel?.[call.id] ?? s.text;
          return { text: typeof text === 'string' ? text : s.invalid ? '1 2 3' : Array(310).fill('42').join(' ') };
        }`,
          "@ai-sdk/openai": `export function createOpenAI(config) {
          return { chat: id => ({id, config, apiType: 'chat'}), responses: id => ({id, config, apiType: 'responses'}) };
        }`,
          "@/lib/challenge": `export function generateChallenges(count) {
          return Array.from({length: count}, (_, id) => ({id, prompt: 'numbers ' + id, expected_count: 300}));
        }`,
          "@/lib/fingerprint": `export function parseNumbers(text) { return text.split(' '); }
          export function analyzeGlobalOutputs() {
            const s = globalThis.runnerScenario;
            return {probability: s.probabilities[Math.min(s.analyzed++, s.probabilities.length - 1)]};
          }`,
        };
        build.onResolve({ filter: /^@\/lib\/providers$/ }, () => ({ path: resolve('app/lib/providers.ts') }));
        build.onResolve(
          { filter: /^(ai|@ai-sdk\/openai|@\/lib\/(challenge|fingerprint))$/ },
          (args) => ({ path: args.path, namespace: "fixture" }),
        );
        build.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          contents: modules[args.path],
          loader: "js",
        }));
      },
    },
  ],
});
let states = new Map();
let storage = new Map();
// Object.assign avoids declaring Nuxt auto-import globals in the app's TS scope.
Object.assign(globalThis, {
  useState: (key, init) => {
    if (!states.has(key)) states.set(key, { value: init() });
    return states.get(key);
  },
  reactive: (value) => value,
  useBank: () => ({ bank: { value: globalThis.runnerScenario?.noBank ? null : {} } }),
  localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => {
      if (globalThis.runnerScenario.storageBroken) throw new Error('Storage unavailable');
      storage.set(key, value);
    },
    removeItem: (key) => storage.delete(key),
  },
});
const { useApiTest, useDirectRouting, usePresets, providerTargets, classifyRequestError, decodeDirectFailures, DIRECT_FAILURE_STORAGE_KEY } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].contents).toString("base64")}`
);
const preset = {
  id: "one",
  name: "one",
  model: "test",
  apiType: "chat",
  baseUrl: "https://api.vendor.com/v1",
  apiKey: "test-only",
};
function reset(probabilities, invalid = false, keepStorage = false) {
  states = new Map();
  if (!keepStorage) storage = new Map();
  globalThis.runnerScenario = {
    probabilities,
    invalid,
    calls: [],
    analyzed: 0,
    active: 0,
    peak: 0,
  };
  return useApiTest();
}
for (const [probabilities, expectedCalls] of [
  [[0.99], 1],
  [[1], 1],
  [[0.8, 0.99], 2],
  [[0.989999], 3], // Rounded display may be 99%; raw probability is below threshold.
  [[0.4, 0.7, 0.99], 3],
]) {
  const runner = reset(probabilities);
  const result = await runner.runPreset(preset);
  assert.equal(runnerScenario.calls.length, expectedCalls);
  assert.equal(result.challenges.length, 3);
  assert.equal(result.validCount, expectedCalls);
  assert.equal(result.earlyStopped, expectedCalls < 3);
  assert.equal(result.status, "success");
  assert.equal(result.transport, "direct");
  assert.deepEqual(
    result.steps,
    Array.from({ length: 3 }, (_, i) =>
      i < expectedCalls ? "done" : "skipped",
    ),
  );
  if (result.result.probability >= 0.99)
    assert.match(result.message, /成功检验/);
}
const invalid = await reset([1], true).runPreset(preset);
assert.equal(runnerScenario.calls.length, 3);
assert.equal(invalid.status, "failed");
assert.equal(invalid.result, null);
const batch = reset([0.99]);
await batch.runBatch(
  Array.from({ length: 4 }, (_, i) => ({ ...preset, id: String(i) })),
  "https://proxy.vendor.com/v1",
);
assert.equal(runnerScenario.calls.length, 4);
assert.equal(runnerScenario.peak, 2);
for (const call of runnerScenario.calls) {
  assert.equal(call.config.baseURL, preset.baseUrl);
  assert.equal(call.config.headers, undefined);
  assert.equal(call.maxRetries, 0);
}
assert(
  Object.values(batch.runStates.value).every(
    (state) => state.transport === "direct" && state.earlyStopped,
  ),
);
assert.equal(batch.batchRunning.value, false);
assert.deepEqual(batch.queuedIds.value, []);
// Single clicks and provider/global batches share one queue, including deduplication.
const shared = reset([0.99]);
const one = shared.runPreset({
  ...preset,
  id: "provider-a/model-a",
  model: "first",
});
assert.equal(
  shared.runPreset({ ...preset, id: "provider-a/model-a", model: "duplicate" }),
  one,
);
const two = shared.runPreset({
  ...preset,
  id: "provider-a/model-b",
  model: "second",
});
const queuedInput = { ...preset, id: "provider-b/model-a", model: "snapshot" };
const waiting = shared.runPreset(queuedInput);
assert(shared.queuedIds.value.includes(queuedInput.id));
assert(shared.isBusy(queuedInput.id));
queuedInput.model = "mutated-after-enqueue";
const together = shared.runBatch([
  { ...preset, id: "provider-a/model-a", model: "already-running" },
  { ...preset, id: "provider-b/model-b", model: "batch" },
  { ...preset, id: "provider-b/model-b", model: "duplicate-batch" },
]);
await Promise.all([one, two, waiting, together]);
assert.equal(runnerScenario.peak, 2);
assert.deepEqual(
  runnerScenario.calls.map((call) => call.id),
  ["first", "second", "snapshot", "batch"],
);
assert.equal(Object.keys(shared.runStates.value).length, 4);
assert.deepEqual(shared.queuedIds.value, []);
assert.equal(shared.batchRunning.value, false);

const isolated = reset([0.99]);
runnerScenario.failModels = ["bad-model"];
const finished = await isolated.runBatch([
  { ...preset, id: "provider/model-one", model: "bad-model" },
  { ...preset, id: "provider/model-two", model: "good-model" },
  { ...preset, id: "other-provider/model-one", model: "good-model" },
]);
assert.deepEqual(
  finished.map((state) => state.status),
  ["failed", "success", "success"],
);
assert.equal(
  runnerScenario.calls.filter((call) => call.id === "bad-model").length,
  1,
);
assert.notEqual(
  isolated.runStates.value["provider/model-two"],
  isolated.runStates.value["other-provider/model-one"],
);
// Existing presets have no route cache and must be tried directly, even with
// remembered proxy permission. Failures are isolated by provider/model identity.
const proxyURL = "https://proxy.vendor.com/v1";
const blocked = { ...preset, id: "provider-a/model-a", model: "blocked" };
const reachable = { ...preset, id: "provider-a/model-b", model: "reachable", apiType: "responses" };
const sameModelElsewhere = { ...blocked, id: "provider-b/model-a", baseUrl: "https://other.vendor.com/v1" };
const mixedTargets = [blocked, reachable, sameModelElsewhere];
const networkFailure = () => Object.assign(new Error("SDK wrapped error"), {
  lastError: new TypeError("Failed to fetch"),
});
const failBlockedDirect = (call) =>
  call.id === blocked.model && call.config.baseURL === blocked.baseUrl ? networkFailure() : undefined;
const mixed = reset([0.99]);
runnerScenario.failure = failBlockedDirect;
const mixedResults = await mixed.runBatch(mixedTargets, proxyURL);
assert.deepEqual(mixedResults.map((state) => state.transport), ["proxy", "direct", "direct"]);
assert.equal(mixedResults[0].directNetworkFailed, true);
assert.equal(runnerScenario.calls.length, 4);
assert.equal(runnerScenario.peak, 2);
const attempted = runnerScenario.calls.filter((call) =>
  call.id === blocked.model && call.config.baseURL !== sameModelElsewhere.baseUrl,
);
assert.deepEqual(attempted.map((call) => call.config.baseURL), [blocked.baseUrl, proxyURL]);
assert.equal(attempted[0].prompt, attempted[1].prompt, "Fallback must retry the same challenge");
assert.equal(attempted[1].config.headers["X-ModelTrace-Endpoint"], blocked.baseUrl);
assert.equal(runnerScenario.calls.find((call) => call.id === reachable.model).apiType, "responses");
assert.equal(useDirectRouting().isDirectBlocked(blocked), true);
assert.equal(useDirectRouting().isDirectBlocked(reachable), false);
assert.equal(useDirectRouting().isDirectBlocked(sameModelElsewhere), false);
assert(!storage.get(DIRECT_FAILURE_STORAGE_KEY).includes(preset.apiKey));

const restored = reset([0.99], false, true);
runnerScenario.failure = failBlockedDirect;
await restored.runBatch(mixedTargets, proxyURL);
assert.equal(runnerScenario.calls.length, 3, "Reloaded failures skip the direct attempt");
assert(!runnerScenario.calls.some((call) => call.id === blocked.model && call.config.baseURL === blocked.baseUrl));
assert.equal(useDirectRouting().isDirectBlocked({ ...blocked, baseUrl: "https://changed.vendor.com/v1" }), false);
assert.equal(useDirectRouting().isDirectBlocked({ ...blocked, apiType: "responses" }), false);
assert.equal(useDirectRouting().isDirectBlocked({ ...blocked, model: "changed-model" }), false);

// A failure mark cannot grant consent. Direct-only requests can also discover
// that the connection recovered and clear the old mark.
runnerScenario.calls = [];
const [declined] = await restored.runBatch([blocked]);
assert.equal(declined.status, "failed");
assert.equal(declined.transport, "direct");
assert.equal(runnerScenario.calls.length, 1);
assert.equal(runnerScenario.calls[0].config.baseURL, blocked.baseUrl);
assert.equal(useDirectRouting().isDirectBlocked(blocked), true);
runnerScenario.calls = [];
runnerScenario.failure = undefined;
await restored.runBatch([blocked]);
assert.equal(useDirectRouting().isDirectBlocked(blocked), false);
assert.equal(runnerScenario.calls[0].config.baseURL, blocked.baseUrl);

// Switching mid-run preserves earlier answers and the remaining challenge
// budget. Failed direct attempts are not retried by the SDK before fallback.
const middle = reset([0.5]);
runnerScenario.failure = call => call.config.baseURL === preset.baseUrl && call.prompt === "numbers 1" ? networkFailure() : undefined;
const [continued] = await middle.runBatch([preset], proxyURL);
assert.equal(continued.validCount, 3);
assert.equal(continued.challenges.length, 3);
assert.deepEqual(continued.steps, ["done", "done", "done"]);
assert.deepEqual(runnerScenario.calls.map(call => call.config.baseURL), [preset.baseUrl, preset.baseUrl, proxyURL, proxyURL]);
assert.deepEqual(runnerScenario.calls.map(call => call.prompt), ["numbers 0", "numbers 1", "numbers 1", "numbers 2"]);
assert.deepEqual(runnerScenario.calls.map(call => call.maxRetries), [0, 0, 1, 1]);

// HTTP errors and malformed model output say nothing about CORS. Even an
// upstream error mentioning "CORS" must never cause key forwarding to a proxy.
for (const statusCode of [200, 401, 403, 404, 429, 503]) {
  const http = reset([0.99]);
  runnerScenario.failure = () => Object.assign(new Error("CORS / Failed to fetch test-only"), { statusCode });
  const [result] = await http.runBatch([preset], proxyURL);
  assert.equal(result.transport, "direct");
  assert.equal(result.directNetworkFailed, false);
  assert.equal(useDirectRouting().isDirectBlocked(preset), false);
  assert(runnerScenario.calls.every(call => call.config.baseURL === preset.baseUrl));
  assert(!result.errors.join().includes(preset.apiKey));
}
for (const name of ["AbortError", "TimeoutError"]) {
  const cancelled = reset([0.99]);
  runnerScenario.failure = () => Object.assign(new Error("Failed to fetch"), { name });
  await cancelled.runBatch([preset], proxyURL);
  assert.equal(runnerScenario.calls.length, 1);
  assert.equal(useDirectRouting().isDirectBlocked(preset), false);
  assert.equal(runnerScenario.calls[0].config.baseURL, preset.baseUrl);
}
const short = reset([0.99], true);
await short.runBatch([preset], proxyURL);
assert.equal(runnerScenario.calls.length, 3);
assert.equal(useDirectRouting().isDirectBlocked(preset), false);
assert(runnerScenario.calls.every(call => call.config.baseURL === preset.baseUrl));

const proxyFails = reset([0.99]);
runnerScenario.failure = call => call.config.baseURL === proxyURL
  ? Object.assign(new Error("Proxy auth failure"), { statusCode: 401 })
  : networkFailure();
const [failedFallback] = await proxyFails.runBatch([preset], proxyURL);
assert.equal(failedFallback.status, "failed");
assert.equal(runnerScenario.calls.length, 2);
assert.equal(useDirectRouting().isDirectBlocked(preset), true);

// Single-model explicit proxy tests remain unchanged and do not pretend that
// they established direct connectivity for a future batch.
const singleProxy = reset([0.99]);
await singleProxy.runPreset(preset, proxyURL);
assert.equal(runnerScenario.calls[0].config.baseURL, proxyURL);
assert.equal(useDirectRouting().isDirectBlocked(preset), false);
runnerScenario.calls = [];
await singleProxy.runBatch([preset], proxyURL);
assert.equal(runnerScenario.calls[0].config.baseURL, preset.baseUrl);

const temporary = reset([0.99]);
runnerScenario.storageBroken = true;
runnerScenario.failure = failBlockedDirect;
await temporary.runBatch([blocked], proxyURL);
assert.equal(useDirectRouting().isDirectBlocked(blocked), true);
assert.match(useDirectRouting().storageError.value, /本次会话/);
runnerScenario.calls = [];
await temporary.runBatch([blocked], proxyURL);
assert.equal(runnerScenario.calls.length, 1);
assert.equal(runnerScenario.calls[0].config.baseURL, proxyURL);

// Configuration changes invalidate only the affected marks. Credential changes
// are handled here rather than persisting a duplicate API key in the cache.
reset([0.99]);
const store = usePresets();
const routing = useDirectRouting();
const provider = store.addPreset({ name: "Original", baseUrl: preset.baseUrl, apiKey: preset.apiKey,
  models: [{ id: "a", model: "alpha", apiType: "chat", temperature: null }, { id: "b", model: "beta", apiType: "responses", temperature: null }] });
const other = store.addPreset({ ...provider, name: "Other", models: [{ ...provider.models[0] }] });
const originalTargets = providerTargets(provider);
[...originalTargets, ...providerTargets(other)].forEach(routing.markDirectFailure);
store.updatePreset(provider.id, { ...provider, name: "Renamed", models: [...provider.models].reverse() });
assert(originalTargets.every(routing.isDirectBlocked));
store.updatePreset(provider.id, { ...provider, models: provider.models.map(model => model.id === "a" ? { ...model, model: "updated-alpha" } : model) });
assert.equal(routing.isDirectBlocked(originalTargets[0]), false);
assert.equal(routing.isDirectBlocked(originalTargets[1]), true);
assert.equal(routing.isDirectBlocked(providerTargets(other)[0]), true);
store.updatePreset(provider.id, { ...provider, apiKey: "replacement-key" });
assert.equal(routing.isDirectBlocked(originalTargets[1]), false);
assert.equal(routing.isDirectBlocked(providerTargets(other)[0]), true);
store.removePreset(other.id);
assert.equal(routing.isDirectBlocked(providerTargets(other)[0]), false);
routing.markDirectFailure(originalTargets[0]);
routing.clearDirectFailures([originalTargets[0].id]);
assert.equal(routing.isDirectBlocked(originalTargets[0]), false);

assert.deepEqual(decodeDirectFailures(null), {});
assert.throws(() => decodeDirectFailures("invalid JSON"));
assert.deepEqual(decodeDirectFailures(JSON.stringify({ version: 1, failures: { bad: { apiType: "unknown" } } })), {});
assert.deepEqual(classifyRequestError({ cause: new TypeError("Load failed") }), { kind: "network" });
assert.deepEqual(classifyRequestError({ lastError: { statusCode: 429, message: "CORS" } }), { kind: "http", statusCode: 429 });
const cycle = new Error("Unknown failure");
cycle.cause = cycle;
assert.deepEqual(classifyRequestError(cycle), { kind: "other" });

// The private diagnostic has one fixed request and no attribution, retries,
// raw-output retention, bank dependency or result sharing with fingerprint mode.
const question = 'what is your juice number divided by 2 multiplied by 10 divided by 5';
for (const [text, verdict] of [["I can't disclose private-magic-output", 'normal'], ['64', 'degraded'], ['', 'degraded'], ['assistant guidelines', 'normal']]) {
  reset([]);
  runnerScenario.noBank = true;
  runnerScenario.text = text;
  const diagnostic = useApiTest();
  const result = await diagnostic.runDegradation(preset);
  assert.equal(runnerScenario.calls.length, 1);
  assert.equal(runnerScenario.calls[0].prompt, question);
  assert.equal(runnerScenario.calls[0].maxRetries, 0);
  assert.equal(runnerScenario.analyzed, 0);
  assert.equal(result.verdict, verdict);
  assert.equal(result.status, 'success');
  assert.deepEqual(Object.keys(result).sort(), ['error', 'status', 'transport', 'verdict']);
  assert(!JSON.stringify(result).includes('private-magic-output'));
  assert.deepEqual(diagnostic.runStates.value, {});
  diagnostic.clearRun(preset.id);
  assert.deepEqual(diagnostic.degradationRuns.value, {});
}
const diagnosticFailure = reset([]);
runnerScenario.failure = () => Object.assign(new Error("can't original number test-only private-error-body"), { statusCode: 503 });
const failedDiagnostic = await diagnosticFailure.runDegradation(preset, proxyURL);
assert.equal(failedDiagnostic.status, 'failed');
assert.equal(failedDiagnostic.verdict, null);
assert.equal(runnerScenario.calls.length, 1);
assert.equal(runnerScenario.calls[0].config.baseURL, proxyURL);
assert(!JSON.stringify(failedDiagnostic).includes('private-error-body'));
assert(!JSON.stringify(failedDiagnostic).includes(preset.apiKey));
assert.equal(useDirectRouting().isDirectBlocked(preset), false);

const crossMode = reset([0.99]);
runnerScenario.textByModel = { diagnosis: 'original number', queuedDiagnosis: 'starting number' };
const diagnosticInput = { ...preset, model: 'diagnosis' };
const started = crossMode.runDegradation(diagnosticInput);
assert.equal(crossMode.runDegradation(diagnosticInput), started);
assert(crossMode.isBusy(preset.id));
await assert.rejects(crossMode.runPreset(preset), /其他测试/);
const normalRun = crossMode.runPreset({ ...preset, id: 'normal-mode', model: 'normal-model' });
const laterInput = { ...preset, id: 'queued-diagnostic', model: 'queuedDiagnosis', apiType: 'responses' };
const later = crossMode.runDegradation(laterInput, proxyURL);
laterInput.model = 'mutated-after-enqueue';
const [firstVerdict, fingerprint, lastVerdict] = await Promise.all([started, normalRun, later]);
assert.equal(runnerScenario.peak, 2);
assert.equal(runnerScenario.calls.length, 3);
assert.equal(firstVerdict.verdict, 'normal');
assert.equal(lastVerdict.verdict, 'normal');
assert.equal(fingerprint.result.probability, 0.99);
assert.equal(runnerScenario.analyzed, 1);
assert.equal(runnerScenario.calls[2].id, 'queuedDiagnosis');
assert.equal(runnerScenario.calls[2].apiType, 'responses');
assert.equal(crossMode.runStates.value[preset.id], undefined);
assert.equal(crossMode.degradationRuns.value['normal-mode'], undefined);
assert.equal(crossMode.isBusy(preset.id), false);
assert.deepEqual(crossMode.queuedIds.value, []);

console.log(
  'PASS fingerprint limits/queue/direct-first routing plus single-question binary diagnostics, independent states, cross-mode locking, shared concurrency and no attribution/raw output',
);
