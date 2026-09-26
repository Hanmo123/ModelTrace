<script setup lang="ts">
import {
  ArrowRight,
  Loader2,
  Pencil,
  Play,
  Plus,
  Trash2,
} from "lucide-vue-next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { PresetRunState } from "@/composables/useApiTest";
import {
  presetLabel,
  providerTargets,
  type ModelTarget,
  type ProviderPreset,
} from "@/lib/providers";
import { percent } from "@/lib/format";
import { cn } from "@/lib/utils";

const props = defineProps<{
  preset: ProviderPreset;
  selectedId: string | null;
  runs: Record<string, PresetRunState>;
  queued: ReadonlySet<string>;
  disabled: boolean;
  locked: boolean;
}>();
const emit = defineEmits<{
  select: [target: ModelTarget];
  test: [target: ModelTarget];
  testProvider: [];
  edit: [];
  remove: [];
}>();
const rows = computed(() =>
  providerTargets(props.preset).map((target) => {
    const run = props.runs[target.id];
    const queued = props.queued.has(target.id);
    const busy = queued || run?.status === "running";
    return {
      target,
      run,
      queued,
      busy,
      status: queued
        ? "排队中"
        : run?.status === "running"
          ? "测试中"
          : run?.status === "success"
            ? "已完成"
            : run?.status === "failed"
              ? "失败"
              : "未测试",
    };
  }),
);
const selected = computed(() =>
  rows.value.some((row) => row.target.id === props.selectedId),
);
const busy = computed(() => rows.value.some((row) => row.busy));
const completed = computed(
  () =>
    rows.value.filter((row) => !row.busy && row.run?.status === "success")
      .length,
);
const failed = computed(
  () =>
    rows.value.filter((row) => !row.busy && row.run?.status === "failed")
      .length,
);
function selectProvider() {
  const row =
    rows.value.find((row) => row.target.id === props.selectedId) ??
    rows.value[0];
  if (row) emit("select", row.target);
}
</script>

<template>
  <article :data-provider-id="preset.id" class="min-w-0 shrink-0">
    <Card
      :class="
        cn(
          'overflow-hidden rounded-md shadow-none',
          selected && 'ring-1 ring-ring',
        )
      "
    >
      <CardHeader class="gap-2 p-3.5">
        <div class="flex items-start justify-between gap-2">
          <button
            type="button"
            class="flex min-w-0 flex-1 flex-col gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            :aria-label="`选择服务商 ${presetLabel(preset)}`"
            :aria-pressed="selected"
            @click="selectProvider"
          >
            <CardTitle class="max-w-full break-all"
              ><strong>{{ presetLabel(preset) }}</strong></CardTitle
            >
            <CardDescription
              class="max-w-full truncate"
              :title="preset.baseUrl"
              >{{ preset.baseUrl }}</CardDescription
            >
          </button>
          <div class="flex shrink-0 items-center gap-0.5">
            <Button
              size="icon-sm"
              variant="ghost"
              :disabled="locked"
              :aria-label="`编辑 ${presetLabel(preset)}`"
              @click="emit('edit')"
              ><Pencil
            /></Button>
            <Button
              size="icon-sm"
              variant="ghost"
              :disabled="locked"
              :aria-label="`删除 ${presetLabel(preset)}`"
              @click="emit('remove')"
              ><Trash2
            /></Button>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{{ rows.length }} 个模型</Badge>
          <span
            v-if="completed || failed || busy"
            class="text-xs text-muted-foreground"
            >已完成 {{ completed }}/{{ rows.length
            }}<template v-if="failed"> · {{ failed }} 个失败</template></span
          >
          <Loader2
            v-if="busy"
            class="ml-auto size-3.5 animate-spin text-muted-foreground"
            aria-label="此服务商有测试任务"
          />
        </div>
      </CardHeader>
      <Separator />
      <CardContent
        class="max-h-96 overflow-y-auto p-1.5"
        :aria-label="`${presetLabel(preset)} 的模型`"
      >
        <div
          v-for="row in rows"
          :key="row.target.id"
          :data-model-id="row.target.modelId"
          :class="
            cn(
              'flex items-center gap-1 rounded-sm p-1 transition-colors',
              selectedId === row.target.id && 'bg-accent',
            )
          "
        >
          <button
            type="button"
            class="flex min-w-0 flex-1 flex-col gap-1.5 rounded-sm px-2 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            :aria-label="`选择 ${presetLabel(preset)} · ${row.target.model}`"
            :aria-pressed="selectedId === row.target.id"
            @click="emit('select', row.target)"
          >
            <span
              class="flex w-full min-w-0 items-center justify-between gap-2"
            >
              <span
                class="min-w-0 truncate font-mono text-xs font-medium"
                :title="row.target.model"
                >{{ row.target.model }}</span
              >
              <Badge
                :variant="row.status === '失败' ? 'destructive' : 'secondary'"
                class="shrink-0"
              >
                <Loader2
                  v-if="row.run?.status === 'running'"
                  class="mr-1 size-3 animate-spin"
                />{{ row.status }}
              </Badge>
            </span>
            <span
              class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
            >
              <span>{{
                row.target.apiType === "responses" ? "Responses" : "Chat"
              }}</span>
              <template v-if="row.run?.result">
                <ArrowRight class="size-3 shrink-0" />
                <span
                  class="min-w-0 truncate"
                  :title="row.run.result.prediction_name"
                  >{{ row.run.result.prediction_name }}</span
                >
                <span class="tnum">{{
                  percent(row.run.result.probability)
                }}</span>
              </template>
              <span v-else-if="!row.busy && !row.run">选择查看详情</span>
            </span>
          </button>
          <Button
            size="icon-sm"
            variant="ghost"
            class="shrink-0"
            :disabled="disabled || row.busy"
            :aria-label="`测试 ${presetLabel(preset)} · ${row.target.model}`"
            :title="row.run ? '重新测试此模型' : '测试此模型'"
            @click="emit('test', row.target)"
            ><Play
          /></Button>
        </div>
      </CardContent>
      <Separator />
      <CardFooter class="flex-wrap justify-between gap-2 p-2.5">
        <Button
          size="sm"
          variant="outline"
          :disabled="disabled || busy"
          :aria-label="`测试 ${presetLabel(preset)}`"
          @click="emit('testProvider')"
        >
          <Loader2
            v-if="busy"
            class="animate-spin"
            data-icon="inline-start"
          /><Play v-else data-icon="inline-start" />
          {{
            busy
              ? "测试中…"
              : rows.length > 1
                ? "测试此服务商"
                : rows[0]?.run
                  ? "重新测试"
                  : "开始测试"
          }}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          :disabled="locked"
          :aria-label="`管理 ${presetLabel(preset)} 的模型`"
          @click="emit('edit')"
          ><Plus data-icon="inline-start" />管理模型</Button
        >
      </CardFooter>
    </Card>
  </article>
</template>
