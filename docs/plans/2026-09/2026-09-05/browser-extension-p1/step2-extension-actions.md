---
step: 2
title: 扩展侧命令执行 + 风险护栏
status: pending
---

## 目标

扩展 SW 能接收 command 帧、竞态校验、注入纯 DOM 函数执行 observe/click/fill/read_text 并回推结果——headful Edge 真实页面验证四命令与护栏。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1-protocol-command.md] sendExtensionCommand 已通（node 冒烟过）；CommandResult/errorCode 类型定稿
- 当前关键文件状态：`extension/src/background.js` NM 消息处理为扁平 if 链（hello/welcome/goodbye）；`chrome.scripting.executeScript({target:{tabId}, func})` 注入模式见 sendTabSnapshot（background.js:24-38）
- 一期纯函数平移源：`electron/main/agents/tools/browser-tools.ts` observe 执行体（:262-303 选择器匹配/可见性过滤/ref 打标/120 上限/region/text_filter）、click 验证口径（:320-365）、fill 回读（:380-410）、read_text（:425-455）——`new Function` 包裹的原因（主进程无 DOM lib）在扩展侧不存在，直接写普通函数
- 关键决策回顾：无常驻 content script；ref 属性 `data-dogear-ref="eN"` 页面自持；fill 需手工 `dispatchEvent(new Event('input', {bubbles:true}))`（React 受控组件）；guard 启发式宁可拦错

## 计划改动

- [ ] `extension/src/dom-actions.js`（新建，纯 DOM 函数集，executeScript func 注入用）：
  - `observeFn(region?, textFilter?)`：平移一期逻辑——选择器组（a[href]/button/input/select/textarea/role 映射/contenteditable）→ 可见性过滤 → 打 `data-dogear-ref` → 返回 `{total, regionCounts, elements:[{ref,tag,role,text(80),hint}]}`
  - `clickFn(ref)`：定位元素 → **guard_submit 检查**（button[type=submit]、input[type=submit|image]、form 内无 type 的 button → 返回 errorCode guard_submit，不执行）→ click() → 轻量验证（URL 变化/元素消失/正文字数变化，平移 statsFn 口径）
  - `fillFn(ref, value)`：定位 → type=password 检查（guard_password）→ set value + dispatch input 事件 → 回读比对（value_mismatch）
  - `readTextFn(ref?)`：ref 元素 innerText 或正文容器（选择器组同 statsFn 取最长），8000 字截断
- [ ] `extension/src/background.js`：`handleCommand(msg)`——tabId 与连接 tabId 校验（stale_tab）→ `chrome.tabs.query` 取当前 url 与 msg.url 前缀校验（navigated_away）→ executeScript 注入对应 func（params 走 args 第三参注入，不进函数体字符串）→ 回推 command_result；tab 不存在 → tab_closed；注入异常分类（权限 → permission_denied）
- [ ] `extension/src/background.js`：observe/read_text 成功后顺带回推 `tab_snapshot`（复用 sendTabSnapshot，状态行随命令刷新）
- [ ] 验证（headful Edge + dev electron，NODE_ENV=development，临时 DOGEAR_CONFIG_DIR）：
  - `edge://extensions` 重载扩展 → 连接 → 任开普通页（如 developer.mozilla.org）手动 `chrome.permissions.request` 或临时硬授权后测四命令（观察结果/ref 连续性/click 导航/readText 截断）
  - 护栏：构造含 password 框与 form submit 按钮的本地测试页（`<meta charset="utf-8">` 教训），验证 guard_password/guard_submit 触发与文案
  - 竞态：命令执行前关 tab（tab_closed）/ 先导航再发命令（navigated_away）
  - 方式参考 P0 step4：popup.html 作为 page target 走真实按钮路径 + 主进程侧 node 脚本经 sendExtensionCommand 发命令断言结果
- [ ] 回归：lint / build:electron / 管线 20/20；P0 状态行行为不变

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
