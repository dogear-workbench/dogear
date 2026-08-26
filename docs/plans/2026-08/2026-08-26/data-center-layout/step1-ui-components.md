---
step: 1
title: 基础组件准备
status: done
---

## 目标
为后续步骤备好两个 UI 基础件：tabs 下划线变体 + shadcn Select 组件，本步不接入任何页面。

## 依赖上下文（接力棒输入）
- 无前置 step。当前 `components/ui/tabs.tsx` 是 shadcn 默认形态（`TabsList` 灰底圆角容器），被 `app/settings/page.tsx`、`components/stock/StockDetail.tsx`、`app/data-center/page.tsx`、`app/data-center/memory-section.tsx`、`app/data-center/usage-panel.tsx` 引用——**加 variant 默认值必须等于现形态**，否则炸别的页面
- `@radix-ui/react-select` 未安装（已确认 package.json），需要 bun add

## 计划改动
- [ ] `bun add @radix-ui/react-select`
- [ ] `components/ui/select.tsx`：新增 shadcn Select 全套（Select / SelectTrigger / SelectContent / SelectItem / SelectValue / SelectGroup / SelectLabel），从 shadcn 官方源码取，项目风格参照现有 `components/ui/dropdown-menu.tsx`（forwardRef + cn + displayName）
- [ ] `components/ui/tabs.tsx`：`TabsList` 与 `TabsTrigger` 支持 `variant?: 'default' | 'underline'`。underline 形态：TabsList 去灰底（`bg-transparent border-b rounded-none p-0 h-10`），Trigger 去背景块、激活态改为底部高亮线（`data-[state=active]:shadow-none` + border-b-2 border-primary 或 after: 伪元素画线，text 前景色激活）+ 不激活项 `border-transparent border-b-2` 保持等高
- [ ] 验证：`bun run lint` + `bun run dev:renderer` 打开设置页和股票详情确认 tabs 视觉无变化（default 变体未受影响）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：① tabs 高亮线用 `border-b-2` 直接画（非 after 伪元素），TabsList `items-stretch` 让 trigger 线紧贴容器 1px 底线；② select.tsx 风格参照 dropdown-menu.tsx 实际的新式函数组件 + data-slot 风格（计划括号里写的 forwardRef 与实际不符），另增 `ScrollUp/ScrollDownButton`、`SelectSeparator`；③ 视觉验证用 build:renderer + 类名逐字 diff 替代 dev 肉眼确认
- 改动文件清单：`package.json`/`bun.lock`（@radix-ui/react-select@2.3.7）、`components/ui/select.tsx`（新增）、`components/ui/tabs.tsx`

### 给下一步的接力棒
- 关键签名 / 数据结构：`<TabsList variant="underline">` 与 `<TabsTrigger variant="underline">` **两个组件都要传 variant**（Trigger 不自动继承）；`<Select value onValueChange>` 受控，radix 不允许 `""` 作 SelectItem value（工作区筛选的 `'all'` 哨兵天然合法），value=undefined 时显示 placeholder；`SelectTrigger` 有 `size="sm"`（h-8）；SelectContent 默认 popper 同宽
- 下个 step 该从哪里继续：`app/data-center/page.tsx` 骨架重构（6 tab 下划线导航 + 筛选下沉）
- 待办或已知限制：设置页/股票详情 default 变体视觉零变化的验证只做了类名 diff + 构建通过，建议用户抽空肉眼过一眼
