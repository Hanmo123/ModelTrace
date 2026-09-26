<script setup lang="ts">
import { Loader2, Plus, Server, Zap } from "lucide-vue-next";
import { toast } from "vue-sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import {
  invalidatedModelRuns,
  presetLabel,
  providerTargets,
  type ModelTarget,
  type ProviderInput,
  type ProviderPreset,
} from "@/lib/providers";

const { presets, storageError, addPreset, updatePreset, removePreset } =
  usePresets();
const { bank, error: bankError, load } = useBank();
const {
  runStates,
  batchRunning,
  queuedIds,
  isBusy,
  runPreset,
  runBatch,
  clearRun,
} = useApiTest();
const targets = computed(() => presets.value.flatMap(providerTargets));
const queued = computed(() => new Set(queuedIds.value));
const busyProviders = computed(
  () =>
    new Set(
      targets.value
        .filter((target) => isBusy(target.id))
        .map((target) => target.providerId),
    ),
);
const selectedId = ref<string | null>(null);
const detailPane = ref<HTMLElement | null>(null);
const selected = computed(
  () => targets.value.find((target) => target.id === selectedId.value) ?? null,
);
const dialogOpen = ref(false);
const editing = ref<ProviderPreset | null>(null);
const deleting = ref<ProviderPreset | null>(null);
const deleteOpen = ref(false);
const proxyBaseURL = useRuntimeConfig().public.proxyUrl as string;
const terminalEnabled = false;
const proxyOpen = ref(false);
const {
  allowed: proxyAllowed,
  allow: allowProxy,
  revoke: revokeProxy,
} = useProxyConsent(proxyBaseURL);
const pendingTest = ref<{ targets: ModelTarget[]; batch: boolean } | null>(
  null,
);
const pendingProviderCount = computed(
  () =>
    new Set(pendingTest.value?.targets.map((target) => target.providerId)).size,
);
const terminalOpen = ref(false);
const terminalPreset = ref<ModelTarget | null>(null);
const { sessions: terminalSessions, clear: clearTerminal } = useTerminalTest();

watch(
  () => targets.value.map((target) => target.id),
  (ids) => {
    if (!selectedId.value || !ids.includes(selectedId.value))
      selectedId.value = ids[0] ?? null;
  },
  { immediate: true },
);
watch(proxyOpen, (open) => {
  if (!open) pendingTest.value = null;
});
watch(selectedId, async () => {
  await nextTick();
  detailPane.value?.scrollTo({ top: 0 });
});
onMounted(load);

async function selectTarget(target: ModelTarget) {
  selectedId.value = target.id;
  await nextTick();
  if (window.matchMedia("(max-width: 1023px)").matches) {
    detailPane.value?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function locked(providerId: string) {
  return (
    proxyOpen.value || batchRunning.value || busyProviders.value.has(providerId)
  );
}
function configure(preset: ProviderPreset | null = null) {
  if (proxyOpen.value || (preset && locked(preset.id))) return;
  editing.value = preset;
  dialogOpen.value = true;
}
function clearResult(id: string) {
  clearRun(id);
  clearTerminal(id);
}
function save(input: ProviderInput) {
  if (editing.value) {
    if (locked(editing.value.id)) return;
    invalidatedModelRuns(editing.value, input).forEach(clearResult);
    updatePreset(editing.value.id, input);
    const updated = presets.value.find(
      (preset) => preset.id === editing.value!.id,
    )!;
    const nextTargets = providerTargets(updated);
    if (!nextTargets.some((target) => target.id === selectedId.value))
      selectedId.value = nextTargets[0]?.id ?? null;
  } else {
    selectedId.value = providerTargets(addPreset(input))[0]?.id ?? null;
  }
  toast.success("服务商配置已保存", { id: "provider-saved", duration: 1800 });
}
function confirmDelete() {
  if (!deleting.value || locked(deleting.value.id)) return;
  providerTargets(deleting.value).forEach((target) => clearResult(target.id));
  removePreset(deleting.value.id);
  deleting.value = null;
  deleteOpen.value = false;
  toast.success("服务商及其模型已删除");
}

function requestTests(input: ModelTarget[], batch: boolean) {
  if (!bank.value || proxyOpen.value || batchRunning.value) return;
  const list = input
    .filter((target) => !isBusy(target.id))
    .map((target) => ({ ...target }));
  if (!list.length) return;
  selectedId.value = list[0]!.id;
  if (proxyBaseURL && !proxyAllowed.value) {
    pendingTest.value = { targets: list, batch };
    proxyOpen.value = true;
    return;
  }
  void executeTests(list, batch, proxyAllowed.value ? proxyBaseURL : undefined);
}
function test(target: ModelTarget) {
  requestTests([target], false);
}
function testProvider(provider: ProviderPreset) {
  const list = providerTargets(provider);
  requestTests(list, list.length > 1);
}
function testAll() {
  requestTests(targets.value, true);
}
function consentProxy() {
  const pending = pendingTest.value;
  pendingTest.value = null;
  proxyOpen.value = false;
  if (!pending || !proxyBaseURL) return;
  allowProxy();
  void executeTests(pending.targets, pending.batch, proxyBaseURL);
}
function declineProxy() {
  const pending = pendingTest.value;
  pendingTest.value = null;
  proxyOpen.value = false;
  if (pending) void executeTests(pending.targets, pending.batch);
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
function openTerminal(target: ModelTarget) {
  selectedId.value = target.id;
  terminalPreset.value = target;
  terminalOpen.value = true;
}
async function executeTests(
  list: ModelTarget[],
  batch: boolean,
  proxyURL?: string,
) {
  try {
    list.forEach((target) => clearTerminal(target.id));
    if (batch) {
      const states = await runBatch(list, proxyURL);
      const success = states.filter(
        (state) => state.status === "success",
      ).length;
      toast.success(
        `批量测试完成：成功 ${success} 个模型，失败 ${states.length - success} 个模型`,
      );
    } else {
      const target = list[0]!;
      const state = await runPreset(target, proxyURL);
      if (state.status === "failed")
        toast.error(
          `「${presetLabel(target)} · ${target.model}」测试失败，请查看详情`,
        );
    }
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "无法开始测试");
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
      <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h1 class="text-sm font-semibold">自动测试</h1>
        <span class="text-xs text-muted-foreground"
          >{{ presets.length }} 个服务商 · {{ targets.length }} 个模型</span
        >
        <span class="text-xs text-muted-foreground">{{
          proxyAllowed ? "服务端代理已授权" : "浏览器直连"
        }}</span>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <Button
          v-if="proxyAllowed"
          :disabled="batchRunning || !!busyProviders.size"
          title="测试结束后可撤销代理授权"
          size="sm"
          variant="ghost"
          @click="revokeProxy"
          >撤销代理授权</Button
        >
        <Button
          size="sm"
          variant="outline"
          :disabled="proxyOpen"
          @click="configure()"
          ><Plus data-icon="inline-start" />添加服务商</Button
        >
        <Button
          size="sm"
          :disabled="
            !bank ||
            !targets.length ||
            batchRunning ||
            proxyOpen ||
            targets.every((target) => isBusy(target.id))
          "
          :title="`测试全部 ${targets.length} 个模型，全局并发 2`"
          @click="testAll"
        >
          <Loader2
            v-if="batchRunning"
            class="animate-spin"
            data-icon="inline-start"
          /><Zap v-else data-icon="inline-start" />
          {{ batchRunning ? "批量测试中…" : "一键测全部" }}
        </Button>
      </div>
    </div>
    <Alert v-if="storageError || bankError" variant="destructive"
      ><AlertDescription>{{
        storageError || bankError
      }}</AlertDescription></Alert
    >
    <div
      class="grid min-h-0 flex-1 gap-6 lg:grid-cols-[minmax(0,38.2fr)_minmax(0,61.8fr)] lg:grid-rows-[minmax(0,1fr)]"
    >
      <section
        aria-label="服务商列表"
        class="flex min-h-0 flex-col gap-3 overflow-y-auto p-0.5"
      >
        <Empty v-if="!presets.length" class="min-h-60 rounded-md border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Server /></EmptyMedia>
            <EmptyTitle>一个连接，多个模型</EmptyTitle>
            <EmptyDescription
              >填写服务商的 Endpoint 和 API
              Key，一次添加多个模型。按模型查看结果，按服务商批量测试。</EmptyDescription
            >
          </EmptyHeader>
          <EmptyContent
            ><Button size="sm" @click="configure()"
              ><Plus data-icon="inline-start" />添加第一个服务商</Button
            ></EmptyContent
          >
        </Empty>
        <ProviderCard
          v-for="preset in presets"
          :key="preset.id"
          :preset="preset"
          :selected-id="selectedId"
          :runs="runStates"
          :queued="queued"
          :disabled="!bank || proxyOpen || batchRunning"
          :locked="locked(preset.id)"
          @select="selectTarget"
          @test="test"
          @test-provider="testProvider(preset)"
          @edit="configure(preset)"
          @remove="
            deleting = preset;
            deleteOpen = true;
          "
        />
        <p class="px-1 text-xs leading-relaxed text-muted-foreground">
          每个模型最多 3 题，归因概率达到 99% 即停止后续调用。单个与批量测试共用
          2 个并发名额，其他模型自动排队。测试会消耗 API
          额度；直连需要服务商允许跨域（CORS），也可在测试前授权代理。
        </p>
      </section>
      <section
        ref="detailPane"
        aria-label="服务商测试详情"
        class="min-h-0 overflow-y-auto"
      >
        <ProviderTestDetail
          v-if="selected"
          :preset="selected"
          :run="runStates[selected.id]"
          :terminal="
            terminalEnabled ? terminalSessions[selected.id] : undefined
          "
          :terminal-available="terminalEnabled"
          :proxy-available="
            !!proxyBaseURL && !proxyAllowed && isNetworkFailure(selected.id)
          "
          :queued="queued.has(selected.id)"
          :disabled="!bank || proxyOpen || batchRunning || isBusy(selected.id)"
          @test="test(selected)"
          @terminal="openTerminal(selected)"
          @proxy="test(selected)"
        />
        <Empty v-else class="min-h-80 rounded-md border lg:h-full">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Server /></EmptyMedia>
            <EmptyTitle>模型测试详情</EmptyTitle>
            <EmptyDescription
              >选择左侧服务商下的模型，在这里查看独立的挑战、模型回答和归因结果。</EmptyDescription
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
            即将{{ pendingTest?.batch ? "批量测试" : "测试" }}
            {{ pendingTest?.targets.length || 0 }} 个模型（{{
              pendingProviderCount
            }}
            个服务商）。 若同意，你的 API Key、模型 ID 和挑战提示词将发送到
            {{ proxyBaseURL }}，再由该服务器请求服务商。
            授权会在此浏览器记住，后续单个和批量测试均直接使用此代理，不再询问；可在测试结束后撤销授权。
            这不再是纯浏览器直连；请仅在信任代理运营方时继续。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter
          ><AlertDialogCancel @click="declineProxy"
            >仅本次直连</AlertDialogCancel
          ><AlertDialogAction @click="consentProxy"
            >同意并通过代理测试</AlertDialogAction
          ></AlertDialogFooter
        >
      </AlertDialogContent>
    </AlertDialog>
    <LazyTerminalTestDialog
      v-if="terminalEnabled && terminalOpen"
      v-model:open="terminalOpen"
      :preset="terminalPreset"
    />
    <LazyPresetFormDialog
      v-if="dialogOpen"
      v-model:open="dialogOpen"
      :preset="editing"
      :disabled="!!editing && locked(editing.id)"
      @save="save"
    />
    <AlertDialog v-model:open="deleteOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除服务商</AlertDialogTitle>
          <AlertDialogDescription
            >确定删除「{{ deleting ? presetLabel(deleting) : "" }}」的全部
            {{
              deleting?.models.length || 0
            }}
            个模型及其测试结果吗？此操作不可撤销。</AlertDialogDescription
          >
        </AlertDialogHeader>
        <AlertDialogFooter
          ><AlertDialogCancel>取消</AlertDialogCancel
          ><AlertDialogAction @click="confirmDelete"
            >删除</AlertDialogAction
          ></AlertDialogFooter
        >
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
