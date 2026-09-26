import type { EndpointPreset } from "../lib/providers";
import {
  decodeDirectFailures,
  DIRECT_FAILURE_STORAGE_KEY,
  type DirectFailure,
} from "../lib/direct-routing";

export function useDirectRouting() {
  const storageError = useState<string | null>(
    "modeltrace:direct-routing:error",
    () => null,
  );
  const failures = useState<Record<string, DirectFailure>>(
    "modeltrace:direct-routing",
    () => {
      try {
        return decodeDirectFailures(
          localStorage.getItem(DIRECT_FAILURE_STORAGE_KEY),
        );
      } catch {
        storageError.value = "直连状态读取失败，批量测试会重新尝试直连。";
        return {};
      }
    },
  );

  function persist(next: Record<string, DirectFailure>) {
    failures.value = next;
    try {
      localStorage.setItem(
        DIRECT_FAILURE_STORAGE_KEY,
        JSON.stringify({ version: 1, failures: next }),
      );
      storageError.value = null;
    } catch {
      storageError.value =
        "直连失败标记仅在本次会话中保留，刷新后会重新尝试直连。";
    }
  }

  function isDirectBlocked(target: EndpointPreset): boolean {
    const entry = failures.value[target.id];
    return (
      !!entry &&
      entry.baseUrl === target.baseUrl &&
      entry.model === target.model &&
      entry.apiType === target.apiType
    );
  }

  function markDirectFailure(target: EndpointPreset) {
    persist({
      ...failures.value,
      [target.id]: {
        baseUrl: target.baseUrl,
        model: target.model,
        apiType: target.apiType,
      },
    });
  }

  function clearDirectFailures(ids: string[]) {
    if (!ids.some((id) => Object.hasOwn(failures.value, id))) return;
    const next = { ...failures.value };
    for (const id of ids) delete next[id];
    persist(next);
  }

  return {
    isDirectBlocked,
    markDirectFailure,
    clearDirectFailures,
    storageError,
  };
}
