export type ApiType = "chat" | "responses";

export interface ProviderModel {
  id: string;
  model: string;
  apiType: ApiType;
  /** null leaves the upstream default unchanged. */
  temperature: number | null;
}

export interface ProviderChannel {
  id: string;
  name: string;
  /** Decimal string: display metadata, never a quality score or request parameter. */
  multiplier: string;
  apiKey: string;
  models: ProviderModel[];
}

export interface ProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  channels: ProviderChannel[];
}
export type ProviderInput = Omit<ProviderPreset, "id">;

/** An immutable request snapshot, never a second persisted API key. */
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
  channelId: string;
  channelName: string;
  multiplier: string;
  modelId: string;
}

export const PRESET_STORAGE_KEY = "modeltrace.presets.v3";
export const PREVIOUS_PRESET_STORAGE_KEY = "modeltrace.presets.v2";
export const LEGACY_PRESET_STORAGE_KEY = "modeltrace.presets.v1";
export const DEFAULT_CHANNEL_ID = "default";
export const MAX_PROVIDER_CHANNELS = 20;
export const MAX_CHANNEL_MODELS = 50;

export function normalizeMultiplier(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  if (!/^\d{1,9}(?:\.\d{1,6})?$/.test(text)) return null;
  const [integer, fraction = ""] = text.split(".");
  const whole = integer!.replace(/^0+(?=\d)/, "");
  const decimal = fraction.replace(/0+$/, "");
  return decimal ? `${whole}.${decimal}` : whole;
}

export function presetLabel(preset: { name: string; baseUrl: string }): string {
  if (preset.name.trim()) return preset.name.trim();
  try {
    return new URL(preset.baseUrl).hostname;
  } catch {
    return preset.baseUrl;
  }
}
export function targetLabel(target: ModelTarget): string {
  return `${presetLabel(target)} · ${target.channelName} · ${target.model}`;
}
export function modelRunId(
  providerId: string,
  channelId: string,
  modelId: string,
): string {
  return JSON.stringify([providerId, channelId, modelId]);
}
export function channelTargets(
  provider: ProviderPreset,
  channel: ProviderChannel,
): ModelTarget[] {
  return channel.models.map((model) => ({
    id: modelRunId(provider.id, channel.id, model.id),
    providerId: provider.id,
    channelId: channel.id,
    channelName: channel.name,
    multiplier: channel.multiplier,
    modelId: model.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    apiKey: channel.apiKey,
    model: model.model,
    apiType: model.apiType,
    temperature: model.temperature,
  }));
}
export function providerTargets(provider: ProviderPreset): ModelTarget[] {
  return provider.channels.flatMap((channel) =>
    channelTargets(provider, channel),
  );
}
export function parseModelIds(text: string): string[] {
  return [...new Set(text.split(/[\s,，;；]+/u).filter(Boolean))];
}
export function invalidatedModelRuns(
  before: ProviderPreset,
  after: ProviderInput,
): string[] {
  const next = new Map(
    providerTargets({ ...after, id: before.id }).map((target) => [
      target.id,
      target,
    ]),
  );
  return providerTargets(before)
    .filter((target) => {
      const updated = next.get(target.id);
      return (
        !updated ||
        target.baseUrl !== updated.baseUrl ||
        target.apiKey !== updated.apiKey ||
        target.model !== updated.model ||
        target.apiType !== updated.apiType ||
        target.temperature !== updated.temperature
      );
    })
    .map((target) => target.id);
}

const nonempty = (value: unknown): value is string =>
  typeof value === "string" && !!value.trim();
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const temperature = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function decodeModels(source: unknown): ProviderModel[] {
  if (!Array.isArray(source)) return [];
  const ids = new Set<string>();
  const names = new Set<string>();
  const models: ProviderModel[] = [];
  for (const entry of source) {
    if (
      !record(entry) ||
      !nonempty(entry.id) ||
      !nonempty(entry.model) ||
      ids.has(entry.id) ||
      names.has(entry.model.trim()) ||
      (entry.apiType !== "chat" && entry.apiType !== "responses")
    )
      continue;
    models.push({
      id: entry.id,
      model: entry.model.trim(),
      apiType: entry.apiType,
      temperature: temperature(entry.temperature),
    });
    ids.add(entry.id);
    names.add(entry.model.trim());
  }
  return models;
}

export function decodePresets(
  raw: string,
  version: 1 | 2 | 3,
): ProviderPreset[] {
  const payload: unknown = JSON.parse(raw);
  if (
    !record(payload) ||
    payload.version !== version ||
    !Array.isArray(payload.presets)
  )
    throw new Error("不支持的服务商配置格式");
  const ids = new Set<string>();
  const presets: ProviderPreset[] = [];
  for (const item of payload.presets) {
    if (
      !record(item) ||
      !nonempty(item.id) ||
      ids.has(item.id) ||
      typeof item.name !== "string" ||
      !nonempty(item.baseUrl)
    )
      continue;
    const source =
      version === 3
        ? item.channels
        : [
            {
              id: DEFAULT_CHANNEL_ID,
              name: "默认渠道",
              multiplier: "1",
              apiKey: item.apiKey,
              models: version === 1 ? [{ ...item, id: item.id }] : item.models,
            },
          ];
    if (!Array.isArray(source)) continue;
    const channelIds = new Set<string>();
    const channels: ProviderChannel[] = [];
    for (const entry of source) {
      if (
        !record(entry) ||
        !nonempty(entry.id) ||
        channelIds.has(entry.id) ||
        !nonempty(entry.name) ||
        !nonempty(entry.apiKey)
      )
        continue;
      const multiplier = normalizeMultiplier(entry.multiplier);
      const models = decodeModels(entry.models);
      if (multiplier === null || !models.length) continue;
      channels.push({
        id: entry.id,
        name: entry.name.trim(),
        multiplier,
        apiKey: entry.apiKey.trim(),
        models,
      });
      channelIds.add(entry.id);
    }
    if (!channels.length) continue;
    presets.push({
      id: item.id,
      name: presetLabel({ name: item.name, baseUrl: item.baseUrl }),
      baseUrl: item.baseUrl.trim().replace(/\/+$/, ""),
      channels,
    });
    ids.add(item.id);
  }
  return presets;
}
export function encodePresets(presets: ProviderPreset[]): string {
  return JSON.stringify({ version: 3, presets });
}
export function loadPresets(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
): { presets: ProviderPreset[]; error: string | null } {
  let presets: ProviderPreset[] = [];
  try {
    const current = storage.getItem(PRESET_STORAGE_KEY);
    // An explicitly empty collection is authoritative at every schema version.
    if (current !== null)
      return { presets: decodePresets(current, 3), error: null };
    const previous = storage.getItem(PREVIOUS_PRESET_STORAGE_KEY);
    const legacy =
      previous === null ? storage.getItem(LEGACY_PRESET_STORAGE_KEY) : null;
    if (previous === null && legacy === null) return { presets, error: null };
    presets = decodePresets((previous ?? legacy)!, previous !== null ? 2 : 1);
    storage.setItem(PRESET_STORAGE_KEY, encodePresets(presets));
    // Only remove duplicate plaintext credentials after the new write succeeds.
    storage.removeItem(PREVIOUS_PRESET_STORAGE_KEY);
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
