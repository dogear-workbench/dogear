# 附加工作区路径 设计

## 背景

当前一个工作区只有一个 `path`，agent 的文件操作边界（`WorkspaceExecutionEnv`）只认这一个根路径。用户有跨项目参考的需求：主项目在 `C:\projectA`，想同时读写 `D:\projectB` 的文件，但工作区配置（`.dogear/`、`.claude/`、sessions）不能移动。

需要支持一个工作区挂载多个附加文件夹，每个可独立开关，agent 的边界动态扩展。同时需要调整 UI 布局，并扩展引用机制让用户能方便地把文件/文件夹路径传递给 agent。

## 目标

1. 一个工作区可挂载多个附加文件夹，每个带独立开关
2. 开启的附加路径对 agent 读写可见，关闭的不可见
3. 路径变更后下一轮消息自动生效（热更新，无需重启会话）
4. UI 布局调整：文件树移到右栏，新增「附加」Tab
5. 引用机制扩展：主工作区 + 附加路径的文件树都支持引用文件和文件夹

## 架构

### 核心方案：多根路径边界 + 可变 allowedPaths

排除的选项：
- 虚拟挂载点（`/secondary/projectB/`）：引入路径翻译层，复杂且不自然
- 全局开关控制所有附加路径：用户需要逐个控制，不是一刀切
- 路径变更需重启会话：体验差，技术上可避免

选定方案：
- Workspace 数据模型加 `additionalPaths: AdditionalPath[]`，每条带 `enabled` 开关
- `resolveWithinWorkspace(singleRoot, candidate)` → `resolveWithinPaths(roots[], candidate)`，遍历根路径做现有两层校验（语法 + 符号链接逃逸），命中任意一个放行
- `WorkspaceExecutionEnv` 的 `allowedPaths` 改为可变数组，暴露 `updateAllowedPaths()` 方法；它是引用对象，`toolContext: { env }` 持有同一引用，热更新后下一轮工具调用自动生效
- 系统提示词不涉及路径列表（当前也没列），agent 通过用户消息或引用得知路径，工具层面放行即可

### 附加路径的边界语义

- 主路径：`.dogear/`、`.claude/`、sessions 存储、Bash 默认 cwd、相对路径解析基准 — 始终绑在主路径上
- 附加路径：纯文件读写 + 命令执行入口，agent 用绝对路径访问
- Bash 的 `options.cwd` 落在任一 allowedPaths 内即可

## 模块边界

### 数据模型

| 文件 | 改动 |
|------|------|
| `types/electron-api.ts` | `Workspace` 加 `additional_paths: AdditionalPathData[]` |
| `electron/main/services/workspace-json-service.ts` | `WorkspaceData` 加 `additionalPaths: AdditionalPath[]`，CRUD 操作读写该字段 |
| `electron/main/types.ts` | 如有镜像类型同步 |

```typescript
// 兼容格式（tipc / 前端）
interface AdditionalPathData {
  path: string;
  enabled: boolean;
}

interface Workspace {
  // ...现有字段不变
  additional_paths: AdditionalPathData[];
}
```

### 边界机制

| 文件 | 改动 |
|------|------|
| `electron/main/agents/pi-session/workspace-boundary.ts` | `resolveWithinWorkspace` → `resolveWithinPaths(roots: string[], candidate: string)`；遍历 roots，命中任一根路径的两层校验即放行 |
| `electron/main/agents/pi-session/workspace-execution-env.ts` | 构造参数改为 `allowedPaths: string[]`；`guard()` 调 `resolveWithinPaths`；新增 `updateAllowedPaths(paths: string[])` 方法 |

### Session 层

| 文件 | 改动 |
|------|------|
| `electron/main/agents/pi-session/pi-session.ts` | `PiSessionConfig` 加 `additionalPaths: string[]`（已过滤 enabled 的绝对路径）；`start()` 创建 `WorkspaceExecutionEnv` 时传入 `[workspacePath, ...additionalPaths]` |
| `electron/main/agents/pi-session/pi-session-manager.ts` | 创建 PiSession 时从 workspace 配置读取 enabled 的附加路径传入 config |
| `electron/main/agents/pi-session/search-tools.ts` | Glob/Grep 的 `resolveWithinWorkspace` 换成 `resolveWithinPaths`；搜索根目录不在 allowedPaths 内时拒绝 |

### IPC 路由

| 文件 | 改动 |
|------|------|
| `electron/main/tipc/workspace.ts` | 新增：`addAdditionalPath(wsId, path)` / `removeAdditionalPath(wsId, path)` / `toggleAdditionalPath(wsId, path, enabled)` / `updateAdditionalPaths(wsId, paths[])`；写 `workspaces.json` 后同步更新正在运行的 PiSession 的 `WorkspaceExecutionEnv.allowedPaths` |

热更新链路：IPC handler → workspace-json-service 写盘 → 查 PiSessionManager 拿当前 workspace 的活跃 PiSession → 调 `env.updateAllowedPaths()` 重算 allowedPaths。

### 前端 Store

| 文件 | 改动 |
|------|------|
| `stores/workspace-store.ts` | Workspace 类型加 `additionalPaths`；新增管理 actions（add/remove/toggle） |
| `stores/reference-store.ts` | 扩展引用类型：支持 file / folder 引用（当前只有 article / quoteSnippet） |
| `stores/ui-store.ts` | `rightPanelTab` 类型从 `'preview' \| 'shared'` 改为 `'files' \| 'additional' \| 'shared'`；左侧去掉 `leftPanelTab`（不再需要 Tab 切换） |

### 前端组件

| 文件 | 改动 |
|------|------|
| `app/page.tsx` | 左栏去掉 Tab 切换，直接渲染 ConversationList；右栏 Tab 改为 文件 / 附加 / 共享区；文章预览代码保留但不渲染 |
| `components/WorkspaceExplorer.tsx` | 移到右栏渲染；增加文件/文件夹引用交互（点击引用 / 右键「引用」） |
| `components/AdditionalFilesPanel.tsx`（新增） | 附加 Tab 内容：路径卡片列表（开关 + 路径 + 移除 + 可折叠文件树）+ 底部「添加文件夹」按钮；关闭的路径灰显 |
| `components/agent-chat/ChatInputArea.tsx` | 引用芯片扩展：支持 file / folder 类型，区分图标（📄 / 📁） |
| `components/ArticlePreview.tsx` | 不改动（代码保留，页面不渲染） |

### 引用机制扩展

当前引用只支持 article 和 quoteSnippet。扩展为支持文件和文件夹引用：

```typescript
// reference-store.ts 新增引用类型
interface FileReference {
  type: 'file';
  path: string;       // 绝对路径
  name: string;       // 文件名
}
interface FolderReference {
  type: 'folder';
  path: string;       // 绝对路径
  name: string;       // 文件夹名
}
```

引用来源（所有文件树都支持）：
- 右栏「文件」Tab（主工作区文件树）：点击文件 → 引用文件；点击文件夹 → 引用文件夹
- 右栏「附加」Tab（附加路径文件树）：同上

引用注入消息：发送消息时，引用的路径列表拼到消息内容前部，格式如：
```
[用户引用了以下路径]
- D:\projectB\src\utils.ts
- D:\projectB\src\components\
```

agent 收到后自行决定用 Read / Glob / Grep / Bash 去探索。

## 数据流

### 附加路径配置 → 边界生效

```
用户在「附加」Tab 点击「+ 添加文件夹」
  → 系统文件夹选择器
  → client.addAdditionalPath(wsId, path)
  → workspace-json-service 写 workspaces.json
  → PiSessionManager 拿当前活跃 PiSession
  → env.updateAllowedPaths([primary, ...enabledAdditional])
  → 下一轮工具调用 guard() 用新边界
```

### 文件引用 → 注入消息

```
用户在文件树点击文件 → reference-store.addFileReference(path)
  → ChatInputArea 显示引用芯片 📄 utils.ts
用户输入消息并发送
  → useSendMessage 读 reference-store 的引用列表
  → 拼到消息内容前部
  → PiSession.sendMessage(含引用路径的消息)
  → agent 收到路径，自行用工具探索
```

## 错误处理 / 边界情况

1. **附加路径是主路径的子目录**：冗余但无害，边界校验天然放行
2. **附加路径是主路径的父目录**：用户主动添加，允许（用户有意图）
3. **附加路径不存在**：文件树显示空或错误提示，IPC 层不阻止添加（路径可能后续创建）
4. **附加路径被删除（外部）**：文件树显示空，边界校验对不存在路径无影响（guard 不依赖路径存在性）
5. **开关关闭时 agent 正在访问该路径**：当前轮次不受影响（工具调用已 in-flight），下一轮 guard 用新数组
6. **同一会话多次开关**：每次 IPC 调用都重算 allowedPaths 并 updateAllowedPaths，幂等
7. **附加路径跨盘符（Windows）**：`path.resolve` 处理绝对路径时跨盘符正常工作

## 未决问题

1. **独立会话窗口（session-window/page.tsx）**：是否也做同样的右栏三 Tab 改造？建议一期只改主页面，独立窗口后续跟进
2. **附加路径文件树的性能**：大量文件的目录扫描可能慢，是否需要虚拟滚动或懒加载？建议一期简单实现，性能问题后续优化
3. **引用去重**：同一路径多次引用是否自动去重？建议是
