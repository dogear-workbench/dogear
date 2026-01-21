# Agent 框架实现计划

## 📋 总体目标

构建一个基于 Claude Agent SDK 的子进程框架,支持在后台自动完成 AI 任务。

## 🏗️ 架构设计

### 进程架构
```
Electron 主进程 (Main Process)
    ↓ (IPC: renderer <-> main)
    ↓ (MessagePort: main <-> agent)
Agent Manager (代理管理器)
    ↓ (按需启动/关闭)
Agent Worker (独立 Worker 进程)
    ↓ (使用 Claude Agent SDK)
    ↓ (Task 工具启动子 Agent)
子 Agent 进程 (处理细分任务)
```

### 通信流程
```
前端 (Renderer)
    → IPC: 'agent:submitTask'
    → 主进程收到任务
    → Agent Manager 创建/复用 Agent Worker
    → Worker 通过 MessagePort 接收任务
    → Worker 处理任务 (调用 SDK)
    → Worker 返回结果
    → Agent Manager 通过 IPC 返回前端
    ← IPC: 'agent:taskUpdate' (事件流)
```

## 📁 文件结构

```
electron/main/agents/
├── task-types.ts           # 任务类型定义和数据结构
├── agent-manager.ts        # Agent 管理器
├── agent-worker.ts         # Agent Worker 进程入口
├── logger.ts               # 日志工具
├── skills/
│   ├── index.ts            # Skills 注册和导出
│   ├── chat-skill.ts       # 对话 Skill
│   └── reading-assistant.ts # 阅读助手 Skill
└── utils/
    └── error-handler.ts    # 错误处理工具
```

## 🔧 实现步骤

### 第一阶段: 基础框架 (当前)

#### Step 1: 创建任务类型定义 (`task-types.ts`)
- [x] 定义任务状态枚举 (PENDING, IN_PROGRESS, COMPLETED, FAILED, CANCELLED)
- [x] 定义任务类型枚举 (CHAT, SUMMARIZE, ANALYZE_BOOK, READING_ASSIST)
- [x] 定义任务负载接口 (ChatTaskPayload, SummarizeTaskPayload 等)
- [x] 定义消息通信协议 (MainToWorkerMessage, WorkerToMainMessage)

**完成标准**: 所有类型定义完整,支持 TypeScript 类型检查

---

#### Step 2: 创建日志工具 (`logger.ts`)
```typescript
// 功能:
- 统一的日志格式
- 日志级别 (debug, info, warn, error)
- 可选的文件输出
- 区分主进程和 Worker 进程的日志
```

**完成标准**:
- 可以通过 `logger.info()`, `logger.error()` 等方法记录日志
- 日志包含时间戳和来源标识

---

#### Step 3: 创建 Agent Worker (`agent-worker.ts`)
```typescript
// 核心功能:
1. Worker 生命周期管理
   - 接收 init 消息初始化
   - 发送 ready 状态通知
   - 处理优雅退出

2. 任务处理
   - 接收 task 消息
   - 根据 task.type 分发到不同处理器
   - 更新任务状态 (IN_PROGRESS -> COMPLETED/FAILED)

3. 集成 Claude Agent SDK
   - 初始化 SDK (使用环境变量中的 API Key)
   - 实现基础的对话功能
   - (未来) 使用 Task 工具启动子 Agent

4. 通信
   - 通过 MessagePort 或 parentPort 与主进程通信
   - 发送任务更新
   - 处理心跳检测
```

**完成标准**:
- Worker 可以独立运行
- 可以接收并处理任务
- 返回模拟结果 (暂时不依赖 SDK)

---

#### Step 4: 创建 Agent 管理器 (`agent-manager.ts`)
```typescript
// 核心功能:
1. Worker 池管理
   - 维护多个 Worker 实例
   - 按需创建/销毁 Worker
   - Worker 空闲时自动回收

2. 任务队列
   - 接收来自 IPC 的任务
   - 将任务分配给空闲 Worker
   - 跟踪任务状态

3. 消息路由
   - 将 Worker 的消息路由到正确的 IPC 通道
   - 维护 taskId 与 IPC channel 的映射

4. 错误处理
   - Worker 崩溃时自动重启
   - 任务失败时根据策略重试或报告错误
```

**完成标准**:
- 可以管理多个 Worker
- 可以接收任务并分配
- 可以处理 Worker 崩溃

---

#### Step 5: 集成到主进程 (`main/index.ts`)
```typescript
// 修改内容:
1. 导入 AgentManager
2. 在 app.whenReady() 后初始化 AgentManager
3. 添加 IPC 处理器:
   - 'agent:submitTask' - 提交新任务
   - 'agent:cancelTask' - 取消任务
   - 'agent:getStatus' - 获取状态
4. 添加 IPC 事件发送:
   - 'agent:taskUpdate' - 任务状态更新
```

**完成标准**:
- 主进程启动时 AgentManager 自动初始化
- 前端可以通过 IPC 与 Agent 通信

---

#### Step 6: 添加前端 IPC 通信接口 (`preload/index.ts`)
```typescript
// 暴露给前端的 API:
- agentSubmitTask(task) - 提交任务
- agentCancelTask(taskId) - 取消任务
- agentOnTaskUpdate(callback) - 监听任务更新
```

**完成标准**:
- 前端可以调用 Agent API
- 类型安全

---

#### Step 7: 创建简单的对话 Skill (`skills/chat-skill.ts`)
```typescript
// 目的: 测试框架可用性
// 功能:
- 简单的对话接口
- 暂时返回模拟响应
- 未来集成真实的 SDK 调用
```

**完成标准**:
- 可以提交对话任务
- 收到任务更新事件
- 收到最终结果

---

#### Step 8: 测试基础框架
```typescript
// 测试场景:
1. 启动应用 -> AgentManager 初始化成功
2. 前端提交任务 -> 任务被接受
3. 任务状态变化 -> 前端收到更新事件
4. 任务完成 -> 前端收到结果
5. Worker 崩溃 -> 自动重启
```

**完成标准**:
- 所有基础流程正常工作
- 错误处理符合预期

---

## 🎯 第一阶段完成后的能力

### ✅ 已实现
- 完整的 Agent 框架基础结构
- 任务提交、执行、状态更新流程
- 多 Worker 并行处理能力
- 基础的错误处理和恢复机制
- 前端可以通过 API 调用 Agent

### 🔄 待后续实现 (第二阶段)
- 集成真实的 Claude Agent SDK
- 实现具体的 Skills (阅读助手、书籍分析)
- 支持子 Agent 的启动和协调
- 任务结果持久化到数据库
- 更丰富的错误处理和重试策略

## 📝 技术决策记录

### 1. Worker Threads vs Child Process
- **选择**: Worker Threads (worker_threads)
- **原因**:
  - 更轻量级,适合 CPU 密集型任务
  - 共享内存空间,通信更高效
  - 支持 MessagePort,适合长时间通信

### 2. 通信方式
- **主进程 <-> Worker**: MessagePort (支持长连接)
- **前端 <-> 主进程**: IPC (Electron 标准)
- **数据共享**: 数据库 (better-sqlite3)

### 3. 任务状态管理
- **内存**: 任务状态保存在 AgentManager 中
- **持久化**: (未来) 重要任务可保存到数据库

### 4. SDK 集成
- **API Key**: SDK 从环境变量自动读取
- **初始化**: 在 Worker 进程中初始化 SDK
- **子 Agent**: 使用 SDK 的 Task 工具

## ⚠️ 潜在风险和注意事项

1. **API Key 配置**
   - 确保 ANTHROPIC_API_KEY 环境变量已设置
   - 考虑添加配置验证

2. **Worker 生命周期**
   - 避免频繁创建/销毁 Worker
   - 实现 Worker 池复用机制

3. **错误恢复**
   - Worker 崩溃时需要恢复正在进行的任务
   - 考虑任务超时机制

4. **性能考虑**
   - 限制同时运行的 Worker 数量
   - 实现任务优先级队列

## 📖 参考文档

- [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk)
- [Electron IPC](https://www.electronjs.org/docs/latest/tutorial/ipc)
- [Node.js Worker Threads](https://nodejs.org/api/worker_threads.html)
