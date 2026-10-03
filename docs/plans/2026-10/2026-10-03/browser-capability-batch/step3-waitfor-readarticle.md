---
step: 3
title: 扩展工具补尾 wait_for / readArticle
status: pending
---

## 目标

扩展通道补 `wait_for`（原子等待）与 `readArticle`（Readability 正文抽取）两工具，对齐内嵌通道工具集。

## 依赖上下文（接力棒输入）

- 协议：`electron/main/services/browser/nm-protocol.ts` 与 `extension/src/nm-protocol.js` 双副本，v4 CommandKind 现有 observe/find/click/fill/read_text/navigate/read_state/scroll/open_tab/close_tab/list_tabs；全局决策：v4 内追加不 bump 版本
- 扩展侧参考：`dom-actions.js`（click/fill 的 ref 校验模式）、`content-extract.js`（已有 turndown 链路可复用于 readArticle）、`observe-actions.js`（find 的元素查找模式）
- 内嵌通道对照实现：`electron/main/agents/tools/browser-atom-tools.ts`（内嵌 wait_for 的超时语义：超时上限、返回形态）
- 主进程工具注册：`extension-tools.ts`（现有工具定义模式、ownership gate、动作流 emitAction）
- click 命令 params 已有 `confirmed?` 先例（选择性字段）

## 计划改动

- [ ] 双副本 CommandKind 追加 `wait_for` / `readArticle`；wait_for params（selector 或 ref、条件：出现/消失/文本包含、timeoutMs 上限对齐内嵌）；readArticle params（可选 selector 限定容器）
- [ ] 扩展侧 `dom-actions.js` 或新文件实现 wait_for：轮询 DOM（间隔 300~500ms）到条件满足或超时；`content-extract.js` 扩展 readArticle：Readability + turndown 产 markdown
- [ ] 主进程 `extension-tools.ts` 注册 `extension__wait_for` / `extension__readArticle`（描述对齐内嵌同名工具，含 scopeNote）
- [ ] `node --check` 扩展 js、build:electron、lint 0 errors
- [ ] 简单验证：dev-selftest 或真机（等一个元素出现、抽一篇文章正文）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 协议新命令的 params 形状：
- 下个 step 该从哪里继续：
