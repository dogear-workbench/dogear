---
paths:
  - "components/**/*.tsx"
  - "app/**/*.tsx"
  - "src/**/*.tsx"
  - "stores/**/*.ts"
---

# 前端组件规则

- UI 基础组件用 shadcn/ui（`components/ui/`），不要手写基础组件
- 图标统一用 lucide-react，不引入其他图标库
- 样式用 Tailwind CSS，类名合并用 `cn()`（from `lib/utils.ts`）
- Electron 中不支持 window.prompt / window.confirm，用自定义 UI 替代
- Store 操作用对应的 Zustand store action，不要在组件内直接操作数据

## StatusPulse 组件使用

`StatusPulse.tsx` 用于表示异步操作状态：
- `isPending=true` → 蓝色脉冲（等待用户确认权限/AskUser）
- `isPending=false` → 橙色脉冲（Agent 正在运行）
- `size="sm"` → 12px（Tab 标签中使用）
- `size="md"` → 16px（列表项中使用，默认）

示例：
```tsx
import { StatusPulse } from '@/components/StatusPulse';

// 等待确认状态
<StatusPulse isPending={true} size="md" />

// 运行中状态
<StatusPulse isPending={false} className="ml-2" />
```

对话列表中已使用 StatusPulse 替代旋转加载动画（Loader2），提供更清晰的状态指示。
