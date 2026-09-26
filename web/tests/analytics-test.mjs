// Test the actual static artifact at simulated public/local origins.
// Every request is intercepted: no Google Analytics hits or paid API calls.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = fileURLToPath(new URL("../.output/public/", import.meta.url));
const base = process.env.TEST_BASE_URL || "/";
const id = process.env.EXPECT_GTAG_ID || "G-R374H35YTH";
const enabled = process.env.EXPECT_GTAG_ENABLED !== "false";
assert(base.startsWith("/") && base.endsWith("/"));
await readFile(resolve(root, "index.html")); // Run npm run generate first.
const mime = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
};
const secret = "sk-analytics-regression-secret";
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
  args: ["--no-sandbox"],
});

try {
  for (const { origin, track, blocked = false } of [
    { origin: "https://modeltrace.example", track: enabled },
    { origin: "https://localhost.example", track: enabled },
    { origin: "https://127.example.org", track: enabled },
    { origin: "http://localhost:4200", track: false },
    { origin: "http://127.0.0.1:3245", track: false },
    { origin: "http://127.0.0.2:4200", track: false },
    { origin: "http://0.0.0.0:4200", track: false },
    { origin: "http://[::1]:4200", track: false },
    { origin: "http://preview.localhost:4200", track: false },
    { origin: "https://blocked.example", track: enabled, blocked: true },
  ]) {
    const page = await browser.newPage();
    const tagRequests = [];
    const unexpected = [];
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(document, "referrer", {
        value:
          "https://referrer.example/private-path?token=referrer-secret#fragment",
        configurable: true,
      });
    });
    await page.setRequestInterception(true);
    page.on("request", async (request) => {
      try {
        const url = new URL(request.url());
        if (
          url.origin === "https://www.googletagmanager.com" &&
          url.pathname === "/gtag/js"
        ) {
          tagRequests.push(url.href);
          if (blocked) return await request.abort("blockedbyclient");
          return await request.respond({
            status: 200,
            contentType: "text/javascript",
            body: "/* Google tag mocked: never send analytics in tests. */",
          });
        }
        if (url.origin !== origin) {
          unexpected.push(url.href);
          return await request.abort();
        }
        if (url.pathname === "/favicon.ico")
          return await request.respond({ status: 204 });
        if (!url.pathname.startsWith(base))
          throw new Error(`Outside base path: ${url.pathname}`);
        const file = resolve(
          root,
          url.pathname.slice(base.length) || "index.html",
        );
        if (!file.startsWith(root)) throw new Error("Invalid asset path");
        await request.respond({
          status: 200,
          contentType: mime[extname(file)] || "text/html",
          body: await readFile(file),
        });
      } catch (error) {
        errors.push(String(error));
        if (!request.isInterceptResolutionHandled()) await request.abort();
      }
    });
    await page.goto(`${origin}${base}?api_key=query-secret#hash-secret`, {
      waitUntil: "networkidle0",
    });
    await page.waitForSelector('[role="tab"]');
    await page.waitForFunction(() =>
      /指纹库 \d+ 模型/.test(document.body.innerText),
    );
    const commands = () =>
      page.evaluate(() =>
        Array.from(window.dataLayer || [], (command) => Array.from(command)),
      );
    let data = await commands();
    if (track) {
      assert.equal(tagRequests.length, 1, origin);
      assert.equal(new URL(tagRequests[0]).searchParams.get("id"), id);
      assert.equal(
        await page.$$eval("script[data-gtag]", (nodes) => nodes.length),
        1,
      );
      const configurations = data.filter((command) => command[0] === "config");
      assert.equal(configurations.length, 1);
      assert.equal(configurations[0][1], id);
      assert.equal(configurations[0][2].send_page_view, false);
      assert.equal(configurations[0][2].allow_google_signals, false);
      assert.equal(
        configurations[0][2].allow_ad_personalization_signals,
        false,
      );
      const views = data.filter((command) => command[0] === "event");
      assert.deepEqual(views, [
        [
          "event",
          "page_view",
          {
            page_title: "ModelTrace",
            page_location: `${origin}${base}`,
            page_referrer: "https://referrer.example",
          },
        ],
      ]);
      assert.deepEqual(
        data.find((command) => command[0] === "set")?.[1],
        views[0][2],
      );
    } else {
      assert.deepEqual(tagRequests, [], origin);
      assert.equal(await page.$("script[data-gtag]"), null);
      assert.equal(data.filter((command) => command[0] === "event").length, 0);
    }

    // Opening/submitting the real provider form must not emit business data,
    // and a blocked Google script must not prevent normal application use.
    if (origin === "https://modeltrace.example" || blocked) {
      async function click(text) {
        // Wait for Reka dialog transitions before performing a real pointer click.
        await new Promise((resolve) => setTimeout(resolve, 250));
        const handle = await page.evaluateHandle(
          (text) =>
            [...document.querySelectorAll("button")].find(
              (node) => node.textContent.trim() === text && node.offsetWidth,
            ),
          text,
        );
        assert(handle.asElement(), `Missing button: ${text}`);
        await handle.asElement().click();
        await handle.dispose();
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      await click("自动测试");
      await click("添加服务商");
      await page.waitForSelector("#preset-name");
      for (const [selector, value] of Object.entries({
        "#preset-name": "Private analytics fixture",
        "#preset-base-url": "https://private-vendor.example/v1",
        "#preset-api-key": secret,
        "#preset-model": "private-model-id",
      })) {
        await page.$eval(
          selector,
          (node, value) => {
            node.value = value;
            node.dispatchEvent(new Event("input", { bubbles: true }));
          },
          value,
        );
      }
      await click("保存");
      await page.waitForFunction(
        () => !document.querySelector('[role="dialog"]'),
      );
      const storedKey = await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("modeltrace.presets.v2")).presets[0]
            .apiKey,
      );
      assert.equal(storedKey, secret);
      data = await commands();
      assert.equal(
        data.filter((command) => command[0] === "event").length,
        track ? 1 : 0,
        "No duplicate page views or form events from application code",
      );
      assert.equal(tagRequests.length, track ? 1 : 0);
    }
    const serialized = JSON.stringify(data);
    for (const sensitive of [
      secret,
      "query-secret",
      "hash-secret",
      "referrer-secret",
      "private-path",
      "Private analytics fixture",
      "private-vendor",
      "private-model-id",
    ]) {
      assert(
        !serialized.includes(sensitive),
        `Analytics must not include ${sensitive}`,
      );
    }
    assert.deepEqual(unexpected, []);
    assert.deepEqual(errors, []);
    console.log(
      `PASS analytics: ${origin}${base} (${blocked ? "script blocked" : track ? id : "disabled"})`,
    );
    await page.close();
  }
} finally {
  await browser.close();
}
