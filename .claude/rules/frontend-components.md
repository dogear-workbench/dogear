---
paths:
  - "components/**/*.tsx"
  - "app/**/*.tsx"
---

# 前端组件规则

- UI 基础组件用 shadcn/ui（`components/ui/`），不要手写基础组件
- 图标统一用 lucide-react，不引入其他图标库
- 样式用 Tailwind CSS，类名合并用 `cn()`（from `lib/utils.ts`）
- Electron 中不支持 window.prompt / window.confirm，用自定义 UI 替代
- Store 操作用对应的 Zustand store action，不要在组件内直接操作数据
