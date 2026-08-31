# 存量类型错误与测试失败清理

## 背景

- 全量 tsc：渲染层 20 个错误（14 个文件，含 6 个测试文件的 bun:test 类型缺失）、electron 层 0 错误
- `bun test`：28 文件 / 162 用例，153 pass / 9 fail
- 全部为历史累积，与笔记 Markdown 功能（bb05946）无关；测试文件保留（活跃的回归保护）

## 目标

1. 渲染层 + electron 层 tsc 均 0 错误
2. bun test 修复可修的失败；不可修的（环境限制）明确标注
3. 不改任何运行时行为逻辑，只动类型与测试

## 改动清单

### A. 测试类型配置

- 安装 `@types/bun`（bun add -d）
- `tsconfig.json` 补：测试文件类型解析 + `"allowImportingTsExtensions": true`（已是 noEmit，满足前提）
- 若主 tsconfig 显式 types 引入 `bun` 引发全局类型冲突，改用测试专用 tsconfig 方案（tsconfig.test.json extends 主配置），lint/tsc 均需覆盖到

### B. 两侧类型定义不同步

- `types/settings.ts` vs `electron/main/services/settings-types.ts` 的 `EffortLevel`：一侧多 `'xhigh'`、一侧多 `'off'`。先查真实模型参数面（grep 两处类型的使用点与设置 UI），确定合法值集合后统一两份定义
- `stores/tool-registry-store.ts:52`：`ToolGroupInfo` 缺 `server`/`category`，与 IPC 返回的 `ToolGroup` 对齐（以 electron 侧 `client.getRegisteredTools()` 实际返回结构为准）

### C. 组件类型小错（8 处）

- `components/agent-chat/AgentChat.tsx:103`：`ExtendedSessionMessage[]` vs `TranscriptEvent[]` 参数不兼容——优先让回调参数类型收窄对齐，不做 as 断言逃逸
- `components/agent-chat/AgentChat.tsx:129`：`'stopped'` 与 `'done'` 比较无重叠——查实际状态机取值，修正比较对象或类型
- `app/settings/AboutTab.tsx:54,55`：联合类型上访问 `error` 属性不存在——收窄或扩 CheckResult 类型
- `components/agent-chat/LiveTail.tsx:77`、`StableHistory.tsx:78`：TodoItem `status` 被 string 拓宽——给数据来源处补字面量类型
- `components/stock/KLineChart.tsx:162`：lightweight-charts `Time` 类型，time 值做显式转换
- `app/debug/page.tsx:75`：`string | null` vs `string | undefined`

### D. 测试失败修复（9 fail）

- **测试-源码不同步**：`migratePiProfiles`、`getConfiggedDir/getConfigDir` 等导出名在 `settings-service.ts` 已变——对齐现状（测试改引用新导出名；若功能已删则删对应用例）
- **bun 无法加载 electron 原生模块**（`Missing 'default' export in node_modules/electron/index.js`）：确认相关测试是否依赖 electron 运行时；纯逻辑部分剥离 mock，无法剥离的用 `todo`/条件 skip 标注，保证 `bun test` 退出码可控
- task-store 的 safeJsonRead ENOENT 日志属预期路径，确认非失败源即可

### E. 收尾

- `package.json` 增加 `"test": "bun test"` script

## 验收

- [ ] `bunx tsc -p tsconfig.json --noEmit` → 0 errors
- [ ] `bunx tsc -p tsconfig.electron.json --noEmit` → 0 errors
- [ ] `bun test` → 无 fail（或剩余失败全部为已标注的环境限制）
- [ ] `bun run lint` 无新增 error
- [ ] `bun run dev` 启动，主流程（笔记/会话/设置）无回归

## 不做

- 不重构、不改业务行为
- 不动 `#root` 标题栏布局与 Markdown 功能（已另行修复）
