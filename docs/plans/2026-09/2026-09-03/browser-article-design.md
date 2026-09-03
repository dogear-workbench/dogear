# 浏览器文章读取一期设计（受控浏览器）

**日期**：2026-09-03
**状态**：设计已拍板，待写实施计划
**上游**：笔记 r1nwc444《浏览器自动化分期路线与核心点》、笔记 tv9dexzz（研究方向）

## 背景

现有文章解析链路（tipc/article.ts parseArticle：直连 fetch → 平台脚本 → Readability 静态解析 → AI 兜底）卡在「拿不到渲染后的 DOM」：JS 渲染页面静态抓取是空壳，AI 兜底拿到的是无米之炊；需要点击展开/翻页的页面无解。文章工具长期未优化即因等浏览器能力。一期用 Playwright 受控浏览器补上这一层，价值锚点 = 文章读取。

## 目标

1. 浏览器渲染解析作为文章链路的兜底层，JS 重渲染/需展开/轻反爬页面可正常出结果
2. 登录墙场景「把人工那一步递到面前」：诚实失败 + 引导登录 + 手动重试
3. headful 真窗口常驻最小化：平时不打扰、随时可看可接管
4. 薄原子工具地基 + 动作流可视化，为二期社交场景复用

## 架构

### 解析链路（方案 B：插入现有编排）

```
① fetchRawHtml → ② 平台脚本 → ③ Readability 静态
  → ③.5 浏览器渲染解析（新增）
       navigate → 等渲染 → 展开启发式（白名单文本按钮）→ 渲染后 DOM Readability → Turndown → 落盘
  → ④ AI 兜底（仅浏览器也失败：格式怪异；登录墙不走 AI，走人工流程）
```

底层为主进程服务，tipc 编排（手动贴 URL 路径）与 Agent 工具（对话路径）调同一个服务。平台脚本一期保留（零成本最快路径）。

**排除的选项**：只做 Agent 工具不动手动路径（主痛点不解决）；重构两态（大重构无必要）。

### 登录墙「递到面前」流程

```
检测到登录墙（跳登录页/登录表单特征）
  → headful 窗口恢复置前，navigate 停在目标页
  → 广播事件 → 前端 toast + 文章条目「需要登录」状态
  → 条目挂「我已登录，重试」按钮（一期手动重试，登录完成自动检测留作后续）
  → 重试走浏览器层，profile 已有登录态，正常出结果
```

### 浏览器实例生命周期

- 主进程 `BrowserManager` 单例：Playwright `launchPersistentContext`，profile 落 `.dogear/browser-profile/`（用户登录一次持久）
- 窗口形态：**headful + `--start-minimized`**——任务栏常驻不抢屏，好奇点开可看，登录墙时恢复置前，零模式切换逻辑。排除 headless 默认（登录场景要切模式）与 headful 弹脸（打扰）
- 任务队列串行（profile 文件锁的硬约束）；懒启动；空闲 3-5 分钟自动关闭；应用退出强杀
- 排除的选项：并发多实例（profile 锁不允许；同时双任务概率低）

### 工具与权限

工具包 `dogear-browser`（能力域默认关，按工作区启用）：

- **声明式**：`dogear__browser__readArticle(url)`——内部含展开启发式（白名单文本：展开/全文/更多/下一页）+ 点击后正文变长校验，失败标 `quality_warning`
- **命令式原子**：`navigate / observe_page / click / fill / read_text / wait_for / screenshot / close`——readArticle 失败时 Agent 降级手动探索用
- 单 tab，无 upload/download（download 低优先级待定）

权限粒度（「声明式按意图、命令式按动作」）：

| 工具 | default 模式 | autoExecute |
|---|---|---|
| navigate / observe_page / read_text / wait_for / screenshot | 放行（GET 只读语义） | 放行 |
| readArticle / click / fill | 逐次工具调用确认 | 放行 |

实现上零新机制：现有 `permission-rules.ts` 的 `decideToolPermission` 加浏览器工具映射即可——readArticle 一次调用 = 一次确认 = 天然任务级授权。域名级授权与业务内容审批卡留给二期（社交场景主菜）。

### 模型档位（修正原笔记决策 5）

一期**不加** `browserModelSelection` 设置项——浏览器工具在会话内执行，模型跟会话走；digestModelSelection 模式适用于后台 runOnce 任务，一期不同构。省钱路径 = 「浏览器解析」子会话 Profile（便宜档模型 + 浏览器工具包，现有 subAgent.profiles 机制零改动）。三期调度器后台浏览器任务时再加设置项。

## 模块边界

**主进程新增**：
- `services/browser/browser-manager.ts` — 实例单例：启动（headful + minimized）、队列、空闲关闭、退出清理、窗口置前
- `services/browser/browser-article-service.ts` — readArticle 核心：渲染等待、展开启发式、Readability on 渲染后 DOM、登录墙检测上报、动作事件发源
- `services/browser/browser-action-stream.ts` — 动作流环形缓冲 + 增量广播（照 terminal-stream 服务模式）
- `agents/tools/browser-tools.ts` — 工具定义 + registerToolGroup

**改动**：
- `tipc/article.ts` — parseArticle 编排在 Readability 失败后插入浏览器层，AI 兜底后移
- `agents/pi-session/permission-rules.ts` — 浏览器工具权限映射
- 渲染层：登录墙通知消费（article-store）、文章条目「需要登录/重试」状态、伴随面板新增浏览器 tab（`components/companion/BrowserPanel.tsx`，照 TerminalPanel「一条流」模式）+ 动作流 store

**测试基建**：`resources/browser-eval/` 六类静态页（JS 注入正文/折叠展开/翻页/mock 登录墙/懒加载长图/怪异容器）+ 15 个标准任务清单 + runner。两层用途：管线回归（零模型断言）/ Agent 任务层（便宜档成功率量化）。

## 数据流

```
readArticle / 原子工具（Agent 会话 或 tipc 手动解析）
  → BrowserManager 队列 → Playwright 执行
  → 动作事件（navigate/click/observe + URL + 结果摘要）→ action-stream 环形缓冲 + 增量广播
  → BrowserPanel 渲染（伴随面板第五 tab）
解析结果 → article-service 落盘（meta.json + content.md，parseStatus 新增 browser 相关态）
登录墙 → 广播 → 前端 toast + 条目状态
```

## 错误处理 / 边界情况

- 浏览器进程崩溃：当前任务失败，下次任务自动重启实例
- profile 锁残留（异常退出）：启动前检测清理
- 导航超时 / Readability 空结果：按现有 `trimmedTextLength > 100` 阈值逻辑落 `quality_warning`
- 启发式误点（如「关注」按钮长得像展开）：白名单文本约束 + 点击后正文变长校验，校验失败回退结果并标记
- 队列排队无上限但有任务级超时，避免一个卡死任务堵死队列

## 未决问题（实施时定）

1. 翻页拼接（「下一页」循环合并正文）进不进一期——看测试集翻页场景失败率
2. download 工具（公告 PDF/报告）一期做不做——低优先级
3. Chromium 分发：自带（~150MB 版本可控，倾向）vs `channel: 'chrome'` 复用系统浏览器（零体积，版本不可控）
4. 登录完成自动检测（监听导航离开登录页）后置优化
5. 动作流缓冲上限与任务标记（conversationId / articleId 归属）细节
