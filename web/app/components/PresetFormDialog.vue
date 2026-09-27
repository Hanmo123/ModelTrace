<script setup lang="ts">
import { ClipboardList, Plus, Trash2 } from "lucide-vue-next";
import ActionTooltip from "@/components/ActionTooltip.vue";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  MAX_CHANNEL_MODELS,
  MAX_PROVIDER_CHANNELS,
  normalizeMultiplier,
  parseModelIds,
  type ProviderInput,
  type ProviderPreset,
  type ProviderChannel,
  type ProviderModel,
} from "@/lib/providers";

const props = defineProps<{
  open: boolean;
  preset: ProviderPreset | null;
  initialChannelId?: string;
  disabled?: boolean;
}>();
const emit = defineEmits<{
  "update:open": [value: boolean];
  save: [input: ProviderInput];
}>();
const newModel = (model = ""): ProviderModel => ({
  id: crypto.randomUUID(),
  model,
  apiType: "chat",
  temperature: null,
});
const newChannel = (name = ""): ProviderChannel => ({
  id: crypto.randomUUID(),
  name,
  multiplier: "1",
  apiKey: "",
  models: [newModel()],
});
const form = reactive<ProviderInput>({
  name: "",
  baseUrl: "",
  channels: [newChannel("默认渠道")],
});
const activeId = ref(form.channels[0]!.id);
const channel = computed(
  () =>
    form.channels.find((item) => item.id === activeId.value) ??
    form.channels[0]!,
);
const errors = reactive<Record<string, string>>({});
const channelErrors = reactive<Record<string, Record<string, string>>>(
  Object.create(null),
);
const activeErrors = computed(() => channelErrors[channel.value.id] ?? {});
// Each channel owns its un-applied paste; switching never discards a draft.
const bulkTexts = reactive<Record<string, string>>(Object.create(null));
const bulkOpen = reactive<Record<string, boolean>>(Object.create(null));
const bulkText = computed({
  get: () => bulkTexts[channel.value.id] ?? "",
  set: (value) => {
    bulkTexts[channel.value.id] = value;
  },
});
const newModelCount = computed(
  () =>
    parseModelIds(bulkText.value).filter(
      (id) => !channel.value.models.some((row) => row.model.trim() === id),
    ).length,
);
const inputId = (index: number) =>
  index === 0 ? "preset-model" : `preset-model-${index}`;
const protocolId = (index: number) =>
  index === 0 ? "preset-protocol" : `preset-protocol-${index}`;
function clearMap(map: Record<string, unknown>) {
  Object.keys(map).forEach((key) => delete map[key]);
}
function errorFor(item: ProviderChannel) {
  return (channelErrors[item.id] ??= {});
}

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    Object.assign(form, {
      name: props.preset?.name ?? "",
      baseUrl: props.preset?.baseUrl ?? "",
      channels: props.preset?.channels.map((item) => ({
        ...item,
        models: item.models.map((row) => ({ ...row })),
      })) ?? [newChannel("默认渠道")],
    });
    activeId.value =
      form.channels.find((item) => item.id === props.initialChannelId)?.id ??
      form.channels[0]!.id;
    [errors, channelErrors, bulkTexts, bulkOpen].forEach(clearMap);
  },
  { immediate: true },
);

async function addChannel() {
  if (props.disabled || form.channels.length >= MAX_PROVIDER_CHANNELS) return;
  const item = newChannel();
  form.channels.push(item);
  activeId.value = item.id;
  await nextTick();
  document.getElementById("channel-name")?.focus();
}
function removeChannel() {
  if (props.disabled || form.channels.length <= 1) return;
  const id = channel.value.id;
  const index = form.channels.findIndex((item) => item.id === id);
  form.channels.splice(index, 1);
  delete bulkTexts[id];
  delete bulkOpen[id];
  delete channelErrors[id];
  activeId.value = form.channels[Math.min(index, form.channels.length - 1)]!.id;
}
async function appendModel() {
  if (channel.value.models.length >= MAX_CHANNEL_MODELS) return;
  channel.value.models.push(newModel());
  await nextTick();
  document.getElementById(inputId(channel.value.models.length - 1))?.focus();
}
function importModels(
  item: ProviderChannel,
  text: string,
  replaceIndex?: number,
) {
  const rows = item.models.map((row) => ({ ...row }));
  if (replaceIndex !== undefined) rows[replaceIndex]!.model = "";
  const names = new Set(rows.map((row) => row.model.trim()).filter(Boolean));
  for (const model of parseModelIds(text)) {
    if (names.has(model)) continue;
    const empty = rows.find((row) => !row.model.trim());
    if (empty) empty.model = model;
    else rows.push(newModel(model));
    names.add(model);
  }
  if (names.size > MAX_CHANNEL_MODELS) {
    errorFor(item).models = `每个渠道最多添加 ${MAX_CHANNEL_MODELS} 个模型`;
    return false;
  }
  item.models = names.size
    ? rows.filter((row) => row.model.trim())
    : [newModel()];
  delete errorFor(item).models;
  return true;
}
function applyBulk(item = channel.value) {
  const text = bulkTexts[item.id] ?? "";
  if (!text.trim()) return true;
  if (!importModels(item, text)) return false;
  bulkTexts[item.id] = "";
  return true;
}
function pasteModels(event: ClipboardEvent, index: number) {
  const text = event.clipboardData?.getData("text") || "";
  if (parseModelIds(text).length < 2) return;
  event.preventDefault();
  importModels(channel.value, text, index);
}
async function submit() {
  if (props.disabled) return;
  clearMap(errors);
  clearMap(channelErrors);
  if (!form.name.trim()) errors.name = "请填写服务商名称";
  try {
    const url = new URL(form.baseUrl.trim());
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error();
    if (/\/(chat\/completions|responses)\/?$/.test(url.pathname))
      errors.baseUrl =
        "请填写 API 根地址（例如 /v1），不要包含 /chat/completions 或 /responses";
  } catch {
    errors.baseUrl =
      "请填写有效的 HTTP(S) API 根地址，不含凭据、查询参数或锚点";
  }
  if (!form.channels.length || form.channels.length > MAX_PROVIDER_CHANNELS)
    errors.channels = `请添加 1–${MAX_PROVIDER_CHANNELS} 个渠道`;
  const names = new Set<string>();
  for (const item of form.channels) {
    const issue = errorFor(item);
    applyBulk(item);
    if (!item.name.trim()) issue.name = "请填写渠道名称";
    else if (names.has(item.name.trim()))
      issue.name = "同一服务商内的渠道名称不能重复";
    names.add(item.name.trim());
    if (normalizeMultiplier(item.multiplier) === null)
      issue.multiplier = "请填写非负倍率，最多 9 位整数和 6 位小数";
    if (!item.apiKey.trim()) issue.apiKey = "请填写此渠道的 API Key";
    if (!item.models.length || item.models.length > MAX_CHANNEL_MODELS)
      issue.models = `请添加 1–${MAX_CHANNEL_MODELS} 个模型`;
    const seen = new Set<string>();
    for (const row of item.models) {
      const model = row.model.trim();
      if (!model) issue[`model:${row.id}`] = "请填写模型 ID";
      else if (/[\s,，;；]/u.test(model))
        issue[`model:${row.id}`] = "每行一个模型 ID；多个模型请使用批量添加";
      else if (seen.has(model))
        issue[`model:${row.id}`] = "此模型已在该渠道中，请勿重复添加";
      seen.add(model);
    }
  }
  const invalid = form.channels.find(
    (item) => Object.keys(errorFor(item)).length,
  );
  if (Object.keys(errors).length || invalid) {
    if (invalid) activeId.value = invalid.id;
    await nextTick();
    document
      .querySelector<HTMLElement>('[role="dialog"] [aria-invalid="true"]')
      ?.focus();
    return;
  }
  emit("save", {
    name: form.name.trim(),
    baseUrl: form.baseUrl.trim().replace(/\/+$/, ""),
    channels: form.channels.map((item) => ({
      ...item,
      name: item.name.trim(),
      multiplier: normalizeMultiplier(item.multiplier)!,
      apiKey: item.apiKey.trim(),
      models: item.models.map((row) => ({ ...row, model: row.model.trim() })),
    })),
  });
  emit("update:open", false);
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent
      class="flex max-h-[90dvh] flex-col overflow-hidden sm:max-w-2xl"
    >
      <DialogHeader>
        <DialogTitle>{{ preset ? "编辑服务商" : "添加服务商" }}</DialogTitle>
        <DialogDescription
          >服务商共用 Endpoint；每个渠道独立配置名称、价格倍率、API Key
          和模型。所有修改在保存后生效。</DialogDescription
        >
      </DialogHeader>
      <form
        class="flex min-h-0 flex-col gap-4"
        novalidate
        @submit.prevent="submit"
      >
        <div class="min-h-0 overflow-y-auto px-1">
          <FieldGroup class="gap-5">
            <FieldSet :disabled="disabled" class="min-w-0 gap-4">
              <FieldLegend variant="label" class="mb-0">服务商连接</FieldLegend>
              <FieldGroup class="gap-4">
                <Field :data-invalid="!!errors.name" class="gap-2">
                  <FieldLabel for="preset-name">服务商名称 *</FieldLabel>
                  <Input
                    id="preset-name"
                    v-model="form.name"
                    required
                    placeholder="例如：OpenAI 官方"
                    :aria-invalid="!!errors.name"
                    aria-describedby="name-error"
                  />
                  <FieldError v-if="errors.name" id="name-error">{{
                    errors.name
                  }}</FieldError>
                </Field>
                <Field :data-invalid="!!errors.baseUrl" class="gap-2">
                  <FieldLabel for="preset-base-url">Endpoint *</FieldLabel>
                  <Input
                    id="preset-base-url"
                    v-model="form.baseUrl"
                    required
                    type="url"
                    placeholder="https://api.openai.com/v1"
                    :aria-invalid="!!errors.baseUrl"
                    aria-describedby="endpoint-hint endpoint-error"
                  />
                  <FieldDescription id="endpoint-hint"
                    >所有渠道共用此 API 根地址；SDK
                    自动追加请求路径。</FieldDescription
                  >
                  <FieldError v-if="errors.baseUrl" id="endpoint-error">{{
                    errors.baseUrl
                  }}</FieldError>
                </Field>
              </FieldGroup>
            </FieldSet>
            <Separator />
            <FieldSet :disabled="disabled" class="min-w-0 gap-3">
              <FieldLegend variant="label" class="mb-0">渠道配置</FieldLegend>
              <FieldGroup class="gap-3">
                <Field class="min-w-0 gap-2">
                  <FieldLabel for="channel-select">当前编辑的渠道</FieldLabel>
                  <div class="flex min-w-0 items-center gap-2">
                    <Select v-model="activeId" :disabled="disabled">
                      <SelectTrigger id="channel-select" class="min-w-0 flex-1"
                        ><SelectValue class="truncate"
                      /></SelectTrigger>
                      <SelectContent
                        ><SelectGroup>
                          <SelectItem
                            v-for="item in form.channels"
                            :key="item.id"
                            :value="item.id"
                            >{{ item.name.trim() || "未命名渠道" }} ·
                            {{ item.multiplier || "—" }}×{{
                              Object.keys(channelErrors[item.id] ?? {}).length
                                ? " · 待修正"
                                : ""
                            }}</SelectItem
                          >
                        </SelectGroup></SelectContent
                      >
                    </Select>
                    <ActionTooltip
                      :disabled="
                        disabled ||
                        form.channels.length >= MAX_PROVIDER_CHANNELS
                      "
                      text="添加独立渠道"
                    >
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        :disabled="
                          disabled ||
                          form.channels.length >= MAX_PROVIDER_CHANNELS
                        "
                        aria-label="添加渠道"
                        @click="addChannel"
                        ><Plus
                      /></Button>
                    </ActionTooltip>
                    <ActionTooltip
                      :disabled="disabled || form.channels.length <= 1"
                      :text="
                        form.channels.length <= 1
                          ? '至少保留一个渠道'
                          : '移除此渠道，保存后生效；取消编辑可撤销'
                      "
                    >
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        :disabled="disabled || form.channels.length <= 1"
                        aria-label="删除当前渠道"
                        @click="removeChannel"
                        ><Trash2
                      /></Button>
                    </ActionTooltip>
                  </div>
                  <FieldError v-if="errors.channels">{{
                    errors.channels
                  }}</FieldError>
                </Field>
                <FieldGroup class="gap-3 sm:grid sm:grid-cols-2">
                  <Field :data-invalid="!!activeErrors.name" class="gap-2">
                    <FieldLabel for="channel-name">渠道名称 *</FieldLabel>
                    <Input
                      id="channel-name"
                      v-model="channel.name"
                      required
                      placeholder="例如：优质渠道 / 经济渠道"
                      :aria-invalid="!!activeErrors.name"
                      aria-describedby="channel-name-error"
                    />
                    <FieldError
                      v-if="activeErrors.name"
                      id="channel-name-error"
                      >{{ activeErrors.name }}</FieldError
                    >
                  </Field>
                  <Field
                    :data-invalid="!!activeErrors.multiplier"
                    class="gap-2"
                  >
                    <FieldLabel for="channel-multiplier">价格倍率 *</FieldLabel>
                    <Input
                      id="channel-multiplier"
                      v-model="channel.multiplier"
                      required
                      inputmode="decimal"
                      placeholder="1 / 0.5 / 1.25"
                      :aria-invalid="!!activeErrors.multiplier"
                      aria-describedby="multiplier-hint multiplier-error"
                    />
                    <FieldError
                      v-if="activeErrors.multiplier"
                      id="multiplier-error"
                      >{{ activeErrors.multiplier }}</FieldError
                    >
                  </Field>
                  <Field
                    :data-invalid="!!activeErrors.apiKey"
                    class="gap-2 sm:col-span-2"
                  >
                    <FieldLabel for="preset-api-key"
                      >此渠道的 API Key *</FieldLabel
                    >
                    <Input
                      id="preset-api-key"
                      v-model="channel.apiKey"
                      required
                      type="password"
                      autocomplete="off"
                      placeholder="sk-..."
                      :aria-invalid="!!activeErrors.apiKey"
                      aria-describedby="key-error"
                    />
                    <FieldError v-if="activeErrors.apiKey" id="key-error">{{
                      activeErrors.apiKey
                    }}</FieldError>
                  </Field>
                </FieldGroup>
                <FieldDescription id="multiplier-hint"
                  >倍率默认 1，支持 0 和最多 6
                  位小数。仅作价格参考，不影响测试或质量判定，也不代表实际账单。</FieldDescription
                >
              </FieldGroup>
            </FieldSet>
            <Separator />
            <FieldSet :disabled="disabled" class="min-w-0 gap-3">
              <FieldLegend variant="label" class="mb-0"
                >当前渠道的模型</FieldLegend
              >
              <p class="text-xs leading-relaxed text-muted-foreground">
                各渠道模型列表互不影响，同名模型可以出现在不同渠道。支持多行粘贴；只在当前渠道内去重。
              </p>
              <div
                :key="channel.id"
                class="flex max-h-72 flex-col gap-3 overflow-y-auto pr-1"
                aria-label="模型配置列表"
              >
                <FieldGroup
                  v-for="(row, index) in channel.models"
                  :key="row.id"
                  class="grid grid-cols-[minmax(0,1fr)_7.5rem_2rem] items-start gap-2"
                >
                  <Field
                    :data-invalid="!!activeErrors[`model:${row.id}`]"
                    class="min-w-0 gap-1.5"
                  >
                    <FieldLabel :for="inputId(index)">{{
                      index === 0 ? "模型 ID *" : `模型 ${index + 1} *`
                    }}</FieldLabel>
                    <Input
                      :id="inputId(index)"
                      v-model="row.model"
                      required
                      placeholder="例如：gpt-4o"
                      autocomplete="off"
                      spellcheck="false"
                      :aria-invalid="!!activeErrors[`model:${row.id}`]"
                      :aria-describedby="`model-error-${row.id}`"
                      @paste="pasteModels($event, index)"
                    />
                    <FieldError
                      v-if="activeErrors[`model:${row.id}`]"
                      :id="`model-error-${row.id}`"
                      >{{ activeErrors[`model:${row.id}`] }}</FieldError
                    >
                  </Field>
                  <Field class="min-w-0 gap-1.5">
                    <FieldLabel :for="protocolId(index)">协议</FieldLabel>
                    <Select v-model="row.apiType" :disabled="disabled">
                      <SelectTrigger :id="protocolId(index)"
                        ><SelectValue>{{
                          row.apiType === "responses" ? "Responses" : "Chat"
                        }}</SelectValue></SelectTrigger
                      >
                      <SelectContent
                        ><SelectGroup
                          ><SelectItem value="chat">Chat</SelectItem
                          ><SelectItem value="responses"
                            >Responses API</SelectItem
                          ></SelectGroup
                        ></SelectContent
                      >
                    </Select>
                  </Field>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    class="mt-6"
                    :disabled="channel.models.length === 1"
                    :aria-label="`移除模型 ${index + 1}`"
                    @click="channel.models.splice(index, 1)"
                    ><Trash2
                  /></Button>
                </FieldGroup>
              </div>
              <FieldError v-if="activeErrors.models" id="models-error">{{
                activeErrors.models
              }}</FieldError>
              <div class="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  :disabled="channel.models.length >= MAX_CHANNEL_MODELS"
                  @click="appendModel"
                  ><Plus data-icon="inline-start" />添加模型</Button
                >
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  :aria-expanded="!!bulkOpen[channel.id]"
                  aria-controls="bulk-model-panel"
                  @click="bulkOpen[channel.id] = !bulkOpen[channel.id]"
                  ><ClipboardList data-icon="inline-start" />批量添加</Button
                >
                <span class="ml-auto text-xs text-muted-foreground"
                  >每渠道最多 {{ MAX_CHANNEL_MODELS }} 个</span
                >
              </div>
              <Field
                v-if="bulkOpen[channel.id]"
                id="bulk-model-panel"
                class="gap-2 rounded-md border p-3"
              >
                <FieldLabel for="preset-models-bulk">粘贴模型列表</FieldLabel>
                <Textarea
                  id="preset-models-bulk"
                  v-model="bulkText"
                  :rows="3"
                  placeholder="gpt-4o&#10;gpt-4o-mini&#10;claude-sonnet-4-6"
                />
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <span class="text-xs text-muted-foreground"
                    >支持换行、空格和逗号分隔，区分大小写。</span
                  >
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    :disabled="!bulkText.trim()"
                    @click="applyBulk()"
                    >加入列表（{{ newModelCount }}）</Button
                  >
                </div>
              </Field>
            </FieldSet>
            <p class="text-xs leading-relaxed text-muted-foreground">
              配置仅保存在当前浏览器，每个服务商最多
              {{
                MAX_PROVIDER_CHANNELS
              }}
              个渠道。直连只发送至服务商；授权代理后，当前渠道的密钥与挑战也会经过代理服务器。测试会消耗
              API 额度。
            </p>
          </FieldGroup>
        </div>
        <DialogFooter class="shrink-0">
          <Button
            type="button"
            variant="outline"
            @click="emit('update:open', false)"
            >取消</Button
          >
          <Button type="submit" :disabled="disabled">保存</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
