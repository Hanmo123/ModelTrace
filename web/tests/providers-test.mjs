import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

async function moduleFrom(path) {
  const output = await build({
    entryPoints: [path],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].contents).toString("base64")}`
  );
}
const {
  decodePresets,
  encodePresets,
  invalidatedModelRuns,
  loadPresets,
  modelRunId,
  parseModelIds,
  providerTargets,
  PRESET_STORAGE_KEY,
  LEGACY_PRESET_STORAGE_KEY,
} = await moduleFrom("lib/providers.ts");
const { createTaskQueue } = await moduleFrom("lib/task-queue.ts");
const model = (id, name = id, apiType = "chat") => ({
  id,
  model: name,
  apiType,
  temperature: null,
});
const provider = {
  id: "provider",
  name: "Provider",
  baseUrl: "https://api.vendor.com/v1",
  apiKey: "sk-private",
  models: [model("one"), model("two", "second", "responses")],
};
const legacy = {
  id: "old",
  name: "",
  baseUrl: "https://legacy.vendor.com/v1/",
  apiKey: "sk-legacy",
  model: "old-model",
  apiType: "responses",
  temperature: 0.7,
};
function storage(values = {}) {
  const entries = new Map(Object.entries(values));
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: (key) => entries.delete(key),
  };
}

test("bulk model IDs support common separators, stable order and case-sensitive deduplication", () => {
  assert.deepEqual(
    parseModelIds(
      " gpt-4o\r\ngpt-4o,claude-sonnet，foo/bar;foo:bar；GPT-4o \t",
    ),
    ["gpt-4o", "claude-sonnet", "foo/bar", "foo:bar", "GPT-4o"],
  );
  assert.deepEqual(parseModelIds(" \n ,，；"), []);
});

test("v2 persists shared credentials once, models retain their identities and protocols", () => {
  const encoded = encodePresets([provider]);
  assert.equal(encoded.split("sk-private").length - 1, 1);
  assert.deepEqual(decodePresets(encoded, 2), [provider]);
  assert(!Object.hasOwn(JSON.parse(encoded).presets[0], "model"));
});

test("legacy single-model providers migrate without merging distinct provider records", () => {
  const previous = {
    version: 1,
    presets: [legacy, { ...legacy, id: "other", model: "another" }],
  };
  const store = storage({
    [LEGACY_PRESET_STORAGE_KEY]: JSON.stringify(previous),
  });
  const { presets, error } = loadPresets(store);
  assert.equal(error, null);
  assert.equal(presets.length, 2);
  assert.equal(presets[0].name, "legacy.vendor.com");
  assert.equal(presets[0].baseUrl, "https://legacy.vendor.com/v1");
  assert.deepEqual(presets[0].models, [
    { id: "old", model: "old-model", apiType: "responses", temperature: 0.7 },
  ]);
  assert.equal(store.getItem(LEGACY_PRESET_STORAGE_KEY), null);
  assert.equal(JSON.parse(store.getItem(PRESET_STORAGE_KEY)).version, 2);
  assert.deepEqual(loadPresets(store).presets, presets);
});

test("failed migration keeps legacy data and usable in-memory models", () => {
  const raw = JSON.stringify({ version: 1, presets: [legacy] });
  const store = storage({ [LEGACY_PRESET_STORAGE_KEY]: raw });
  store.setItem = () => {
    throw new Error("quota");
  };
  const loaded = loadPresets(store);
  assert.equal(loaded.presets.length, 1);
  assert(loaded.error);
  assert.equal(store.getItem(LEGACY_PRESET_STORAGE_KEY), raw);
  assert.equal(store.getItem(PRESET_STORAGE_KEY), null);
});

test("an empty v2 collection never resurrects v1 data", () => {
  const store = storage({
    [PRESET_STORAGE_KEY]: encodePresets([]),
    [LEGACY_PRESET_STORAGE_KEY]: JSON.stringify({
      version: 1,
      presets: [legacy],
    }),
  });
  assert.deepEqual(loadPresets(store), { presets: [], error: null });
});

test("unreadable or unsupported storage is reported without overwriting data", () => {
  for (const raw of [
    "not-json",
    JSON.stringify({ version: 3, presets: [provider] }),
  ]) {
    const store = storage({ [PRESET_STORAGE_KEY]: raw });
    assert(loadPresets(store).error);
    assert.equal(store.getItem(PRESET_STORAGE_KEY), raw);
  }
  assert(
    loadPresets({
      getItem() {
        throw new Error("denied");
      },
    }).error,
  );
});

test("malformed and duplicate persisted entries do not crash or create duplicate model runs", () => {
  const malformed = {
    ...provider,
    extraSecret: "discard",
    models: [
      ...provider.models,
      model("three", "one"),
      model("one", "different"),
      null,
      { ...model("bad"), apiType: "unknown" },
      { ...model("temp"), temperature: "invalid" },
    ],
  };
  const decoded = decodePresets(
    JSON.stringify({
      version: 2,
      presets: [
        null,
        malformed,
        malformed,
        { ...provider, id: "empty", models: [] },
      ],
    }),
    2,
  );
  assert.equal(decoded.length, 1);
  assert.deepEqual(
    decoded[0].models.map((row) => row.id),
    ["one", "two", "temp"],
  );
  assert.equal(decoded[0].models[2].temperature, null);
  assert(!Object.hasOwn(decoded[0], "extraSecret"));
});

test("run keys isolate the same model across providers and cannot collide on delimiters", () => {
  assert.notEqual(modelRunId("a/b", "c"), modelRunId("a", "b/c"));
  const first = providerTargets(provider);
  const other = providerTargets({ ...provider, id: "another" });
  assert.notEqual(first[0].id, other[0].id);
  assert.equal(first[1].apiType, "responses");
  assert.equal(first[0].providerId, provider.id);
  assert.equal(first[0].apiKey, provider.apiKey);
  first[0].model = "changed snapshot";
  assert.equal(provider.models[0].model, "one");
});

test("name-only edits, adding and reordering models preserve previous results", () => {
  assert.deepEqual(
    invalidatedModelRuns(provider, {
      ...provider,
      name: "Renamed",
      models: [...provider.models].reverse().concat(model("new")),
    }),
    [],
  );
});

test("model edits/removal invalidate only affected model results", () => {
  assert.deepEqual(
    invalidatedModelRuns(provider, {
      ...provider,
      models: [provider.models[0]],
    }),
    [modelRunId(provider.id, "two")],
  );
  for (const patch of [
    { model: "changed" },
    { apiType: "responses" },
    { temperature: 1 },
  ]) {
    assert.deepEqual(
      invalidatedModelRuns(provider, {
        ...provider,
        models: [{ ...provider.models[0], ...patch }, provider.models[1]],
      }),
      [modelRunId(provider.id, "one")],
    );
  }
});

test("changing the shared connection invalidates every model result", () => {
  for (const patch of [
    { apiKey: "new-key" },
    { baseUrl: "https://other.vendor.com/v1" },
  ]) {
    assert.deepEqual(
      invalidatedModelRuns(provider, { ...provider, ...patch }),
      providerTargets(provider).map((target) => target.id),
    );
  }
});

test("task queue enforces a shared concurrency budget and FIFO starts", async () => {
  const queue = createTaskQueue(2);
  let active = 0;
  let peak = 0;
  const started = [];
  const values = await Promise.all(
    Array.from({ length: 7 }, (_, index) =>
      queue.enqueue(String(index), async () => {
        started.push(index);
        peak = Math.max(peak, ++active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return index;
      }),
    ),
  );
  assert.equal(peak, 2);
  assert.deepEqual(started, values);
  assert.deepEqual(values, [0, 1, 2, 3, 4, 5, 6]);
});

test("duplicate clicks join a task, and a completed key can immediately be run again", async () => {
  const queue = createTaskQueue(1);
  let calls = 0;
  const first = queue.enqueue("same", async () => ++calls);
  assert.equal(
    queue.enqueue("same", async () => ++calls),
    first,
  );
  assert.equal(await first, 1);
  assert.equal(await queue.enqueue("same", async () => ++calls), 2);
});

test("failed and synchronously throwing tasks release their slots", async () => {
  const queue = createTaskQueue(1);
  const results = await Promise.allSettled([
    queue.enqueue("bad", () => {
      throw new Error("failed");
    }),
    queue.enqueue("good", async () => "ok"),
  ]);
  assert.equal(results[0].status, "rejected");
  assert.deepEqual(results[1], { status: "fulfilled", value: "ok" });
  assert.equal(queue.has("bad"), false);
  assert.equal(await queue.enqueue("bad", async () => "retry"), "retry");
  assert.throws(() => createTaskQueue(0));
});
