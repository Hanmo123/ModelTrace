export type ApiType = "chat" | "responses";

export interface ProviderModel {
  id: string;
  model: string;
  apiType: ApiType;
  /** null leaves the upstream default unchanged. */
  temperature: number | null;
}

export interface ProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: ProviderModel[];
}

export type ProviderInput = Omit<ProviderPreset, "id">;

/** An immutable, single-model request target, never a second stored API key. */
export interface EndpointPreset {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  apiType: ApiType;
  temperature: number | null;
}

export interface ModelTarget extends EndpointPreset {
  providerId: string;
  modelId: string;
}

export const PRESET_STORAGE_KEY = "modeltrace.presets.v2";
export const LEGACY_PRESET_STORAGE_KEY = "modeltrace.presets.v1";
export const MAX_PROVIDER_MODELS = 50;

export function presetLabel(preset: { name: string; baseUrl: string }): string {
  if (preset.name.trim()) return preset.name.trim();
  try {
    return new URL(preset.baseUrl).hostname;
  } catch {
    return preset.baseUrl;
  }
}

export function modelRunId(providerId: string, modelId: string): string {
  // Tuple encoding prevents collisions even for imported, non-UUID identifiers.
  return JSON.stringify([providerId, modelId]);
}

export function providerTargets(provider: ProviderPreset): ModelTarget[] {
  return provider.models.map((model) => ({
    id: modelRunId(provider.id, model.id),
    providerId: provider.id,
    modelId: model.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    model: model.model,
    apiType: model.apiType,
    temperature: model.temperature,
  }));
}

export function parseModelIds(text: string): string[] {
  return [...new Set(text.split(/[\s,，;；]+/u).filter(Boolean))];
}

export function invalidatedModelRuns(
  before: ProviderPreset,
  after: ProviderInput,
): string[] {
  const connectionChanged =
    before.baseUrl !== after.baseUrl || before.apiKey !== after.apiKey;
  const next = new Map(after.models.map((model) => [model.id, model]));
  return before.models
    .filter((model) => {
      const updated = next.get(model.id);
      return (
        connectionChanged ||
        !updated ||
        model.model !== updated.model ||
        model.apiType !== updated.apiType ||
        model.temperature !== updated.temperature
      );
    })
    .map((model) => modelRunId(before.id, model.id));
}

const nonempty = (value: unknown): value is string =>
  typeof value === "string" && !!value.trim();
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const temperature = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export function decodePresets(raw: string, version: 1 | 2): ProviderPreset[] {
  const payload: unknown = JSON.parse(raw);
  if (
    !record(payload) ||
    payload.version !== version ||
    !Array.isArray(payload.presets)
  ) {
    throw new Error("不支持的服务商配置格式");
  }
  const ids = new Set<string>();
  const presets: ProviderPreset[] = [];
  for (const item of payload.presets) {
    if (
      !record(item) ||
      !nonempty(item.id) ||
      ids.has(item.id) ||
      typeof item.name !== "string" ||
      !nonempty(item.baseUrl) ||
      !nonempty(item.apiKey)
    )
      continue;
    const source = version === 1 ? [{ ...item, id: item.id }] : item.models;
    if (!Array.isArray(source)) continue;
    const modelIds = new Set<string>();
    const modelNames = new Set<string>();
    const models: ProviderModel[] = [];
    for (const entry of source) {
      if (
        !record(entry) ||
        !nonempty(entry.id) ||
        !nonempty(entry.model) ||
        modelIds.has(entry.id) ||
        modelNames.has(entry.model.trim()) ||
        (entry.apiType !== "chat" && entry.apiType !== "responses")
      )
        continue;
      models.push({
        id: entry.id,
        model: entry.model.trim(),
        apiType: entry.apiType,
        temperature: temperature(entry.temperature),
      });
      modelIds.add(entry.id);
      modelNames.add(entry.model.trim());
    }
    if (!models.length) continue;
    presets.push({
      id: item.id,
      name: presetLabel({ name: item.name, baseUrl: item.baseUrl }),
      baseUrl: item.baseUrl.trim().replace(/\/+$/, ""),
      apiKey: item.apiKey.trim(),
      models,
    });
    ids.add(item.id);
  }
  return presets;
}

export function encodePresets(presets: ProviderPreset[]): string {
  return JSON.stringify({ version: 2, presets });
}

export function loadPresets(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
): {
  presets: ProviderPreset[];
  error: string | null;
} {
  let presets: ProviderPreset[] = [];
  try {
    const current = storage.getItem(PRESET_STORAGE_KEY);
    // An empty v2 collection is intentional: never resurrect deleted v1 presets.
    if (current !== null)
      return { presets: decodePresets(current, 2), error: null };
    const legacy = storage.getItem(LEGACY_PRESET_STORAGE_KEY);
    if (legacy === null) return { presets, error: null };
    presets = decodePresets(legacy, 1);
    storage.setItem(PRESET_STORAGE_KEY, encodePresets(presets));
    // Remove the duplicate plaintext keys only after the migration is durable.
    storage.removeItem(LEGACY_PRESET_STORAGE_KEY);
    return { presets, error: null };
  } catch {
    return {
      presets,
      error:
        "浏览器配置读取或迁移失败，原始数据未主动覆盖。当前配置可能仅在本次会话保留。",
    };
  }
}
