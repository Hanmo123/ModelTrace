// Run after building with NUXT_PUBLIC_PROXY_URL=http://127.0.0.1:3244/v1
import puppeteer from "puppeteer-core";
import http from "node:http";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const numbers = Array.from(
  { length: 310 },
  (_, i) => ((i * 73) % 355) + 1,
).join(" ");
let proxyCalls = 0;
const proxyModels = [];
const proxyRequests = [];
const directRequests = [];
let targetCalls = 0;
let mixedMode = false;
function answer(data, path) {
  if (path.endsWith('/responses')) return {
    id: 'resp_mock', created_at: 1, model: data.model, status: 'completed',
    output: [{ id: 'msg_mock', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: numbers, annotations: [] }] }],
    usage: { input_tokens: 10, output_tokens: 800 },
  };
  return {
    id: 'mock', object: 'chat.completion', created: 1, model: data.model,
    choices: [{ index: 0, message: { role: 'assistant', content: numbers }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 800, total_tokens: 810 },
  };
}
const target = http.createServer(async (req, res) => {
  targetCalls++;
  if (!mixedMode) return res.writeHead(403).end(); // no CORS in the original consent scenarios
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization,content-type');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const data = JSON.parse(raw);
  directRequests.push({ data, auth: req.headers.authorization, path: req.url });
  if (data.model === 'blocked-model' && req.headers.authorization !== 'Bearer sk-other') {
    res.removeHeader('Access-Control-Allow-Origin');
    return res.writeHead(403).end();
  }
  res.setHeader('Content-Type', 'application/json');
  if (data.model === 'auth-model') return res.writeHead(401).end(JSON.stringify({ error: { message: 'Invalid API key: CORS configuration is not the issue' } }));
  res.end(JSON.stringify(answer(data, req.url)));
});
await new Promise((resolve) => target.listen(0, "127.0.0.1", resolve));
const proxy = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "authorization,content-type,x-modeltrace-endpoint",
  );
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }
  proxyCalls++;
  let body = "";
  for await (const chunk of req) body += chunk;
  const data = JSON.parse(body);
  proxyModels.push(data.model);
  proxyRequests.push({ data, auth: req.headers.authorization, path: req.url });
  assert.equal(req.headers.authorization, "Bearer sk-test");
  assert.equal(
    req.headers["x-modeltrace-endpoint"],
    `http://127.0.0.1:${target.address().port}/v1`,
  );
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(answer(data, req.url)));
});
await new Promise((resolve) => proxy.listen(3244, "127.0.0.1", resolve));
const server = spawn(process.execPath, [".output/server/index.mjs"], {
  cwd: fileURLToPath(new URL("../", import.meta.url)),
  env: { ...process.env, PORT: "3245" },
  stdio: "ignore",
});
let browser;
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch("http://127.0.0.1:3245")).ok) break;
    } catch {}
    await delay(100);
  }
  browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
    args: ["--no-sandbox"],
  });
  let page = await browser.newPage();
  await page.goto("http://127.0.0.1:3245", { waitUntil: "networkidle0" });
  const click = async (text) => {
    const node = await page.evaluateHandle(
      (text) =>
        [...document.querySelectorAll("button")].find(
          (button) => button.textContent.trim() === text && button.offsetWidth,
        ),
      text,
    );
    assert(node.asElement(), `button not found: ${text}`);
    await node.asElement().click();
    await delay(300);
  };
  const fill = (selector, value) =>
    page.$eval(
      selector,
      (el, v) => {
        el.value = v;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      },
      value,
    );
  await page.$("[role=tab]");
  const tab = await page.evaluateHandle(() =>
    [...document.querySelectorAll("[role=tab]")].find((e) =>
      e.textContent.includes("自动测试"),
    ),
  );
  await tab.asElement().click();
  await delay(300);
  await click("添加服务商");
  await fill("#preset-name", "CORS blocked");
  await fill(
    "#preset-base-url",
    `http://127.0.0.1:${target.address().port}/v1`,
  );
  await fill("#preset-api-key", "sk-test");
  await fill("#preset-model", "test-model");
  await click("添加模型");
  await fill("#preset-model-1", "second-model");
  await click("保存");
  await delay(350);
  await click("开始测试");
  await page.waitForSelector("[role=alertdialog]", { timeout: 30000 });
  assert.equal(proxyCalls, 0, "Must not proxy before consent");
  assert.equal(targetCalls, 0, "Must ask before ANY API request");
  await page.keyboard.press("Escape");
  await delay(350);
  assert.equal(
    targetCalls + proxyCalls,
    0,
    "Dismissing consent must cancel testing",
  );
  await click("一键测全部");
  await page.waitForSelector("[role=alertdialog]");
  assert.match(
    await page.$eval("[role=alertdialog]", (el) => el.textContent),
    /2 个模型（1 个服务商）/,
  );
  assert.equal(
    targetCalls + proxyCalls,
    0,
    "Batch must also ask before testing",
  );
  await click("仅本次直连");
  await page.waitForFunction(
    () => !document.querySelector("[role=alertdialog]"),
  );
  assert.equal(proxyCalls, 0, "Declining must not proxy");
  assert.equal((await page.$$("[role=dialog]")).length, 0);
  assert.equal(
    await page.$$eval(
      "button",
      (buttons) =>
        buttons.filter((button) => button.textContent.includes("终端方式"))
          .length,
    ),
    0,
  );
  await page.waitForFunction(() =>
    document
      .querySelector('[aria-label="服务商测试详情"]')
      ?.textContent.includes("没有获得可分析输出"),
  );
  assert(targetCalls > 0);
  assert.equal(proxyCalls, 0);
  assert.equal(
    (await page.$$("[role=alertdialog]")).length,
    0,
    "Declined batch must not prompt again after CORS failure",
  );
  await click("通过代理测试");
  await page.waitForSelector("[role=alertdialog]");
  await click("同意并通过代理测试");
  await page.waitForFunction(
    () =>
      document
        .querySelector('[aria-label="服务商测试详情"]')
        ?.textContent.includes("有效查询 3/3"),
    { timeout: 30000 },
  );
  assert.equal(proxyCalls, 3);
  const directCallsAfterDecline = targetCalls;
  assert.equal(
    await page.evaluate(() =>
      localStorage.getItem("modeltrace.proxy-consent.v1"),
    ),
    "http://127.0.0.1:3244/v1",
  );

  // A second provider is also covered by the explicitly granted future-test consent.
  await click("添加服务商");
  await fill("#preset-name", "Second provider");
  await fill(
    "#preset-base-url",
    `http://127.0.0.1:${target.address().port}/v1`,
  );
  await fill("#preset-api-key", "sk-test");
  await fill("#preset-model", "test-model");
  await click("保存");
  await click("一键测全部");
  await page.waitForFunction(() =>
    document.body.textContent.includes("批量测试完成：成功 3 个"),
  );
  assert.equal(proxyCalls, 12);
  assert.equal(
    proxyModels.filter((model) => model === "second-model").length,
    3,
  );
  assert(
    targetCalls > directCallsAfterDecline,
    "A newly added model must try direct before an authorized proxy fallback",
  );
  assert.equal(
    await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('modeltrace.direct-failures.v1')).failures).length),
    3,
  );
  assert.equal((await page.$$("[role=alertdialog]")).length, 0);

  await page.reload({ waitUntil: "networkidle0" });
  await click("自动测试");
  await click("开始测试");
  await page.waitForFunction(() =>
    document
      .querySelector('[aria-label="服务商测试详情"]')
      ?.textContent.includes("测试完成"),
  );
  assert.equal(proxyCalls, 15, "Remember consent across reloads");
  assert.equal((await page.$$("[role=alertdialog]")).length, 0);

  await click("撤销代理授权");
  await click("一键测全部");
  await page.waitForSelector("[role=alertdialog]");
  assert.equal(proxyCalls, 15, "Revocation requires renewed consent");
  await page.keyboard.press("Escape");
  await page.evaluate(() =>
    localStorage.setItem(
      "modeltrace.proxy-consent.v1",
      "https://different-proxy.invalid/v1",
    ),
  );
  await page.reload({ waitUntil: "networkidle0" });
  await click("自动测试");
  await click("开始测试");
  await page.waitForSelector("[role=alertdialog]");
  assert.equal(
    proxyCalls,
    15,
    "Consent to a different proxy must not be reused",
  );
  // Simulate users upgrading with already-saved providers and remembered
  // proxy consent, but no direct-connectivity records. No paid API is used.
  mixedMode = true;
  await page.close();
  const context = await browser.createBrowserContext();
  page = await context.newPage();
  await page.setViewport({ width: 1500, height: 950 });
  const baseURL = `http://127.0.0.1:${target.address().port}/v1`;
  await page.evaluateOnNewDocument((baseUrl) => {
    if (localStorage.getItem('modeltrace.presets.v2')) return;
    localStorage.setItem('modeltrace.presets.v2', JSON.stringify({ version: 2, presets: [
      { id: 'existing-one', name: 'Existing provider', baseUrl, apiKey: 'sk-test', models: [
        { id: 'direct', model: 'direct-model', apiType: 'responses', temperature: null },
        { id: 'blocked', model: 'blocked-model', apiType: 'chat', temperature: null },
        { id: 'auth', model: 'auth-model', apiType: 'chat', temperature: null },
      ] },
      { id: 'existing-two', name: 'Other provider', baseUrl, apiKey: 'sk-other', models: [
        { id: 'blocked', model: 'blocked-model', apiType: 'chat', temperature: null },
      ] },
    ] }));
    localStorage.setItem('modeltrace.proxy-consent.v1', 'http://127.0.0.1:3244/v1');
  }, baseURL);
  await page.goto('http://127.0.0.1:3245', { waitUntil: 'networkidle0' });
  const proxyBeforeMixed = proxyCalls;
  const waitBatch = () => page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === '一键测全部' && !button.disabled));
  const runMixed = async () => { await click('一键测全部'); await waitBatch(); };
  const directCount = (model, auth = 'Bearer sk-test') => directRequests.filter(request => request.data.model === model && request.auth === auth).length;
  const marks = () => page.evaluate(() => JSON.parse(localStorage.getItem('modeltrace.direct-failures.v1')).failures);
  await runMixed();
  assert.equal((await page.$$('[role=alertdialog]')).length, 0);
  assert.equal(directCount('direct-model'), 3);
  assert.equal(directCount('blocked-model'), 1);
  assert.equal(directCount('auth-model'), 1);
  assert.equal(directCount('blocked-model', 'Bearer sk-other'), 3);
  assert.equal(proxyCalls - proxyBeforeMixed, 3);
  assert.match(await page.$eval('body', node => node.textContent), /批量测试完成：成功 3 个模型，失败 1 个模型/);
  assert.deepEqual(Object.keys(await marks()), [JSON.stringify(['existing-one', 'blocked'])]);
  assert.deepEqual(
    proxyRequests.find(request => request.data.model === 'blocked-model').data.messages,
    directRequests.find(request => request.data.model === 'blocked-model').data.messages,
    'Fallback retries the original challenge, not a new question',
  );
  assert.equal(
    await page.$$eval('article[data-provider-id="existing-one"] [data-model-id="blocked"]', nodes => nodes[0].textContent.includes('直连不可用')),
    true,
  );
  assert.equal(
    await page.$eval('article[data-provider-id="existing-two"]', node => node.textContent.includes('直连不可用')),
    false,
  );
  await page.click('[aria-label="选择 Existing provider · blocked-model"]');
  assert.match(await page.$eval('[aria-label="服务商信息"]', node => node.textContent), /直连失败后转代理/);

  await page.reload({ waitUntil: 'networkidle0' });
  await runMixed();
  assert.equal(directCount('blocked-model'), 1, 'Cached failure skips direct after reload');
  assert.equal(directCount('direct-model'), 6);
  assert.equal(directCount('auth-model'), 2, 'Readable HTTP errors never poison the direct cache');
  assert.equal(directCount('blocked-model', 'Bearer sk-other'), 6);
  assert.equal(proxyCalls - proxyBeforeMixed, 6);

  await page.click('[aria-label="选择 Existing provider · blocked-model"]');
  await click('重置直连标记');
  assert.deepEqual(await marks(), {});
  await runMixed();
  assert.equal(directCount('blocked-model'), 2, 'Manual reset enables one new direct attempt');
  assert.equal(proxyCalls - proxyBeforeMixed, 9);

  const beforeRevoked = { direct: directRequests.length, proxy: proxyCalls };
  // Rapid local batches stack top-right toasts over the header controls.
  const dismissToasts = async () => {
    await page.$$eval('[data-sonner-toast] [data-close-button]', buttons => buttons.forEach(button => button.click()));
    await page.waitForFunction(() => !document.querySelector('[data-sonner-toast]'));
  };
  await dismissToasts();
  await click('撤销代理授权');
  assert.equal(await page.evaluate(() => localStorage.getItem('modeltrace.proxy-consent.v1')), null);
  await click('一键测全部');
  await page.waitForSelector('[role=alertdialog]');
  assert.match(await page.$eval('[role=alertdialog]', node => node.textContent), /优先直连/);
  assert.equal(directRequests.length, beforeRevoked.direct);
  assert.equal(proxyCalls, beforeRevoked.proxy);
  await click('仅本次直连');
  await waitBatch();
  assert.equal(proxyCalls, beforeRevoked.proxy, 'Cached route failure never overrides declined proxy consent');
  assert.equal(directCount('blocked-model'), 3);
  assert.equal((await page.$$('[role=alertdialog]')).length, 0);

  await dismissToasts();
  await click('一键测全部');
  await page.waitForSelector('[role=alertdialog]');
  await click('同意并允许代理回退');
  await waitBatch();
  assert.equal(directCount('blocked-model'), 3, 'Renewed consent uses the cached fallback route');
  assert.equal(proxyCalls, beforeRevoked.proxy + 3);
  assert.equal(directCount('direct-model'), 15, 'Healthy models still stay direct after renewed consent');
  await page.setViewport({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Routing badges must not cause mobile overflow');
  await context.close();
  console.log(
    'PASS consent/decline/revocation/URL scoping, legacy saved models, direct-first mixed batches, per-model CORS marks, HTTP errors, same-challenge fallback, persistence and manual reset',
  );
} finally {
  await browser?.close();
  server.kill();
  await new Promise((resolve) => proxy.close(resolve));
  await new Promise((resolve) => target.close(resolve));
}
