---
step: 1
title: BrowserManager 地基
status: pending
---

## 目标

Playwright 依赖引入 + 浏览器实例单例服务落地：队列串行、懒启动、空闲关闭、退出清理、窗口置前、崩溃自恢复。

## 依赖上下文（接力棒输入）

- 首个 step，无前置产出
- 设计依据：`docs/plans/2026-09/2026-09-03/browser-article-design.md` 的「浏览器实例生命周期」节
- 关键决策：headful + `--start-minimized`；profile 落全局配置目录（跨工作区共享登录态）；单 page

## 计划改动

- [ ] `bun add playwright`（Chromium 二进制 `bunx playwright install chromium`，自带而非 channel:'chrome'，版本可控；打包分发携带策略记入待办不阻塞）
- [ ] 新建 `electron/main/services/browser/browser-manager.ts`：
  - 单例 `getBrowserManager()`
  - `acquire(taskMeta): Promise<{ page, release }>` —— 内部 Promise 队列串行（同一时刻仅一个任务持有 page）；taskMeta 含 `{ kind: 'article' | 'agent', conversationId?, articleId? }` 供后续动作流标记
  - 懒启动：首次 acquire 时 `launchPersistentContext`（`headless: false`、`args: ['--start-minimized']`、`userDataDir: <configDir>/browser-profile`）；configDir 获取对齐现有全局配置目录解析方式（参考 session-paths / settings-service 的目录约定）
  - 空闲关闭：release 后 3 分钟无新 acquire → context.close()（计时器实现，数值可调）
  - 退出清理：主进程 before-quit 钩子强杀
  - `bringToFront()`：恢复并置前窗口（page.bringToFront + CDP `Browser.setWindowBounds` state:'normal'，实现时验证最小化窗口能否正确还原）
  - 崩溃自恢复：监听 context/process 退出，置失效标记，下次 acquire 自动重启；profile 锁残留（SingletonLock）启动失败时清理后重试一次
- [ ] debug 页或临时入口加手动验证按钮（用后即删）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：Chromium 打包分发策略（NSIS/便携版携带方式）未定
