<script setup lang="ts">
import { ChevronDown, Loader2, Pencil, Play, Plus, Server, Trash2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import type { EndpointPreset } from '@/composables/usePresets'
import type { StepState } from '@/composables/useApiTest'
import { percent } from '@/lib/format'
import { cn } from '@/lib/utils'

const { presets, addPreset, updatePreset, removePreset } = usePresets()
const { runStates, batchRunning, isRunning, runPreset, clearRun } = useApiTest()
const { bank } = useBank()

const dialogOpen = ref(false)
const editingPreset = ref<EndpointPreset | null>(null)
const deletingPreset = ref<EndpointPreset | null>(null)
const expandedResults = ref<Set<string>>(new Set())

const STEP_LABELS: Record<StepState, string> = {
  pending: '等待',
  working: '请求中',
  done: '有效',
  invalid: '数字不足',
  error: '失败',
  skipped: '未调用',
}

const stepClass = (step: StepState) =>
  ({
    pending: 'border-border text-muted-foreground',
    working: 'border-blue-200 bg-blue-50 text-blue-700',
    done: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    invalid: 'border-amber-200 bg-amber-50 text-amber-700',
    error: 'border-red-200 bg-red-50 text-red-700',
    skipped: 'border-border text-muted-foreground line-through',
  })[step]

function openCreate() {
  editingPreset.value = null
  dialogOpen.value = true
}

function openEdit(preset: EndpointPreset) {
  editingPreset.value = preset
  dialogOpen.value = true
}

function handleSave(input: Omit<EndpointPreset, 'id'>) {
  if (editingPreset.value) {
    updatePreset(editingPreset.value.id, input)
    toast.success(`预设「${input.name}」已更新`)
  } else {
    addPreset(input)
    toast.success(`预设「${input.name}」已创建`)
  }
}

function confirmDelete() {
  if (!deletingPreset.value) return
  clearRun(deletingPreset.value.id)
  removePreset(deletingPreset.value.id)
  toast.success(`预设「${deletingPreset.value.name}」已删除`)
  deletingPreset.value = null
}

async function handleTest(preset: EndpointPreset) {
  if (!bank.value) {
    toast.error('指纹库尚未加载完成，请稍后再试')
    return
  }
  expandedResults.value = new Set(expandedResults.value).add(preset.id)
  const state = await runPreset(preset)
  if (state.status === 'success' && state.result) {
    toast.success(
      `「${preset.name}」检测完成：${state.result.prediction_name}（${percent(state.result.probability)}）`,
    )
  } else {
    toast.error(`「${preset.name}」检测失败：${state.message}`)
  }
}

function toggleExpanded(presetId: string) {
  const next = new Set(expandedResults.value)
  if (next.has(presetId)) next.delete(presetId)
  else next.add(presetId)
  expandedResults.value = next
}

function maskApiKey(key: string): string {
  if (key.length <= 8) return '••••••••'
  return `${key.slice(0, 4)}…${key.slice(-4)}`
}
</script>

<template>
  <Card>
    <CardHeader>
      <div class="flex items-center justify-between">
        <div>
          <CardTitle>Endpoint 预设</CardTitle>
          <CardDescription>
            保存多组 Base URL + API Key + 模型组合，仅存储在浏览器 localStorage。检测时逐组发送最多 6 次挑战，凑齐 3 份有效回答后本地归因。
          </CardDescription>
        </div>
        <Button @click="openCreate">
          <Plus data-icon="inline-start" />
          新增预设
        </Button>
      </div>
    </CardHeader>
    <CardContent>
      <Empty v-if="!presets.length" class="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Server />
          </EmptyMedia>
          <EmptyTitle>暂无预设</EmptyTitle>
          <EmptyDescription>点击「新增预设」添加第一组 Endpoint 与 API Key。</EmptyDescription>
        </EmptyHeader>
      </Empty>

      <div v-else class="flex flex-col gap-4">
        <div
          v-for="preset in presets"
          :key="preset.id"
          class="flex flex-col gap-3 rounded-lg border p-4"
        >
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <strong class="truncate text-sm">{{ preset.name }}</strong>
                <Badge variant="secondary" class="shrink-0">
                  {{ preset.apiType === 'responses' ? 'Responses' : 'Chat' }}
                </Badge>
              </div>
              <span class="block truncate text-xs text-muted-foreground" :title="preset.baseUrl">
                {{ preset.baseUrl }}
              </span>
              <div class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>模型：<code class="rounded bg-muted px-1 py-0.5">{{ preset.model }}</code></span>
                <span>密钥：<code class="rounded bg-muted px-1 py-0.5">{{ maskApiKey(preset.apiKey) }}</code></span>
                <span v-if="preset.temperature !== null">温度：{{ preset.temperature }}</span>
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <Button
                size="sm"
                :disabled="isRunning(preset.id) || batchRunning"
                @click="handleTest(preset)"
              >
                <Loader2 v-if="isRunning(preset.id)" class="animate-spin" data-icon="inline-start" />
                <Play v-else data-icon="inline-start" />
                {{ isRunning(preset.id) ? '检测中' : '测试' }}
              </Button>
              <Button variant="ghost" size="sm" :disabled="isRunning(preset.id)" @click="openEdit(preset)">
                <Pencil data-icon="inline-start" />
                编辑
              </Button>
              <Button variant="ghost" size="sm" :disabled="isRunning(preset.id)" @click="deletingPreset = preset">
                <Trash2 data-icon="inline-start" />
                删除
              </Button>
            </div>
          </div>

          <template v-if="runStates[preset.id]">
            <Separator />
            <div class="flex flex-col gap-2">
              <div class="flex flex-wrap items-center gap-2">
                <Badge
                  v-for="(step, index) in runStates[preset.id].steps"
                  :key="index"
                  variant="outline"
                  :class="cn('font-normal', stepClass(step))"
                >
                  {{ index + 1 }} · {{ STEP_LABELS[step] }}
                </Badge>
              </div>
              <div class="flex items-center gap-3">
                <Progress
                  :model-value="(runStates[preset.id].validCount / 3) * 100"
                  class="h-2 flex-1"
                />
                <span class="text-xs text-muted-foreground">
                  有效 {{ runStates[preset.id].validCount }}/3
                </span>
              </div>
              <p
                class="text-xs"
                :class="runStates[preset.id].status === 'failed' ? 'text-destructive' : 'text-muted-foreground'"
              >
                {{ runStates[preset.id].message }}
              </p>
            </div>

            <template v-if="runStates[preset.id].result">
              <Separator />
              <div class="flex items-center justify-between gap-2">
                <p class="text-sm">
                  最可能：
                  <strong>{{ runStates[preset.id].result!.prediction_name }}</strong>
                  <span class="text-muted-foreground">
                    （{{ percent(runStates[preset.id].result!.probability) }} ·
                    {{ runStates[preset.id].result!.family_prediction_name }}）
                  </span>
                </p>
                <Button variant="ghost" size="sm" @click="toggleExpanded(preset.id)">
                  <ChevronDown
                    data-icon="inline-start"
                    :class="cn('transition-transform', expandedResults.has(preset.id) && 'rotate-180')"
                  />
                  {{ expandedResults.has(preset.id) ? '收起结果' : '完整结果' }}
                </Button>
              </div>
              <AttributionResult
                v-if="expandedResults.has(preset.id)"
                :result="runStates[preset.id].result!"
              />
            </template>
          </template>
        </div>
      </div>
    </CardContent>

    <PresetFormDialog v-model:open="dialogOpen" :preset="editingPreset" @save="handleSave" />

    <AlertDialog :open="!!deletingPreset" @update:open="deletingPreset = null">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除预设</AlertDialogTitle>
          <AlertDialogDescription>
            确定删除预设「{{ deletingPreset?.name }}」吗？此操作不可撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction @click="confirmDelete">删除</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </Card>
</template>
