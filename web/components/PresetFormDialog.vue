<script setup lang="ts">
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ApiType, EndpointPreset } from '@/composables/usePresets'

const props = defineProps<{
  open: boolean
  /** null 表示新增 */
  preset: EndpointPreset | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  save: [input: Omit<EndpointPreset, 'id'>]
}>()

interface FormState {
  name: string
  baseUrl: string
  apiKey: string
  model: string
  apiType: ApiType
  temperature: string
}

const form = reactive<FormState>({
  name: '',
  baseUrl: '',
  apiKey: '',
  model: '',
  apiType: 'chat',
  temperature: '',
})

const errors = reactive<Partial<Record<keyof FormState, string>>>({})

// 打开对话框时用当前预设回填（新增时清空）
watch(
  () => props.open,
  (open) => {
    if (!open) return
    const source = props.preset
    form.name = source?.name ?? ''
    form.baseUrl = source?.baseUrl ?? ''
    form.apiKey = source?.apiKey ?? ''
    form.model = source?.model ?? ''
    form.apiType = source?.apiType ?? 'chat'
    form.temperature = source?.temperature === null || source === null ? '' : String(source.temperature)
    Object.keys(errors).forEach((key) => delete errors[key as keyof FormState])
  },
)

function validate(): boolean {
  Object.keys(errors).forEach((key) => delete errors[key as keyof FormState])
  if (!form.name.trim()) errors.name = '请填写预设名称'
  if (!form.baseUrl.trim()) errors.baseUrl = '请填写 Base URL'
  else if (!/^https?:\/\//.test(form.baseUrl.trim())) errors.baseUrl = 'Base URL 需以 http(s):// 开头'
  if (!form.apiKey.trim()) errors.apiKey = '请填写 API Key'
  if (!form.model.trim()) errors.model = '请填写模型名'
  if (form.temperature.trim() !== '') {
    const value = Number(form.temperature)
    if (!Number.isFinite(value) || value < 0 || value > 2) errors.temperature = '温度需在 0 到 2 之间'
  }
  return Object.keys(errors).length === 0
}

function submit() {
  if (!validate()) return
  emit('save', {
    name: form.name.trim(),
    baseUrl: form.baseUrl.trim().replace(/\/+$/, ''),
    apiKey: form.apiKey.trim(),
    model: form.model.trim(),
    apiType: form.apiType,
    temperature: form.temperature.trim() === '' ? null : Number(form.temperature),
  })
  emit('update:open', false)
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{{ preset ? '编辑预设' : '新增预设' }}</DialogTitle>
        <DialogDescription>
          预设仅保存在当前浏览器的 localStorage 中，API Key 不会上传到任何服务器。
        </DialogDescription>
      </DialogHeader>

      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <div class="flex flex-col gap-2">
          <Label for="preset-name">名称</Label>
          <Input id="preset-name" v-model="form.name" placeholder="例如：OpenAI 官方" :aria-invalid="!!errors.name" />
          <p v-if="errors.name" class="text-sm text-destructive">{{ errors.name }}</p>
        </div>

        <div class="flex flex-col gap-2">
          <Label for="preset-base-url">Base URL</Label>
          <Input
            id="preset-base-url"
            v-model="form.baseUrl"
            placeholder="https://api.openai.com/v1"
            :aria-invalid="!!errors.baseUrl"
          />
          <p v-if="errors.baseUrl" class="text-sm text-destructive">{{ errors.baseUrl }}</p>
        </div>

        <div class="flex flex-col gap-2">
          <Label for="preset-api-key">API Key</Label>
          <Input
            id="preset-api-key"
            v-model="form.apiKey"
            type="password"
            autocomplete="off"
            placeholder="sk-..."
            :aria-invalid="!!errors.apiKey"
          />
          <p v-if="errors.apiKey" class="text-sm text-destructive">{{ errors.apiKey }}</p>
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div class="flex flex-col gap-2">
            <Label for="preset-model">模型</Label>
            <Input
              id="preset-model"
              v-model="form.model"
              placeholder="gpt-4o"
              :aria-invalid="!!errors.model"
            />
            <p v-if="errors.model" class="text-sm text-destructive">{{ errors.model }}</p>
          </div>
          <div class="flex flex-col gap-2">
            <Label>API 协议</Label>
            <Select v-model="form.apiType">
              <SelectTrigger class="w-full">
                <SelectValue placeholder="选择协议" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="chat">Chat Completions</SelectItem>
                  <SelectItem value="responses">Responses API</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div class="flex flex-col gap-2">
          <Label for="preset-temperature">温度（可选）</Label>
          <Input
            id="preset-temperature"
            v-model="form.temperature"
            inputmode="decimal"
            placeholder="留空使用服务端默认"
            :aria-invalid="!!errors.temperature"
          />
          <p v-if="errors.temperature" class="text-sm text-destructive">{{ errors.temperature }}</p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" @click="emit('update:open', false)">取消</Button>
          <Button type="submit">保存</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
