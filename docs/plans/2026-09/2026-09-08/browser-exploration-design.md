# 浏览器探索能力：站点档案 + 探索方法论 设计

**日期**：2026-09-08
**上游**：P3 真机验收（../2026-09-07/browser-p3/）的 agent 行为发现 + 用户拍板的能力模型；首批地图数据在会话组共享区 `p3-xhs-acceptance-state-paths.md`
**状态**：设计拍板

## 背景

P3 真机验收发现：agent 行为**剧本化**——页面状态偏离剧本（当前不在搜索页、state 形态漂移）时不自主恢复，直接把偏离当失败上报。与写死流程的脚本无区别，agent 的价值（处理偏差）没有发挥。

根因三层拆解：

1. **工具层没有问题**：navigate/observe/read_state 是通用原语，且 read_state 自带探索回路（无 path 看顶层概要、传错 path 回显该层可用 key）——A2+A3 验收会话靠它发现了小红书 `search.feeds` 的 Vue ref 包装（`_value`）和形态漂移
2. **引导写成了剧本**：P2 写入浏览器解析 Profile 的小红书工作流是「第 1 步搜索 → 第 2 步 observe → …」流程式描述，模型照抄，偏离即卡
3. 特化站点知识（路径地图）与通用探索能力（行为循环）混在同一份描述里，越加站点越臃肿

用户拍板的能力模型：**一般流程（探索循环）+ 探索方向与自主能力；特化网站 = 自主探索的同时守网站规矩（防风控）**。

## 目标

1. 浏览器解析 Profile 描述从「流程剧本」重构为「探索方法论」（目标导向、行动前确认世界状态、偏差恢复、假设驱动）
2. 站点档案机制：按域名独立 markdown 档案，agent 主动查询 + navigate 指针引导
3. 档案更新回路：两区结构（正式地图 + 探索发现），agent 只能追加发现区，人工/主会话审核合并
4. P3 验收遗留并入：zhihu serp-parser 修复（根因待复测定位）、reddit/降级链验收、step5 文档收口

## 架构

### 三层能力模型（硬约束 → 软引导 → 默认行为）

| 层 | 内容 | 承载 | 现状 |
|---|---|---|---|
| 约束层 | 节奏预算、随机延迟、风控关键词、域名授权 | 代码强制（site-policy + policyGate），agent 不可违反 | ✅ 已有，不动 |
| 知识层 | 特化站点地图（已知 state 路径、直链拼法、站点怪癖） | 站点档案 `{domain}.md`，可验证可弃用 | 本设计新增 |
| 探索层 | 观察世界 → 形成假设 → 行动 → 验证 → 偏差恢复 | Profile 方法论 | 本设计重构 |

### 排除的选项（拍板记录）

- **知识塞 Profile 描述**（现状）：随站点数线性膨胀，换站互不污染做不到
- **导航时自动注入档案到上下文**：管线侵入 + 注入不透明（agent 不知上下文为何多了东西），易污染
- **agent 直写正式地图**：写错一条路径，后续会话按错图下钻，浪费的是预算和风控节奏——错误地图比没地图糟

### 站点档案

- 位置：`.dogear/site-knowledge/{domain}.md`（用户数据目录，热更新，不随版本分发）
- 结构两区：

```markdown
# xiaohongshu.com 站点档案

## 正式地图（已验证）
- 搜索结果卡片数组：__INITIAL_STATE__.search.feeds._value.{index}（ref 包装，真实数组在 _value）
  关键字段：id / xsecToken / noteCard.displayTitle / noteCard.interactInfo（likedCount 等，字符串型）
  直链拼法：/search_result/{id}?xsec_token={xsecToken}&xsec_source=
- 笔记详情正文：__INITIAL_STATE__.note.noteDetailMap.{noteId}.note.title|.desc|.interactInfo|.user
- ...

## 探索发现（未验证，由会话追加）
- [2026-09-08 · 某会话] search 形态会漂移：有时 ref 包装、有时解包对象（SSR 注水/路由切换时改写），用前先概要验证
```

### 注入方式：主动查询 + 指针

- 新工具 `dogear__extension__site_knowledge`（无参）：从 browser-gateway 的 tab snapshot 取当前域名，读对应档案返回（正式地图 + 发现区）。无档案 → 返回「本站暂无档案」+ 鼓励探索话术（正常态非错误）
- `dogear__extension__navigate` 返回尾部：目标域有档案时附一行指针「本站有站点档案，建议先调 site_knowledge 获取已知地图」
- 取地图作为探索循环标准第一步，写进 Profile 方法论

### 更新回路：追加式两区

- 新工具 `dogear__extension__site_finding`（参数：finding 文本）：**仅允许追加**到发现区，自动带时间戳 + 会话标注；单条长度上限 500 字，格式校验防刷爆
- 正式地图只能人工/主会话审核后编辑（不做自动合并，不做工具写入口）
- 读档案时两区都返回，发现区自带「未验证」语境

### 风控与自主的张力处理

- 原则：不限制能力，约束行为模式
- 假设驱动探索写进方法论：每次行动有明确预期（「我猜数据在 X，验证一下」），禁止无目的乱试
- 失败收敛写进方法论（不做代码强制）：同一页面连续 3 次探索失败 → 停止并报告已发现（预算机制兜底硬限制）
- 节奏护栏沿用现有，agent 绕不过

## 模块边界

| 模块 | 改动 |
|---|---|
| `electron/main/services/browser/site-knowledge-service.ts` | **新建**：读档案/追加发现区/域名是否有档案判断；域名取自 browser-gateway tab snapshot |
| `electron/main/agents/tools/extension-tools.ts` | +2 工具（site_knowledge / site_finding）；navigate 返回尾部加指针 |
| `electron/main/services/settings-types.ts` | 浏览器解析 Profile 描述重构（方法论替换剧本）——**必须带 description 旧值→新值迁移**（deepMerge 保留旧值，先例 settings-service.ts:294） |
| `electron/main/services/settings-service.ts` | Profile description 迁移逻辑 |
| `.dogear/site-knowledge/xiaohongshu.com.md` | 首批档案（用共享区 `p3-xhs-acceptance-state-paths.md` 的已验证路径建正式地图） |
| `electron/main/services/browser/serp-parsers`（zhihu） | 修复：根因待复测定位（验证墙 vs 选择器失效），复测是实施第一步 |
| `resources/browser-eval/` | site-knowledge 冒烟（读/追加/指针/无档案态） |

read_state 工具描述不再回填小红书具体路径（P3 原计划作废）——站点知识进档案，工具描述只写通用引导（概要→下钻、站点档案可能有已知路径）。

## 数据流

- **读**：agent navigate（返回带指针）→ `dogear__extension__site_knowledge` → site-knowledge-service 读 `{domain}.md` → 返回两区内容
- **写**：agent 探索发现新结构 → `dogear__extension__site_finding` → 校验长度/格式 → 追加发现区（带 ts + 会话标注）
- **合并**：人工/主会话审核发现区 → 直接编辑档案正式区（无工具通道）

## 错误处理 / 边界情况

- 无档案域名：正常态返回，附探索鼓励话术，不报 isError
- 档案损坏/超大：读取截断保护（如 8KB 上限），发现区追加超限拒绝并提示
- 档案文件名域名规范化：小写、去 `www.` 前缀
- 受控浏览器通道（search/readArticle）暂不接站点档案（YAGNI，扩展通道先行；serp-parsers 是代码解析器，与档案分属两层）

## 未决问题

- zhihu parser 根因（验证墙 vs 选择器）——实施第一步复测诊断后定修法
- 失败收敛 N=3 是否合适——实施后实战观察调整
- reddit 站内 + 降级链验收未跑（Clash 已确认开着）——并入实施后验证
