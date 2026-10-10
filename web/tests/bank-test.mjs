// Ensure every shipped client consumes the same complete upstream fingerprint bank.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { build } from "esbuild";

const root = new URL("../../", import.meta.url);
const paths = [
  "data/unified_bank.json",
  "static/data/unified_bank.json",
  "web/public/data/unified_bank.json",
  "codex-plugin/modeltrace-guard/assets/unified_bank.json",
];
const copies = await Promise.all(paths.map(path => readFile(new URL(path, root))));
const bank = JSON.parse(copies[0]);
const provenance = JSON.parse(await readFile(new URL("codex-plugin/modeltrace-guard/assets/provenance.json", root), "utf8"));
const enrolledModels = await Promise.all([
  { id: "claude-sonnet-5-5", family: "claude" },
  { id: "deepseek-v4.1-flash", family: "deepseek" },
  { id: "kimi-k3", family: "kimi" },
].map(async model => ({
  ...model,
  references: (await readFile(new URL(`data/${model.family}_reference.jsonl`, root), "utf8"))
    .trim().split("\n").map(line => JSON.parse(line)),
})));

function assertVector(vector, length) {
  assert.equal(vector.length, length);
  assert(vector.every(Number.isFinite), "Fingerprint vectors must contain only finite values");
}

test("Python, legacy page, Nuxt/TUI and Guard ship byte-identical banks", () => {
  for (let i = 1; i < copies.length; i++) {
    assert(copies[0].equals(copies[i]), `${paths[i]} is out of sync`);
  }
  assert.equal(createHash("sha256").update(copies[0]).digest("hex"), provenance.bankSha256);
  assert.equal(bank.models.length, provenance.modelCount);
  assert.equal(bank.built_at, provenance.bankBuiltAt);
});

test("enrolled model samples and model order are included", () => {
  for (const { id, family, references } of enrolledModels) {
    const model = bank.models.find(model => model.id === id);
    assert(model, `Missing ${id} fingerprints`);
    const samples = references.filter(row => row.model_id === id);
    assert.equal(samples.length, 36);
    assert.equal(model.response_count, samples.length);
    assert.equal(model.family, family);
    assert(samples.every(row => row.strict_valid && row.text));
    assert.equal(Object.keys(model.conditions).length, 12);
    assert(Object.values(model.conditions).every(count => count === 3));
  }
  assert.equal(new Set(bank.models.map(model => model.id)).size, bank.models.length);
  assert.deepEqual(bank.robust.model_order, bank.models.map(model => model.id));
});

test("all refitted centroids, environments and calibration match the model count", () => {
  for (const model of bank.models) {
    assertVector(model.counts, 355);
    assert(model.counts.every(count => Number.isInteger(count) && count >= 0));
  }
  for (const [name, dimensions] of [["hellinger", 355], ["ordered_blocks", 74]]) {
    const artifact = bank.robust[name];
    assertVector(artifact.feature_mean, dimensions);
    assertVector(artifact.feature_scale, dimensions);
    assert(artifact.feature_scale.every(scale => scale > 0));
    for (const vector of artifact.nuisance_basis) assertVector(vector, dimensions);
    for (const centroids of [artifact.centroids, ...(artifact.environment_centroids || [])]) {
      assert.equal(centroids.length, bank.models.length);
      for (const vector of centroids) assertVector(vector, dimensions);
    }
  }
  for (const count of [1, 2, 3]) {
    const calibration = bank.calibration[String(count)];
    assert(Number.isFinite(calibration.beta) && calibration.beta > 0);
    assert(calibration.cv_accuracy >= 0 && calibration.cv_accuracy <= 1);
  }
});

test("browser attribution recognizes the enrolled models", async () => {
  const output = await build({entryPoints: ["app/lib/fingerprint.ts"], bundle: true, write: false, platform: "node", format: "esm"});
  const { analyzeGlobalOutputs } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].contents).toString("base64")}`);
  for (const { id, family, references } of enrolledModels) {
    const samples = references.filter(row => row.model_id === id).slice(0, 3);
    const result = analyzeGlobalOutputs(samples.map(row => ({text: row.text, expected_count: row.requested_count})), bank);
    assert.equal(result.prediction, id);
    assert.equal(result.family_prediction, family);
    assert.equal(result.used_outputs, 3);
    assert.equal(result.results.length, bank.models.length);
    assert(result.results.every(model => Number.isFinite(model.probability)));
    assert(Math.abs(result.results.reduce((sum, model) => sum + model.probability, 0) - 1) < 1e-12);
  }
});
