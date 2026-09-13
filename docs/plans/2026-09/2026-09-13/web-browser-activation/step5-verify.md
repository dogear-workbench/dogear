---
step: 5
title: 整体验证与文档同步
status: done
---

## 目标
全量构建通过 + 手动动线验证 + codebase-map 同步。

## 依赖上下文（接力棒输入）
- 前置 step 产出：step1-4 全部完成（接力棒见各 step 实施回填）
- 验证环境注意：用户跑的是打包版（configDir = `AppData/Roaming/Dogear/.dogear`），本地 `bun run dev` 是开发态（configDir = 项目 .dogear）——手动验证可在 dev 下做，或 build 后验证打包版

## 计划改动
- [x] `bun run lint` + `bun run build:electron` 全绿
- [x] 手动动线（无人值守，代码级替代验证 + 用户可后续 UI 抽验）：
  1. 设置页 → 子会话派遣 → 默认/浏览器解析 Profile 的能力域出现「联网搜索」且已勾；自定义 Profile 可勾选 —【代码级验证：SubAgentTab BOOLEAN_ABILITIES 含 web 项（:87），内置模板 normalize 预勾由 settings-normalize.test 51 用例覆盖（default 缺键补齐 + 显式 false 尊重）】
  2. 设置页 → 能力 → 有 skill 包关→开总闸补细闸（关不动） —【代码级验证：AbilityTab handleTogglePack 有 skill 包分支 enable=true 只补不删 / enable=false 只写 overrides（:105-116）】
  3. 新建主会话系统提示词含分工段 + fallback 指引正确 —【代码级验证：pi-session.ts:568 主版注入条件、:684 主会话 hasBrowser 双条件防死链；工作区 browser 细闸未开时 fallbackHint=browser-subagent（派浏览器解析文案）】
  4. 派默认 Profile 子会话能调 webSearch —【代码级验证：buildSubAgentToolDefs:797 web-mcp 挂载 + resolveAbilities 细闸用例覆盖；运行时实测待用户】
  5. 定时任务编辑器可选「浏览器」「联网搜索」 —【代码级验证：OPTIONAL_TOOL_PACKS（tool-packs.ts:86/:94）两包已登记，CustomToolPacksSection 零改动自动列出】
- [x] `docs/codebase-map.md` 同步：ability-registry / web-mcp-tools / session-append-templates / pi-session / custom-agent-tools / SubAgentTab / AbilityTab / settings-service 八处条目已更新

## 实施回填（做完后填）

### 实际改动
- 与计划差异：计划只列 lint/build:electron，实际补跑了全量 bun test（309 pass，唯一 fail 为 pty-service 既有 node-pty Windows 环境噪音）与 bun run build 完整构建；另发现 build:renderer 失败与本计划无关——根因是 HEAD 既有 bug：SystemBehaviorDetail.tsx:4 值 import 主进程 tipc/ability 把 pty-service → @xterm/headless（其 package.json module 字段指向不存在的 lib/xterm.mjs，上游包 bug）拉进浏览器构建；此前成功构建（out/ 产物 09:00）用的是工作区未提交的修复版（值改本地常量），执行本计划时为隔离无关改动已 stash，pop 后即恢复
- 改动文件清单：docs/codebase-map.md（八处条目：ability-registry 细闸/web-mcp-tools 三态/session-append-templates 新段/pi-session 挂载与拼装/custom-agent-tools 白名单/SubAgentTab 能力域/AbilityTab 联动/settings-service normalize）

### 给下一步的接力棒
- 关键签名 / 数据流：全套已落地——子会话 web-mcp 生效 = 包总闸开 ∩ profile.enabledAbilities.web===true；描述 fallbackHint 三态；分工段 web-research-guidance 主/子两版；定时任务可选 browser/web-mcp；总开关联动只补不删
- 下个 step 该从哪里继续：无（本计划收尾）
- 待办或已知限制：①UI 实操验证待用户（勾选框显示/总闸联动/子会话实测 webSearch）；②build:renderer 失败为 HEAD 既有 bug（SystemBehaviorDetail 值 import + @xterm/headless 上游 module 字段 bug），修复已在 stash 的模型管理改动里，pop 即恢复；③「先关细闸再开关总闸会重新带上细闸」为已接受 trade-off
