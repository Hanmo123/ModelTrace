// Browser regression for provider/model grouping. Only local mock APIs are used.
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { useLowConfidenceBank } from "./browser-bank-fixture.mjs";

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
  const text =
    req.headers.authorization === "Bearer sk-budget"
      ? "No numeric answer on this channel"
      : numbers;
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
                content: [{ type: "output_text", text, annotations: [] }],
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
                message: { role: "assistant", content: text },
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
  await useLowConfidenceBank(page);
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
      JSON.parse(localStorage.getItem("modeltrace.presets.v3")),
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
  async function tooltip(label, expected, keyboard = false) {
    await page.mouse.move(0, 0);
    await page.keyboard.press("Escape");
    const handle = await page.$(`button[aria-label="${label}"]`);
    assert(handle, `Missing tooltip target: ${label}`);
    if (keyboard) await handle.focus();
    else await handle.hover();
    // Zero configured delay and no fade-in: visible by the next few frames,
    // rather than waiting for the browser's native title tooltip.
    await delay(120);
    const visible = await page.$$eval(
      '[data-slot="tooltip-content"]',
      (nodes) =>
        nodes
          .filter(
            (node) =>
              node.getBoundingClientRect().width &&
              getComputedStyle(node).visibility !== "hidden",
          )
          .map((node) => ({
            text: node.textContent,
            animation: getComputedStyle(node).animationName,
            opacity: getComputedStyle(node).opacity,
          })),
    );
    assert(
      visible.some(
        (item) =>
          item.text.includes(expected) &&
          item.animation === "none" &&
          item.opacity === "1",
      ),
      `Immediate tooltip missing: ${label}`,
    );
    await page.keyboard.press("Escape");
    await page.evaluate(() => document.activeElement?.blur());
    await page.mouse.move(0, 0);
    await handle.dispose();
  }
  const select = (name, model) =>
    labelled(`选择 ${name} · 默认渠道 · ${model}`);
  const rowText = (name, model) =>
    page.$eval(
      `button[aria-label="选择 ${name} · 默认渠道 · ${model}"]`,
      (element) => element.closest("[data-model-id]").textContent,
    );
  const info = () =>
    page.$eval('[aria-label="服务商信息"]', (element) => element.textContent);

  await click("自动测试", "[role=tab]");
  assert.equal((await saved()).version, 3);
  assert.equal(
    (await saved()).presets[0].channels[0].models[0].apiType,
    "responses",
  );
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
  let main = (await saved()).presets[0].channels[0];
  assert.deepEqual(
    main.models.map((model) => model.model),
    ["alpha", "beta", "bad-model", "gamma"],
  );
  assert.equal(main.models[0].id, "legacy-provider");
  assert.equal(main.models[0].temperature, 0.7);
  const betaId = main.models[1].id;
  assert.equal(main.models[1].apiType, "chat");

  const layout = await page.$$eval(
    '[aria-label="Multi Provider · 默认渠道 的模型"] > [data-model-id]',
    (cards) =>
      cards.map((card) => {
        const rect = card.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width };
      }),
  );
  assert.equal(layout.length, 4);
  assert.equal(
    layout[0].y,
    layout[1].y,
    "Multiple model cards must fit in one row",
  );
  assert(layout[1].x > layout[0].x);
  assert(
    await page.$eval(
      'article[data-provider-id="legacy-provider"]',
      (card) =>
        !card.textContent.includes("管理模型") &&
        !/\d+ 个模型|API\s*Key|sk-shared/i.test(card.textContent),
    ),
  );
  assert(
    await page.$$eval(
      'article[data-provider-id="legacy-provider"] button',
      (buttons) =>
        buttons.every(
          (button) =>
            !!button.closest("[data-grace-area-trigger]") &&
            !button.hasAttribute("title"),
        ),
    ),
    "Every card button needs a real tooltip, not a delayed native title",
  );
  for (const label of [
    "测试 Multi Provider",
    "测试 Multi Provider · 默认渠道 · alpha",
  ]) {
    assert(
      await page.$eval(
        `button[aria-label="${label}"]`,
        (button) =>
          button.classList.contains("bg-primary") && !button.textContent.trim(),
      ),
    );
  }
  await tooltip("选择服务商 Multi Provider", "查看 Multi Provider");
  await tooltip("测试 Multi Provider", "测试此服务商的全部模型");
  await tooltip("编辑 Multi Provider", "编辑服务商连接和模型", true);
  await tooltip("删除 Multi Provider", "删除服务商及其模型");
  await tooltip("选择 Multi Provider · 默认渠道 · alpha", "alpha · 未测试");
  await tooltip("测试 Multi Provider · 默认渠道 · alpha", "测试 alpha");
  assert.equal(
    calls.length,
    0,
    "Hovering or focusing actions must never start a test",
  );

  await labelled("测试 Multi Provider · 默认渠道 · alpha");
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
  await labelled("测试 Multi Provider · 默认渠道 · beta");
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
  assert.equal((await saved()).presets[0].channels[0].models[1].id, betaId);
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
  await tooltip("编辑 Multi Provider", "测试期间不能编辑");
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
    await page.$('button[aria-label="选择 Multi Provider · 默认渠道 · gamma"]'),
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
  assert(
    await page.$$eval(
      '[aria-label="Multi Provider · 默认渠道 的模型"] > [data-model-id]',
      (cards) =>
        cards[0].getBoundingClientRect().y ===
        cards[1].getBoundingClientRect().y,
    ),
    "The mobile sidebar should also show multiple compact models per row",
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
  assert.equal((await saved()).presets[0].channels[0].models.length, 4);

  await page.reload({ waitUntil: "networkidle0" });
  await click("自动测试", "[role=tab]");
  main = (await saved()).presets[0].channels[0];
  assert.equal(main.models[1].id, betaId);
  assert.equal(main.apiKey, "sk-rotated");
  assert.deepEqual(
    main.models.map((model) => model.model),
    ["alpha", "beta-v2", "bad-model", "delta"],
  );
  assert.match(await rowText("Multi Provider", "alpha"), /未测试/);
  // Multi-channel editing through the actual form, not a seeded v3 fixture.
  await page.setViewport({ width: 1500, height: 950 });
  await click("添加服务商");
  await fill("#preset-name", "Channels");
  await fill("#preset-base-url", api);
  await fill("#channel-name", "Premium");
  await fill("#channel-multiplier", "0.500000");
  await fill("#preset-api-key", "sk-premium");
  await fill("#preset-model", "shared-model");
  await labelled("添加渠道");
  await fill("#channel-name", "Budget");
  await fill("#channel-multiplier", "-1");
  await fill("#preset-api-key", "sk-budget");
  await fill("#preset-model", "shared-model");
  await click("保存", "[role=dialog] button");
  assert(await page.$("#channel-multiplier[aria-invalid=true]"));
  await fill("#channel-multiplier", "1.25");
  await click("批量添加");
  await fill("#preset-models-bulk", "shared-model\nother-model");
  // Switching channels must keep an un-applied bulk draft for the other channel.
  await page.click("#channel-select");
  await click("Premium · 0.500000×", "[role=option]");
  assert.equal(
    await page.$eval("#preset-api-key", (el) => el.value),
    "sk-premium",
  );
  await click("保存", "[role=dialog] button");
  await closeDialog();
  const savedChannels = () =>
    saved().then((data) =>
      data.presets.find((item) => item.name === "Channels"),
    );
  let config = await savedChannels();
  assert.equal(config.channels.length, 2);
  assert.equal(config.channels[0].multiplier, "0.5");
  assert.equal(config.channels[1].multiplier, "1.25");
  assert.deepEqual(
    config.channels[1].models.map((item) => item.model),
    ["shared-model", "other-model"],
  );
  const cardText = (channel, model = "shared-model") =>
    page.$eval(
      `button[aria-label="选择 Channels · ${channel} · ${model}"]`,
      (node) => node.closest("[data-model-id]").textContent,
    );
  assert(
    await page.$eval(
      `article[data-provider-id="${config.id}"]`,
      (node) => !/sk-premium|sk-budget|API Key/.test(node.textContent),
    ),
  );
  let startCalls = calls.length;
  await labelled("测试 Channels · Premium · shared-model");
  await waitIdle();
  assert.equal(calls.length - startCalls, 3);
  assert(
    calls.slice(startCalls).every((call) => call.auth === "Bearer sk-premium"),
  );
  assert.match(await cardText("Premium"), /已完成/);
  assert.match(await cardText("Budget"), /未测试/);
  startCalls = calls.length;
  await labelled("测试渠道 Channels · Budget");
  await waitIdle();
  assert.equal(calls.length - startCalls, 6);
  assert(
    calls.slice(startCalls).every((call) => call.auth === "Bearer sk-budget"),
  );
  assert.match(await cardText("Budget"), /失败/);
  assert.match(await cardText("Premium"), /已完成/);
  await labelled("选择 Channels · Budget · shared-model");
  assert.match(await info(), /Budget.*1.25×/s);
  assert.equal(await page.$('[aria-label="归因结果"]'), null);
  startCalls = calls.length;
  await labelled("测试 Channels");
  await waitIdle();
  assert.equal(
    calls.length - startCalls,
    9,
    "Same model names in different channels must not join a single job",
  );
  assert.equal(peak, 2);

  // Channel metadata does not invalidate quality results. Credentials do, locally.
  await labelled("编辑渠道 Channels · Budget");
  assert.equal(await page.$eval("#channel-name", (el) => el.value), "Budget");
  await fill("#channel-name", "Budget Plus");
  await fill("#channel-multiplier", "0.75");
  await click("保存", "[role=dialog] button");
  await closeDialog();
  assert.match(await cardText("Budget Plus"), /失败/);
  assert.match(await cardText("Premium"), /已完成/);
  await labelled("编辑渠道 Channels · Budget Plus");
  await fill("#preset-api-key", "sk-budget-upgraded");
  await click("保存", "[role=dialog] button");
  await closeDialog();
  assert.match(await cardText("Budget Plus"), /未测试/);
  assert.match(await cardText("Premium"), /已完成/);
  await labelled("测试 Channels · Budget Plus · shared-model");
  await waitIdle();
  assert.match(await cardText("Budget Plus"), /已完成/);

  await page.setViewport({ width: 390, height: 844 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await labelled("编辑渠道 Channels · Budget Plus");
  await labelled("删除当前渠道");
  await click("取消", "[role=dialog] button");
  await closeDialog();
  assert.equal(
    (await savedChannels()).channels.length,
    2,
    "Cancel must not delete a channel",
  );
  await labelled("编辑渠道 Channels · Budget Plus");
  await labelled("删除当前渠道");
  await click("保存", "[role=dialog] button");
  await closeDialog();
  assert.equal((await savedChannels()).channels.length, 1);
  assert.match(await cardText("Premium"), /已完成/);
  assert.equal(
    await page.$(
      'button[aria-label="选择 Channels · Budget Plus · shared-model"]',
    ),
    null,
  );
  await page.reload({ waitUntil: "networkidle0" });
  config = await savedChannels();
  assert.equal(config.channels[0].name, "Premium");
  assert.equal(config.channels[0].multiplier, "0.5");
  assert.equal(config.channels[0].apiKey, "sk-premium");
  assert.deepEqual(errors, []);
  console.log(
    "PASS v1/v2 migration, compact cards/tooltips, channel editor/drafts, decimal validation, credential isolation, independent same-model results, all/channel/provider scopes, concurrency, selective invalidation, cancellation, reload and mobile layout",
  );
} finally {
  await browser?.close();
  preview.kill();
  await new Promise((resolve) => mock.close(resolve));
}
