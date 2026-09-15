---
step: 3
title: 通用 playbook 机制
status: done
---

## 目标

通用浏览器调研技巧（跨站点适用）有了存储与注入机制：全局文件 `browser-playbook.md`，凡挂载 browser 能力的会话创建时自动注入系统提示，并预置从 2026-09-14 调研提炼的首批技巧。

## 依赖上下文（接力棒输入）

- 注入点：`electron/main/agents/pi-session/pi-session.ts:140-158` builtin skill 挂载段——`browser-exploration` skill 的挂载条件是 `ab.browser === true`，playbook 注入用同一条件（能力驱动，非 Profile 硬编码；用户自建勾了 browser 的 Profile 也自动携带）
- 文件路径：`getConfigDir()`（`electron/main/services/settings-service.ts:62`）+ `browser-playbook.md`，全局配置目录而非工作区（浏览器技巧与代码无关）
- 注入时机：会话创建时读一次，不热更（新会话生效即可，已拍板）
- 参照：site-knowledge-service.ts 的文件 IO 风格（fs 同步读、exists 判定、8KB 上限截断模式）

## 计划改动

- [ ] 新建 `electron/main/services/browser/browser-playbook-service.ts`：`readBrowserPlaybook(): { exists: boolean; content: string }`（读 `getConfigDir()/browser-playbook.md`，超 8KB 截断同 site-knowledge 模式）+ `ensureDefaultPlaybook(): void`（不存在时写入默认初稿，幂等）
- [ ] 默认初稿内容（首批 5 条 + 头部说明「主会话/人工审核维护，子会话只读」）：
  - 对比类配置表的图标型单元格纯文本有损，优先找单版本/单项详情页逐项核对
  - 数据页数字 JS 后渲染不可靠时，换官方口径文章或搜索佐证，不要在原页死磕
  - 站内搜索表单被 guard_submit 拦截时，改用「关键词 site:域名」通用搜索绕过
  - 搜索引擎结果页被反爬只剩分页框架时，直接导航目标站
  - SERP 标题足够佐证事实时不必点开全文，省步骤
- [ ] `pi-session.ts`：系统提示组装处（builtin skill 段同条件 `ab.browser === true`）追加 playbook 段，格式如 `## 浏览器调研通用技巧\n\n<content>`；`exists === false` 时跳过；启动路径上调用一次 `ensureDefaultPlaybook()`（放 readBrowserPlaybook 内部 or pi-session 初始化，实施时选更稳的——注意别在热路径反复写盘）
- [ ] 验证：dev 起一个挂 browser 能力的子会话确认系统提示含 playbook；无 browser 能力的会话不含

## 实施回填（做完后填）

### 实际改动
- 与计划差异：① ensureDefaultPlaybook 放在 readBrowserPlaybook 内部首行（二选一选更稳项：任意读取入口保证预置，existsSync 命中后零写盘）；② 默认初稿头部说明用引用块、内容不带一级标题，避免与注入段标题重复；读写失败静默不阻塞会话启动
- 改动文件清单：新建 `electron/main/services/browser/browser-playbook-service.ts`（64 行）；`electron/main/agents/pi-session/pi-session.ts`（+3 行：import + personaParts 注入段）
- 注入条件：`activeAbilities.has('browser')`（子会话 Profile 的 ab.browser 已并入 resolveAbilities，与 browser-exploration skill 挂载同源）；格式 `## 浏览器调研通用技巧\n\n<content>`，exists=false 跳过
- 验证：lint / build:electron 通过 + 临时目录冒烟测试（幂等、首读预置、内容稳定）；dev 起会话人工核对列入遗留

### 给下一步的接力棒
- 关键签名 / 数据结构：`readBrowserPlaybook(): { exists: boolean; content: string }`；`ensureDefaultPlaybook(): void`；文件位于 `getConfigDir()/browser-playbook.md`，返回原始 markdown 不加工
- 下个 step 该从哪里继续：Step 4 Profile 描述与本步无代码依赖；后续若做主会话沉淀工具直接 append 该文件即可，注入逻辑无需变更
- 待办或已知限制：① dev 起挂/不挂 browser 能力会话人工核对系统提示含/不含该段；② 首次启动确认 browser-playbook.md 自动生成；③ 改动对新会话生效不热更（设计如此）
