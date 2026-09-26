// Browser regression for provider/model grouping. Only local mock APIs are used.
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const calls = [];
let active = 0;
let peak = 0;
const numbers = Array.from(
  { length: 310 },
  (_, i) => ((i * 73) % 355) + 1,
).join(" ");
const mock = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization,content-type");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  if (req.method === "OPTIONS") return res.writeHead(204).end();
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  calls.push({
    url: req.url,
    model: body.model,
    body,
    auth: req.headers.authorization,
  });
  peak = Math.max(peak, ++active);
  await delay(350);
  active--;
  res.setHeader("Content-Type", "application/json");
  if (body.model === "bad-model") {
    return res.writeHead(401).end(
      JSON.stringify({
        error: {
          message: "Rejected sk-shared",
          type: "authentication_error",
        },
      }),
    );
  }
  res.end(
    JSON.stringify(
      req.url.endsWith("/responses")
        ? {
            id: "resp_mock",
            created_at: 1,
            model: body.model,
            status: "completed",
            output: [
              {
                id: "message",
                type: "message",
                role: "assistant",
                content: [
                  { type: "output_text", text: numbers, annotations: [] },
                ],
              },
            ],
            usage: { input_tokens: 10, output_tokens: 1000 },
          }
        : {
            id: "chat_mock",
            object: "chat.completion",
            created: 1,
            model: body.model,
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: numbers },
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 1000,
              total_tokens: 1010,
            },
          },
    ),
  );
});
await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
const api = `http://127.0.0.1:${mock.address().port}/v1`;
const reserve = http.createServer();
await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
const port = reserve.address().port;
await new Promise((resolve) => reserve.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const preview = spawn(process.execPath, [".output/server/index.mjs"], {
  cwd: fileURLToPath(new URL("../", import.meta.url)),
  env: {
    ...process.env,
    PORT: String(port),
    HOST: "127.0.0.1",
    NUXT_PUBLIC_PROXY_URL: "",
  },
  stdio: "ignore",
});
let browser;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(origin)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await delay(100);
  }
  assert(ready, "Build the app before running test:multi");
  browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 950 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.evaluateOnNewDocument((api) => {
    if (localStorage.getItem("multi-test-seeded")) return;
    localStorage.setItem(
      "modeltrace.presets.v1",
      JSON.stringify({
        version: 1,
        presets: [
          {
            id: "legacy-provider",
            name: "Legacy",
            baseUrl: api,
            apiKey: "sk-shared",
            model: "old-model",
            apiType: "responses",
            temperature: 0.7,
          },
        ],
      }),
    );
    localStorage.setItem("multi-test-seeded", "yes");
  }, api);
  await page.goto(origin, { waitUntil: "networkidle0" });
  async function click(text, selector = "button") {
    await delay(150);
    const node = await page.evaluateHandle(
      (text, selector) =>
        [...document.querySelectorAll(selector)].find(
          (node) =>
            node.textContent.trim() === text &&
            node.getBoundingClientRect().height,
        ),
      text,
      selector,
    );
    assert(node.asElement(), `Missing ${selector}: ${text}`);
    await node.asElement().click();
    await node.dispose();
    await delay(250);
  }
  const fill = (selector, value) =>
    page.$eval(
      selector,
      (element, value) => {
        element.value = value;
        element.dispatchEvent(new Event("input", { bubbles: true }));
      },
      value,
    );
  const labelled = async (label) => {
    await page.click(`button[aria-label="${label}"]`);
    await delay(250);
  };
  const saved = () =>
    page.evaluate(() =>
      JSON.parse(localStorage.getItem("modeltrace.presets.v2")),
    );
  const closeDialog = () =>
    page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
  const waitIdle = () =>
    page.waitForFunction(
      () =>
        !document.querySelector('[aria-label="此服务商有测试任务"]') &&
        ![...document.querySelectorAll("button")].some((button) =>
          button.textContent.includes("批量测试中"),
        ),
      { timeout: 30000 },
    );
  const select = (name, model) => labelled(`选择 ${name} · ${model}`);
  const rowText = (name, model) =>
    page.$eval(
      `button[aria-label="选择 ${name} · ${model}"]`,
      (element) => element.textContent,
    );
  const info = () =>
    page.$eval('[aria-label="服务商信息"]', (element) => element.textContent);

  await click("自动测试", "[role=tab]");
  assert.equal((await saved()).version, 2);
  assert.equal((await saved()).presets[0].models[0].apiType, "responses");
  assert.equal(
    await page.evaluate(() => localStorage.getItem("modeltrace.presets.v1")),
    null,
  );
  assert.equal(calls.length, 0, "Migration must not start any tests");

  await labelled("编辑 Legacy");
  await fill("#preset-name", "Multi Provider");
  await fill("#preset-model", "alpha");
  await click("添加模型");
  await fill("#preset-model-1", "alpha");
  await click("保存", "[role=dialog] button");
  assert(
    await page.$("[role=dialog] input[aria-invalid=true]"),
    "Duplicate model IDs must be rejected",
  );
  await fill("#preset-model-1", "beta");
  await click("批量添加");
  await fill("#preset-models-bulk", "beta\nbad-model,alpha，gamma");
  // Save also applies a pending bulk paste, with no silent data loss.
  await click("保存", "[role=dialog] button");
  await closeDialog();
  let main = (await saved()).presets[0];
  assert.deepEqual(
    main.models.map((model) => model.model),
    ["alpha", "beta", "bad-model", "gamma"],
  );
  assert.equal(main.models[0].id, "legacy-provider");
  assert.equal(main.models[0].temperature, 0.7);
  const betaId = main.models[1].id;
  assert.equal(main.models[1].apiType, "chat");

  await labelled("测试 Multi Provider · alpha");
  await waitIdle();
  assert.equal(calls.length, 3);
  assert(
    calls.every(
      (call) =>
        call.url === "/v1/responses" &&
        call.model === "alpha" &&
        call.auth === "Bearer sk-shared",
    ),
  );
  assert.match(await rowText("Multi Provider", "alpha"), /已完成/);
  await select("Multi Provider", "beta");
  assert.match(await info(), /beta/);
  assert.equal(await page.$('[aria-label="归因结果"]'), null);
  await labelled("测试 Multi Provider · beta");
  await waitIdle();
  assert(
    calls.some(
      (call) =>
        call.url === "/v1/chat/completions" &&
        call.model === "beta" &&
        call.auth === "Bearer sk-shared",
    ),
  );
  assert.match(await rowText("Multi Provider", "alpha"), /已完成/);
  assert.match(await rowText("Multi Provider", "beta"), /已完成/);

  await labelled("编辑 Multi Provider");
  await click("添加模型");
  await fill("#preset-model-4", "delta");
  await click("保存", "[role=dialog] button");
  await closeDialog();
  assert(
    await page.$('[aria-label="归因结果"]'),
    "Adding a model must preserve the selected existing result",
  );
  assert.match(await rowText("Multi Provider", "alpha"), /已完成/);
  await labelled("编辑 Multi Provider");
  await fill("#preset-model-1", "beta-v2");
  await click("保存", "[role=dialog] button");
  await closeDialog();
  assert.equal((await saved()).presets[0].models[1].id, betaId);
  assert.match(await rowText("Multi Provider", "beta-v2"), /未测试/);
  assert.match(await rowText("Multi Provider", "alpha"), /已完成/);
  assert.equal(await page.$('[aria-label="归因结果"]'), null);

  await click("添加服务商");
  await fill("#preset-name", "Other Provider");
  await fill("#preset-base-url", api);
  await fill("#preset-api-key", "sk-other");
  await fill("#preset-model", "alpha");
  await click("保存", "[role=dialog] button");
  await closeDialog();
  assert.equal((await saved()).presets.length, 2);
  assert.match(await rowText("Other Provider", "alpha"), /未测试/);

  peak = 0;
  await labelled("测试 Multi Provider");
  await page.waitForFunction(() =>
    document
      .querySelector('[aria-label="服务商列表"]')
      .textContent.includes("排队中"),
  );
  assert(await page.$('button[aria-label="编辑 Multi Provider"][disabled]'));
  assert(await page.$('button[aria-label="删除 Multi Provider"][disabled]'));
  await waitIdle();
  assert.equal(peak, 2);
  assert(
    !calls.some((call) => call.auth === "Bearer sk-other"),
    "Provider batch must not include other providers",
  );
  assert.equal(calls.filter((call) => call.model === "bad-model").length, 1);
  for (const name of ["alpha", "beta-v2", "gamma", "delta"])
    assert.match(await rowText("Multi Provider", name), /已完成/);
  await select("Multi Provider", "bad-model");
  const failure = await page.$eval(
    '[aria-label="服务商测试详情"]',
    (element) => element.textContent,
  );
  assert.match(failure, /已隐藏密钥/);
  assert(!failure.includes("sk-shared"));

  peak = 0;
  await click("一键测全部");
  await waitIdle();
  assert.equal(peak, 2);
  assert.equal(
    calls.filter(
      (call) => call.auth === "Bearer sk-other" && call.model === "alpha",
    ).length,
    3,
  );
  assert.match(await rowText("Multi Provider", "alpha"), /已完成/);
  assert.match(await rowText("Other Provider", "alpha"), /已完成/);
  await select("Multi Provider", "beta-v2");
  assert.match(await info(), /beta-v2/);
  if (process.env.SCREENSHOT_DIR)
    await page.screenshot({
      path: `${process.env.SCREENSHOT_DIR}/modeltrace-multi-desktop.png`,
      fullPage: true,
    });

  const beforeCancel = await saved();
  await labelled("编辑 Multi Provider");
  await click("添加模型");
  await page.$eval("#preset-model-5", (input) => {
    const clipboard = new DataTransfer();
    clipboard.setData("text/plain", "epsilon,zeta，epsilon\nalpha");
    input.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: clipboard,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await page.waitForFunction(
    () =>
      document.querySelectorAll('[aria-label="模型配置列表"] input').length ===
      7,
  );
  assert.deepEqual(
    await page.$$eval('[aria-label="模型配置列表"] input', (inputs) =>
      inputs.slice(-2).map((input) => input.value),
    ),
    ["epsilon", "zeta"],
  );
  await click("批量添加");
  await fill(
    "#preset-models-bulk",
    Array.from({ length: 51 }, (_, index) => `limit-${index}`).join("\n"),
  );
  await click("加入列表（51）");
  assert.match(
    await page.$eval("#models-error", (element) => element.textContent),
    /最多添加 50/,
  );
  assert.equal(
    (await page.$$('[aria-label="模型配置列表"] input')).length,
    7,
    "Rejected bulk input must not partially modify the list",
  );
  await fill("#preset-api-key", "should-not-save");
  await click("取消", "[role=dialog] button");
  await closeDialog();
  assert.deepEqual(await saved(), beforeCancel);

  await select("Multi Provider", "gamma");
  await labelled("编辑 Multi Provider");
  await labelled("移除模型 4");
  await click("保存", "[role=dialog] button");
  await closeDialog();
  assert.equal(
    await page.$('button[aria-label="选择 Multi Provider · gamma"]'),
    null,
  );
  assert.match(await info(), /alpha/);
  assert(
    await page.$('[aria-label="归因结果"]'),
    "Removing another model must retain the fallback model result",
  );

  await labelled("编辑 Multi Provider");
  await fill("#preset-api-key", "sk-rotated");
  await click("保存", "[role=dialog] button");
  await closeDialog();
  for (const name of ["alpha", "beta-v2", "bad-model", "delta"])
    assert.match(await rowText("Multi Provider", name), /未测试/);
  assert.match(await rowText("Other Provider", "alpha"), /已完成/);

  await page.setViewport({ width: 390, height: 844 });
  await delay(300);
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "Mobile page horizontal overflow",
  );
  await labelled("编辑 Multi Provider");
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "Mobile dialog horizontal overflow",
  );
  if (process.env.SCREENSHOT_DIR)
    await page.screenshot({
      path: `${process.env.SCREENSHOT_DIR}/modeltrace-multi-form-mobile.png`,
      fullPage: true,
    });
  await click("取消", "[role=dialog] button");
  await closeDialog();
  await labelled("删除 Other Provider");
  await click("删除", "[role=alertdialog] button");
  assert.equal((await saved()).presets.length, 1);
  assert.equal((await saved()).presets[0].models.length, 4);

  await page.reload({ waitUntil: "networkidle0" });
  await click("自动测试", "[role=tab]");
  main = (await saved()).presets[0];
  assert.equal(main.models[1].id, betaId);
  assert.equal(main.apiKey, "sk-rotated");
  assert.deepEqual(
    main.models.map((model) => model.model),
    ["alpha", "beta-v2", "bad-model", "delta"],
  );
  assert.match(await rowText("Multi Provider", "alpha"), /未测试/);
  assert.deepEqual(errors, []);
  console.log(
    "PASS multi-model migration, bulk input, independent results, scoped batches, shared concurrency, selective invalidation, reload and mobile layout",
  );
} finally {
  await browser?.close();
  preview.kill();
  await new Promise((resolve) => mock.close(resolve));
}
