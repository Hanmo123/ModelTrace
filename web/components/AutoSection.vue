<script setup lang="ts">
import {
  Loader2,
  Pencil,
  Play,
  Plus,
  Server,
  Trash2,
  Zap,
} from "lucide-vue-next";
import { toast } from "vue-sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { presetLabel, type EndpointPreset } from "@/composables/usePresets";
import { percent } from "@/lib/format";
import { cn } from "@/lib/utils";

const { presets, storageError, addPreset, updatePreset, removePreset } =
  usePresets();
const { bank, error: bankError, load } = useBank();
const {
  runStates,
  batchRunning,
  queuedIds,
  isRunning,
  runPreset,
  runBatch,
  clearRun,
} = useApiTest();
const selectedId = ref<string | null>(null);
const selected = computed(
  () => presets.value.find((preset) => preset.id === selectedId.value) ?? null,
);
const dialogOpen = ref(false);
const editing = ref<EndpointPreset | null>(null);
const deleting = ref<EndpointPreset | null>(null);
const deleteOpen = ref(false);
const proxyBaseURL = useRuntimeConfig().public.proxyUrl as string;
const proxyOpen = ref(false);
const proxyPreset = ref<EndpointPreset | null>(null);
const terminalOpen = ref(false);
const terminalPreset = ref<EndpointPreset | null>(null);
const { sessions: terminalSessions, clear: clearTerminal } = useTerminalTest();

function askProxy(preset: EndpointPreset) {
  if (!proxyBaseURL) {
    openTerminal(preset);
    return;
  }
  selectedId.value = preset.id;
  proxyPreset.value = preset;
  proxyOpen.value = true;
}
function isNetworkFailure(id: string) {
  const state = runStates.value[id];
  return (
    state?.status === "failed" &&
    state.errors.some((message) =>
      /failed to fetch|networkerror|network error|load failed|cors/i.test(
        message,
      ),
    )
  );
}
async function consentProxy() {
  const preset = proxyPreset.value;
  proxyOpen.value = false;
  if (!preset || !proxyBaseURL) return;
  try {
    clearTerminal(preset.id);
    const state = await runPreset(preset, proxyBaseURL);
    if (state.status === "failed")
      toast.error("代理请求失败；可以使用终端方式");
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "代理请求失败");
  }
}
function declineProxy() {
  const preset = proxyPreset.value;
  proxyOpen.value = false;
  if (preset) openTerminal(preset);
}
function openTerminal(preset: EndpointPreset) {
  selectedId.value = preset.id;
  terminalPreset.value = preset;
  terminalOpen.value = true;
}

watch(
  () => presets.value.map((preset) => preset.id),
  (ids) => {
    if (!selectedId.value || !ids.includes(selectedId.value))
      selectedId.value = ids[0] ?? null;
  },
  { immediate: true },
);
onMounted(load);

function locked(id: string) {
  return batchRunning.value || isRunning(id);
}
function status(id: string) {
  if (queuedIds.value.includes(id)) return "排队中";
  const state = runStates.value[id];
  if (state?.status === "running") return "测试中";
  if (state?.result || terminalSessions.value[id]?.result) return "已完成";
  return state?.status === "failed" ? "失败" : "未测试";
}
function configure(preset: EndpointPreset | null = null) {
  editing.value = preset;
  dialogOpen.value = true;
}
function save(input: Omit<EndpointPreset, "id">) {
  if (editing.value) {
    if (locked(editing.value.id)) return;
    updatePreset(editing.value.id, input);
    clearRun(editing.value.id);
    clearTerminal(editing.value.id);
    selectedId.value = editing.value.id;
  } else {
    selectedId.value = addPreset(input).id;
  }
  toast.success("服务商配置已保存", { id: "provider-saved", duration: 1800 });
}
function confirmDelete() {
  if (!deleting.value || locked(deleting.value.id)) return;
  clearRun(deleting.value.id);
  clearTerminal(deleting.value.id);
  removePreset(deleting.value.id);
  deleting.value = null;
  deleteOpen.value = false;
  toast.success("服务商已删除");
}
async function test(preset: EndpointPreset) {
  if (!bank.value || locked(preset.id)) return;
  selectedId.value = preset.id;
  try {
    clearTerminal(preset.id);
    const state = await runPreset(preset);
    if (isNetworkFailure(preset.id)) {
      if (proxyBaseURL) askProxy(preset);
      else openTerminal(preset);
    } else if (state.status === "failed") {
      toast.error(`「${presetLabel(preset)}」测试失败，请查看详情`);
    }
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "无法开始测试");
  }
}
async function testAll() {
  if (!bank.value || batchRunning.value) return;
  // 仅统计本轮新启动的服务商，不把之前的结果混入汇总。
  const targets = presets.value.filter((preset) => !isRunning(preset.id));
  if (!targets.length) return;
  selectedId.value = targets[0]!.id;
  try {
    targets.forEach((preset) => clearTerminal(preset.id));
    await runBatch(targets);
    const success = targets.filter(
      (preset) => runStates.value[preset.id]?.status === "success",
    ).length;
    toast.success(
      `批量测试完成：成功 ${success} 个，失败 ${targets.length - success} 个`,
    );
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "批量测试失败");
  }
}
</script>

<template>
  <div
    class="mt-3 flex min-h-0 flex-1 flex-col gap-3 overflow-hidden rounded-md bg-card p-3 lg:mt-4 lg:p-4"
  >
    <div
      class="flex shrink-0 flex-wrap items-center justify-between gap-3 px-1"
    >
      <div class="flex items-baseline gap-2">
        <h1 class="text-sm font-semibold">自动测试</h1>
        <span class="text-xs text-muted-foreground"
          >{{ presets.length }} 个服务商 · 浏览器直连</span
        >
      </div>
      <div class="flex items-center gap-2">
        <Button size="sm" variant="outline" @click="configure()"
          ><Plus data-icon="inline-start" />添加服务商</Button
        >
        <Button
          size="sm"
          :disabled="
            !bank ||
            !presets.length ||
            batchRunning ||
            presets.every((p) => isRunning(p.id))
          "
          @click="testAll"
        >
          <Loader2
            v-if="batchRunning"
            class="animate-spin"
            data-icon="inline-start"
          />
          <Zap v-else data-icon="inline-start" />
          {{ batchRunning ? "批量测试中…" : "一键测全部" }}
        </Button>
      </div>
    </div>
    <Alert v-if="storageError || bankError" variant="destructive">
      <AlertDescription>{{ storageError || bankError }}</AlertDescription>
    </Alert>
    <div
      class="grid min-h-0 flex-1 gap-6 lg:grid-cols-[minmax(0,38.2fr)_minmax(0,61.8fr)] lg:grid-rows-[minmax(0,1fr)]"
    >
      <section
        aria-label="服务商列表"
        class="flex min-h-0 flex-col gap-3 overflow-y-auto"
      >
        <Empty v-if="!presets.length" class="min-h-60 rounded-md border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Server /></EmptyMedia>
            <EmptyTitle>添加服务商</EmptyTitle>
            <EmptyDescription
              >配置名称、Endpoint、API Key 和模型
              ID。可以添加多组配置，分别测试或一键测试全部。</EmptyDescription
            >
          </EmptyHeader>
          <EmptyContent
            ><Button size="sm" @click="configure()"
              ><Plus data-icon="inline-start" />添加第一个服务商</Button
            ></EmptyContent
          >
        </Empty>
        <article
          v-for="preset in presets"
          :key="preset.id"
          :class="
            cn(
              'shrink-0 rounded-md border p-3.5 transition-colors',
              selectedId === preset.id && 'border-primary bg-muted/40',
            )
          "
        >
          <button
            type="button"
            class="flex w-full flex-col gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            :aria-pressed="selectedId === preset.id"
            @click="selectedId = preset.id"
          >
            <span class="flex w-full items-center justify-between gap-2">
              <strong class="min-w-0 break-all text-sm">{{
                presetLabel(preset)
              }}</strong>
              <Badge
                :variant="
                  status(preset.id) === '失败' ? 'destructive' : 'secondary'
                "
                class="shrink-0 font-normal"
              >
                <Loader2
                  v-if="isRunning(preset.id)"
                  class="mr-1 size-3 animate-spin"
                />{{ status(preset.id) }}
              </Badge>
            </span>
            <span
              class="max-w-full truncate text-xs text-muted-foreground"
              :title="preset.baseUrl"
              >{{ preset.baseUrl }}</span
            >
            <span
              class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
            >
              <span class="break-all font-mono">{{ preset.model }}</span>
              <Badge variant="outline" class="font-normal">{{
                preset.apiType === "responses" ? "Responses" : "Chat"
              }}</Badge>
            </span>
            <span
              v-if="
                runStates[preset.id]?.result ||
                terminalSessions[preset.id]?.result
              "
              class="flex flex-wrap items-baseline gap-2 text-sm"
            >
              <strong class="uppercase">{{
                (terminalSessions[preset.id]?.result ||
                  runStates[preset.id]?.result)!.prediction_name
              }}</strong>
              <span class="tnum">{{
                percent(
                  (terminalSessions[preset.id]?.result ||
                    runStates[preset.id]?.result)!.probability,
                )
              }}</span>
              <span
                v-if="isRunning(preset.id)"
                class="text-xs text-muted-foreground"
                >更新中</span
              >
            </span>
          </button>
          <div class="mt-3 flex items-center justify-between gap-2">
            <Button
              size="sm"
              variant="outline"
              :disabled="!bank || locked(preset.id)"
              :aria-label="`测试 ${presetLabel(preset)}`"
              @click="test(preset)"
            >
              <Play data-icon="inline-start" />{{
                isRunning(preset.id)
                  ? "测试中…"
                  : runStates[preset.id]
                    ? "重新测试"
                    : "开始测试"
              }}
            </Button>
            <div class="flex items-center gap-1">
              <Button
                size="icon"
                variant="ghost"
                :disabled="locked(preset.id)"
                :aria-label="`编辑 ${presetLabel(preset)}`"
                @click="configure(preset)"
                ><Pencil
              /></Button>
              <Button
                size="icon"
                variant="ghost"
                :disabled="locked(preset.id)"
                :aria-label="`删除 ${presetLabel(preset)}`"
                @click="
                  deleting = preset;
                  deleteOpen = true;
                "
                ><Trash2
              /></Button>
            </div>
          </div>
        </article>
        <p class="px-1 text-xs leading-relaxed text-muted-foreground">
          每个服务商独立生成挑战，最多尝试 6 题以收集 3 份有效回答。批量并发 2
          个服务商；测试会消耗所填 API 的额度，Endpoint 需允许跨域（CORS）。
        </p>
      </section>
      <section aria-label="服务商测试详情" class="min-h-0 overflow-y-auto">
        <ProviderTestDetail
          v-if="selected"
          :preset="selected"
          :run="runStates[selected.id]"
          :terminal="terminalSessions[selected.id]"
          :proxy-available="!!proxyBaseURL && isNetworkFailure(selected.id)"
          :queued="queuedIds.includes(selected.id)"
          :disabled="!bank || locked(selected.id)"
          @test="test(selected)"
          @terminal="openTerminal(selected)"
          @proxy="askProxy(selected)"
        />
        <Empty v-else class="min-h-80 rounded-md border lg:h-full">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Server /></EmptyMedia>
            <EmptyTitle>服务商测试详情</EmptyTitle>
            <EmptyDescription
              >添加并选择左侧服务商后，在这里查看挑战、模型回答和归因结果。</EmptyDescription
            >
          </EmptyHeader>
        </Empty>
      </section>
    </div>
    <AlertDialog v-model:open="proxyOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>是否通过 Cloudflare 代理测试？</AlertDialogTitle>
          <AlertDialogDescription>
            浏览器直连失败。若同意，你的 API Key、模型 ID 和挑战提示词将发送到
            {{ proxyBaseURL }}，再由该服务器请求「{{ proxyPreset?.name }}」。
            这不再是纯浏览器直连；请仅在信任代理运营方时继续。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel @click="declineProxy"
            >不使用代理，改用终端</AlertDialogCancel
          >
          <AlertDialogAction @click="consentProxy"
            >同意并通过代理测试</AlertDialogAction
          >
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <TerminalTestDialog v-model:open="terminalOpen" :preset="terminalPreset" />
    <PresetFormDialog
      v-model:open="dialogOpen"
      :preset="editing"
      @save="save"
    />
    <AlertDialog v-model:open="deleteOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除服务商</AlertDialogTitle>
          <AlertDialogDescription
            >确定删除「{{
              deleting ? presetLabel(deleting) : ""
            }}」及其测试结果吗？此操作不可撤销。</AlertDialogDescription
          >
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction @click="confirmDelete">删除</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
