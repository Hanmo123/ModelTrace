<script setup lang="ts">
import {
  ArrowRight,
  Loader2,
  Pencil,
  Play,
  Trash2,
  Zap,
} from "lucide-vue-next";
import ActionTooltip from "@/components/ActionTooltip.vue";
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
import type { PresetRunState } from "@/composables/useApiTest";
import {
  presetLabel,
  providerTargets,
  targetLabel,
  type ProviderChannel,
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
  busyModels: ReadonlySet<string>;
  directBlocked: ReadonlySet<string>;
  disabled: boolean;
  locked: boolean;
}>();
const emit = defineEmits<{
  select: [target: ModelTarget];
  test: [target: ModelTarget];
  testProvider: [];
  testChannel: [channel: ProviderChannel];
  editChannel: [channelId: string];
  edit: [];
  remove: [];
}>();
const rows = computed(() =>
  providerTargets(props.preset).map((target) => {
    const run = props.runs[target.id];
    const queued = props.queued.has(target.id);
    const busy = props.busyModels.has(target.id);
    return {
      target,
      run,
      queued,
      busy,
      status: queued
        ? "排队中"
        : busy
          ? "测试中"
          : run?.status === "success"
            ? "已完成"
            : run?.status === "failed"
              ? "失败"
              : "未测试",
    };
  }),
);
const groups = computed(() =>
  props.preset.channels.map((channel) => {
    const channelRows = rows.value.filter(
      (row) => row.target.channelId === channel.id,
    );
    return {
      channel,
      rows: channelRows,
      busy: channelRows.some((row) => row.busy),
    };
  }),
);
const selected = computed(() =>
  rows.value.some((row) => row.target.id === props.selectedId),
);
const busy = computed(() => rows.value.some((row) => row.busy));
const connectionLabel = computed(() => {
  try {
    const url = new URL(props.preset.baseUrl);
    // Keep the identity compact; never expose URL credentials or query tokens.
    return url.host + url.pathname.replace(/\/$/, "");
  } catch {
    return "自定义连接";
  }
});
function selectProvider() {
  const row =
    rows.value.find((row) => row.target.id === props.selectedId) ??
    rows.value[0];
  if (row) emit("select", row.target);
}
function modelTestHint(row: (typeof rows.value)[number]) {
  if (row.queued) return "此模型已排队，请等待空闲任务位";
  if (row.busy) return "此模型正在测试，请等待完成";
  if (props.disabled) return "暂不可测试，请等待当前任务或指纹库加载完成";
  return `${row.run ? "重新测试" : "测试"} ${row.target.model}`;
}
</script>

<template>
  <article :data-provider-id="preset.id" class="min-w-0 shrink-0">
    <Card
      :class="
        cn(
          'min-w-0 overflow-hidden rounded-md shadow-none',
          selected && 'ring-1 ring-ring',
        )
      "
    >
      <CardHeader class="flex-row items-center gap-2 p-3 pb-2">
        <ActionTooltip
          :text="`查看 ${presetLabel(preset)} 的测试详情 · ${connectionLabel}`"
        >
          <button
            type="button"
            class="flex min-w-0 flex-1 flex-col gap-1 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            :aria-label="`选择服务商 ${presetLabel(preset)}`"
            :aria-pressed="selected"
            @click="selectProvider"
          >
            <CardTitle class="w-full min-w-0 truncate"
              ><strong>{{ presetLabel(preset) }}</strong></CardTitle
            >
            <CardDescription class="w-full min-w-0 truncate">{{
              connectionLabel
            }}</CardDescription>
          </button>
        </ActionTooltip>
        <div class="flex shrink-0 items-center gap-1">
          <ActionTooltip
            :disabled="disabled || busy"
            :text="
              busy
                ? '此服务商有测试任务，请等待完成'
                : disabled
                  ? '暂不可测试，请等待当前任务或指纹库加载完成'
                  : '测试此服务商的全部模型'
            "
          >
            <Button
              type="button"
              variant="default"
              size="icon-sm"
              :disabled="disabled || busy"
              :aria-label="`测试 ${presetLabel(preset)}`"
              @click="emit('testProvider')"
            >
              <Loader2
                v-if="busy"
                class="animate-spin"
                aria-label="此服务商有测试任务"
              />
              <Zap v-else />
            </Button>
          </ActionTooltip>
          <ActionTooltip
            :disabled="locked"
            :text="locked ? '测试期间不能编辑此服务商' : '编辑服务商连接和模型'"
          >
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              :disabled="locked"
              :aria-label="`编辑 ${presetLabel(preset)}`"
              @click="emit('edit')"
              ><Pencil
            /></Button>
          </ActionTooltip>
          <ActionTooltip
            :disabled="locked"
            :text="locked ? '测试期间不能删除此服务商' : '删除服务商及其模型'"
          >
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              :disabled="locked"
              :aria-label="`删除 ${presetLabel(preset)}`"
              @click="emit('remove')"
              ><Trash2
            /></Button>
          </ActionTooltip>
        </div>
      </CardHeader>
      <CardContent class="flex flex-col gap-3 p-3 pt-0">
        <section
          v-for="group in groups"
          :key="group.channel.id"
          :data-channel-id="group.channel.id"
          class="flex min-w-0 flex-col gap-2"
        >
          <div class="flex min-w-0 items-center gap-2">
            <ActionTooltip
              :text="`${group.channel.name} · 价格倍率 ${group.channel.multiplier}×`"
            >
              <span
                tabindex="0"
                class="min-w-0 flex-1 truncate text-xs font-medium"
                >{{ group.channel.name }}</span
              >
            </ActionTooltip>
            <Badge variant="outline">{{ group.channel.multiplier }}×</Badge>
            <ActionTooltip
              :disabled="disabled || group.busy"
              :text="
                group.busy
                  ? '此渠道有测试任务，请等待完成'
                  : disabled
                    ? '暂不可测试，请等待当前任务或指纹库加载完成'
                    : `测试 ${group.channel.name} 的全部模型`
              "
            >
              <Button
                type="button"
                variant="default"
                size="icon-sm"
                :disabled="disabled || group.busy"
                :aria-label="`测试渠道 ${presetLabel(preset)} · ${group.channel.name}`"
                @click="emit('testChannel', group.channel)"
              >
                <Loader2 v-if="group.busy" class="animate-spin" /><Zap v-else />
              </Button>
            </ActionTooltip>
            <ActionTooltip
              :disabled="locked"
              :text="
                locked
                  ? '测试期间不能编辑渠道'
                  : `编辑渠道 ${group.channel.name}`
              "
            >
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                :disabled="locked"
                :aria-label="`编辑渠道 ${presetLabel(preset)} · ${group.channel.name}`"
                @click="emit('editChannel', group.channel.id)"
                ><Pencil
              /></Button>
            </ActionTooltip>
          </div>
          <div
            class="grid grid-cols-[repeat(auto-fill,minmax(min(100%,8.5rem),1fr))] gap-2"
            :aria-label="`${presetLabel(preset)} · ${group.channel.name} 的模型`"
          >
            <Card
              v-for="row in group.rows"
              :key="row.target.id"
              :data-model-id="row.target.modelId"
              :class="
                cn(
                  'min-w-0 cursor-pointer overflow-hidden rounded-md shadow-none transition-colors hover:border-primary/40',
                  selectedId === row.target.id && 'border-primary bg-accent/50',
                )
              "
              @click="emit('select', row.target)"
            >
              <CardHeader class="gap-0 p-2 pb-1">
                <CardTitle class="min-w-0">
                  <ActionTooltip
                    :text="`${row.target.model} · ${row.status}，点击查看详情`"
                  >
                    <button
                      type="button"
                      class="block w-full min-w-0 truncate rounded-sm py-1 text-left font-mono text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      :aria-label="`选择 ${targetLabel(row.target)}`"
                      :aria-pressed="selectedId === row.target.id"
                      @click.stop="emit('select', row.target)"
                    >
                      {{ row.target.model }}
                    </button>
                  </ActionTooltip>
                </CardTitle>
              </CardHeader>
              <CardContent
                class="flex items-center justify-between gap-1.5 px-2 pb-2 pt-0"
              >
                <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span class="text-xs text-muted-foreground">{{
                    row.target.apiType === "responses" ? "Responses" : "Chat"
                  }}</span>
                  <Badge
                    :variant="
                      row.status === '失败' ? 'destructive' : 'secondary'
                    "
                    >{{ row.status }}</Badge
                  >
                  <Badge
                    v-if="directBlocked.has(row.target.id)"
                    variant="outline"
                    >直连不可用</Badge
                  >
                </div>
                <div class="shrink-0" @click.stop>
                  <ActionTooltip
                    :disabled="disabled || row.busy"
                    :text="modelTestHint(row)"
                  >
                    <Button
                      type="button"
                      variant="default"
                      size="icon-sm"
                      :disabled="disabled || row.busy"
                      :aria-label="`测试 ${targetLabel(row.target)}`"
                      @click.stop="emit('test', row.target)"
                    >
                      <Loader2
                        v-if="row.busy && !row.queued"
                        class="animate-spin"
                      />
                      <Play v-else />
                    </Button>
                  </ActionTooltip>
                </div>
              </CardContent>
              <CardFooter v-if="row.run?.result" class="gap-1.5 px-2 pb-2 pt-0">
                <ArrowRight
                  class="size-3 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span
                  class="min-w-0 flex-1 truncate text-xs text-muted-foreground"
                  >{{ row.run.result.prediction_name }}</span
                >
                <span class="tnum shrink-0 text-xs">{{
                  percent(row.run.result.probability)
                }}</span>
              </CardFooter>
            </Card>
          </div>
        </section>
      </CardContent>
    </Card>
  </article>
</template>
