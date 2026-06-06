# 里程碑 2 · Phase B：跨会话复盘 skill 设计

> 创建日期：2026-06-06
> 状态：设计已定，待实现
> 前置：Phase A（会话摘要卡 digest）已完成，每个会话能自动提炼出摘要卡
> 总规划：`../../2026-06-02/milestone-2-memory-copilot.md`（本文是其中 Phase B「参谋综合 ③」的 B1 细化）

---

## 一、目标与定位

Phase A 已经让每个会话自动产出一张「摘要卡」（决策 / 想法 / 注意 / 搁置 四类条目，每条带回溯 uuid）。Phase B 要把攒下来的一堆摘要卡，变成**跨会话有用的信号**——用户在对话里说"帮我复盘"，agent 综合所有摘要卡，产出一张「复盘卡」。

复盘卡同时是 **Phase B → Phase C（首页仪表盘）的数据接口**：Phase C 直接读这张卡渲染，不必每次重跑 skill。

**第一版边界（YAGNI）**：
- 不接 git、不做想法状态推断（落实/搁置/放弃 → 留给 Phase D）
- 只读摘要卡验证清单质量；拿不准时才回溯原始会话
- 不做多功能，先把"复盘"一个 skill 跑通

---

## 二、核心设计原则（本轮讨论拍定）

1. **主观判断完全交给 agent，代码只做确定性低成本 IO。**
   主题聚类、闭环匹配、价值挖掘这类语义活，代码写出来既贵又飘。所有"判断"放进 skill 提示词引导 agent，代码层（MCP 工具）一律不碰分析逻辑，只读写文件。

2. **保真契约：宁可不写也不瞎造，但给 agent 查证的能力。**
   每条结论必须挂到具体 uuid，挂不上就不写；拿不准某条 uuid 的真实含义时，先回溯原始会话再下笔；复述只指路（贴 uuid）不重写原文，防二次失真。

3. **复盘卡每工作区单张、滚动 merge。**
   不存历史快照。每次复盘在原卡上增量更新（时间维度信息靠 agent 写进文字，如"挂了三周"）。

4. **追溯根源读原始会话 JSONL，不依赖 `_cleaned` 留底。**
   `digests/_cleaned/` 是 Phase A 为省提炼 token 的过渡产物，将来会废弃。回溯工具直接读原始会话 JSONL（永久真相源），避免绑定会消失的中间层。摘要卡条目的 uuid 本就源自原始 JSONL 行的 uuid，天然可定位。

---

## 三、架构

复盘是用户在**主对话**里触发，所以 skill 与工具都挂在主对话 session（不走 Phase A 的 worker/DIGEST_SESSION 那条后台线）。

```
用户在对话里说"帮我复盘"
        │
   agent 看到 review skill 的 description 匹配，自动调用（自然语言触发，非 slash 命令）
        │
   skill 提示词引导 agent 依次调用 dogear-memory-review 的 5 个工具：
        │
   ReadReviewCard ──→ 有旧卡？拿 reviewedAt + 存量清单
        │
   ListDigests ────→ 全部摘要卡 + createdAt
        │              （全量 vs 增量由 agent 判断：哪些 createdAt 晚于 reviewedAt）
   ReadDigest ─────→ 读需要的摘要卡（含 items + uuid）
        │
   TraceSource ────→ 拿不准 uuid 含义时，读原始会话 JSONL 那行 + 上下文
        │
   SaveReviewCard ─→ 覆盖落盘复盘卡（单张滚动）
        ▼
   <configDir>/workspaces/<wsId>/review.md
```

### 工具清单（全是薄 IO，零分析逻辑）

| 工具 | 作用 | 复用 |
|------|------|------|
| `ListDigests` | 列全部摘要卡 + createdAt | 包装 `digest-store.ts` 的 `listDigests` |
| `ReadDigest` | 读单张摘要卡（含 items+uuid） | 包装 `digest-store.ts` 的 `readDigest` |
| `ReadReviewCard` | 读当前复盘卡（拿 reviewedAt + 存量清单） | 新增 `review-store.ts` |
| `TraceSource` | sessionId+uuid → 原始会话 JSONL 定位 | 新增，用 `session-paths.ts` 的 `getSessionJsonlPath` |
| `SaveReviewCard` | 覆盖落盘复盘卡 | 新增 `review-store.ts` |

MCP server 名：`dogear-memory-review`，仿 `agents/tools/digest-tools.ts` 用 `createSdkMcpServer` + `registerTools`。

---

## 四、数据结构：复盘卡

**存储**：每工作区一张，`<configDir>/workspaces/<wsId>/review.md`，与 `digests/` 平级。

**frontmatter（代码管，给增量判断用）**：
```yaml
reviewedAt: 2026-06-06T...   # 本次复盘时间 → 下次只读 createdAt 晚于它的摘要卡
coveredCount: 12             # 已覆盖摘要卡数（给 Phase C 显示，可选）
```

**正文四类清单**，沿用 `SaveDigest` 的结构化模式（agent 填字段、代码拼 markdown，保证 Phase C 可解析）。item schema 精简：

```ts
{
  kind: '未闭环' | '反复出现' | '已否决' | '悬而未决',
  text: string,                                 // 计数/原因/挂了多久，agent 写进文字
  refs: { sessionId: string, uuid: string }[]   // 回溯，跨卡聚合时多条
}
```

- `refs` 是**数组**——一条"反复出现的主题"会同时指向多张摘要卡的多个 uuid。
- 计数、原因、时长**不单列字段**，让 agent 写进 `text`（YAGNI，Phase C 真要再拆）。

四类信号的语义定义（写进提示词，不写进代码）：
- **未闭环**：出现过的想法/计划，后续无对应决策收尾
- **反复出现**：同一主题在 ≥2 张卡出现
- **已否决**：带否定语义的决策，连原因一起写
- **悬而未决**：搁置类条目，标明挂了多久

---

## 五、skill 提示词骨架

做成 local plugin（SKILL.md），照 `getArticleParserSkillsDir()` 模式加进 `query-based-session.ts` 的 `queryOptions.plugins`。description 写明"当用户要求复盘/回顾跨会话进展时使用"。

```
你在为这个工作区维护一张「复盘卡」，汇总跨会话的关键信号。
只用 ListDigests / ReadDigest / ReadReviewCard / TraceSource / SaveReviewCard 五个工具。

步骤：
1. ReadReviewCard() 看有无现存复盘卡：
   - 无 → 全量：ListDigests() 拿全部，逐张 ReadDigest；
   - 有 → 增量：记下 reviewedAt，只 ReadDigest 那些 createdAt 晚于它的新卡，
     存量清单从复盘卡正文继承。
2. 把摘要卡条目归并成四类信号：
   - 未闭环：出现过的想法/计划，后续无对应决策收尾的；
   - 反复出现：同一主题 ≥2 张卡出现（text 里标出现几次）；
   - 已否决：带否定语义的决策，连原因一起写；
   - 悬而未决：搁置类条目，text 里标挂了多久。
3. 【保真契约·最重要】
   - 每条结论必须挂到具体 refs(sessionId+uuid)，挂不上就不写；
   - 拿不准某条 uuid 的真实含义时，先 TraceSource(sessionId,uuid)
     翻原始会话再下笔，禁止凭摘要卡只言片语臆断；
   - 宁可漏写，不可瞎造；复述只指路、不重写原文。
4. SaveReviewCard({ reviewedAt, items }) 覆盖落卡。
完成后简述这次新增/更新了哪几条，再结束。
```

提示词模板可考虑像 `digest-prompt.ts` 那样做成可在设置页编辑的全局单份文件（本版可先内置在 SKILL.md，按需再外置）。

---

## 六、错误处理

- 工具内部出错统一返回 `{ isError: true }`，不抛异常（抛异常会终止 agent 循环，见 `agent-development.md`）。
- `TraceSource` 找不到 JSONL 文件 / uuid：返回明确提示（"未找到该 uuid 对应原文"），让 agent 据保真契约选择不写该条。
- `ReadReviewCard` 无旧卡：返回"(无复盘卡)"，agent 走全量分支。
- 输入参数用 Zod schema 严格校验。

---

## 七、落地清单（5 处改动）

| # | 文件 | 动作 |
|---|------|------|
| 1 | `electron/main/services/memory/review-store.ts`（新） | 复盘卡 serialize/parse/read/save（纯函数可单测），落 `<configDir>/workspaces/<wsId>/review.md` |
| 2 | `electron/main/agents/tools/review-tools.ts`（新） | `createReviewMcpServer(wsId, wsPath)`，5 工具 + `registerTools` |
| 3 | 复盘 skill 目录 + `SKILL.md`（新） | 第五节提示词骨架；配 `getReviewSkillDir()` |
| 4 | `electron/main/agents/query-based-session.ts` | 挂 review server（仿 `:332` article-parse）+ skill plugin（仿 `:342`）；`QueryBasedSessionConfig` 补 `workspaceId` |
| 5 | `electron/main/tipc/agent.ts`（待核实） | 创建 session 时把 `workspaceId` 传进 config |

---

## 八、测试

- `review-store.ts`：serialize/parse 往返单测（含多 refs、空清单、frontmatter 解析）。
- `review-tools.ts`：`TraceSource` 对真实 JSONL 按 uuid 定位的单测（含找不到的兜底）。
- 端到端：在一个有多张摘要卡的工作区里说"帮我复盘"，验证复盘卡生成 + 增量更新 + 回溯链准确。

---

## 九、开放问题

1. 提示词模板内置 SKILL.md vs 外置可编辑文件——本版先内置，看效果再外置。
2. `workspaceId` 注入路径——`query-based-session.ts` 补 config 字段后，确认 `agent.ts` 创建 session 处能拿到 wsId。
3. 复盘卡正文的 Phase C 解析格式——本版按 item schema 结构化输出即可，Phase C 开工时再定渲染。

---

## 修订历史

- 2026-06-06：初版。Phase B B1 细化。确立"复盘 skill + dogear-memory-review 5 工具 + 单张滚动复盘卡"形态，拍定 4 条核心原则（判断交给 agent / 保真契约 / 单张滚动 / 回溯读原始会话）。
