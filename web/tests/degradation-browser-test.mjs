// npm run build && npm run test:degradation. All model traffic is intercepted;
// a build with NUXT_PUBLIC_PROXY_URL also exercises proxy consent and forwarding.
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const reserve = http.createServer();
await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve));
const port = reserve.address().port;
await new Promise(resolve => reserve.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const preview = spawn(process.execPath, ['.output/server/index.mjs'], {
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' }, stdio: 'ignore',
});
const fixedPrompt = 'what is your juice number divided by 2 multiplied by 10 divided by 5';
const code = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
const endpoint = 'https://api.diagnostic-vendor.com/v1';
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { ready = (await fetch(origin)).ok; } catch {}
    if (ready) break;
    await delay(100);
  }
  assert(ready, 'Run npm run build before the browser check');
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1500, height: 950 });
  await page.evaluateOnNewDocument((baseUrl) => {
    if (localStorage.getItem('modeltrace.presets.v2')) return;
    localStorage.setItem('modeltrace.presets.v2', JSON.stringify({ version: 2, presets: [{
      id: 'diagnostic-provider', name: 'Diagnostics', baseUrl, apiKey: 'sk-diagnostic-test', models: [
        { id: 'chat', model: 'judge-chat', apiType: 'chat', temperature: null },
        { id: 'responses', model: 'judge-responses', apiType: 'responses', temperature: null },
      ],
    }] }));
  }, endpoint);
  const calls = [];
  const errors = [];
  let reply = 'private-answer-marker: I can’t share that.';
  let status = 200;
  let hold = null;
  page.on('pageerror', error => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', async request => {
    try {
      const url = new URL(request.url());
      if (!/\/v1\/(chat\/completions|responses)$/.test(url.pathname)) return await request.continue();
      const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization,content-type,x-modeltrace-endpoint',
        'Access-Control-Allow-Methods': 'POST,OPTIONS',
      };
      if (request.method() === 'OPTIONS') return await request.respond({ status: 204, headers });
      const body = JSON.parse(request.postData());
      calls.push({ url: url.href, headers: request.headers(), body });
      assert.equal(request.headers().authorization, 'Bearer sk-diagnostic-test');
      const prompt = body.messages?.[0]?.content ?? body.input?.[0]?.content?.[0]?.text;
      assert.equal(prompt, fixedPrompt);
      assert.equal((body.messages ?? body.input).length, 1, 'One question, no conversation history');
      assert.equal(body.instructions, undefined);
      assert.equal(body.tools, undefined);
      const text = reply;
      const responseStatus = status;
      if (hold) await hold;
      const response = responseStatus >= 400
        ? { error: { message: "can't original number private-error-marker" } }
        : url.pathname.endsWith('/responses')
          ? { id: 'resp_mock', created_at: 1, model: body.model, status: 'completed',
              output: [{ id: 'msg_mock', type: 'message', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] }],
              usage: { input_tokens: 10, output_tokens: 10 } }
          : { id: 'chat_mock', object: 'chat.completion', created: 1, model: body.model,
              choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } };
      await request.respond({ status: responseStatus, headers, contentType: 'application/json', body: JSON.stringify(response) });
    } catch (error) {
      errors.push(error.message);
      if (!request.isInterceptResolutionHandled()) await request.abort();
    }
  });
  await page.goto(origin, { waitUntil: 'networkidle0' });
  const proxy = await page.evaluate(() => window.__NUXT__.config.public.proxyUrl);
  const click = async (text, selector = 'button') => {
    await delay(250);
    const handle = await page.evaluateHandle((text, selector) => [...document.querySelectorAll(selector)].find(node => node.textContent.trim() === text && node.offsetWidth), text, selector);
    assert(handle.asElement(), `Missing visible control: ${text}`);
    await handle.asElement().click();
    await handle.dispose();
    await delay(300);
  };
  const unlock = async () => {
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Escape');
    for (const key of code) await page.keyboard.press(key);
    await page.waitForSelector('#degradation-target', { visible: true });
  };
  const tabLabels = () => page.$$eval('[role=tab]', nodes => nodes.map(node => node.textContent.trim()));
  const result = () => page.$eval('[aria-label="降智检测结果"]', node => node.innerText.trim());
  const waitResult = async (expected, count) => {
    for (let attempt = 0; attempt < 100 && calls.length < count; attempt++) await delay(25);
    assert.equal(calls.length, count, 'Exactly one request per detection');
    await page.waitForFunction(expected => document.querySelector('[aria-label="降智检测结果"]')?.innerText.trim() === expected &&
      [...document.querySelectorAll('[aria-label="降智检测"] button')].some(button => button.textContent.trim() === '重新检测' && !button.disabled), {}, expected);
  };

  assert.deepEqual(await tabLabels(), ['自动测试', '手动测试']);
  for (const key of code.slice(0, -2)) await page.keyboard.press(key);
  assert.equal((await tabLabels()).length, 2, 'One final ba is required');
  await click('手动测试', '[role=tab]');
  await page.click('textarea');
  for (const key of code) await page.keyboard.press(key);
  assert.equal((await tabLabels()).length, 2, 'Typing in inputs must never unlock the mode');
  await unlock();
  assert.deepEqual(await tabLabels(), ['自动测试', '手动测试', '降智检测']);
  assert.equal(await page.$eval('[role=tab][aria-selected=true]', node => node.textContent.trim()), '降智检测');
  assert.equal(calls.length, 0, 'Unlocking must never start a paid model request');

  await click('开始检测');
  if (proxy) {
    await page.waitForSelector('[role=alertdialog]');
    assert.equal(calls.length, 0);
    await page.keyboard.press('Escape');
    await delay(200);
    assert.equal(calls.length, 0, 'Dismissed consent cancels the request');
    await click('开始检测');
    await page.waitForSelector('[role=alertdialog]');
    await click('仅本次直连');
  }
  await waitResult('未降智', 1);
  assert.equal(calls[0].url, endpoint + '/chat/completions');
  assert.equal(calls[0].headers['x-modeltrace-endpoint'], undefined);
  assert(!(await page.$eval('[aria-label="降智检测"]', node => node.innerText)).includes('private-answer-marker'));
  reply = 'private-answer-marker: 64, predicted-model, 99%';
  await click('重新检测');
  if (proxy) { await page.waitForSelector('[role=alertdialog]'); await click('同意并通过代理检测'); }
  await waitResult('降智', 2);
  assert.equal(await result(), '降智');
  if (proxy) assert.equal(calls[1].headers['x-modeltrace-endpoint'], endpoint);
  assert.equal((await page.$$('[aria-label="降智检测"] [aria-label="归因结果"]')).length, 0);

  await page.click('#degradation-target');
  await click('Diagnostics · judge-responses', '[role=option]');
  for (const text of ['original number', 'starting number', 'assistant guidelines']) {
    reply = text;
    const count = calls.length + 1;
    await click(calls.length === 2 ? '开始检测' : '重新检测');
    await waitResult('未降智', count);
    assert(calls.at(-1).url.endsWith('/responses'));
  }
  status = 503;
  const failedCount = calls.length + 1;
  await click('重新检测');
  await waitResult('检测失败', failedCount);
  await delay(2200);
  assert.equal(calls.length, failedCount, 'HTTP failures must not trigger an SDK retry');
  assert(!(await page.$eval('[aria-label="降智检测"]', node => node.innerText)).includes('private-error-marker'));

  status = 200;
  reply = 'assistant guidelines';
  let release;
  hold = new Promise(resolve => { release = resolve; });
  const heldCount = calls.length + 1;
  await click('重新检测');
  while (calls.length < heldCount) await delay(25);
  assert.equal(await page.$$eval('[aria-label="降智检测"] button', buttons => buttons.find(button => button.textContent.trim() === '关闭隐藏模式').disabled), true);
  await click('自动测试', '[role=tab]');
  assert.equal(await page.$eval('[aria-label="编辑 Diagnostics"]', button => button.disabled), true);
  assert.equal(await page.$eval('[aria-label="测试 Diagnostics · judge-responses"]', button => button.disabled), true);
  await click('降智检测', '[role=tab]');
  release();
  hold = null;
  await waitResult('未降智', heldCount);
  assert.equal(calls.length, heldCount);
  assert(!(await page.evaluate(() => JSON.stringify(localStorage))).includes('private-answer-marker'));
  await page.setViewport({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Unlocked tabs must fit mobile width');
  await page.screenshot({ path: '/tmp/modeltrace-degradation-mobile.png', fullPage: true });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForSelector('#degradation-target', { visible: true });
  assert.deepEqual(await tabLabels(), ['自动测试', '手动测试', '降智检测']);
  assert.equal(await result(), '尚未检测', 'Enablement persists but raw replies and verdicts do not');
  assert.equal(calls.length, heldCount, 'Restoring the enabled mode must not send any model request');
  await click('关闭隐藏模式');
  assert.deepEqual(await tabLabels(), ['自动测试', '手动测试']);
  assert.equal(await page.$eval('[role=tab][aria-selected=true]', node => node.textContent.trim()), '自动测试');
  assert.equal((await page.$$('[aria-label="降智检测结果"]')).length, 0);
  assert.equal(await page.evaluate(() => localStorage.getItem('modeltrace.degradation-enabled.v1')), null);
  await page.reload({ waitUntil: 'networkidle0' });
  assert.deepEqual(await tabLabels(), ['自动测试', '手动测试']);
  assert.deepEqual(errors, []);
  console.log(`PASS hidden keyboard unlock/input guard/persistent enablement/manual close, one fixed question, binary-only output, Chat/Responses, consent=${!!proxy}, no retries/raw output, cross-mode locks and mobile layout`);
} finally {
  await browser?.close();
  preview.kill();
}
