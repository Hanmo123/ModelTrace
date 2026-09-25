<script setup lang="ts">
import { Pencil, Plus, Server, Trash2 } from 'lucide-vue-next'
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
import type { EndpointPreset } from '@/composables/usePresets'

const { presets, addPreset, updatePreset, removePreset } = usePresets()

const dialogOpen = ref(false)
const editingPreset = ref<EndpointPreset | null>(null)
const deletingPreset = ref<EndpointPreset | null>(null)

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
  removePreset(deletingPreset.value.id)
  toast.success(`预设「${deletingPreset.value.name}」已删除`)
  deletingPreset.value = null
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
            保存多组 Base URL + API Key + 模型组合，全部仅存储在浏览器 localStorage。
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

      <div v-else class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div
          v-for="preset in presets"
          :key="preset.id"
          class="flex flex-col gap-3 rounded-lg border p-4"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <strong class="block truncate text-sm">{{ preset.name }}</strong>
              <span class="block truncate text-xs text-muted-foreground" :title="preset.baseUrl">
                {{ preset.baseUrl }}
              </span>
            </div>
            <Badge variant="secondary" class="shrink-0">
              {{ preset.apiType === 'responses' ? 'Responses' : 'Chat' }}
            </Badge>
          </div>
          <div class="flex flex-col gap-1 text-xs text-muted-foreground">
            <span>模型：<code class="rounded bg-muted px-1 py-0.5">{{ preset.model }}</code></span>
            <span>密钥：<code class="rounded bg-muted px-1 py-0.5">{{ maskApiKey(preset.apiKey) }}</code></span>
            <span v-if="preset.temperature !== null">温度：{{ preset.temperature }}</span>
          </div>
          <div class="mt-auto flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" @click="openEdit(preset)">
              <Pencil data-icon="inline-start" />
              编辑
            </Button>
            <Button variant="ghost" size="sm" @click="deletingPreset = preset">
              <Trash2 data-icon="inline-start" />
              删除
            </Button>
          </div>
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
