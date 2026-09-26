# GitHub Actions 部署

前端是纯静态 SPA，Worker 是可选的独立代理。部署不运行 Python 服务，不需要模型 API Key，也不会自动发送付费模型请求。

## Cloudflare Worker + Pages：首次配置

### 1. 准备 Cloudflare 账户

1. 在 Cloudflare **Workers & Pages** 中启用账户的 `workers.dev` 子域，例如 `my-account.workers.dev`。
2. 创建 API Token，限制到目标账户，授予：
   - **Account → Workers Scripts → Edit**：部署 Worker。
   - **Account → Cloudflare Pages → Edit**：创建 Pages 项目、上传站点。
   - **Account → Account Settings → Read**：读取账户 / Workers 子域信息。
   - 仅部署其中一项时可移除另一项的 Edit 权限。本流程不操作 DNS、Zone Routes、KV 或数据库；不要使用 Global API Key。
3. 记下 **Account ID**（不是 Zone ID）。

Pages 项目不必提前创建：工作流先查询项目，仅在返回 404 时创建 **Direct Upload** 项目，生产分支设置为下面的 `DEPLOY_BRANCH`。如使用已有项目，它的生产分支必须一致，否则流程会失败，而不是把生产发布误发到 Preview。不要同时开启同一项目的 Cloudflare Git 自动构建，以免重复发布。

### 2. 配置 GitHub Secrets / Variables

打开仓库 **Settings → Secrets and variables → Actions**。

**Secrets**（可以放在仓库，或 `cloudflare-production` Environment 中）：

| 名称 | 值 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | 上一步创建的 API Token |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 的 32 位 Account ID |

**Repository Variables**（配置在仓库级，不要只放在 Environment 中；构建时还没有进入部署 Environment）：

| 名称 | 示例 / 默认值 | 说明 |
| --- | --- | --- |
| `CLOUDFLARE_DEPLOY_ENABLED` | `true` | 开启生产分支 push 自动部署；未设置时只做 CI，手动部署不受此开关影响 |
| `DEPLOY_BRANCH` | 默认：仓库默认分支 | 允许部署的唯一分支；例如 `hanmo` 或 `main`，不要填 `refs/heads/` |
| `CLOUDFLARE_DEPLOY_TARGET` | 默认：`all` | push 部署目标：`all` / `worker` / `pages`；手动运行时由输入覆盖 |
| `CLOUDFLARE_WORKER_NAME` | 默认：`modeltrace-relay` | 要更新已有 Worker 时填其现有名称 |
| `CLOUDFLARE_PAGES_PROJECT_NAME` | `my-modeltrace` | 部署 Pages 时必填；用于 `https://my-modeltrace.pages.dev` |
| `SITE_ORIGIN` | `https://my-modeltrace.pages.dev` | 必填，实际前端 Origin；不要带路径。也可以是绑定好的自定义域名 |
| `NUXT_PUBLIC_PROXY_URL` | `https://modeltrace-relay.my-account.workers.dev/v1` | **公开**的代理地址，以 `/v1` 结尾；`all` 必填，`pages` 可留空禁用代理，`worker` 可省略 |
| `CLOUDFLARE_RATE_LIMIT_NAMESPACE_ID` | 默认：`1001` | 必须是正整数；同账户内需要相互隔离的 Worker 使用不同 namespace |
| `GH_PAGES_ENABLED` | `false` | 如不再使用原 GitHub Pages，可关闭其独立发布流程 |
| `NUXT_PUBLIC_GTAG_ID` | 默认：`G-R374H35YTH` | 公开的 GA4 Measurement ID；fork / 自行部署时可替换为自己的 ID |
| `NUXT_PUBLIC_GTAG_ENABLED` | 默认：`true` | 设置 `false` 在构建时禁用 Google 统计；修改后需重新构建 |

例如：

```text
CLOUDFLARE_WORKER_NAME=modeltrace-relay
CLOUDFLARE_PAGES_PROJECT_NAME=my-modeltrace
SITE_ORIGIN=https://my-modeltrace.pages.dev
NUXT_PUBLIC_PROXY_URL=https://modeltrace-relay.my-account.workers.dev/v1
CLOUDFLARE_DEPLOY_ENABLED=true
```

`NUXT_PUBLIC_PROXY_URL` 会写入浏览器可下载的静态文件，**不能包含 API Token 或其他密钥**。它必须在构建时提供；之后只在 Pages 控制台修改环境变量不会改变已经上传的 SPA。

### 3. 执行部署

将工作流合并到仓库默认分支后，进入 **Actions → Deploy Cloudflare Worker and Pages → Run workflow**，选择 `DEPLOY_BRANCH` 对应分支：

- `all`：测试 / 构建 → 检查或创建 Pages 项目 → 部署 Worker → 部署 Pages。Worker 失败不会继续上传 Pages。
- `worker`：只发布代理，可用于前端已经迁移到 Nginx / EdgeOne Pages 的情况。
- `pages`：只发布静态站点。仍使用构建时配置的代理地址，但**不会修改 Worker 的 SITE_ORIGIN**。

三个目标都会跑无凭据的构建与部署配置测试。所有检查通过才进入 `cloudflare-production` 部署 Environment；可在 **Settings → Environments** 给它设置 required reviewers 和部署分支限制。

开启 `CLOUDFLARE_DEPLOY_ENABLED=true` 后，生产分支中前端、Worker、部署脚本或相关工作流的变更会自动发布。其他分支 push / PR（包括 fork PR）只做 CI，既不部署，也不使用 Cloudflare Secrets。手动运行也只允许生产分支；在其他分支运行时部署 job 会跳过。修改 Secrets / Variables 本身不会触发 Actions，需要手动运行一次。

生产部署不会取消正在执行的发布，新运行会排队；GitHub concurrency 可能合并尚未开始的运行。Worker 与 Pages 不是原子事务：如果 Worker 成功而 Pages 上传失败，可修复后重跑；需要回滚时分别在 Cloudflare 中回滚对应部署。

### 4. 验收与域名

工作流日志提供 Worker / Pages 的发布地址，Summary 展示本次 commit、站点 Origin 和代理 URL。打开配置的站点检查静态页面、候选库和代理授权提示。

可不使用模型密钥检查 Worker 的 CORS 预检：

```bash
curl -i -X OPTIONS 'https://modeltrace-relay.my-account.workers.dev/v1/chat/completions' \
  -H 'Origin: https://my-modeltrace.pages.dev' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: authorization,content-type,x-modeltrace-endpoint'
```

应返回 `204`，且 `Access-Control-Allow-Origin` 与站点 Origin 一致。错误来源应返回 `403`。

自定义域名需要先在 Cloudflare 控制台绑定和配置 DNS；本工作流**不自动创建域名 / 路由**。之后修改 `SITE_ORIGIN` 并执行 `all` 或 `worker`。如果 Worker 也使用自定义域名，先绑定该域名，再更新 `NUXT_PUBLIC_PROXY_URL` 并重建前端。

**生产站点仍只接受 `SITE_ORIGIN` 配置的一个精确 Origin，不接受 `*` 或逗号分隔列表。** 生产域名、`pages.dev`、Preview URL、GitHub Pages 是不同来源；只授权你实际使用的那个域名。不要为支持任意 Preview 放宽来源检查。多域名同时使用代理时，部署独立 Worker 并分别设置来源。

**本地开发例外**：额外放行 HTTP(S) `localhost` 的任意有效端口，例如 `http://localhost:4200`、`http://localhost:5173`、`https://localhost:8443`；无须改变生产 `SITE_ORIGIN`。前端 `npm run dev` 和 `npm run preview` 默认使用 `4200`，用 `http://localhost:4200/` 访问。验证预检时可把上面 curl 的 Origin 替换为 `http://localhost:4200`，应返回 `204` 并回显同一 Origin。

该例外不包括 `127.0.0.1`、`[::1]`、子域名或 `localhost.evil.com`，也不允许带凭据、路径、查询参数的 Origin。`SITE_ORIGIN` 与 `RATE_LIMITER` 仍必需，代理上游也仍禁止本地地址。更新后需要重新部署 Worker。允许任意 localhost 端口意味着其他本地网页也能使用该代理；Origin 不是身份认证，仍需限流、WAF、用量预算及告警。

## 工作流与本地检查

| 文件 | 职责 |
| --- | --- |
| `.github/workflows/build-web.yml` | 可复用、无云凭据的静态构建：`npm ci`、Nuxt 4 类型检查、配置/队列/API runner/Worker mock 测试、`npm run generate`、上传 artifact |
| `.github/workflows/cloudflare.yml` | PR / push CI、Worker dry-run、生产部署、单目标手动部署 |
| `.github/workflows/pages.yml` | 保留的 GitHub Pages 发布，同样复用静态构建 |
| `deploy/cloudflare/config.mjs` | 校验配置，从已跟踪模板生成隔离的 Worker CI 配置 |
| `deploy/cloudflare/pages-project.mjs` | 首次创建 / 校验 Pages 项目及生产分支 |
| `deploy/package.json` + `package-lock.json` | 锁定 Wrangler 及其依赖；通过提交 lockfile 升级 |

固定单题诊断需要同步发布前端和 Worker（`target=all`），旧 Worker 不接受新增的固定问题。快捷键仅隐藏前端入口，不是身份认证；启用开关保存在当前站点的浏览器存储中，手动关闭后清除。

Worker CI 使用 `worker/wrangler.toml.example` 的 entrypoint、compatibility date 和强制限流配置，仅覆盖 Worker 名称、`SITE_ORIGIN`、限流 namespace。生成的 `worker/wrangler.ci.toml` 已被 gitignore 忽略，不读取、不覆盖本机的 `worker/wrangler.toml`。修改 Worker 的通用部署选项时请编辑模板。

本地检查（Node.js 22+）：

```bash
npm ci --prefix deploy
npm test --prefix deploy
cp worker/wrangler.toml.example worker/wrangler.ci.toml
deploy/node_modules/.bin/wrangler deploy --config worker/wrangler.ci.toml --dry-run

cd web
npm ci
node tests/api-runner-test.mjs
npm run test:terminal
NUXT_APP_BASE_URL=/ NUXT_PUBLIC_PROXY_URL= npm run generate
```

CI 不调用真实 Cloudflare API，也不跑需要真实模型的测试；只有部署 job 才调用 Cloudflare。Google 统计不作为 CI 发布门禁，部署后通过浏览器 Network 和 GA4「实时」报告手动验收。业务浏览器 E2E 仍可按根 README 在本地运行。静态 artifact `modeltrace-web` 保留 7 天，不含服务器运行时；源码位于 `web/.output/public`，下载后的 artifact 根目录直接是 `index.html` 等文件。

## 后续迁移到 EdgeOne Pages

目前实现了 Cloudflare Worker / Cloudflare Pages 和原有 GitHub Pages 发布，**尚未加入 EdgeOne 的鉴权和上传步骤**。前端构建不依赖 Cloudflare：

1. 在未来的 EdgeOne workflow 中通过 `uses: ./.github/workflows/build-web.yml` 调用构建，传入 `base-url: /` 和公开的 `proxy-url`。
2. 用 `actions/download-artifact@v4` 下载 `modeltrace-web`，把整个目录交给 EdgeOne Pages 的官方上传流程即可；不需要 `nuxt build` 服务端产物或 Worker adapter。也可在 EdgeOne Git 构建中使用项目目录 `web`、Node.js 22.19+（22.x）或 24.11+（24.x）、命令 `npm ci && npm run generate`、输出目录 `.output/public`。
3. 保留 CF Worker 时，把 `SITE_ORIGIN` 改为 EdgeOne 的正式域名，把 `CLOUDFLARE_DEPLOY_TARGET` 改成 `worker`，再发布一次 Worker；`NUXT_PUBLIC_PROXY_URL` 可以不变。这样后续 push 不再向 CF Pages 上传。
4. EdgeOne Preview 仍不会自动获得代理权限；SPA fallback / 自定义域名按 EdgeOne 托管配置处理。现有前端只有根页面。

迁移静态托管不等于迁移 Worker 运行时；当前代理依赖 Cloudflare 的 Rate Limiting binding，不能不做适配就当作 EdgeOne Function 上传。
