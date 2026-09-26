<script setup lang="ts">
import { ClipboardList, Plus, Trash2 } from "lucide-vue-next";
import { Badge } from "@/components/ui/badge";
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
  MAX_PROVIDER_MODELS,
  parseModelIds,
  type ProviderInput,
  type ProviderModel,
  type ProviderPreset,
} from "@/lib/providers";

const props = defineProps<{
  open: boolean;
  preset: ProviderPreset | null;
  disabled?: boolean;
}>();
const emit = defineEmits<{
  "update:open": [value: boolean];
  save: [input: ProviderInput];
}>();
const form = reactive<ProviderInput>({
  name: "",
  baseUrl: "",
  apiKey: "",
  models: [],
});
const errors = reactive<Record<string, string>>({});
const bulkText = ref("");
const bulkOpen = ref(false);
const modelCount = computed(
  () =>
    new Set(form.models.map((row) => row.model.trim()).filter(Boolean)).size,
);
const newModelCount = computed(
  () =>
    parseModelIds(bulkText.value).filter(
      (id) => !form.models.some((row) => row.model.trim() === id),
    ).length,
);
const newModel = (model = ""): ProviderModel => ({
  id: crypto.randomUUID(),
  model,
  apiType: "chat",
  temperature: null,
});
const inputId = (index: number) =>
  index === 0 ? "preset-model" : `preset-model-${index}`;
const protocolId = (index: number) =>
  index === 0 ? "preset-protocol" : `preset-protocol-${index}`;

function clearErrors() {
  Object.keys(errors).forEach((key) => delete errors[key]);
}
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    Object.assign(form, {
      name: props.preset?.name ?? "",
      baseUrl: props.preset?.baseUrl ?? "",
      apiKey: props.preset?.apiKey ?? "",
      models: props.preset?.models.map((row) => ({ ...row })) ?? [newModel()],
    });
    bulkText.value = "";
    bulkOpen.value = false;
    clearErrors();
  },
  { immediate: true },
);

async function appendModel() {
  if (form.models.length >= MAX_PROVIDER_MODELS) return;
  form.models.push(newModel());
  await nextTick();
  document.getElementById(inputId(form.models.length - 1))?.focus();
}

function importModels(text: string, replaceIndex?: number) {
  const rows = form.models.map((row) => ({ ...row }));
  if (replaceIndex !== undefined) rows[replaceIndex]!.model = "";
  const names = new Set(rows.map((row) => row.model.trim()).filter(Boolean));
  for (const model of parseModelIds(text)) {
    if (names.has(model)) continue;
    const empty = rows.find((row) => !row.model.trim());
    if (empty) empty.model = model;
    else rows.push(newModel(model));
    names.add(model);
  }
  if (names.size > MAX_PROVIDER_MODELS) {
    errors.models = `每个服务商最多添加 ${MAX_PROVIDER_MODELS} 个模型`;
    return false;
  }
  form.models = names.size
    ? rows.filter((row) => row.model.trim())
    : [newModel()];
  delete errors.models;
  return true;
}
function applyBulk() {
  if (!bulkText.value.trim()) return true;
  if (!importModels(bulkText.value)) return false;
  bulkText.value = "";
  return true;
}
function pasteModels(event: ClipboardEvent, index: number) {
  const text = event.clipboardData?.getData("text") || "";
  if (parseModelIds(text).length < 2) return;
  event.preventDefault();
  importModels(text, index);
}

function submit() {
  if (props.disabled) return;
  clearErrors();
  // Saving never silently discards a not-yet-applied bulk paste.
  if (!applyBulk()) return;
  if (!form.name.trim()) errors.name = "请填写服务商名称";
  if (!form.baseUrl.trim()) errors.baseUrl = "请填写 Endpoint";
  else {
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
      if (/\/(chat\/completions|responses)\/?$/.test(url.pathname)) {
        errors.baseUrl =
          "请填写 API 根地址（例如 /v1），不要包含 /chat/completions 或 /responses";
      }
    } catch {
      errors.baseUrl =
        "请填写有效的 HTTP(S) API 根地址，不含凭据、查询参数或锚点";
    }
  }
  if (!form.apiKey.trim()) errors.apiKey = "请填写 API Key";
  if (!form.models.length || form.models.length > MAX_PROVIDER_MODELS)
    errors.models = `请添加 1–${MAX_PROVIDER_MODELS} 个模型`;
  const seen = new Set<string>();
  for (const row of form.models) {
    const model = row.model.trim();
    if (!model) errors[row.id] = "请填写模型 ID";
    else if (/[\s,，;；]/u.test(model))
      errors[row.id] = "每行一个模型 ID；多个模型请使用批量添加";
    else if (seen.has(model)) errors[row.id] = "此模型已在列表中，请勿重复添加";
    seen.add(model);
  }
  if (Object.keys(errors).length) return;
  emit("save", {
    name: form.name.trim(),
    baseUrl: form.baseUrl.trim().replace(/\/+$/, ""),
    apiKey: form.apiKey.trim(),
    models: form.models.map((row) => ({ ...row, model: row.model.trim() })),
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
          >连接信息只填一次，为同一服务商添加多个模型，分别测试和对比结果。</DialogDescription
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
              <FieldLegend variant="label" class="mb-0">连接配置</FieldLegend>
              <FieldGroup class="gap-4 sm:grid sm:grid-cols-2">
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
                <Field :data-invalid="!!errors.apiKey" class="gap-2">
                  <FieldLabel for="preset-api-key">API Key *</FieldLabel>
                  <Input
                    id="preset-api-key"
                    v-model="form.apiKey"
                    required
                    type="password"
                    autocomplete="off"
                    placeholder="sk-..."
                    :aria-invalid="!!errors.apiKey"
                    aria-describedby="key-error"
                  />
                  <FieldError v-if="errors.apiKey" id="key-error">{{
                    errors.apiKey
                  }}</FieldError>
                </Field>
                <Field
                  :data-invalid="!!errors.baseUrl"
                  class="gap-2 sm:col-span-2"
                >
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
                    >填写 API 根地址，所有模型共用此连接；SDK
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
              <FieldLegend variant="label" class="mb-0"
                >模型配置
                <Badge variant="secondary" class="ml-2">{{
                  modelCount
                }}</Badge></FieldLegend
              >
              <p class="text-xs leading-relaxed text-muted-foreground">
                每个模型可独立选择协议。支持直接粘贴多行模型
                ID，或用逗号分隔；批量添加自动去重。
              </p>
              <div
                class="flex max-h-72 flex-col gap-3 overflow-y-auto pr-1"
                aria-label="模型配置列表"
              >
                <FieldGroup
                  v-for="(row, index) in form.models"
                  :key="row.id"
                  class="grid grid-cols-[minmax(0,1fr)_7.5rem_2rem] items-start gap-2"
                >
                  <Field
                    :data-invalid="!!errors[row.id]"
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
                      :aria-invalid="!!errors[row.id]"
                      :aria-describedby="`model-error-${row.id}`"
                      @paste="pasteModels($event, index)"
                    />
                    <FieldError
                      v-if="errors[row.id]"
                      :id="`model-error-${row.id}`"
                      >{{ errors[row.id] }}</FieldError
                    >
                  </Field>
                  <Field class="min-w-0 gap-1.5">
                    <FieldLabel :for="protocolId(index)">协议</FieldLabel>
                    <Select v-model="row.apiType">
                      <SelectTrigger :id="protocolId(index)"
                        ><SelectValue>{{
                          row.apiType === "responses" ? "Responses" : "Chat"
                        }}</SelectValue></SelectTrigger
                      >
                      <SelectContent
                        ><SelectGroup>
                          <SelectItem value="chat">Chat</SelectItem>
                          <SelectItem value="responses"
                            >Responses API</SelectItem
                          >
                        </SelectGroup></SelectContent
                      >
                    </Select>
                  </Field>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    class="mt-6"
                    :disabled="form.models.length === 1"
                    :aria-label="`移除模型 ${index + 1}`"
                    @click="form.models.splice(index, 1)"
                    ><Trash2
                  /></Button>
                </FieldGroup>
              </div>
              <FieldError v-if="errors.models" id="models-error">{{
                errors.models
              }}</FieldError>
              <div class="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  :disabled="form.models.length >= MAX_PROVIDER_MODELS"
                  @click="appendModel"
                  ><Plus data-icon="inline-start" />添加模型</Button
                >
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  :aria-expanded="bulkOpen"
                  aria-controls="bulk-model-panel"
                  @click="bulkOpen = !bulkOpen"
                  ><ClipboardList data-icon="inline-start" />批量添加</Button
                >
                <span class="ml-auto text-xs text-muted-foreground"
                  >最多 {{ MAX_PROVIDER_MODELS }} 个</span
                >
              </div>
              <Field
                v-if="bulkOpen"
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
                    @click="applyBulk"
                    >加入列表（{{ newModelCount }}）</Button
                  >
                </div>
              </Field>
            </FieldSet>
            <p class="text-xs leading-relaxed text-muted-foreground">
              配置仅保存在当前浏览器。直连只发送至服务商；授权代理后，密钥与挑战也会经过代理服务器。测试会消耗
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
