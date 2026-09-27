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
  normalizeMultiplier,
  parseModelIds,
  providerTargets,
  PRESET_STORAGE_KEY,
  PREVIOUS_PRESET_STORAGE_KEY,
  LEGACY_PRESET_STORAGE_KEY,
} = await moduleFrom("app/lib/providers.ts");
const { createTaskQueue } = await moduleFrom("app/lib/task-queue.ts");
const { decodeDirectFailures } = await moduleFrom("app/lib/direct-routing.ts");
const model = (id, name = id, apiType = "chat") => ({
  id,
  model: name,
  apiType,
  temperature: null,
});
const channel = (id, apiKey = `sk-${id}`) => ({
  id,
  name: id,
  apiKey,
  multiplier: "1",
  models: [model("one"), model("two", "second", "responses")],
});
const provider = {
  id: "provider",
  name: "Provider",
  baseUrl: "https://api.vendor.com/v1",
  channels: [channel("premium"), channel("economy")],
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
const updateChannel = (index, patch) => ({
  ...provider,
  channels: provider.channels.map((item, i) =>
    i === index ? { ...item, ...patch } : item,
  ),
});

test("bulk model parsing is ordered, case-sensitive and de-duplicated", () => {
  assert.deepEqual(
    parseModelIds(" gpt-4o\r\ngpt-4o,claude，foo/bar;foo:bar；GPT-4o \t"),
    ["gpt-4o", "claude", "foo/bar", "foo:bar", "GPT-4o"],
  );
  assert.deepEqual(parseModelIds(" \n ,，；"), []);
});
test("decimal multipliers preserve exact precision and reject unsafe/invalid input", () => {
  for (const [input, expected] of [
    ["1", "1"],
    ["000.500000", "0.5"],
    ["1.234567", "1.234567"],
    ["0", "0"],
    [1.25, "1.25"],
  ])
    assert.equal(normalizeMultiplier(input), expected);
  for (const input of [
    "",
    "NaN",
    Infinity,
    -1,
    "-0.5",
    "1e3",
    "1.1234567",
    "1000000000",
    {},
    null,
  ])
    assert.equal(normalizeMultiplier(input), null);
});
test("v3 persists credentials once per channel and round-trips independent models", () => {
  const encoded = encodePresets([provider]);
  assert.equal(JSON.parse(encoded).version, 3);
  assert.equal(encoded.split("sk-premium").length - 1, 1);
  assert.equal(encoded.split("sk-economy").length - 1, 1);
  assert.deepEqual(decodePresets(encoded, 3), [provider]);
  assert(!Object.hasOwn(JSON.parse(encoded).presets[0], "apiKey"));
});
test("v1 and v2 migrate into stable default channels without losing credentials, model IDs or protocols", () => {
  for (const version of [1, 2]) {
    const source =
      version === 1
        ? legacy
        : {
            ...legacy,
            models: [
              model("one"),
              { ...model("two", "other", "responses"), temperature: 0.7 },
            ],
          };
    const key =
      version === 1 ? LEGACY_PRESET_STORAGE_KEY : PREVIOUS_PRESET_STORAGE_KEY;
    const store = storage({
      [key]: JSON.stringify({
        version,
        presets: [source, { ...source, id: "other" }],
      }),
    });
    const loaded = loadPresets(store);
    assert.equal(loaded.error, null);
    assert.equal(loaded.presets.length, 2);
    const first = loaded.presets[0];
    assert.equal(first.name, "legacy.vendor.com");
    assert.equal(first.baseUrl, "https://legacy.vendor.com/v1");
    assert.deepEqual(first.channels[0], {
      id: "default",
      name: "默认渠道",
      multiplier: "1",
      apiKey: "sk-legacy",
      models:
        version === 1
          ? [
              {
                id: "old",
                model: "old-model",
                apiType: "responses",
                temperature: 0.7,
              },
            ]
          : source.models,
    });
    assert.equal(store.getItem(key), null);
    assert.equal(JSON.parse(store.getItem(PRESET_STORAGE_KEY)).version, 3);
    assert.deepEqual(loadPresets(store).presets, loaded.presets);
  }
});
test("failed migration preserves the old credentials and usable in-memory configuration", () => {
  for (const key of [LEGACY_PRESET_STORAGE_KEY, PREVIOUS_PRESET_STORAGE_KEY]) {
    const version = key === LEGACY_PRESET_STORAGE_KEY ? 1 : 2;
    const raw = JSON.stringify({
      version,
      presets: [{ ...legacy, models: [model("one")] }],
    });
    const store = storage({ [key]: raw });
    store.setItem = () => {
      throw new Error("quota");
    };
    const loaded = loadPresets(store);
    assert.equal(loaded.presets.length, 1);
    assert(loaded.error);
    assert.equal(store.getItem(key), raw);
    assert.equal(store.getItem(PRESET_STORAGE_KEY), null);
  }
});
test("empty current or previous collections never resurrect older presets", () => {
  for (const key of [PRESET_STORAGE_KEY, PREVIOUS_PRESET_STORAGE_KEY]) {
    const store = storage({
      [key]: JSON.stringify({
        version: key === PRESET_STORAGE_KEY ? 3 : 2,
        presets: [],
      }),
      [LEGACY_PRESET_STORAGE_KEY]: JSON.stringify({
        version: 1,
        presets: [legacy],
      }),
    });
    assert.deepEqual(loadPresets(store), { presets: [], error: null });
  }
});
test("unreadable storage and unknown formats are never overwritten", () => {
  for (const raw of [
    "not-json",
    JSON.stringify({ version: 4, presets: [provider] }),
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
test("malformed and duplicate entries are isolated, without leaking extra fields", () => {
  const malformed = {
    ...provider,
    extraSecret: "discard",
    channels: [
      {
        ...provider.channels[0],
        models: [
          ...provider.channels[0].models,
          model("three", "one"),
          model("one", "different"),
          null,
          { ...model("bad"), apiType: "unknown" },
          { ...model("temp"), temperature: "invalid" },
        ],
      },
      provider.channels[0],
      null,
      { ...channel("invalid"), multiplier: "-1" },
      { ...channel("empty"), models: [] },
      provider.channels[1],
    ],
  };
  const decoded = decodePresets(
    JSON.stringify({ version: 3, presets: [null, malformed, malformed] }),
    3,
  );
  assert.equal(decoded.length, 1);
  assert.equal(decoded[0].channels.length, 2);
  assert.deepEqual(
    decoded[0].channels[0].models.map((row) => row.id),
    ["one", "two", "temp"],
  );
  assert.equal(decoded[0].channels[0].models[2].temperature, null);
  assert(!Object.hasOwn(decoded[0], "extraSecret"));
});
test("run identities isolate provider/channel/model tuples, even with equal model IDs", () => {
  assert.notEqual(modelRunId("a/b", "c", "d"), modelRunId("a", "b/c", "d"));
  assert.notEqual(modelRunId("a", "b/c", "d"), modelRunId("a", "b", "c/d"));
  const targets = providerTargets(provider);
  assert.equal(new Set(targets.map((target) => target.id)).size, 4);
  assert.equal(targets[0].apiKey, "sk-premium");
  assert.equal(targets[2].apiKey, "sk-economy");
  assert.equal(targets[2].channelName, "economy");
  assert.equal(targets[1].apiType, "responses");
  assert.notEqual(
    targets[0].id,
    providerTargets({ ...provider, id: "other" })[0].id,
  );
  targets[0].model = "changed snapshot";
  assert.equal(provider.channels[0].models[0].model, "one");
});
test("names, multipliers, ordering and new channels/models preserve results", () => {
  assert.deepEqual(
    invalidatedModelRuns(provider, {
      ...provider,
      name: "renamed",
      channels: [...provider.channels]
        .reverse()
        .map((item) => ({
          ...item,
          name: `${item.name} renamed`,
          multiplier: "0.75",
          models: [...item.models].reverse().concat(model("new")),
        }))
        .concat(channel("third")),
    }),
    [],
  );
});
test("model edits/removal only invalidate that model in its own channel", () => {
  assert.deepEqual(
    invalidatedModelRuns(
      provider,
      updateChannel(0, { models: [provider.channels[0].models[0]] }),
    ),
    [modelRunId(provider.id, "premium", "two")],
  );
  for (const patch of [
    { model: "changed" },
    { apiType: "responses" },
    { temperature: 1 },
  ]) {
    assert.deepEqual(
      invalidatedModelRuns(
        provider,
        updateChannel(0, {
          models: [
            { ...provider.channels[0].models[0], ...patch },
            provider.channels[0].models[1],
          ],
        }),
      ),
      [modelRunId(provider.id, "premium", "one")],
    );
  }
});
test("channel key replacement/deletion only invalidates its own results; Endpoint invalidates all", () => {
  const premium = providerTargets(provider)
    .slice(0, 2)
    .map((target) => target.id);
  assert.deepEqual(
    invalidatedModelRuns(provider, updateChannel(0, { apiKey: "new-key" })),
    premium,
  );
  assert.deepEqual(
    invalidatedModelRuns(provider, {
      ...provider,
      channels: [provider.channels[1]],
    }),
    premium,
  );
  assert.deepEqual(
    invalidatedModelRuns(provider, {
      ...provider,
      baseUrl: "https://other.vendor.com/v1",
    }),
    providerTargets(provider).map((target) => target.id),
  );
});
test("legacy direct-failure marks only migrate into the default channel; newer marks take priority", () => {
  const old = JSON.stringify(["p", "m"]);
  const current = modelRunId("p", "default", "m");
  const mark = {
    baseUrl: "https://api.vendor.com/v1",
    model: "alpha",
    apiType: "chat",
  };
  const cache = decodeDirectFailures(
    JSON.stringify({ version: 1, failures: { [old]: mark } }),
  );
  assert.deepEqual(cache[current], mark);
  assert.equal(cache[modelRunId("p", "new-channel", "m")], undefined);
  assert.equal(cache[old], undefined);
  const override = { ...mark, apiType: "responses" };
  assert.deepEqual(
    decodeDirectFailures(
      JSON.stringify({
        version: 1,
        failures: { [current]: override, [old]: mark },
      }),
    )[current],
    override,
  );
});
test("FIFO concurrency, duplicate joining and failed-task release remain shared", async () => {
  const queue = createTaskQueue(2);
  let active = 0,
    peak = 0;
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
  const first = queue.enqueue("same", async () => 1);
  assert.equal(
    queue.enqueue("same", async () => 2),
    first,
  );
  assert.equal(await first, 1);
  assert.equal(await queue.enqueue("same", async () => 2), 2);
  const failed = await Promise.allSettled([
    queue.enqueue("bad", () => {
      throw new Error("failed");
    }),
    queue.enqueue("good", async () => "ok"),
  ]);
  assert.equal(failed[0].status, "rejected");
  assert.equal(failed[1].value, "ok");
  assert.equal(queue.has("bad"), false);
  assert.equal(await queue.enqueue("bad", async () => "retry"), "retry");
  assert.throws(() => createTaskQueue(0));
});
