---
step: 2
title: 扩展侧命令执行 + 风险护栏
status: done
---

## 目标

扩展 SW 能接收 command 帧、竞态校验、注入纯 DOM 函数执行 observe/click/fill/read_text 并回推结果——headful Edge 真实页面验证四命令与护栏。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1-protocol-command.md] sendExtensionCommand 已通（node 冒烟过）；CommandResult/errorCode 类型定稿
- 当前关键文件状态：`extension/src/background.js` NM 消息处理为扁平 if 链（hello/welcome/goodbye）；`chrome.scripting.executeScript({target:{tabId}, func})` 注入模式见 sendTabSnapshot（background.js:24-38）
- 一期纯函数平移源：`electron/main/agents/tools/browser-tools.ts` observe 执行体（:262-303 选择器匹配/可见性过滤/ref 打标/120 上限/region/text_filter）、click 验证口径（:320-365）、fill 回读（:380-410）、read_text（:425-455）——`new Function` 包裹的原因（主进程无 DOM lib）在扩展侧不存在，直接写普通函数
- 关键决策回顾：无常驻 content script；ref 属性 `data-dogear-ref="eN"` 页面自持；fill 需手工 `dispatchEvent(new Event('input', {bubbles:true}))`（React 受控组件）；guard 启发式宁可拦错

## 计划改动

- [x] `extension/src/dom-actions.js`（新建，纯 DOM 函数集，executeScript func 注入用）：
  - `observeFn(region?, textFilter?)`：平移一期逻辑——选择器组（a[href]/button/input/select/textarea/role 映射/contenteditable）→ 可见性过滤 → 打 `data-dogear-ref` → 返回 `{total, regionCounts, elements:[{ref,tag,role,text(80),hint}]}`
  - `clickFn(ref)`：定位元素 → **guard_submit 检查**（button[type=submit]、input[type=submit|image]、form 内无 type 的 button → 返回 errorCode guard_submit，不执行）→ click() → 轻量验证（URL 变化/元素消失/正文字数变化，平移 statsFn 口径）
  - `fillFn(ref, value)`：定位 → type=password 检查（guard_password）→ set value + dispatch input 事件 → 回读比对（value_mismatch）
  - `readTextFn(ref?)`：ref 元素 innerText 或正文容器（选择器组同 statsFn 取最长），8000 字截断
- [x] `extension/src/background.js`：`handleCommand(msg)`——tabId 与连接 tabId 校验（stale_tab）→ `chrome.tabs.query` 取当前 url 与 msg.url 前缀校验（navigated_away）→ executeScript 注入对应 func（params 走 args 第三参注入，不进函数体字符串）→ 回推 command_result；tab 不存在 → tab_closed；注入异常分类（权限 → permission_denied）
- [x] `extension/src/background.js`：observe/read_text 成功后顺带回推 `tab_snapshot`（复用 sendTabSnapshot，状态行随命令刷新）
- [x] 验证（headful Edge + dev electron，NODE_ENV=development，临时 DOGEAR_CONFIG_DIR）：
  - 四命令 + 护栏 + 竞态全部以「独立 gateway 进程（pipe 常量替换）+ 真实 Edge headful + CDP 自动化」验证（详见交付文档，因安装版 Dogear 占用真实 pipe，方案经 step1 先例调整）
- [x] 回归：lint / build:electron / 管线 20/20；P0 状态行行为不变

## 实施回填（做完后填）

### 实际改动
- 新建 `extension/src/dom-actions.js`（189 行）：observeFn/clickFn/fillFn/readTextFn 四个完全自包含的注入函数（函数体不引用模块作用域，executeScript 序列化约束）；observe 平移一期选择器组/可见性/ref 打标/120 上限/region/textFilter；click 含 guard_submit 三类拦截 + 400ms settle 轻量验证（URL/元素消失/正文字数）；fill 含 guard_password（自身 password 或祖先 form 内含 password）+ React 兼容 native setter 注入 + contenteditable/select 分支 + 回读比对；readText 含正文容器取最长与 8000 截断；ref 格式校验 `/^e\d+$/` 防选择器注入
- 改 `extension/src/background.js`（261 行）：新增 COMMAND_FUNCS 分发/postResult/executeScriptWithTimeout（8s 注入超时竞赛）/resolveLostClickResult（4×250ms 轮询 URL 变化）/handleCommand（stale_tab→tab_closed→navigated_away 前置校验→注入执行→异常分类 permission_denied/navigated_away→函数内 errorCode 透传）；onHostMessage 加 command 分支；observe/read_text 成功后回推 tab_snapshot
- 与计划差异：
  1. **args 序列化修正**：executeScript 的 args 数组中 undefined 必须映射为 null（Chrome scripting API 拒绝非 JSON-serializable 值，observe 无参时 args 全 undefined 导致注入失败）
  2. **注入超时竞赛（关键）**：click 触发导航后注入上下文被销毁，executeScript 的 Promise 永不 settle（不 reject、result 不为 null，而是无限挂起）——SW 侧必须自建 8s 超时竞赛，超时后走 URL 检测兜底（tab 已导航 → ok clicked+navigated；未变 → navigated_away），否则命令只能靠 gateway 30s 超时且语义错误
  3. **Edge SW 脚本缓存**：复用 user-data-dir 时完全重启 Edge 后 SW 仍可能加载旧代码（比 P0 记录的 reload() 不可靠更进一步）——改扩展代码后必须删 profile 再重启
  4. 验证拓扑：安装版 Dogear 占用真实 pipe，采用 step1 先例（临时拷贝 dist 三文件 + nm-bridge-worker 替换 pipe 常量为 `dogear-nm-gateway-step2-test`）+ 独立 node gateway 进程 + 临时扩展拷贝 manifest 硬授权 host_permissions + 手工 HKCU NM 注册（结束后已恢复安装版原值）
- 改动文件清单：`extension/src/dom-actions.js`（新）、`extension/src/background.js`

### 给下一步的接力棒
- 关键签名 / 数据结构：command_result 失败时 `{ok:false, errorCode(12值), error(中文)}`，成功 `{ok:true, data}`；data 各命令形状——observe `{total,regionCounts,elements[{ref,tag,role,text,hint}]}`、click `{urlBefore,urlAfter,elementGone,textBefore,textAfter}` 或导航兜底 `{clicked:true,navigated:true,urlAfter,verification:'lost'}`、fill `{applied:true}`、read_text `{text,totalLength}`；gateway `sendExtensionCommand(kind, params, timeoutMs=30000)` 契约不变
- 下个 step 该从哪里继续：step3（域名授权 popup UI + gateway 纵深防御 + authorizedOrigins 持久化）；扩展侧 handleCommand 已按「executeScript 异常消息含 cannot access/permission → permission_denied」分类，step3 popup 授权后该路径自然收敛为纵深防御
- 待办或已知限制：stale_tab 在单连接模型下无法端到端自然构造（已用 mock chrome 单测覆盖）；click 导航兑底走 8s 注入超时 + URL 轮询，验证全绿；`注入函数体内不得引用模块作用域` 约束已在 dom-actions.js 头部注释
