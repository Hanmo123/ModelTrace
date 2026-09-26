// Keep Nuxt's strictly typed core aligned with the original browser implementation.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

const core = await moduleFrom("app/lib/fingerprint.ts");
const original = await moduleFrom("../static/fingerprint-core.js");
const { generateChallenges } = await moduleFrom("app/lib/challenge.ts");
const bank = JSON.parse(
  await readFile(new URL("../public/data/unified_bank.json", import.meta.url), "utf8"),
);
const outputs = Array.from({ length: 3 }, (_, index) => ({
  text: Array.from(
    { length: 310 },
    (_, i) => ((i * (73 + index * 14) + index) % 355) + 1,
  ).join(" "),
  expected_count: 310,
}));

for (const count of [1, 2, 3]) {
  test(`${count} answer attribution matches the original browser core`, () => {
    const input = outputs.slice(0, count);
    assert.deepEqual(
      core.analyzeGlobalOutputs(input, bank),
      original.analyzeGlobalOutputs(input, bank),
    );
  });
}

test("mixed accepted/rejected answers retain diagnostics and calibration", () => {
  const input = [outputs[0], { text: "too short 1 2 3", expected_count: 300 }, outputs[2]];
  assert.deepEqual(
    core.analyzeGlobalOutputs(input, bank),
    original.analyzeGlobalOutputs(input, bank),
  );
  assert.throws(() => core.analyzeGlobalOutputs([], bank), /没有可用回答/);
});

test("missing calibration is reported rather than reading an undefined entry", () => {
  assert.throws(
    () => core.analyzeGlobalOutputs(outputs, { ...bank, calibration: {} }),
    /指纹库缺少 3 份回答的校准参数/,
  );
});

test("challenge generation retains unique lengths, IDs and complete prompts", () => {
  for (let run = 0; run < 20; run++) {
    const challenges = generateChallenges();
    assert.equal(challenges.length, 3);
    assert.equal(new Set(challenges.map((item) => item.id)).size, 3);
    assert.equal(new Set(challenges.map((item) => item.expected_count)).size, 3);
    for (const challenge of challenges) {
      assert(challenge.expected_count >= 292 && challenge.expected_count <= 332);
      assert(challenge.prompt.includes(`${challenge.expected_count} 个 1 到 355`));
      assert(!challenge.prompt.includes("undefined"));
    }
  }
});
