// Endpoint 预设的本地持久化（localStorage，带版本 schema，参考 client-localstorage-schema 规则）

export type ApiType = 'chat' | 'responses'

export interface EndpointPreset {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  model: string
  apiType: ApiType
  /** null 表示不设置，由服务端默认 */
  temperature: number | null
}

interface PresetStorage {
  version: 1
  presets: EndpointPreset[]
}

const STORAGE_KEY = 'modeltrace.presets.v1'

function readStorage(): EndpointPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Partial<PresetStorage>
    if (parsed.version !== 1 || !Array.isArray(parsed.presets)) return []
    return parsed.presets.filter(
      (item): item is EndpointPreset =>
        !!item && typeof item.id === 'string' && typeof item.baseUrl === 'string',
    )
  } catch {
    return []
  }
}

export function usePresets() {
  // 惰性初始化（rerender-lazy-state-init）：ssr: false，setup 只在浏览器执行
  const presets = useState<EndpointPreset[]>('modeltrace:presets', () => readStorage())

  function persist() {
    try {
      const payload: PresetStorage = { version: 1, presets: presets.value }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    } catch {
      // localStorage 不可用时静默降级为内存态
    }
  }

  function addPreset(input: Omit<EndpointPreset, 'id'>): EndpointPreset {
    const preset: EndpointPreset = { ...input, id: crypto.randomUUID() }
    presets.value = [...presets.value, preset]
    persist()
    return preset
  }

  function updatePreset(id: string, input: Omit<EndpointPreset, 'id'>) {
    presets.value = presets.value.map((item) => (item.id === id ? { ...input, id } : item))
    persist()
  }

  function removePreset(id: string) {
    presets.value = presets.value.filter((item) => item.id !== id)
    persist()
  }

  return { presets, addPreset, updatePreset, removePreset }
}
