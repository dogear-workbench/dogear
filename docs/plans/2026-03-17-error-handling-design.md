# 错误处理与消息通知系统设计

> 日期：2026-03-17

## 一、目标

为 Dogear 建立统一的错误处理、消息通知和日志持久化系统，解决以下问题：

1. 用户看不到操作错误（只打 console）
2. 无 React Error Boundary，组件崩溃白屏
3. 无全局异常捕获（window.onerror / unhandledrejection / process uncaughtException）
4. 现有 Logger 只是 console 封装，无文件写入能力
5. Agent 对话中的错误渲染可以更清晰

## 二、错误分类与处理策略

| 错误类型 | 展示方式 | 举例 |
|---------|---------|------|
| Agent 对话错误 | 内联渲染（对话流中） | API 错误、token 超限、rate limit、模型拒绝 |
| 会话中断/停止 | 内联渲染（现有 stop 块） | 用户主动停止、SDK 中断 |
| IPC 操作错误 | Sonner toast | 文件操作失败、书籍导入失败、工作区操作失败 |
| Agent 通知 | Sonner toast | SDK Notification hook 推送 |
| 前端组件崩溃 | Error Boundary 降级 UI | React 组件 render 抛异常 |
| 全局未捕获异常 | Sonner toast + 主进程日志 | unhandledrejection、window.onerror |

**核心原则：对话区域内的错误用内联渲染，对话区域外的操作用 Sonner toast 通知。**

## 三、模块设计

### 3.1 Sonner Toast 集成

- 通过 shadcn 添加 Sonner 组件 → `components/ui/sonner.tsx`
- 在 `src/App.tsx` 根组件挂载 `<Toaster />`
- 全局可调用：`toast.error()` / `toast.success()` / `toast.info()` / `toast.warning()`

**Toast 使用场景：**

| 场景 | 级别 | 消息示例 |
|------|------|---------|
| 书籍导入成功/失败 | success / error | "《xxx》导入成功" / "导入失败: 文件格式不支持" |
| 文章抓取成功/失败 | success / error | "文章已保存" / "抓取失败: 无法访问该网址" |
| 文件树操作失败 | error | "重命名失败" / "删除失败" |
| 工作区切换/创建失败 | error | "工作区创建失败" |
| Agent 通知 | info | SDK Notification hook 推送 |
| 全局未捕获异常 | error | "发生未知错误，请查看控制台" |
| 设置保存 | success / error | "设置已保存" / "设置保存失败" |

**不加 toast：** Agent 对话流中的错误（已内联渲染）、用户中断/停止、调试日志。

### 3.2 React Error Boundary

新建 `components/ErrorBoundary.tsx`：

```
<ErrorBoundary fallback="app">           ← App.tsx 最外层兜底
  <HashRouter>
    <Routes>
      <Route element={
        <ErrorBoundary fallback="page">  ← 页面级，崩溃不影响路由
          <PageComponent />
        </ErrorBoundary>
      } />
    </Routes>
  </HashRouter>
</ErrorBoundary>
```

降级 UI：shadcn Alert 组件（`variant="destructive"`），显示错误描述 + "重新加载"按钮。

### 3.3 全局异常捕获

**渲染进程**（`src/main.tsx`）：
- `window.onerror` — 捕获同步异常
- `window.addEventListener('unhandledrejection')` — 捕获未处理的 Promise 拒绝
- 捕获后：弹 toast 通知 + 通过 IPC `logFromRenderer` 发到主进程写入日志

**主进程**（`electron/main/index.ts`）：
- `process.on('uncaughtException')` — 记录日志，不退出进程
- `process.on('unhandledRejection')` — 记录日志

### 3.4 Agent 对话错误内联渲染优化

改进 `ContentBlockItem.tsx` 中 `error` 类型块的渲染：

- 解析常见 SDK/API 错误，提取可读描述：
  - `overloaded` → "模型服务过载，请稍后重试"
  - `rate_limit` → "请求频率过高，请稍候"
  - `invalid_api_key` → "API Key 无效，请检查设置"
  - `context_length_exceeded` → "对话长度超出限制，尝试 /compact"
  - 网络/超时 → "网络连接失败"
  - 其他 → 原始错误信息
- 使用 shadcn Alert 组件（`variant="destructive"`）替代手写样式
- 长错误信息可折叠展示技术细节

### 3.5 Logger 文件写入扩展

扩展现有 `electron/main/agents/logger.ts`：

**写入规则：**
- 只有 WARN 和 ERROR 级别写入文件
- DEBUG / INFO 仍然只打 console
- 日志文件路径：`.dogear/logs/dogear-YYYY-MM-DD.log`（按天轮转）
- 单文件上限 5MB，超出时截断旧内容
- 保留最近 7 天日志，启动时清理过期文件

**日志格式：**
```
2026-03-17T14:23:45.123Z [ERROR] [AgentManager] 启动会话失败: API key invalid
2026-03-17T14:23:46.456Z [WARN] [Task:a1b2c3d4] PostToolUseFailure: Read 工具执行超时
```

**改动点：**
- Logger 构造函数新增 `logDir?: string` 选项
- `log()` 方法中，当 level >= WARN 且 logDir 存在时，异步追加写入文件
- `mainLogger` / `workerLogger` 启用文件写入
- 新增 `initLogDir()` 函数：确保目录存在 + 清理过期日志

**新增 IPC：**
- `logFromRenderer` — 渲染层发送边缘异常日志到主进程写入文件

## 四、文件改动清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `components/ui/sonner.tsx` | 新增 | shadcn Sonner 组件 |
| `components/ErrorBoundary.tsx` | 新增 | React Error Boundary |
| `src/App.tsx` | 修改 | 挂载 `<Toaster />` + ErrorBoundary 包裹 |
| `src/main.tsx` | 修改 | 全局异常捕获（onerror + unhandledrejection） |
| `electron/main/index.ts` | 修改 | 主进程异常捕获 |
| `electron/main/agents/logger.ts` | 修改 | 添加文件写入能力 |
| `electron/main/tipc/index.ts` | 修改 | 注册 logFromRenderer IPC |
| `electron/main/tipc/log.ts` | 新增 | logFromRenderer IPC handler |
| `components/agent-chat/ContentBlockItem.tsx` | 修改 | 优化 error 块渲染 |
| `components/agent-chat/hooks/useSessionEvents.ts` | 修改 | Agent 通知接入 toast |
| `components/agent-chat/hooks/useAgentSession.ts` | 修改 | 会话启动错误 toast |
| `components/WorkspaceExplorer.tsx` | 修改 | 文件操作失败 toast |
| `stores/workspace-store.ts` | 修改 | 工作区操作 toast |
| `stores/article-store.ts` | 修改 | 文章抓取 toast |

## 五、不做的事

- 不引入前端日志库（运行日志继续用 console）
- 不为每个 store 添加 error state
- 对话区内的错误不弹 toast（避免重复）
- 不改变现有 IPC `{ error: string }` 返回格式
- 不引入第三方日志库（electron-log 等）

## 六、实现顺序

1. **基础设施**：安装 sonner + 添加 Sonner 组件 + ErrorBoundary + App.tsx 集成
2. **Logger 文件写入**：扩展 logger.ts + 新增 logFromRenderer IPC
3. **全局异常捕获**：main.tsx（渲染层）+ index.ts（主进程）
4. **Agent 错误渲染优化**：ContentBlockItem error 块 + useSessionEvents toast
5. **IPC 调用 toast 接入**：各组件/store 的 IPC 调用处加 toast
