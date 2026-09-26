import type { ApiType } from "./providers";

export const DIRECT_FAILURE_STORAGE_KEY = "modeltrace.direct-failures.v1";

// No API keys, prompts, responses or error bodies are stored in this cache.
export interface DirectFailure {
  baseUrl: string;
  model: string;
  apiType: ApiType;
}

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export function decodeDirectFailures(
  raw: string | null,
): Record<string, DirectFailure> {
  if (raw === null) return {};
  const payload: unknown = JSON.parse(raw);
  if (!record(payload) || payload.version !== 1 || !record(payload.failures))
    throw new Error("不支持的直连状态格式");
  const entries: [string, DirectFailure][] = [];
  for (const [id, entry] of Object.entries(payload.failures)) {
    if (
      record(entry) &&
      typeof entry.baseUrl === "string" &&
      typeof entry.model === "string" &&
      (entry.apiType === "chat" || entry.apiType === "responses")
    ) {
      entries.push([id, {
        baseUrl: entry.baseUrl,
        model: entry.model,
        apiType: entry.apiType,
      }]);
    }
  }
  return Object.fromEntries(entries);
}

export function classifyRequestError(error: unknown): {
  kind: "network" | "http" | "aborted" | "other";
  statusCode?: number;
} {
  // AI SDK may wrap fetch errors in APICallError / RetryError. Inspect causes,
  // but never treat an HTTP error message mentioning CORS as a transport error.
  const pending: unknown[] = [error];
  const seen = new Set<object>();
  let network = false;
  let aborted = false;
  let statusCode: number | undefined;
  while (pending.length && seen.size < 50) {
    const item = pending.pop();
    if (!record(item) || seen.has(item)) continue;
    seen.add(item);
    const status = item.statusCode ??
      (record(item.response) ? item.response.status : undefined);
    if (typeof status === "number" && status >= 100 && status <= 599)
      statusCode ??= status;
    if (item.name === "AbortError" || item.name === "TimeoutError")
      aborted = true;
    if (
      item.name === "NetworkError" ||
      (typeof item.message === "string" &&
        /failed to fetch|fetch failed|networkerror|network error|network request failed|load failed|\bcors\b/i.test(item.message))
    )
      network = true;
    if (
      typeof item.code === "string" &&
      /^(ECONNREFUSED|ECONNRESET|ENOTFOUND|ERR_NETWORK)$/.test(item.code)
    )
      network = true;
    pending.push(item.cause, item.lastError);
    if (Array.isArray(item.errors)) pending.push(...item.errors.slice(0, 50));
  }
  if (aborted) return { kind: "aborted" };
  if (statusCode !== undefined) return { kind: "http", statusCode };
  return { kind: network ? "network" : "other" };
}
