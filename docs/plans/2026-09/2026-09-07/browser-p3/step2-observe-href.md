---
step: 2
title: A2 observe 透出 href
status: pending
---

## 目标

observe_page 返回的 `<a>` 元素带绝对 URL（截断 400），agent 拿到直链后可用 navigate 真实导航直达笔记详情，绕开弹层与 feed 重渲染。

## 依赖上下文（接力棒输入）

- 前置 step 产出：step1 的 ownership gate 已在 5 个工具入口生效，本步骤新增改动无需再碰 gate
- 当前关键文件状态：`extension/src/dom-actions.js` 的 `observeFn` 序列化字段为 `{ref, tag, role, text, hint}`（text 截 80）；工具层 `extension-tools.ts` 的 `formatObserve` 按 `[ref] tag(role) "text" hint="..."` 拼行
- 关键决策回顾：用 IDL 属性 `el.href`（自动解析相对链接为绝对 URL）而非 `getAttribute('href')`；协议加**可选**字段实现单向兼容（旧扩展不回不炸）

## 计划改动

- [ ] `extension/src/dom-actions.js` observeFn：元素序列化时 `<a>` 加 `href` 字段——`el.href` 取值，超 400 字符截断并以 `…` 结尾标记；非链接元素不带该字段
- [ ] `electron/main/services/browser/nm-protocol.ts`：`ObserveElement` 类型的元素序列化加可选 `href?: string`（TS 侧类型对齐；JS 侧 nm-protocol.js 若有 schema 校验则同步放宽）
- [ ] `electron/main/agents/tools/extension-tools.ts`：`ObserveElement` 接口加 `href?: string`；`formatObserve` 拼行加 ` href="..."`（有值才拼）
- [ ] `dogear__extension__observe_page` 工具描述补一句「链接元素带 href，可将其传给 navigate 直达目标页（推荐优先于点击）」
- [ ] `bun run build:electron` 编译通过；手动核对 `resources/browser-eval/` 现有 observe 相关冒烟不受影响（若有无 href 断言需放宽）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：（真机重载扩展验证留 step5 验收清单）
