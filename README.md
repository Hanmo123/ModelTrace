# ModelTrace

ModelTrace 是一个本地运行的主动模型归因工具。它通过三条独立的长整数生成挑战提取输出指纹，在统一候选库中自动判断模型家族和具体版本。

## 运行

```powershell
python -m pip install -r requirements.txt
python start.py
```

页面地址为 `http://127.0.0.1:7860/`。

## Nuxt 3 新版前端（web/）

`web/` 是基于 Nuxt 3（纯 SPA，`ssr: false`）+ Tailwind CSS + shadcn-vue 重新设计的前端；默认在浏览器本地运行，不依赖后端。另有用户明确同意后才启用的可选 Cloudflare Worker 代理：

- **API 自动检测**：基于 [AI SDK](https://ai-sdk.dev/)（`ai` + `@ai-sdk/openai`），浏览器直连目标 Endpoint，默认使用 OpenAI **Chat Completions**，也可在配置中选择 **Responses API**。每组最多尝试 6 条独立挑战，以收集 3 份有效回答为目标；第一份有效回答返回后即展示初步归因，后续回答自动更新结果。
- **多服务商管理**：名称、Endpoint、API Key、模型 ID 四项必填，支持新增、编辑、删除。左侧为服务商列表，右侧 61.8% 展示选中服务商的进度、每题提示词与原始回答、错误信息及前 6 名匹配分布。支持单个测试和一键测全部（批量并发 2），某个服务商失败不会阻塞其他任务。
- **本地保存**：配置仅保存在当前浏览器的 localStorage（带版本 schema），刷新后恢复；测试结果仅保留在本次页面会话中。API Key 以明文保存在 localStorage，测试时只发送给用户配置的 Endpoint，无后端中转，请勿在共享设备上保存敏感密钥。
- **手动检测**：复制挑战发送给待测模型，任意一份回答达到长度阈值即在浏览器本地自动计算；继续填写其他回答后自动更新结果。切换手动/自动 Tab 不会清空输入或中断正在运行的自动测试。

```bash
cd web
npm install
npm run dev      # 开发
npm run build    # 产出 .output（node .output/server/index.mjs 预览）
npm run generate # 纯静态产物 .output/public，可部署到任意静态托管
```

> 注意：Endpoint 填 API 根地址（例如 `https://api.openai.com/v1`），不要包含 `/chat/completions` 或 `/responses`。浏览器直连要求目标允许跨域（CORS）；HTTPS 页面一般无法请求普通 HTTP 端点。测试会消耗对应服务商的 API 额度。每次请求超时 180 秒，SDK 最多重试 1 次；401/403 鉴权错误或网络错误会提前结束该服务商的本轮测试。

### 浏览器直连失败时

- **终端 curl（无需中转）**：自动测试详情点「终端方式」，按 Linux/macOS、PowerShell、CMD（先进入 PowerShell）复制命令。当前终端会话先隐式输入 API Key；密钥不嵌入命令或 shell 历史（但运行期间可能短暂出现在 `curl` 进程参数中）。命令在终端直连所填 Endpoint，默认从 Chat/Responses JSON 中提取回答（Linux/macOS 需 Python 3）；也可选原始 JSON 模式（仅需 curl），粘贴回页面由浏览器解析。输出会尝试写入系统剪贴板，失败时仍在终端打印。任意一份达到阈值即在本地显示概率；终端请求需要用户手动执行，不能批量自动运行。
- **可选 Cloudflare Worker**：仓库 `worker/` 提供 *自行部署的* 受限代理。当浏览器直连出现网络/CORS 错误，且部署时配置了代理 URL，页面会先弹窗告知密钥、模型 ID、挑战文本将经过 Worker；**用户明确同意后才会转发**。拒绝后打开终端模式。批量失败不自动同意代理，用户可在单个服务商详情中决定。代理不保存 API Key，但运营 Worker 的账户能接触经过它的密钥。

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

Worker 不要求配置上游域名白名单，可访问任意公网 HTTPS OpenAI-compatible Endpoint（API 根路径必须以 `/v1` 结尾）。它只代理 `/v1/chat/completions`、`/v1/responses` 的单条非流式 ModelTrace 数值挑战，限制请求/响应体积、输出长度和每 IP 请求频率，并拒绝 IP 字面量、常见本地域名、重定向、未知路径与附加工具参数。移除上游白名单会扩大滥用与 SSRF 风险；域名仍可能通过 DNS 指向特殊地址，因此上线前应配置 Cloudflare WAF、每日预算/告警和更严格的账户级限流。未配置 `NUXT_PUBLIC_PROXY_URL` 时，界面不会声称存在已部署的代理，只提供终端备用通道。

### 自动测试回归检查

安装依赖后，需要本机 Chrome/Chromium。测试使用本地 mock API，不访问真实付费端点；mock 仅用于测试，不属于产品后端。

```bash
cd web
npm run build
CHROME_PATH=/usr/bin/google-chrome npm run test:auto
npm run test:terminal # 终端命令 + Worker 边界测试，使用本地 mock，不需真实密钥
# 可选：检查代理同意/拒绝流程（测试脚本使用本地 3244、3245 端口）：
NUXT_PUBLIC_PROXY_URL=http://127.0.0.1:3244/v1 npm run build
npm run test:proxy
```

覆盖四项必填/URL 校验、增删改与 localStorage 恢复、Chat/Responses SDK 请求、首份回答出结果、批量并发/排队、鉴权失败/数字不足、Tab 切换保留状态与移动端横向溢出检查。

## GitHub Pages

`static/index.html` 仍保留为旧版手动测试页面。GitHub Actions 的 `.github/workflows/pages.yml` 现已改为将 Nuxt 前端 `web/.output/public` 部署到 GitHub Pages；构建时设置 `NUXT_APP_BASE_URL=/ModelTrace/` 和 `NUXT_PUBLIC_PROXY_URL=https://llm-iq-proxy.hanmo5888.workers.dev/v1`。指纹库加载路径会跟随 baseURL。工作流在 `main` 分支推送或手动触发时生效。

**部署前需同步 Worker 来源**：目前部署在 `llm-iq-proxy.hanmo5888.workers.dev` 的 Worker 只允许 `http://localhost:3002`（预检为 204），而正式页面 `https://xqy2006.github.io/ModelTrace/` 的 Origin 是 `https://xqy2006.github.io`（目前预检为 403）。先在本地 `worker/wrangler.toml` 把 `SITE_ORIGIN` 改为 `https://xqy2006.github.io`，然后重新执行 `npx wrangler@latest deploy --config worker/wrangler.toml`；若只在本地测试，则应保持 `SITE_ORIGIN=http://localhost:3002` 并用这个主机名和端口打开页面。Worker 当前只支持一个来源；无需配置上游域名白名单。

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
web/                Nuxt 3 纯前端新版界面（SPA + Tailwind + shadcn-vue）
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
