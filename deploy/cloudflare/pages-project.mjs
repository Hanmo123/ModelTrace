import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { deploymentConfig } from "./config.mjs";

export async function ensurePagesProject(config, apiToken, request = fetch) {
  const collection = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/pages/projects`;
  const headers = { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" };
  let response = await request(`${collection}/${config.pagesProject}`, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 404) {
    response = await request(collection, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({ name: config.pagesProject, production_branch: config.productionBranch }),
    });
  }
  if (!response.ok) {
    // Never print request headers or credentials, including in failure paths.
    throw new Error(`Cloudflare Pages project request failed (HTTP ${response.status}); check the account ID and token's Cloudflare Pages: Edit permission`);
  }
  const payload = await response.json();
  if (!payload.success || !payload.result) throw new Error("Cloudflare Pages project request was unsuccessful");
  if (payload.result.production_branch !== config.productionBranch) {
    throw new Error(`Pages production branch differs from ${config.productionBranch}; update the project's production branch before deploying (refusing an accidental preview deployment)`);
  }
  return payload.result;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const config = deploymentConfig(process.env);
    if (!config.pages) throw new Error("Pages project setup requires the pages or all target");
    const project = await ensurePagesProject(config, process.env.CLOUDFLARE_API_TOKEN.trim());
    console.log(`Pages project ready: ${project.name} (production branch: ${project.production_branch})`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
