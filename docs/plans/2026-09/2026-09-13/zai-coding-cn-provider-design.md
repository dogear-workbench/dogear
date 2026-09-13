# GLM Coding Plan（zai-coding-cn）线协议接入 设计

**背景**：pi 官方接 GLM Coding Plan 走 `/login zai-coding-cn` + API Key（非 OAuth，本质是选内置 provider + 存 key）。pi-ai 库已内置 `zai-coding-cn` provider（模型目录完整、baseUrl `https://open.bigmodel.cn/api/coding/paas/v4`、openai-completions 协议、cost 全 0），但 Dogear 的模型配置链路不支持 openai-completions 线协议，用户无法配置 Coding Plan 端点的 Profile。

**目标**：让用户能新建「GLM Coding Plan」模型方案：baseUrl 填 `/api/coding/paas/v4`、上游协议选 openai-completions、填套餐 Key，即可用套餐额度跑 glm-4.7 / glm-5.x 系列模型。

**架构**（核心做法 + 排除的选项）：
- `ModelProfile.piWireApi` 联合类型加 `'openai-completions'`（types/settings.ts + electron/main/services/settings-types.ts 双侧镜像）
- `pi/provider.ts`：`buildPiModels` 加 `openAICompletionsApi()` 分支（`@earendil-works/pi-ai/api/openai-completions.lazy`，无参调用，用法与现有两个 API 一致）；`resolveWireApi` / `lookupCatalogModel` 类型与分支同步扩展；openai-completions 的 catalog lookup 查 `ZAI_CODING_CN_MODELS`（拿 reasoning 标记；目录无 thinkingLevelMap，effort 由 compat.thinkingFormat: "zai" 在 API 层处理）
- 设置页模型方案 tab「上游协议」下拉加第三项

**排除的选项**：
- ~~model-catalog.ts 收录 ZAI_CODING_CN_MODELS~~：与已收录的 ZAI_MODELS 模型 ID / contextWindow / maxTokens 完全一致（唯一差异 baseUrl 国际版 vs 国内版），查表零增益，不动
- ~~直接用 pi-ai 内置 zaiCodingCnProvider~~：其 auth 走环境变量（envApiKeyAuth），Dogear 的 key 存 settings.json 走 createProvider 自定义 auth，现有体系更合适
- ~~lib/pi-model-catalog.ts 渲染层镜像加目录~~：同查表零增益理由

**模块边界**：4 文件——`types/settings.ts:16`、`electron/main/services/settings-types.ts:25`、`electron/main/agents/pi/provider.ts`、`app/settings/page.tsx:652`（select + onChange 断言 + 说明文案）。`settings-diff.ts:60` 为宽泛值比较，新值自动兼容，零改动。

**数据流**：用户配 Profile（baseUrl=/api/coding/paas/v4 + openai-completions + 套餐 Key + 模型清单 glm-4.7 等）→ resolvePiModel → buildPiModel（catalog 查 ZAI_CODING_CN_MODELS 得 reasoning）→ buildPiModels 构造 openAICompletionsApi Provider → pi agent loop。

**错误处理 / 边界情况**：
- 存量 Profile 不受影响（联合类型加值向后兼容，缺省仍是 anthropic-messages）
- contextWindow 查表：glm-4.7=204800 / glm-5.2=1M 已在目录，识别不到可手填（现有机制）
- Key 无效 / 套餐过期：沿用 pi 上游报错透传，无额外处理

**未决问题**：
- Coding Plan Key 是否也能在现有 `/api/anthropic` 端点走套餐额度（智谱给 Claude Code 的官方路径）——用户后续自行验证；若可行则现有 GLM Profile 换 Key 即可零改动使用套餐，本接入作为 openai-completions 协议的完整补齐仍然保留
- MCP 联网工具（web-mcp 包）已独立可用，与本次改动无耦合（Key 同源但不共享配置字段）

**分步骤决策**：不分步骤。4 文件均为几行级线性修改，无中间验收点、无数据迁移，一锅出 + 完整 build / lint 验证。

---

## 附：通用上游模型列表拉取（同日追加）

**需求**：模型清单手敲 ID 繁琐；提供「从上游拉取」通用能力，拉回后用户勾选启用，未勾不进清单（与手填语义对齐）。

**实现**：
- `electron/main/tipc/settings.ts` 新增 `fetchUpstreamModels(baseUrl, apiKey, piWireApi)`：anthropic-messages 走 `GET {baseUrl}/v1/models?limit=1000`（x-api-key + anthropic-version，baseUrl 已含 /v1 时不重复拼）；openai-responses / openai-completions 走 `GET {baseUrl}/models`（Bearer）。15s 超时，解析 `data[].id/display_name`，按 id 排序。只探测不落盘。
- `app/settings/FetchModelsDialog.tsx`（新组件）：勾选式弹窗——已在清单的行置灰标「已在清单」，未识别窗口查表徽标（命中 204.8K / 1M，未命中「未识别」），确认后仅勾选项合入 piModels。
- `app/settings/page.tsx`：模型清单标题行加「从上游拉取」按钮（loading 转圈），拉回打开弹窗；合并去重后 toast。

**通用性**：覆盖三种线协议，任何 openai / anthropic 兼容网关（GLM Coding Plan、DeepSeek、Moonshot、Anthropic 官方等）均可拉取。
