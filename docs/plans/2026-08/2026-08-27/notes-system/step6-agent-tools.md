---
step: 6
title: Agent 工具面 + 聊完存卡纪律
status: done
---

## 目标

注册 dogear-notes MCP server（7 个基础工具），主会话系统提示加「聊完方案存卡」纪律，端到端跑通「对话建卡 → 列待办 → 勾选完成」。

## 依赖上下文（接力棒输入）

- 前置 step 产出：读 step1 回填拿 notes-service 签名（工具直接调 service，不绕 tipc）
- 工具注册范式：`electron/main/agents/tools/article-tools.ts`（server: dogear-article，zod schema，`registerToolGroup` 文件末尾注册，错误 `{content:[...], isError:true}` 不抛异常）；批量挂载与 placeholder 写法参照 `delegation-tools.ts` 末尾 `registerToolGroup` 调用
- 前端工具列表走 `client.getRegisteredTools()` 动态获取，**不硬编码**（项目级硬决策）
- 提示模板：`electron/main/agents/session-append-templates.ts:20` 附近是主会话协作纪律注入区

## 计划改动

- [x] `electron/main/agents/tools/notes-tools.ts`：server `dogear-notes`，7 工具（zod 严格校验）
  - `dogear__CreateNote({content, tags?, links?, todos?})`
  - `dogear__GetNote({noteId})`（返回 frontmatter + 正文）
  - `dogear__SearchNotes({query?, tag?})`
  - `dogear__AppendNote({noteId, content})`
  - `dogear__UpdateNote({noteId, patch})`——patch 里 todos 按整体数组替换（todo 用 id 定位，改 status 等）
  - `dogear__DeleteNote({noteId})`（软删除）
  - `dogear__ListTodos({status?, hasPlan?})`
  - workspaceId 从工具挂载 opts 拿（参照 article-tools 的上下文注入方式）
- [x] `session-append-templates.ts`：主会话纪律追加一条——「与用户聊完方案/设计并落盘 plan 文档后，调 dogear__CreateNote 存一张卡片：正文一句话摘要，todos 含『实施 <计划名>』且 plan 字段填 plan.md 路径；用户说『把待办里能做的做了』时，用 dogear__ListTodos(hasPlan) 找可实施项，按 staged-execution 纪律执行，完成后 UpdateNote 置 done 并 AppendNote 结果摘要。普通待办（无 plan）只读不动。」
- [x] `bun run build:electron` 后在应用内真实会话端到端：让 agent 建卡（带 #tag、带 plan 待办）→ ListTodos 看到 → UpdateNote 勾选 → 笔记 Tab 待办视图同步显示已勾选

## 验证

- 端到端手测（上述全流程）+ 前端设置里 getRegisteredTools 能看到 dogear-notes 组 + `bun run lint`

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. **挂载点（计划未列，必要配套）**：工具必须有挂载点才能端到端，在 pi-session.ts 主会话有 workspacePath 时常驻挂载 pack `dogear-notes`（照 dogear-memory-review 模式）；registerPack 自动进权限白名单（permission-rules.ts `toolPackMap.has → allow`），无需额外放行注册
  2. **工厂签名照 article-tools 直接收 workspacePath**：step 文档写「workspaceId 从挂载 opts 拿」，但 article-tools 实际范式是 pi-session 把 `this.config.workspacePath` 直接传工厂、不走 opts 解析，照抄了后者（更简）；子会话不挂载（SubAgentProfile 无 notes 能力开关，存卡纪律场景在主会话）
  3. **ability-types.ts RESIDENT_GROUPS 加一行**（计划未列）：能力 tab 常驻区按这份展示配置渲染，不加则 dogear-notes 组在设置页不可见、不满足验证项；工具清单本身仍走 getRegisteredTools() 动态获取，未硬编码
  4. **UpdateNote 用独立 UPDATE_TODO_SCHEMA**：id/text/status 必填（比 CreateNote 的 TODO_SCHEMA 更严）——todos 是整体替换，id 可选会导致忘带 id 的待办被重新编号、丢失原 ID
  5. **CreateNote 工具层做类型映射**：zod 推导的 `id?`/`status?` 映射为 service 必填类型（id 空串→service 自动生成序号、status 缺省 pending），与 notes-service normalizeTodos 语义一致
  6. 应用内端到端手测（真实会话建卡→勾待办→前端同步）留给主会话；工具层用临时工作区直调工厂+handler 冒烟 19 断言全绿替代机器验证
- 改动文件清单：
  - 新增：`electron/main/agents/tools/notes-tools.ts`（dogear-notes server，7 工具）
  - 修改：`electron/main/agents/pi-session/pi-session.ts`（主会话挂载 + 注入 NOTES_DISCIPLINE_APPEND）、`electron/main/agents/session-append-templates.ts`（NOTES_DISCIPLINE_APPEND 常量 + getSystemPromptSegments 注册 notes-discipline 段）、`app/settings/ability-types.ts`（RESIDENT_GROUPS 加 dogear-notes）
- 验证：`bun run build:electron` 通过；`bun run lint` 0 errors（76 warnings 全为历史遗留，与基线一致）；冒烟脚本（已删）覆盖注册元数据/工具名清单/zod 拦截（非法 link、空 todo text、非法 status）/CreateNote 待办 id 自动生成/ListTodos hasPlan 双向过滤/UpdateNote 全量提交置 done/空 patch 拒绝/AppendNote 读回/SearchNotes tag 命中/DeleteNote 软删除与二次删 isError/GetNote 不存在 isError，19 项全绿

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `createNotesToolDefs(workspacePath: string): ToolDef[]`；末尾 `registerToolGroup({ server: 'dogear-notes', label: '笔记卡片', create, placeholder: [''] })`
  - 7 工具：CreateNote{content, tags?, links?, todos?{id?,text,status?,plan?}} / GetNote{noteId} / SearchNotes{query?, tag?} / AppendNote{noteId, content} / UpdateNote{noteId, patch{content?, tags?, links?, todos?{id,text,status,plan?}}} / DeleteNote{noteId}（软删除） / ListTodos{status?, hasPlan?}
  - notesChanged 广播对 agent 写入照常生效，前端无需额外通知
- 下个 step 该从哪里继续：notes-system 一期六个 step 全部完成；后续如有二期（searchNotes snippet、todo 级 patch、捕捉框 links/todos 快捷输入、创建失败 toast）从 plan.md「全局决策」和各 step「已知限制」汇总
- 待办或已知限制：
  - 子会话不挂 dogear-notes（无 profile 开关字段）；需要时得先给 SubAgentProfile.enabledAbilities 加 notes 字段
  - scheduler 自定义 agent（custom-agent-tools.ts）未挂笔记工具，与 article 工具包不同步——一期主会话场景够用
  - DeleteNote 软删除后无 agent 侧恢复工具（service 有 restoreNote，未暴露）
  - 「按 staged-execution 纪律执行」依赖会话已启用该 skill，提示模板只做了指引
