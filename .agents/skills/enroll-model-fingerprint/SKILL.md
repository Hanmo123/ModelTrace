---
name: enroll-model-fingerprint
description: 为 ModelTrace 收集并录入新模型的数字指纹。用户提供 API 地址、密钥和模型 ID，要求采集指纹、给指纹库添加模型、续采缺失样本、重建统一库或校验入库结果时使用。覆盖 36 条标准挑战、质量检查、精确路由、家族注册、交叉验证及网页/TUI/插件数据同步。
compatibility: 在 ModelTrace 仓库中使用；Python 3.10+、requirements.txt 依赖及 Node.js，浏览器核心测试还需 web 依赖。
---

# 录入模型指纹

按用户授权的范围完成采集、入库、同步和验证，不只返回计划。保留工作区内与任务无关的改动。此 skill 位于项目的 `.agents/skills/enroll-model-fingerprint/`；所有 `scripts/...` 路径相对此目录，仓库根目录为 `../../..`。先读取本文件，再按需读取或运行附带脚本。

## 1. 确定采集身份和范围

区分以下字段，不能混用：

| 字段 | 含义 | 示例 |
| --- | --- | --- |
| `base_url` | API 根地址，保留其路径前缀 | `https://api.example.com/v1` |
| `api_model` | 原样发送的完整模型 ID，包括路由参数 | `deepseek-v4.1-flash::only=DeepSeek,nofallback` |
| `model_label` | 指纹库中的稳定候选标签 | `deepseek-v4.1-flash` |
| `family` / `family_name` | 家族 ID / 展示名 | `deepseek` / `DeepSeek` |
| `provider` | 实际采集来源，仅在私有检查点保存；公开副本使用 `api` | `example-provider` |
| `temperature` | 用户指定的采样参数，否则采用服务商默认值 | `provider_default` |

- 用户已给出的信息直接使用。只在无法推断的必要字段缺失时询问，不重复索要密钥或已经授权的普通采集确认。
- 精确保留用户指定的 `only`、`nofallback`、模型版本和 API 协议。不能去掉后缀、切换渠道或回退到另一模型来凑样本。
- 密钥只通过已有环境变量、隐藏输入或受控标准输入交给采集进程；不用 `--api-key <secret>`，不写入脚本、仓库、报告、日志或 README，不打印请求头或上游原始错误体。
- 用户提供的私有服务商域名、接入地址和渠道标识只保留在仓库外的私有检查点，示例使用占位域名。提交公开参考数据时将 `api_base_url` 设为 `null`、`provider` 设为 `api`，并添加 `source_redacted: true`；同步更新 bank 的来源列表，保持数字、提示词和模型 ID 不变。提交前扫描整个暂存树，包括文档、skill、参考数据和生成副本。脱敏副本不能用于断点续采，`--resume` 和完整采集身份校验使用私有原始检查点。
- 默认使用 `challenge_suite.fingerprint_suite()` 的整套 36 条挑战：12 种环境，每种 3 条，约 1.06 万个请求数字。36 是回答数，不是数字数。保持原题目、system 前缀、user 前缀和环境 ID，不额外注入智能体的系统提示词。
- 36 条用于建立与现有模型规格一致的基础指纹。不要将同一回答中的数字视为独立样本，也不要承诺 36 条足以证明跨时间、跨服务商的准确率。
- 用户明确要求更多样本或独立评估时再按其范围扩展。独立测试回答与训练 JSONL 分开保存；不能先加入训练再称为独立验证。多轮采集需要独立轮次标识与按轮次/环境分组的验证，不能复用挑战 ID 直接追加后沿用现有校准器。

## 2. 检查项目和依赖

先读 `git status --short`，以及当前版本的 `challenge_suite.py`、`enrollment.py`、`bank_builder.py`、`rebuild_unified_bank.py`、`app.py`。查看已有家族参考文件，确定是新增家族还是向现有家族添加型号。

使用可用的 Python；仓库可能只有 `python3`。优先复用 `.venv/bin/python`，缺依赖时创建虚拟环境并安装 `requirements.txt`。`venv` 缺少 `ensurepip` 时处理对应的系统组件或使用现有环境，不在全局 Python 中盲目安装依赖。

以下命令从仓库根目录运行；将解释器替换为实际可用路径：

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

## 3. 在临时目录采集，可断点续采

附带的 `scripts/collect.py` 支持 **OpenAI Chat Completions**。它复用项目题库、数字解析器和标准行结构，但补充实际响应模型、路由、用量和耗时。用户要求 Anthropic Messages、Responses API 或原生 Codex 采集时，适配对应传输，保留下面相同的题目和校验契约；不要假称该脚本支持这些协议。

脚本先用第一条正式挑战验证连接；该回答直接计入 36 条。后续最多并发 2，每题最多尝试 3 次；不可重试的 HTTP 错误会停止后续任务。失败保留已成功的检查点，不写指纹库。成功结果逐条落盘，完成后才允许导入。

示例中只有公开路由和标签；密钥需已放入 `MODELTRACE_API_KEY`。没有环境变量时，脚本可从交互终端隐藏读取；智能体也可通过 `--api-key-stdin` 传入已有密钥。

```bash
SKILL_DIR="$PWD/.agents/skills/enroll-model-fingerprint"
COLLECTION_DIR="$(mktemp -d "${TMPDIR:-/tmp}/modeltrace-enroll.XXXXXX")"
.venv/bin/python "$SKILL_DIR/scripts/collect.py" \
  --base-url 'https://api.example.com/v1' \
  --api-model 'deepseek-v4.1-flash::only=DeepSeek,nofallback' \
  --model-label 'deepseek-v4.1-flash' \
  --family deepseek --family-name DeepSeek --provider example-provider \
  --output "$COLLECTION_DIR/reference.jsonl"
```

- API key 不从该示例继承；每次使用用户为本次任务提供或授权的凭据。
- 将示例中的身份参数全部替换为本次目标。温度只有明确指定时才加 `--temperature`，不要擅自调整 thinking / reasoning 参数来提高通过率。
- 长任务使用当前工具支持的后台执行和进度日志；记录进程与临时目录，至少每分钟给一次简短进度。不因单次工具超时而重复启动整批请求。
- 部分失败：相同参数、相同文件加 `--resume`。脚本校验已有行的身份、题目和参数，只请求缺失的题；参数不匹配则拒绝续采。
- 全套验证：相同参数加 `--verify-only`，不会读取密钥或发 API 请求。即便文件已存在，完整的 36 条才算成功。

每条回答必须满足以下质量要求：

1. 保留未修正的原始 `text`，用 `fingerprint.parse_numbers` 解析；不得自己生成、补齐、裁剪、排序或改写数字。
2. 有效数字达到项目最低门槛，并处于请求数量的 80%～120%。原始数字应与解析序列一致，没有额外数字、越界值、负数、小数或指数表示。
3. 拒绝明确截断或过滤的回答、重复回答、重复的连续 12 数字区块、连续 10 项等差序列等明显规则化输出。记录判定规则；这些启发式检查不是随机性证明。
4. 同一批有 36 个唯一题目、唯一行 ID 和唯一输出，12 个环境各 3 条。续采后重新检查全套覆盖率。
5. 保留 `prompt`、`base_prompt`、`system_prompt`、`user_prefix`、`condition_id`、`wrapper_transport`、`requested_count`、`parsed_count`、`temperature`、`collected_at`、`provider`、`api_model`、`api_base_url`、`response_model`、`finish_reason`、`usage` 和耗时。
6. 上游返回的 `response_model` 是审计信息，可能只是回显请求，不能据此证明真实后端身份。不能以“分类器没有预测成预期模型”为理由丢弃合格回答。

## 4. 导入并注册家族

完整验证后，将临时 JSONL 中的 36 行按挑战 ID 排序，追加到 `data/<family>_reference.jsonl`。导入前检查所有家族中的目标标签：标签必须全局唯一，不能跨家族重复。如果已经存在，不能默认重复追加或覆盖。新模型应只有一套标准 36 行；替换已有指纹必须符合用户授权，保留其他型号的数据。

本次采集文件只包含目标模型。先完整验证并保留私有原始检查点，再制作公开副本：移除私有接入地址和渠道标识，仅对来源元数据脱敏，保留原始输出和模型路由。下面的导入模板自动完成该脱敏；参数依次为采集文件和家族参考文件，已有同标签数据会中止：

```bash
.venv/bin/python - "$COLLECTION_DIR/reference.jsonl" 'data/<family>_reference.jsonl' <<'PY'
import json, sys
from pathlib import Path
source, target = map(Path, sys.argv[1:])
rows = [json.loads(line) for line in source.read_text(encoding="utf-8").splitlines() if line]
labels = {row["source"] for row in rows}
assert len(rows) == 36 and len(labels) == 1
assert len({row["challenge_id"] for row in rows}) == 36
assert all(row["strict_valid"] and row["pattern_valid"] for row in rows)
existing = [json.loads(line) for line in target.read_text(encoding="utf-8").splitlines() if line] if target.exists() else []
assert not any(row["source"] in labels for row in existing), "Target model already exists"
rows.sort(key=lambda row: row["challenge_id"])
with target.open("a", encoding="utf-8") as handle:
    if target.stat().st_size and not target.read_bytes().endswith(b"\n"):
        handle.write("\n")
    for row in rows:
        row = {**row, "api_base_url": None, "provider": "api", "source_redacted": True}
        handle.write(json.dumps(row, ensure_ascii=False) + "\n")
PY
```

新增家族时，注册 `app.py::builtin_configs()` 和 `rebuild_unified_bank.py::SOURCES`，使用正确的家族名和文件路径。现有家族无需重复注册。检查 `data/custom_banks.json`（如存在）是否与新 ID 冲突，避免自定义配置覆盖内置配置。

更新与数据有关的回归覆盖：

- `codex-plugin/validate-reference-data.mjs`：加入需要加载的新家族、目标型号和来源约束；脱敏公开副本的 `provider` 为 `api`。有依据时才要求精确 `response_model`。
- `web/tests/bank-test.mjs`：加入新型号样本、家族、环境数量、模型排序及浏览器识别检查。
- `.github/workflows/plugin-tests.yml`：让新参考文件的变动触发校验。
- `README.md`：按实际库内容更新家族数、模型数、型号列表和已授权公开的来源信息，不出现密钥或用户的私有接入域名。

## 5. 完整重拟合、报告交叉验证并同步

不能只向旧 bank JSON 追加一条模型记录。新增候选改变全局特征空间，必须重新计算所有模型中心、环境投影、有序块特征和 1/2/3 条回答的校准参数。

注册和导入完成后运行：

```bash
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 \
  .venv/bin/python "$SKILL_DIR/scripts/rebuild.py" \
  --family '<family>' --model '<model_label>' \
  --report "$COLLECTION_DIR/validation.json"
```

脚本根据当前 `SOURCES` 拟合目标家族库和统一库；在全局拟合时复用同一轮交叉验证记录，保存目标型号的正确数、总数、误判去向、其他型号误报为它的数量和全局校准结果。无需额外付费请求。`--dry-run` 只计算并写临时报告，不修改 bank 或客户端副本。

成功后这些文件必须一致：

- `data/unified_bank.json`：统一源文件。
- `static/data/unified_bank.json`：旧网页。
- `web/public/data/unified_bank.json`：Nuxt 静态资源，也是 TUI 下次构建的数据源。
- `codex-plugin/modeltrace-guard/assets/unified_bank.json`：通过 `node codex-plugin/build-plugin.mjs` 同步，并更新 `assets/provenance.json` 的哈希、模型数和时间。

TUI 已有 `dist/` 或已发布站点不会随源数据自动更新；用户要求运行产物更新时，执行相应构建。没有部署或安装授权时，完成仓库文件和验证即可，不自动发布、不使用 `--deploy-personal`。

## 6. 验证与交付

从仓库根目录运行与本次入库直接相关的检查：

```bash
node codex-plugin/validate-reference-data.mjs
node codex-plugin/validate-distribution.mjs
npm --prefix web run test:core
MODELTRACE_PYTHON="$PWD/.venv/bin/python" node codex-plugin/verify-parity.mjs
node --test --test-concurrency=1 codex-plugin/modeltrace-guard/tests/*.test.mjs
git diff --check
```

另检查 Python/Flask 能列出新家族和型号、读取家族库、识别已保存样本；确认所有统计向量有限且维度一致、模型排序一致、各副本字节和 provenance 哈希一致。扫描本次新增/修改文件，确认没有凭据。离线回归不需要再次调用用户接口；全部通过后不重复跑全套。

Skill 自身的采集脚本可用完全离线的模拟请求回归检查：

```bash
.venv/bin/python -m unittest discover -s "$SKILL_DIR/tests" -v
```

最终用用户的语言报告：目标调用 ID、有效回答数/数字数/环境数、文件位置、加入后的模型数、校验结果和已知限制。涉及准确率时写清是训练样本回放、留出交叉验证还是独立测试，给出分子/分母；重叠的双题组合和同批样本不是独立试验，100% 的小样本成绩不保证未来准确率。缺样、校准缺失或测试失败必须具体说明，不能宣布完整入库成功。
