import {
  encodePresets,
  LEGACY_PRESET_STORAGE_KEY,
  loadPresets,
  PRESET_STORAGE_KEY,
  type ProviderInput,
  type ProviderPreset,
} from "@/lib/providers";

// Keep the single-request type available to the runner / optional terminal tools.
export { presetLabel } from "@/lib/providers";
export type {
  ApiType,
  EndpointPreset,
  ProviderInput,
  ProviderModel,
  ProviderPreset,
  ModelTarget,
} from "@/lib/providers";

export function usePresets() {
  const storageError = useState<string | null>(
    "modeltrace:presets:storage-error",
    () => null,
  );
  const presets = useState<ProviderPreset[]>("modeltrace:presets", () => {
    try {
      const loaded = loadPresets(localStorage);
      storageError.value = loaded.error;
      return loaded.presets;
    } catch {
      storageError.value = "浏览器存储不可用，配置仅在本次会话中保留。";
      return [];
    }
  });

  function persist() {
    try {
      localStorage.setItem(PRESET_STORAGE_KEY, encodePresets(presets.value));
      storageError.value = null;
    } catch {
      storageError.value =
        "浏览器存储不可用，配置仅在本次会话中保留，刷新后会丢失。";
      return;
    }
    try {
      localStorage.removeItem(LEGACY_PRESET_STORAGE_KEY);
    } catch {
      /* Best-effort cleanup after a durable v2 write. */
    }
  }

  function copy(input: ProviderInput): ProviderInput {
    return { ...input, models: input.models.map((model) => ({ ...model })) };
  }

  function addPreset(input: ProviderInput): ProviderPreset {
    const preset = { ...copy(input), id: crypto.randomUUID() };
    presets.value = [...presets.value, preset];
    persist();
    return preset;
  }

  function updatePreset(id: string, input: ProviderInput) {
    presets.value = presets.value.map((item) =>
      item.id === id ? { ...copy(input), id } : item,
    );
    persist();
  }

  function removePreset(id: string) {
    presets.value = presets.value.filter((item) => item.id !== id);
    persist();
  }

  return { presets, storageError, addPreset, updatePreset, removePreset };
}
