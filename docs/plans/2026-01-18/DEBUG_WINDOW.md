# Agent 调试窗口使用说明

## 概述

Agent 调试窗口是开发阶段的辅助工具,用于在渲染层实时查看和测试 Agent 对话功能。

## 功能特性

### 1. 多窗口支持
- **主窗口**: 正常的应用界面
- **调试窗口**: 专门的 Agent 对话窗口(仅开发环境)

### 2. 实时对话
- 发送消息给 Agent 系统
- 实时显示 Agent 响应
- 显示任务状态和 Worker 信息

### 3. 状态监控
- Workers 数量
- 队列中的任务数
- 正在执行的任务数

## 使用方法

### 启动应用

在开发环境启动应用时,调试窗口会自动创建:

```bash
npm run dev
```

### 发送消息测试 Agent

1. 在调试窗口的输入框中输入消息
2. 点击"发送"按钮或按 Enter 键
3. 等待 Agent 响应
4. 查看对话历史和状态

### 示例对话

```
用户: 你好,请介绍一下你自己
Agent: 你好!我是 Dogear 应用的 AI 助手...

用户: 帮我总结一下这本书的主要内容
Agent: 好的,我来帮您分析...
```

## 技术架构

### 文件结构

```
dogear/
├── electron/
│   ├── main/
│   │   ├── index.ts          # 主进程(包含调试窗口创建逻辑)
│   │   └── ipc/
│   │       └── agents.ts     # Agent IPC 处理器
│   └── preload/
│       ├── index.ts          # 主窗口预加载脚本
│       └── debug.ts          # 调试窗口预加载脚本
├── app/
│   └── debug/
│       └── page.tsx          # 调试窗口 React 组件
├── lib/
│   └── sdk/
│       ├── query.ts          # Agent SDK 导出
│       └── index.ts          # SDK 入口
└── types/
    ├── agents.ts             # Agent 类型定义
    └── preload.d.ts          # 预加载 API 类型
```

### 通信流程

```
[调试窗口] --IPC--> [主进程] --Agent Manager--> [Agent Worker]
     ↑                                                        ↓
     └──────────────────── 消息更新 ──────────────────────────┘
```

## API 使用

### 在主窗口中使用 Agent SDK

```typescript
import { query } from '@/lib/sdk';

// 创建查询
const result = await query({
  prompt: '帮我分析这段文本',
  options: {
    model: 'claude-sonnet-4-5-20250929',
    temperature: 0.7
  }
});

// 处理结果
for await (const message of result) {
  console.log('收到消息:', message);
}
```

### 在调试窗口中测试

调试窗口会自动显示所有 Agent 对话,包括:
- 用户发送的消息
- Agent 的响应
- 任务状态更新
- 错误信息

## 注意事项

1. **仅开发环境**: 调试窗口只在开发环境(`NODE_ENV=development`)创建
2. **子窗口**: 调试窗口是主窗口的子窗口,关闭主窗口时会一起关闭
3. **性能影响**: 调试窗口会显示所有 Agent 活动,可能影响性能
4. **生产构建**: 生产环境不会包含调试窗口

## 未来改进

- [ ] 添加消息过滤和搜索功能
- [ ] 支持导出对话历史
- [ ] 添加 Agent 思考过程的可视化
- [ ] 支持多会话管理
- [ ] 添加性能监控面板

## 故障排查

### 调试窗口未显示

1. 确认是在开发环境运行: `npm run dev`
2. 检查主窗口是否正常创建
3. 查看控制台是否有错误

### 消息发送失败

1. 检查 Agent Manager 是否正常启动
2. 查看 Worker 状态
3. 检查 IPC 通信是否正常

### 类型错误

确保 `types/preload.d.ts` 已正确引入到 `tsconfig.json`:

```json
{
  "include": ["types/**/*.d.ts"]
}
```
