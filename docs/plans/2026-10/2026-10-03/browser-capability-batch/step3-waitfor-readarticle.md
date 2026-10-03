---
step: 3
title: 扩展工具补尾 wait_for / readArticle
status: done
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
  - 计划说「content-extract.js 已有 turndown 链路复用」有误——扩展侧无解析库（无打包器无 node_modules），Readability+Turndown 在主进程 article/parse.ts。落地为：扩展侧只抽渲染后 HTML（可选 selector 限定容器）→ 主进程 parseArticleHtml 加 containerHtml 参数复用整条管线（微信特判、懒加载图预处理免费复用，扩展零新依赖）
  - runCommand 加可选 timeoutMs（wait_for 最长 30s 超默认通道上限，传 timeoutMs+10s buffer；扩展侧注入超时 timeoutMs+5s，保证扩展先报回 navigated_away）
  - 扩展参数错误用枚举内 value_mismatch + data.reason 透传（非枚举 errorCode 会被 gateway 折成 stale_protocol 文案误导）
  - readArticle 未加入 PERMISSION_ASK_TOOLS（只读当前页，对齐扩展 read_text 语义；内嵌版因导航/产生流量才逐次确认）
- 改动文件清单：
  - `electron/main/services/browser/nm-protocol.ts` + `extension/src/nm-protocol.js`（双副本 CommandKind 追加，v4 不 bump）
  - `extension/src/wait-actions.js`（新文件：waitFn 轮询 400ms，函数体全内联——executeScript 序列化硬约束）
  - `extension/src/content-extract.js`（extractArticleHtml：readyState complete 等待≤3s + selector 校验 + html/containerHtml 抽取）
  - `extension/src/background.js`（COMMAND_FUNCS/readSafe/ref 检查/args 组装接新 kind；executeScriptWithTimeout 自定义超时；fail data 透传 reason；wait_for 结果附 pageState）
  - `electron/main/agents/tools/extension-command-shared.ts`（runCommand 可选 timeoutMs）
  - `electron/main/agents/tools/extension-observe-format.ts`（WaitForPayload/ReadArticlePayload 类型）
  - `electron/main/agents/tools/extension-tools.ts`（注册 dogear__extension__wait_for / dogear__extension__readArticle，SHARED_SCOPE_NOTE + ownership gate + policyGate）
  - `electron/main/services/article/parse.ts`（parseArticleHtml 可选 containerHtml，有 selector 时容器替换 body 走标准管线）
- 验证：node --check 4 扩展 js 全过；build:electron 通过；本次改动 ts 文件零 lint 新增；parse.ts containerHtml 分支 bun 实跑验证（容器聚焦/噪音剔除/full 模式不回归）；真机验证留用户重载扩展后

### 给下一步的接力棒
- 协议新命令的 params 形状：
  - wait_for：`{ selector?, ref?, condition: visible|hidden|text_contains, text?, timeoutMs? 1000-30000 缺省 10000 }`，返回 `{ matched, url, pageState }`，超时非 error（matched:false 工具层转 isErrorResult）；轮询 400ms；readSafe（跳过 url 前缀检查）；ref 参与 generation 检查
  - readArticle：`{ selector? }`，扩展侧返回 `{ html, containerHtml?, url, title }`，主进程产 header + 全文 markdown（对齐内嵌不截断）；受策略站点计 1 篇笔记预算 + 正文过 riskScan
- 下个 step 该从哪里继续：Step 4（tab 预算）从 step4 文档继续；策略站点计预算的接法可参考 readArticle 的 policyGate 实现
- 待办：真机验证（readArticle 带/不带 selector、wait_for 三条件）；manifest bump 0.5.0 留 Step 6
