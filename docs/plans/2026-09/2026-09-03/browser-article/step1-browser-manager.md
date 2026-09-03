---
step: 1
title: BrowserManager 地基
status: done
---

## 目标

Playwright 依赖引入 + 浏览器实例单例服务落地：队列串行、懒启动、空闲关闭、退出清理、窗口置前、崩溃自恢复。

## 依赖上下文（接力棒输入）

- 首个 step，无前置产出
- 设计依据：`docs/plans/2026-09/2026-09-03/browser-article-design.md` 的「浏览器实例生命周期」节
- 关键决策：headful + `--start-minimized`；profile 落全局配置目录（跨工作区共享登录态）；单 page

## 计划改动

- [x] `bun add playwright`（Chromium 二进制 `bunx playwright install chromium`，自带而非 channel:'chrome'，版本可控；打包分发携带策略记入待办不阻塞）
- [x] 新建 `electron/main/services/browser/browser-manager.ts`：
  - 单例 `getBrowserManager()`
  - `acquire(taskMeta): Promise<{ page, release }>` —— 内部 Promise 队列串行（同一时刻仅一个任务持有 page）；taskMeta 含 `{ kind: 'article' | 'agent', conversationId?, articleId? }` 供后续动作流标记
  - 懒启动：首次 acquire 时 `launchPersistentContext`（`headless: false`、`args: ['--start-minimized']`、`userDataDir: <configDir>/browser-profile`）；configDir 获取对齐现有全局配置目录解析方式（参考 session-paths / settings-service 的目录约定）
  - 空闲关闭：release 后 3 分钟无新 acquire → context.close()（计时器实现，数值可调）
  - 退出清理：主进程 before-quit 钩子强杀
  - `bringToFront()`：恢复并置前窗口（page.bringToFront + CDP `Browser.setWindowBounds` state:'normal'，实现时验证最小化窗口能否正确还原）
  - 崩溃自恢复：监听 context/process 退出，置失效标记，下次 acquire 自动重启；profile 锁残留（SingletonLock）启动失败时清理后重试一次
- [x] debug 页或临时入口加手动验证按钮（用后即删）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - `--start-minimized` 在 Chromium 151 实测不生效（CDP 读 windowState=normal），launch 后增加 CDP `Browser.setWindowBounds` 主动最小化兜底，实测生效
  - 无人值守无法手动点 debug 按钮，改用临时脚本 `scripts/verify-browser-manager.mjs`（node 跑 dist 编译产物）自动验证 13 项，全部通过后已删除
- 改动文件清单：
  - `package.json`：新增依赖 playwright@1.62.1（bun add）
  - `electron/main/services/browser/browser-manager.ts`：新增
  - `electron/main/index.ts`：before-quit 钩子内增加浏览器 dispose 清理
  - Chromium 二进制已通过 `playwright install chromium` 装到 %LOCALAPPDATA%\ms-playwright\（非仓库内容）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `getBrowserManager(): BrowserManager`（单例）
  - `acquire(meta: BrowserTaskMeta): Promise<BrowserLease>`；`BrowserTaskMeta = { kind: 'article' | 'agent', conversationId?, articleId? }`；`BrowserLease = { page: Playwright Page, release: () => void }`（release 幂等）
  - `bringToFront(): Promise<void>`（还原最小化窗口并置前，登录墙场景用）
  - `dispose(): Promise<void>`（before-quit 已接）
  - 空闲关闭时长可用 env `DOGEAR_BROWSER_IDLE_CLOSE_MS` 覆盖（默认 3 分钟）
- 下个 step 该从哪里继续：browser-article-service.ts，从 manager acquire 拿 page 后做 navigate/渲染等待/展开启发式/Readability
- 待办或已知限制：Chromium 打包分发策略（NSIS/便携版携带方式）未定；SingletonLock 冲突恢复路径已实现但未构造真实锁冲突实测（仅验证 kill 命令无害空跑）
