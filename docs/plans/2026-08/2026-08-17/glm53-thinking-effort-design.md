# GLM-5.3 思考档位适配设计（Proma）

## 背景

Proma 里 GLM-5.3 的思考配置只有「关/开」两档（`GLM_53_LEVELS = ['off','high']`），输入框 UI 上表现为单纯开关，而其他模型（GLM-5.2、Kimi K3、OpenAI 系）都有多档位滑条。这是上游 #1708 基于当时「GLM-5.3 官方端点只支持思考开关，不接受 reasoning_effort」的结论做的限制。

## 实测结论（2026-08-17，智谱官方端点 + glm-5.3）

用真实 key 直测两个端点，推翻上述过时结论：

| 端点 | 思考档位 | 依据 |
|---|---|---|
| Anthropic 兼容（`open.bigmodel.cn/api/anthropic`） | `thinking:{type:'adaptive',effort}` 的 low/medium/high/max 全部 200 且返回思考块 | Dogear 生产环境正在用 adaptive+high 跑 glm-5.3 |
| OpenAI Chat（`open.bigmodel.cn/api/paas/v4`） | `reasoning_effort` 合法值为 low/high/max | 无效值 medium 报 400，错误信息「请使用 low、high 或 max」 |
| OpenAI Responses（`open.bigmodel.cn/api/v1`，新增） | `reasoning.effort` 的 minimal/low/medium/high/max 全部 200，输出长度随档位单调递增（effort 真实生效） | 直测；glm-5.2 同样可用 |

注意：同一 key 在 OpenAI Chat 端点对 glm-5.3 可能返回 403（订阅类 key 仅 Anthropic 端点开放），这是权限差异，不影响参数层结论。

## transport 识别机制（调研确认）

Proma 按**渠道 provider 类型静态映射**协议（`inferReasoningTransport`，reasoning-profile.ts:17-28），不嗅探 baseUrl：

| 渠道 provider | transport | 对应智谱端点 |
|---|---|---|
| zhipu（API 版，按量计费） | openai-completions | `/api/paas/v4` |
| zhipu-coding（Plan 版） | anthropic-messages | `/api/anthropic`（channel.ts:56） |
| zhipu-coding-team（团队版） | anthropic-messages | `/api/anthropic`（channel.ts:57） |
| doubao / qwen / custom | openai-completions | — |
| anthropic-compatible（自定义请求地址） | anthropic-messages | 可配 `/api/anthropic` |
| openai-responses（自定义请求地址） | openai-responses | 可配 `/api/v1`（Responses 模式） |

三个 zai 渠道版本均被方案自动覆盖：API 版用 openai-completions encoding，Plan/团队版共用 anthropic-messages encoding。

`resolveReasoningProfile` 要求 profile 的 `encodings[transport]` 存在才返回 profile——现状 GLM_53_PROFILE 没有 openai-responses key，走 `/api/v1` 渠道时整个 profile 不命中，UI 完全没有思考选项。

## 目标

GLM-5.3 在输入框 UI 呈现 off/低/中/高/最大 五档滑条（与其他模型体验一致），档位真实映射到端点参数。

## 架构

照 GLM-5.2 的现成 profile 模板（`reasoning-profile.ts:263-272`），只改声明层，UI 与请求层自动跟随：

- **档位**：`['off','high']` → `['off','low','medium','high','max']`（方案 A：全五档；OpenAI Chat 端点的 medium 降级为 high，与 GLM-5.2 的档位压缩先例一致）
- **anthropic transport**：encoding `anthropic-manual` → `adaptive-effort`，effortMap：low→low、medium→medium、high→high、xhigh/max→max（全原生）
- **openai-completions transport**：encoding `zai-toggle` → `zai-thinking-effort`，effortMap：low→low、medium→high（降级）、high→high、xhigh/max→max
- **openai-responses transport（新增）**：encoding `openai-reasoning-effort`（OPENAI_STANDARD_PROFILE 同款 kind），effortMap：low→low、medium→medium、high→high、xhigh/max→max（Responses 端点档位最全，全原生映射）
- **normalize**：off→off；max/xhigh→max；low/medium/high 原样；undefined→high（兼容旧会话）
- **defaultLevel**：保持 `'high'`

## 模块边界

| 文件 | 改动 |
|---|---|
| `packages/shared/src/types/reasoning-profile.ts` | 核心：GLM_53_LEVELS 五档、三个 transport 的 effortMap（替换原 GLM_53_THINKING_LEVEL_MAP）、normalizeGlm53Level、GLM_53_PROFILE.encodings 三 key、删 encoding kind 类型 `'zai-toggle'`/`'anthropic-manual'`、更新过时注释 |
| `apps/electron/src/main/lib/adapters/pi-model-registry.ts` | 删除 `zai-toggle`（:125-133）与 `anthropic-manual`（:135-137）两个 compile 分支（GLM-5.3 是唯一使用者，改后无引用） |

UI（AgentView 滑条）、请求组装（agent-orchestrator）、pi-ai 编码层均零改动。

## 数据流

用户拖动滑条 → `AgentSessionMeta.reasoningLevel` 持久化 → 下一轮 `resolvePiThinkingLevel` 经 profile 归一化 → `sdk.createAgentSession({thinkingLevel})` → pi-ai 按 transport 编码：
- anthropic：`thinking:{type:'adaptive', effort}`（`mapThinkingLevelToEffort`，anthropic-messages.js:593-623）
- openai-completions：`thinking:{type:'enabled'}` + `reasoning_effort`（openai-completions.js:560-570）
- openai-responses：`reasoning:{effort}`（openai-reasoning-effort kind 编译为 `supportsReasoningEffort:true`）

## 错误处理 / 边界情况

- **旧会话兼容**：现有 glm-5.3 会话 reasoningLevel 只会是 off/high，都在新档位集合内，normalize 无损
- **OpenAI 端点 medium**：映射为 high，不会发出无效值（实测 medium 会 400）
- **off 档**：两个 encoding 下 pi-ai 均发 `thinking:{type:'disabled'}`（anthropic 端点实测不带思考也 200；OpenAI 端点保持现状行为）
- **非官方渠道**（ark-coding-plan 等 openai 兼容端点）：zai-thinking-effort 发送的 `reasoning_effort` 若端点不支持会怎样——与 GLM-5.2 行为一致，不额外兜底
- **off 档在 Responses 端点**：pi-ai off 时不发 reasoning 字段，`/api/v1` 实测无 reasoning 字段 200 ✅

## 未决问题

- 无（档位集合已拍板方案 A，实测数据齐全）

## 实施结果

- 分支 `feat/glm53-thinking-effort`，commit `99c04608`（2 文件 +33/-24），typecheck 全绿、489 测试通过（1 个 fail 为 main 既有问题）
- 运行时验证：三 transport 的 normalize+effortMap 映射全部符合设计；glm-5.2/gpt-5.6 无回归
- 端到端验收（dev 实测）：Plan 版渠道（/api/anthropic）滑条「低」→ 请求体 `thinking:{type:'adaptive',effort:'low'}`（经本地透传代理抓包确认），响应正常
- 验收工具：`docs/plans/2026-08/2026-08-17/glm-verify-proxy.py`（本地透传代理，多线程版）

## 实施方式

在 `/c/proma` 从最新 main 拉分支 `feat/glm53-thinking-effort`，改完 `bun run lint` + tsc 验证。
