<script setup lang="ts">
import { Loader2, Play, Server, X } from "lucide-vue-next";
import { toast } from "vue-sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DEGRADATION_PROMPT } from "@/lib/degradation";
import { presetLabel, providerTargets, type ModelTarget } from "@/lib/providers";

const emit = defineEmits<{ configure: []; close: [] }>();
const { presets, storageError } = usePresets();
const { degradationRuns, queuedIds, isBusy, hasDegradationJobs, runDegradation } = useApiTest();
const diagnosticBusy = computed(hasDegradationJobs);
const groups = computed(() => presets.value.map((provider) => ({
  provider,
  targets: providerTargets(provider),
})));
const targets = computed(() => groups.value.flatMap((group) => group.targets));
const selectedId = ref("");
const selected = computed(() => targets.value.find((target) => target.id === selectedId.value));
const run = computed(() => degradationRuns.value[selectedId.value]);
const busy = computed(() => !!selected.value && isBusy(selected.value.id));
const queued = computed(() => queuedIds.value.includes(selectedId.value));
const proxyURL = useRuntimeConfig().public.proxyUrl as string;
const { allowed: proxyAllowed, allow: allowProxy } = useProxyConsent(proxyURL);
const proxyOpen = ref(false);
const pending = ref<ModelTarget | null>(null);

watch(() => targets.value.map((target) => target.id), (ids) => {
  if (!ids.includes(selectedId.value)) selectedId.value = ids[0] ?? "";
}, { immediate: true });
watch(proxyOpen, (open) => { if (!open) pending.value = null; });

function close() {
  if (diagnosticBusy.value || proxyOpen.value) return;
  degradationRuns.value = {};
  emit('close');
}

async function execute(target: ModelTarget, proxy?: string) {
  try {
    await runDegradation(target, proxy);
  } catch {
    toast.error("当前目标正在执行其他测试，请等待完成后重试。");
  }
}
function start() {
  if (!selected.value || busy.value || proxyOpen.value) return;
  const target = { ...selected.value };
  if (proxyURL && !proxyAllowed.value) {
    pending.value = target;
    proxyOpen.value = true;
    return;
  }
  void execute(target, proxyAllowed.value ? proxyURL : undefined);
}
function consent() {
  const target = pending.value;
  pending.value = null;
  proxyOpen.value = false;
  if (!target || !proxyURL) return;
  allowProxy();
  void execute(target, proxyURL);
}
function directOnly() {
  const target = pending.value;
  pending.value = null;
  proxyOpen.value = false;
  if (target) void execute(target);
}
</script>

<template>
  <section
    aria-label="降智检测"
    class="mt-3 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto rounded-md bg-card p-4 lg:mt-4 lg:p-6"
  >
    <Card class="mx-auto w-full max-w-2xl">
      <CardHeader>
        <div class="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>降智检测</CardTitle>
          <div class="flex flex-wrap items-center gap-2">
            <Badge variant="outline">固定单题</Badge>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              :disabled="diagnosticBusy || proxyOpen"
              title="关闭后恢复自动测试，需要重新输入快捷键才能开启"
              @click="close"
              ><X data-icon="inline-start" />关闭隐藏模式</Button
            >
          </div>
        </div>
        <CardDescription>
          按自定义关键词规则判定，仅供参考；不进行模型归因或概率计算。
        </CardDescription>
      </CardHeader>
      <CardContent class="flex flex-col gap-6">
        <Alert v-if="storageError" variant="destructive">
          <AlertDescription>{{ storageError }}</AlertDescription>
        </Alert>
        <Empty v-if="!targets.length" class="rounded-md border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Server /></EmptyMedia>
            <EmptyTitle>暂无检测目标</EmptyTitle>
            <EmptyDescription>复用自动测试中保存的服务商和模型配置。</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button @click="emit('configure')">前往自动测试添加服务商</Button>
          </EmptyContent>
        </Empty>
        <template v-else>
          <FieldGroup>
            <Field :data-disabled="proxyOpen || undefined">
              <FieldLabel for="degradation-target">检测目标</FieldLabel>
              <Select v-model="selectedId" :disabled="proxyOpen">
                <SelectTrigger id="degradation-target">
                  <SelectValue class="min-w-0 truncate" placeholder="选择已有的服务商与模型" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup v-for="group in groups" :key="group.provider.id">
                    <SelectLabel>{{ presetLabel(group.provider) }}</SelectLabel>
                    <SelectItem v-for="target in group.targets" :key="target.id" :value="target.id">
                      {{ presetLabel(group.provider) }} · {{ target.model }}
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>这里的型号是你保存的调用目标，不是检测推断。</FieldDescription>
            </Field>
            <Field>
              <FieldLabel>固定问题</FieldLabel>
              <p class="break-words rounded-md border bg-muted p-3 font-mono text-sm">{{ DEGRADATION_PROMPT }}</p>
            </Field>
          </FieldGroup>
          <div
            aria-label="降智检测结果"
            aria-live="polite"
            role="status"
            class="flex min-h-16 items-center justify-center"
          >
            <span v-if="busy" class="flex items-center gap-2 text-muted-foreground">
              <Loader2 class="size-4 animate-spin" />
              {{ queued ? "排队中…" : run?.status === 'running' ? "检测中…" : "目标正在执行其他测试…" }}
            </span>
            <Badge v-else-if="run?.status === 'success'" :variant="run.verdict === 'degraded' ? 'destructive' : 'secondary'">
              {{ run.verdict === 'normal' ? "未降智" : "降智" }}
            </Badge>
            <span v-else class="text-muted-foreground">{{ run?.status === 'failed' ? '检测失败' : '尚未检测' }}</span>
          </div>
          <Alert v-if="run?.status === 'failed' && !busy" variant="destructive">
            <AlertTitle>未获得有效响应</AlertTitle>
            <AlertDescription>{{ run.error }}</AlertDescription>
          </Alert>
        </template>
      </CardContent>
      <CardFooter v-if="targets.length" class="flex-wrap justify-between gap-3">
        <p class="text-xs text-muted-foreground">
          {{ proxyAllowed ? "已授权代理" : "浏览器直连" }} · 一次请求，不自动重试。不保存原始回复。
        </p>
        <Button :disabled="!selected || busy || proxyOpen" @click="start">
          <Loader2 v-if="busy" class="animate-spin" data-icon="inline-start" />
          <Play v-else data-icon="inline-start" />
          {{ busy ? "等待完成…" : run ? "重新检测" : "开始检测" }}
        </Button>
      </CardFooter>
    </Card>
    <AlertDialog v-model:open="proxyOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>是否通过 Cloudflare 代理检测？</AlertDialogTitle>
          <AlertDialogDescription>
            将发送一次固定问题。使用代理时，你的 API Key、目标模型 ID 和固定问题将经过
            {{ proxyURL }}，再由该服务器请求服务商。授权会与其他测试模式共享并在此浏览器记住，
            可在自动测试中撤销。只有信任代理运营方时才同意；关闭弹窗不会发送请求。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel @click="directOnly">仅本次直连</AlertDialogCancel>
          <AlertDialogAction @click="consent">同意并通过代理检测</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>
</template>
