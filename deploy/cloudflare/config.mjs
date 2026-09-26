import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function required(env, key) {
  const value = env[key]?.trim();
  if (!value || /[\r\n]/.test(value)) throw new Error(`${key} must be configured`);
  return value;
}

function httpsURL(value, key) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${key} must be an HTTPS URL`);
  }
  if (
    url.protocol !== "https:" ||
    url.username || url.password || url.search || url.hash ||
    !url.hostname.includes(".") || /[\s\\?#]/.test(value)
  ) throw new Error(`${key} must be a public HTTPS URL without credentials, query or fragment`);
  return url;
}

function resourceName(value, key, maxLength) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) || value.length > maxLength) {
    throw new Error(`${key} must use lowercase letters, digits and internal hyphens (max ${maxLength})`);
  }
  return value;
}

export function deploymentConfig(env) {
  const target = env.DEPLOY_TARGET || "all";
  if (!["all", "worker", "pages"].includes(target)) throw new Error("Invalid DEPLOY_TARGET");
  const worker = target !== "pages";
  const pages = target !== "worker";
  const accountId = required(env, "CLOUDFLARE_ACCOUNT_ID");
  if (!/^[a-f0-9]{32}$/i.test(accountId)) throw new Error("CLOUDFLARE_ACCOUNT_ID must be a 32-character account ID (not a zone ID)");
  required(env, "CLOUDFLARE_API_TOKEN");
  const productionBranch = required(env, "PRODUCTION_BRANCH");
  const site = httpsURL(required(env, "SITE_ORIGIN"), "SITE_ORIGIN");
  if (site.pathname !== "/") throw new Error("SITE_ORIGIN must contain only the origin, without a path");

  const workerName = worker
    ? resourceName(env.CLOUDFLARE_WORKER_NAME || "modeltrace-relay", "CLOUDFLARE_WORKER_NAME", 63)
    : "";
  const pagesProject = pages
    ? resourceName(required(env, "CLOUDFLARE_PAGES_PROJECT_NAME"), "CLOUDFLARE_PAGES_PROJECT_NAME", 58)
    : "";
  if (pages && site.hostname.endsWith(".pages.dev") && site.origin !== `https://${pagesProject}.pages.dev`) {
    throw new Error("SITE_ORIGIN must match the production Pages project, or use a custom domain");
  }

  // Nuxt embeds this at build time. Do not silently deploy a disconnected frontend.
  const proxyURL = env.NUXT_PUBLIC_PROXY_URL || "";
  if (target === "all" && !proxyURL) throw new Error("NUXT_PUBLIC_PROXY_URL is required when deploying Worker and Pages together");
  if (proxyURL) {
    const proxy = httpsURL(proxyURL, "NUXT_PUBLIC_PROXY_URL");
    if (proxy.pathname !== "/v1" || proxy.href !== proxyURL) {
      throw new Error("NUXT_PUBLIC_PROXY_URL must be a canonical HTTPS URL ending in /v1");
    }
    if (worker && proxy.hostname.endsWith(".workers.dev") && proxy.hostname.split(".")[0] !== workerName) {
      throw new Error("NUXT_PUBLIC_PROXY_URL does not match CLOUDFLARE_WORKER_NAME");
    }
  }
  const namespaceId = env.CLOUDFLARE_RATE_LIMIT_NAMESPACE_ID || "1001";
  if (worker && !/^[1-9][0-9]*$/.test(namespaceId)) throw new Error("CLOUDFLARE_RATE_LIMIT_NAMESPACE_ID must be a positive integer");

  // No secrets in this object: it is safe to use for configuration and step outputs.
  return { worker, pages, accountId, productionBranch, workerName, pagesProject, siteOrigin: site.origin, proxyURL, namespaceId };
}

export function renderWorkerConfig(template, config) {
  // Keep compatibility date, entrypoint and mandatory rate limiter in the tracked
  // template. Render alongside it so Wrangler resolves main relative to worker/.
  function replaceSetting(section, key, value) {
    const pattern = new RegExp(`^${key} = "[^"\\r\\n]*"`, "gm");
    if ([...section.matchAll(pattern)].length !== 1) throw new Error(`Expected exactly one ${key} in Worker template`);
    return section.replace(pattern, `${key} = ${JSON.stringify(value)}`);
  }
  // Binding tables also have a name; only change the root-level Worker name.
  const sections = template.split(/(?=^\[)/m);
  sections[0] = replaceSetting(sections[0], "name", config.workerName);
  template = replaceSetting(sections.join(""), "SITE_ORIGIN", config.siteOrigin);
  return replaceSetting(template, "namespace_id", config.namespaceId);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const config = deploymentConfig(process.env);
    if (config.worker) {
      const directory = new URL("../../worker/", import.meta.url);
      const template = readFileSync(new URL("wrangler.toml.example", directory), "utf8");
      writeFileSync(new URL("wrangler.ci.toml", directory), renderWorkerConfig(template, config));
      console.log(`Generated ${fileURLToPath(new URL("wrangler.ci.toml", directory))}`);
    }
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `worker=${config.worker}\npages=${config.pages}\nworker_name=${config.workerName}\npages_project=${config.pagesProject}\nsite_origin=${config.siteOrigin}\n`);
    }
    console.log(`Deployment target: ${process.env.DEPLOY_TARGET || "all"}; site origin: ${config.siteOrigin}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
