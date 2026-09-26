import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { deploymentConfig, renderWorkerConfig } from "./config.mjs";
import { ensurePagesProject } from "./pages-project.mjs";

const env = {
  CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
  CLOUDFLARE_API_TOKEN: "test-token-never-print",
  PRODUCTION_BRANCH: "hanmo",
  CLOUDFLARE_WORKER_NAME: "my-relay",
  CLOUDFLARE_PAGES_PROJECT_NAME: "my-modeltrace",
  SITE_ORIGIN: "https://my-modeltrace.pages.dev",
  NUXT_PUBLIC_PROXY_URL: "https://my-relay.account.workers.dev/v1",
};
const config = deploymentConfig(env);
const template = readFileSync(new URL("../../worker/wrangler.toml.example", import.meta.url), "utf8");

test("combined deployment is explicit and does not include credentials in outputs", () => {
  assert.equal(config.worker, true);
  assert.equal(config.pages, true);
  assert.equal(config.productionBranch, "hanmo");
  assert(!JSON.stringify(config).includes(env.CLOUDFLARE_API_TOKEN));
  assert.equal(deploymentConfig({ ...env, SITE_ORIGIN: `${env.SITE_ORIGIN}/` }).siteOrigin, env.SITE_ORIGIN);
});

test("Worker-only supports a future EdgeOne site without any Pages project", () => {
  const result = deploymentConfig({
    ...env,
    DEPLOY_TARGET: "worker",
    CLOUDFLARE_PAGES_PROJECT_NAME: "",
    SITE_ORIGIN: "https://modeltrace.example.com",
    NUXT_PUBLIC_PROXY_URL: "",
  });
  assert.equal(result.worker, true);
  assert.equal(result.pages, false);
  assert.equal(result.pagesProject, "");
});

test("Pages-only supports direct mode without a managed Worker", () => {
  const result = deploymentConfig({ ...env, DEPLOY_TARGET: "pages", NUXT_PUBLIC_PROXY_URL: "", CLOUDFLARE_WORKER_NAME: "" });
  assert.equal(result.worker, false);
  assert.equal(result.pages, true);
  assert.equal(result.proxyURL, "");
});

test("custom site and proxy domains are supported", () => {
  assert.doesNotThrow(() => deploymentConfig({
    ...env,
    SITE_ORIGIN: "https://modeltrace.example.com",
    NUXT_PUBLIC_PROXY_URL: "https://relay.example.com/v1",
  }));
});

for (const [key, values] of Object.entries({
  DEPLOY_TARGET: ["edgeone", "all\nworker"],
  CLOUDFLARE_ACCOUNT_ID: ["", "account", "a".repeat(32) + "\nbad"],
  CLOUDFLARE_API_TOKEN: ["", "\n", "token\ninjection"],
  PRODUCTION_BRANCH: ["", "main\nextra"],
  SITE_ORIGIN: ["", "not-url", "http://app.example.com", "https://app.example.com/path", "https://user:pass@app.example.com", "https://app.example.com?", "https://app.example.com/#x", "https://wrong.pages.dev", "https://app.example.com\\"],
  NUXT_PUBLIC_PROXY_URL: ["", "http://relay.example.com/v1", "https://relay.example.com", "https://relay.example.com/v1/", "https://relay.example.com/v1?key=x", "https://other.account.workers.dev/v1", "https://relay.example.com/v1\n"],
  CLOUDFLARE_WORKER_NAME: ["Bad_Name", "a".repeat(64), "name\nname = x"],
  CLOUDFLARE_PAGES_PROJECT_NAME: ["", "Bad_Project", "a".repeat(59)],
  CLOUDFLARE_RATE_LIMIT_NAMESPACE_ID: ["0", "-1", '1"\nbad = true'],
})) {
  test(`reject invalid ${key} before deploying`, () => {
    for (const value of values) assert.throws(() => deploymentConfig({ ...env, [key]: value }), undefined, `${key}=${JSON.stringify(value)}`);
  });
}

test("render changes only deployment values and preserves the mandatory limiter", () => {
  const rendered = renderWorkerConfig(template, { ...config, namespaceId: "2002" });
  assert.match(rendered, /^name = "my-relay"$/m);
  assert.match(rendered, /^SITE_ORIGIN = "https:\/\/my-modeltrace.pages.dev"$/m);
  assert.match(rendered, /^namespace_id = "2002"$/m);
  assert.match(rendered, /^name = "RATE_LIMITER"$/m);
  assert.match(rendered, /^main = "src\/index.mjs"$/m);
  assert.match(rendered, /^simple = \{ limit = 10, period = 60 \}$/m);
  assert.equal(renderWorkerConfig(rendered, config), renderWorkerConfig(template, config));
  assert.throws(() => renderWorkerConfig(template.replace("SITE_ORIGIN =", "OTHER_ORIGIN ="), config), /exactly one SITE_ORIGIN/);
  assert.throws(() => renderWorkerConfig(template + '\nSITE_ORIGIN = "duplicate"\n', config), /exactly one SITE_ORIGIN/);
});

test("CLI renders isolated configuration and outputs without touching local settings", () => {
  const root = mkdtempSync(join(tmpdir(), "modeltrace-deploy-test-"));
  try {
    const directory = join(root, "deploy/cloudflare");
    mkdirSync(directory, { recursive: true });
    mkdirSync(join(root, "worker"));
    const script = join(directory, "config.mjs");
    cpSync(new URL("./config.mjs", import.meta.url), script);
    writeFileSync(join(root, "worker/wrangler.toml.example"), template);
    writeFileSync(join(root, "worker/wrangler.toml"), "local configuration must not change");
    const outputs = join(root, "outputs");
    const processEnv = { ...env, GITHUB_OUTPUT: outputs };
    const stdout = execFileSync(process.execPath, [script], { env: processEnv, encoding: "utf8" });
    assert.equal(readFileSync(join(root, "worker/wrangler.ci.toml"), "utf8"), renderWorkerConfig(template, config));
    assert.equal(readFileSync(join(root, "worker/wrangler.toml"), "utf8"), "local configuration must not change");
    assert.match(readFileSync(outputs, "utf8"), /^worker=true\npages=true\n/);
    assert(!stdout.includes(env.CLOUDFLARE_API_TOKEN));
    assert(!readFileSync(outputs, "utf8").includes(env.CLOUDFLARE_API_TOKEN));

    rmSync(join(root, "worker/wrangler.ci.toml"));
    execFileSync(process.execPath, [script], { env: { ...processEnv, DEPLOY_TARGET: "pages" } });
    assert(!existsSync(join(root, "worker/wrangler.ci.toml")));
    const failed = spawnSync(process.execPath, [script], { env: { ...processEnv, CLOUDFLARE_API_TOKEN: "" }, encoding: "utf8" });
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /CLOUDFLARE_API_TOKEN must be configured/);
    assert(!existsSync(join(root, "worker/wrangler.ci.toml")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const project = { name: config.pagesProject, production_branch: config.productionBranch };
const ok = (result = project) => Response.json({ success: true, result });

test("existing Pages project is reused without writes", async () => {
  let calls = 0;
  const result = await ensurePagesProject(config, env.CLOUDFLARE_API_TOKEN, async (url, options) => {
    calls++;
    assert.equal(url, `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/pages/projects/my-modeltrace`);
    assert.equal(options.headers.Authorization, `Bearer ${env.CLOUDFLARE_API_TOKEN}`);
    assert.equal(options.method, undefined);
    return ok();
  });
  assert.deepEqual(result, project);
  assert.equal(calls, 1);
});

test("missing Pages project is created with the configured production branch", async () => {
  const calls = [];
  await ensurePagesProject(config, "token", async (url, options) => {
    calls.push({ url, options });
    return calls.length === 1 ? new Response(null, { status: 404 }) : ok();
  });
  assert.equal(calls.length, 2);
  assert(calls[1].url.endsWith("/pages/projects"));
  assert.equal(calls[1].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[1].options.body), project);
});

test("authentication and server errors never trigger project creation", async () => {
  for (const status of [401, 403, 429, 500]) {
    let calls = 0;
    await assert.rejects(ensurePagesProject(config, "token", async () => {
      calls++;
      return new Response(null, { status });
    }), new RegExp(`HTTP ${status}`));
    assert.equal(calls, 1);
  }
});

test("failed creation and unexpected API responses block deployment", async () => {
  let calls = 0;
  await assert.rejects(ensurePagesProject(config, "token", async () => {
    return new Response(null, { status: ++calls === 1 ? 404 : 403 });
  }), /HTTP 403/);
  await assert.rejects(ensurePagesProject(config, "token", async () => Response.json({ success: false })), /unsuccessful/);
});

test("mismatched production branch fails rather than silently publishing a preview", async () => {
  await assert.rejects(ensurePagesProject(config, "token", async () => ok({ ...project, production_branch: "main" })), /production branch differs/);
});
