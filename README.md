# ModelTrace

开源仓库：[Hanmo123/ModelTrace](https://github.com/Hanmo123/ModelTrace)。本项目基于 [xqy2006/ModelTrace](https://github.com/xqy2006/ModelTrace) 继续开发，保留原项目的 MIT 许可证及版权声明；新版增加了 Nuxt 纯静态前端、多服务商测试、可选 Worker 代理及 Nginx 发布包。

ModelTrace 是一个本地运行的主动模型归因工具。它通过三条独立的长整数生成挑战提取输出指纹，在统一候选库中自动判断模型家族和具体版本。

## 运行

```powershell
python -m pip install -r requirements.txt
python start.py
```

页面地址为 `http://127.0.0.1:7860/`。

## Nuxt 4 新版前端（web/）

> 推荐使用 [GitHub Actions 一键部署 Cloudflare Worker + Pages](deploy/README.md)：通过 GitHub Secrets / Variables 配置账户与域名，无需修改工作流中的地址。请创建自己的 Worker，不要将仓库历史示例中的个人 Worker 当作公共代理服务。不要提交真实 API Key 或本地 Worker 配置。

`web/` 是基于 Nuxt 4（纯 SPA，`ssr: false`）+ Tailwind CSS + shadcn-vue 重新设计的前端；默认在浏览器本地运行，不依赖后端。另有用户明确同意后才启用的可选 Cloudflare Worker 代理：

- **API 自动检测**：基于 [AI SDK](https://ai-sdk.dev/)（`ai` + `@ai-sdk/openai`），浏览器直连目标 Endpoint，默认使用 OpenAI **Chat Completions**，也可在配置中选择 **Responses API**。每组最多测试 3 条独立挑战，不再追加补测题；第一份有效回答返回后即展示初步归因。模型归因概率（未四舍五入）达到 99% 时立即成功检验并停止后续题目，否则继续剩余题目。
- **多服务商 / 多模型管理**：每个服务商只需填写一次名称、Endpoint 和 API Key，可配置 1–50 个模型；每个模型独立选择 Chat Completions / Responses API。支持逐行添加、多行粘贴或逗号分隔批量添加，自动去重。左侧按服务商分组，模型行独立显示状态和归因摘要；右侧 61.8% 展示所选模型的结果、前 6 名候选、进度及原始回答。可测试单个模型、整个服务商或一键测全部；所有测试共用最多 2 个并发任务，其余排队，某个模型失败不阻塞其他模型。
- **本地保存**：配置仅保存在当前浏览器的 localStorage（`modeltrace.presets.v2`），旧版单模型配置自动迁移为单模型服务商，成功写入新版后清理旧存储，不自动合并原有服务商。刷新后恢复配置，测试结果仅保留在本次页面会话中。API Key 以明文保存在 localStorage，直连测试时只发送给用户配置的 Endpoint，授权使用代理时也会经过所选 Worker；请勿在共享设备上保存敏感密钥。
- **手动检测**：复制挑战发送给待测模型，任意一份回答达到长度阈值即在浏览器本地自动计算；继续填写其他回答后自动更新结果。切换手动/自动 Tab 不会清空输入或中断正在运行的自动测试。

开发 / 构建需要 **Node.js 22.19+（22.x）或 24.11+（24.x，推荐 LTS）**，也支持 26+；不再支持 Node.js 20。应用源码位于 `web/app/`，`@/` 和 `~/` 均指向该目录；`public/`、配置、脚本和测试仍位于 `web/` 根目录。

```bash
cd web
npm ci
npm run typecheck # Nuxt 4 分离的应用 / 服务端 / 共享 / 构建配置类型检查
npm run dev      # 开发：http://localhost:4200/
npm run build    # 产出 .output
npm run preview  # 构建后本地预览：http://localhost:4200/
npm run generate # 纯静态产物 .output/public，可部署到任意静态托管
```

> 注意：Endpoint 填 API 根地址（例如 `https://api.openai.com/v1`），不要包含 `/chat/completions` 或 `/responses`。浏览器直连要求目标允许跨域（CORS）；HTTPS 页面一般无法请求普通 HTTP 端点。测试会消耗对应服务商的 API 额度。每次请求超时 180 秒；批量直连请求不做 SDK 重试，其他请求最多重试 1 次。401/403 鉴权错误、超时或取消会提前结束该模型的本轮测试；网络/CORS 错误按下文规则回退代理或停止。

### Google Analytics 4 访问统计

前端通过 [Nuxt Google Tag 模块 `nuxt-gtag`](https://nuxt.com/modules/gtag) 接入 **`G-R374H35YTH`**，不用手动复制 `<script>`。项目使用 Nuxt 4 和 `nuxt-gtag` 5.x。配置位于 `web/nuxt.config.ts`，初始化策略位于 `web/app/plugins/analytics.client.ts`。

- `npm run build` / `npm run generate` 的生产产物默认启用；`npm run dev` 不启用。本地 `localhost`、`*.localhost`、IPv4/IPv6 回环地址上的生产预览也不会加载 Google 脚本，避免污染统计。
- 页面挂载后由模块加载 `gtag.js`，每次加载仅主动发送一次 `page_view`；切换手动 / 自动 Tab 不重复计 PV。广告拦截器或 Google 不可达不会阻塞工具功能。
- 应用不为服务商名称、Endpoint、API Key、模型 ID、提示词、回答和检测结果添加埋点。页面 URL 不含 query / hash，referrer 只保留来源 Origin；Google Signals 和广告个性化信号已关闭。
- GA4 控制台的「增强型衡量」可能额外采集自动事件，建议关闭「表单互动」和「站内搜索」，并审阅数据流设置。Google 脚本仍是运行在页面上下文中的第三方代码，不等同于密钥隔离沙箱；对第三方脚本有严格要求时请关闭统计。生产站点会向 Google 发送访问统计并可能使用 Analytics Cookie，请按部署地区完善隐私说明及同意机制；统计与 Worker 代理授权是两回事。

自行部署或 fork 时，可用构建环境变量替换统计 ID 或关闭统计（ID 是公开标识，不是 Secret）：

```bash
cd web
NUXT_PUBLIC_GTAG_ID=G-你的统计ID npm run generate
# 完全禁用统计：
NUXT_PUBLIC_GTAG_ENABLED=false npm run generate
```

GitHub Actions 同样支持这两个 **Repository Variables**，Cloudflare / GitHub Pages 共用同一配置。纯静态站点修改后必须重新构建，单独修改托管平台的运行时变量不会更新已发布页面。上线后可通过浏览器 Network 的 `gtag/js` 请求和 GA4「实时」报告验收。Google 统计不作为 CI 发布门禁，避免统计检查阻塞站点发布。

### 同一服务商测试多个模型

1. 点击「添加服务商」，填写共用的 Endpoint / API Key，在「模型配置」逐个添加模型；也可直接向模型输入框粘贴多行，或用「批量添加」。重复 ID 自动去重（区分大小写），每个模型的请求协议单独选择。
2. 点击左侧模型行查看该模型的详情；行末播放按钮只测试该模型。「测试此服务商」仅测试这一组，「一键测全部」则测试所有服务商的模型。任务排队时会显示「排队中」，批量授权只询问一次并明确显示模型数量。
3. 「管理模型」可继续增删模型。新增模型、改服务商名称不会清空已有结果；修改模型 ID / 协议只清除该模型的结果，修改共享 Endpoint / API Key 会清除整个服务商的结果。运行或排队期间禁止修改相关服务商，避免配置与结果错位。
4. 同名模型在不同服务商下互相独立。删除服务商时会一并删除其全部模型和当前结果；取消编辑不会修改保存的数据。

### 测试通道与代理授权

- **终端 curl（暂时隐藏）**：终端命令生成与粘贴归因的实现仍保留，但当前前端不显示入口，也不会在直连失败或拒绝代理时弹出终端操作。日后可重新启用。终端请求不会由浏览器自动执行。
- **可选 Cloudflare Worker**：仓库 `worker/` 提供 *自行部署的* 受限代理。配置代理 URL 后，点击单个或批量测试按钮会在任何模型请求发出前询问授权，告知密钥、模型 ID、挑战文本将经过 Worker；**用户明确同意后才会转发**。同意后单模型测试直接使用代理，批量测试仍优先直连，并在此浏览器记住对该代理地址的授权，后续测试（含刷新、新服务商与批量）不再询问；可在测试结束后点击「撤销代理授权」。代理地址变化需重新同意。选择「仅本次直连」则当前单个/批量仅直连，CORS 失败不再自动弹窗；关闭弹窗则取消启动。代理不保存 API Key，但运营 Worker 的账户能接触经过它的密钥。

- **批量直连优先**：「一键测全部」和多模型服务商批量测试，会先用实际挑战请求尝试直连，不额外生成探测题。只有网络/CORS 失败才会通过已授权的代理重试**同一道题**，后续题目继续走代理；保持全局并发 2、最多 3 题和 99% 提前停止。可读的 HTTP 鉴权错误、限流、服务端错误、回答数字不足、超时或取消都不会被标记为直连不通，也不会因此自动转发给代理。失败请求可能已经消耗上游额度，代理重试可能额外计费。
- **按模型记住直连失败**：标记保存在当前浏览器的 `modeltrace.direct-failures.v1`，以「服务商 + 模型」的稳定 ID 隔离，不额外存储 API Key 或请求内容。已有配置没有该标记，升级后下次批量也会先尝试直连；已标记的模型在代理已授权时跳过直连。模型行显示「直连不可用」，详情提供「重置直连标记」。修改连接、密钥、模型或协议/采样参数会重置受影响的标记，改名和排序不会；删除模型/服务商会清理标记。标记不等于代理授权，选择「仅本次直连」仍只直连，并可在连接恢复后清除旧标记。浏览器存储不可用时，标记仅在本次会话有效，页面会提示。

#### 部署可选 Worker

```bash
cp worker/wrangler.toml.example worker/wrangler.toml
# 编辑 SITE_ORIGIN（前端部署域名，不含路径）。上游服务商无需预先配置。
# 需 Cloudflare 账户；RATE_LIMITER 必须绑定，未绑定会拒绝全部请求。
npx wrangler deploy --config worker/wrangler.toml
# 获得 Worker URL 后，构建静态站点时指定（URL 必须以 /v1 结尾）：
cd web
NUXT_PUBLIC_PROXY_URL=https://<你的-worker>.workers.dev/v1 npm run generate
```

Worker 不要求配置上游域名白名单，可访问任意公网 HTTPS OpenAI-compatible Endpoint（API 根路径必须以 `/v1` 结尾）。它只代理 `/v1/chat/completions`、`/v1/responses` 的单条非流式 ModelTrace 数值挑战或精确匹配的固定单题诊断，限制请求/响应体积、输出长度和每 IP 请求频率，并拒绝 IP 字面量、常见本地域名、重定向、未知路径与附加工具参数。移除上游白名单会扩大滥用与 SSRF 风险；域名仍可能通过 DNS 指向特殊地址，因此上线前应配置 Cloudflare WAF、每日预算/告警和更严格的账户级限流。未配置 `NUXT_PUBLIC_PROXY_URL` 时，直连失败会显示错误详情，不会展示代理或终端入口。

**本地开发来源**：Worker 除了精确匹配 `SITE_ORIGIN` 配置的生产站点，还额外允许 `http://localhost` / `https://localhost` 的任意有效端口（包括前端默认的 `4200`），无需为切换本地端口重新配置 Worker。`127.0.0.1`、`[::1]`、`*.localhost`、相似域名及带路径的 Origin 不在此例外中。CORS 响应回显已验证的完整 Origin，仍保留强制限流及上游本地地址限制；`SITE_ORIGIN` 和 `RATE_LIMITER` 仍必须配置。修改 Worker 代码后需重新部署才能在线上生效。

### GitHub Actions → Cloudflare Worker / Pages

已提供 `.github/workflows/cloudflare.yml`：PR / 普通分支只做测试、Worker dry-run 和静态构建；开启自动部署后，生产分支 push 会部署 Worker 和 Cloudflare Pages。也可以手动选择 `all`、`worker`、`pages`。首次发布自动创建不存在的 Pages Direct Upload 项目，并校验生产分支；Worker 的 `SITE_ORIGIN` 随部署同步，强制限流绑定保留。

在 GitHub 仓库中添加 Secrets `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`，以及 Variables `CLOUDFLARE_PAGES_PROJECT_NAME`、`SITE_ORIGIN`、`NUXT_PUBLIC_PROXY_URL`、`CLOUDFLARE_DEPLOY_ENABLED=true`。生产分支默认使用仓库默认分支，可用 `DEPLOY_BRANCH` 覆盖；Worker 名称默认 `modeltrace-relay`。然后运行 **Actions → Deploy Cloudflare Worker and Pages**。

静态构建已抽为可复用 workflow，后续迁移 EdgeOne Pages 不需要改造前端。**完整 Token 权限、配置示例、自定义域名、单目标发布及 EdgeOne 扩展方式见 [部署说明](deploy/README.md)。**

### Nginx 纯静态部署包

```bash
cd web
npm ci
npm run package:static
```

生成 `dist/modeltrace-static.tar.gz` 及 SHA-256 校验文件（位于仓库根目录）。包内包含 `site/`、Nginx 配置和部署说明，无需 Node.js 服务。默认使用当前已部署的 Worker URL，支持通过 `NUXT_PUBLIC_PROXY_URL` 在打包时覆盖；站点根路径固定为 `/`。部署新域名时必须同步修改 Worker 的 `SITE_ORIGIN`。详见 [Nginx 部署说明](deploy/nginx/README.md)。

### 自动测试回归检查

安装依赖后，需要本机 Chrome/Chromium。测试使用本地 mock API，不访问真实付费端点；mock 仅用于测试，不属于产品后端。

```bash
cd web
npm run typecheck     # Nuxt 4 严格类型检查
npm run test:core     # 指纹算法、挑战生成、单题规则与 Worker 白名单（无需浏览器）
npm run test:providers # 配置迁移、去重、结果失效范围及全局任务队列（无需浏览器）
npm run build
CHROME_PATH=/usr/bin/google-chrome npm run test:auto # 含多模型浏览器回归
npm run test:terminal # 终端命令 + Worker 边界测试，使用本地 mock，不需真实密钥
# 可选：检查代理同意/拒绝流程（测试脚本使用本地 3244、3245 端口）：
NUXT_PUBLIC_PROXY_URL=http://127.0.0.1:3244/v1 npm run build
npm run test:proxy
npm run test:degradation # 单题检测、隐藏入口开关持久化与代理授权，全部使用 mock
# 检查解压后的 Nginx 包（普通静态文件服务 + mock 代理）：
npm run package:static
npm run test:static
```

覆盖最多 3 题、99% 阈值提前结束（含未四舍五入边界）、结果置顶/分割线、单个与多模型批量测试前代理授权、记住/撤销授权、代理地址隔离、批量直连优先与同题代理回退、存量配置的首次探测、逐模型失败标记/刷新恢复/手动重置和错误分类，以及必填/URL 校验、v1 → v2 迁移、批量模型输入/去重、按模型与服务商测试、同名模型隔离、选择性清除结果、全局单个/批量并发限制、快照与重复点击去重、鉴权失败/数字不足、刷新恢复、Tab 切换保留状态与移动端横向溢出检查。

## GitHub Pages

`static/index.html` 仍保留为旧版手动测试页面。`.github/workflows/pages.yml` 保留 GitHub Pages 发布，并复用 `build-web.yml` 构建 Nuxt 前端。工作流在 `main` 分支相关文件推送或手动触发时生效；设置 Repository Variable `GH_PAGES_ENABLED=false` 可关闭它，不影响 Cloudflare 部署。

默认站点路径为 `/<仓库名>/`（`*.github.io` 仓库为 `/`），可通过 `GH_PAGES_BASE_URL` 覆盖；自定义根域名请填 `/`。指纹库加载路径会跟随 baseURL。代理通过 **`GH_PAGES_PROXY_URL`** 配置，留空则仅直连，不再内置个人 Worker 地址。这个变量与 Cloudflare 的 `NUXT_PUBLIC_PROXY_URL` 分开，避免不同站点误用仅授权单一来源的 Worker。

本仓库的 GitHub Pages 地址为 `https://hanmo123.github.io/ModelTrace/`；需在 GitHub 仓库 Settings → Pages 中将部署来源设为 **GitHub Actions**。

**部署前需同步 Worker 来源**：GitHub Pages 的 Origin 是 `https://hanmo123.github.io`，不包含 `/ModelTrace/`。可设置 `SITE_ORIGIN` 并手动运行 Cloudflare workflow 的 `worker` 目标，或在本地修改 `worker/wrangler.toml` 后手动发布。仅发布静态页面不会自动修改 Worker 来源，配置不匹配会返回 403。Worker 的生产来源仍只支持一个精确 Origin（另外允许 HTTP(S) localhost 任意有效端口）；若同时保留 Cloudflare Pages 和 GitHub Pages 的代理功能，需要分别部署 Worker。

## 使用

- **手动测试**：复制三条挑战，分别发送给同一个待测模型，再粘贴每次完整输出。
- **API 自动测试**：填写 Base URL、API Key 和模型名。程序会自动尝试 OpenAI Chat Completions 与 Anthropic Messages 格式，以三份有效回答为目标完成归因。
- **指纹库管理**：可以新建指纹库，或通过 API 为现有指纹库添加模型指纹。

API Key 只用于当前页面发起请求，不写入磁盘。
自动采集会在对应的 `*_reference.jsonl` 中保存实际 user prompt、base prompt、system prompt 和 user prefix；拟合后的 `*_bank.json` 与 `unified_bank.json` 只保存统计指纹和校准参数。

## 指纹方法

### Codex 任务内监测插件

[ModelTrace Guard](codex-plugin/modeltrace-guard/README.md) 按工具调用次数，在后台从原 Codex 任务的冻结快照分别 fork 进行普通检测和异常复测，测后清理临时分支。正常结果静默保存，主任务无需等待检测。用户可调整工具间隔、复测次数（默认 3）、有效期和十种语言，不设每轮或任务累计探针上限。网页仪表盘提供完整历史分页和实时提醒；首次不一致要求智能体告知并暂停工作，额外复测全部不一致时停止原任务并拦截后续受支持的工作工具。探针由 Codex 自身生成并消耗对应推理额度，评分使用插件附带的 ModelTrace 指纹库，页面刷新不消耗模型额度。

安装后在 Codex CLI 的 `/hooks` 中审阅并信任插件 hooks，再在目标任务中开启监测。安装、配置和结果解释详见[插件使用说明](codex-plugin/modeltrace-guard/README.md)。

### 核心算法

所有模型使用同一个全局特征空间、同一套特征与权重：

```text
0.75 × 去除环境方向后的 Hellinger 模型中心相似度
+ 0.25 × 有序块数字序列特征
```

建库时使用共享环境的平均偏移估计主要干扰方向。归因时先从数字分布和有序特征中投影掉这些方向，再同时与全部模型中心比较。三份回答分别评分后取平均，并使用与查询数量对应的校准温度转换为概率。

具体模型概率由一次全局 softmax 得到，家族概率是该家族下各模型概率之和：

```text
P(具体模型) = softmax(β × 全局模型得分)
P(模型家族) = Σ P(该家族中的具体模型)
```

结果是当前候选库内、均匀先验下的闭集概率。未收录模型仍会被归到最相似的现有候选。

## 项目结构

```text
app.py              Web 接口
fingerprint.py      指纹提取与归因
bank_builder.py     指纹库构建与概率校准
challenge_suite.py  自动建库挑战
enrollment.py       API 调用与指纹采集
rebuild_unified_bank.py  重建统一全局库
data/               参考数据与指纹库
static/             页面资源
templates/          页面模板
web/                Nuxt 4 纯前端新版界面（SPA + Tailwind + shadcn-vue）
  app/              应用入口、页面、布局、组件、composables、lib、插件与样式
  public/           原样发布的静态资源与指纹库
  tests/            本地 mock 与浏览器回归测试
```

## 指纹库说明

项目中现有指纹库共包含两个模型家族、16 个模型：

```
gpt-5.4
gpt-5.5
gpt-5.6-luna
gpt-5.6-terra
gpt-5.6-sol
gpt-6-astra
gpt-6-sol
gpt-6-luna
claude-haiku-4-5-20251001
claude-sonnet-4-6
claude-sonnet-5
claude-opus-4-6
claude-opus-4-7
claude-opus-4-8
claude-opus-5
claude-opus-5-5
```

GPT 采集自官方订阅 Codex，Claude 采集自 [OAIPro](https://api.oaipro.com/)。

## 声明

测试结果仅供参考，并非判断模型的决定性证据

注意该项目为归因工具，只对指纹库内的模型尽可能去判断属于哪种模型，若待测模型不在指纹库中，得到任何结果都是有可能的

目前已知因系统提示词严重影响模型偏好，在Claude Code中得到的测试结果存在较大偏差，建议不要在Claude Code中测试

## 致谢

感谢 [hanlinwenyuan/hlwy-ai-checker](https://github.com/hanlinwenyuan/hlwy-ai-checker)。该项目较早将语言模型的随机数字生成偏差用于第三方 API 渠道一致性检查，为 ModelTrace 提供了重要参考。



[LINUX DO](https://linux.do/)
