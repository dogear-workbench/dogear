# 调试窗口设置说明

## 架构简化

调试窗口现在直接使用主窗口的预加载脚本 `electron/preload/index.js`,不再需要单独的 `debug.ts`。

## 文件结构

```
electron/
├── main/
│   └── index.ts          # 主进程(创建调试窗口,使用 index.js 预加载)
└── preload/
    └── index.ts          # 统一的预加载脚本(主窗口和调试窗口共用)
```

## 优势

1. ✅ 只有一个预加载脚本,避免 CommonJS/ES Module 混用问题
2. ✅ 主窗口和调试窗口使用相同的 API (`window.electronAPI`)
3. ✅ `AgentChat` 组件在两个窗口都能正常工作
4. ✅ 更简单的维护和调试

## 调试窗口可用的 API

调试窗口可以使用 `window.electronAPI` 的所有功能:

- `window.electronAPI.agent` - Agent 任务操作
- `window.electronAPI.db` - 数据库操作
- `window.electronAPI.book` - 书籍操作
- `window.electronAPI.ai` - AI 服务
- `window.electronAPI.file` - 文件操作

## 使用示例

```tsx
// 在调试窗口页面 (app/debug/page.tsx)
import { AgentChat } from '@/components/AgentChat';

export default function DebugPage() {
  return (
    <div>
      <AgentChat placeholder="测试 Agent..." />
    </div>
  );
}
```

`AgentChat` 组件会使用 `window.electronAPI.agent` 与 Agent 系统通信。