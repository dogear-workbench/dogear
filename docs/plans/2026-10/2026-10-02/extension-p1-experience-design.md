# 扩展通道 P1 体验升级设计

**背景**：P0（协议 v4 / tab 管理 / 移交 / 确认放行）四轮真机回归收敛，五个实现 bug 修复，核心闭环全部验证通过。用户实测后拍板三项体验升级：全面自动化连接、agent 独立窗口、移交草稿引用；回归过程中另确认三项探索交互增强。

**目标**：用户浏览器通道从「需要手动连接、抢占前台、移交直发」升级为「装好即用、独立窗口后台干活、移交可编辑」的自治通道。

## 主题一：通道自治

### 1. 自动连接 + 去页面绑定

- SW 冷启动（顶层代码）即尝试 connectNative，不依赖用户点连接
- 桌面端未运行 → 立即断开 → 固定 30s alarm 重试（不做指数退避，简单优先）；SW 被任何事件唤醒时也顺带重试
- `connect()` 不再 `getActiveTab()` 设初始焦点：state.tabId 置空（NO_FOCUS_TAB_ID 空闲态，gateway 已支持），焦点完全由 agent 的 open_tab/close_tab/click 管理
- popup 改造：
  - 「连接此标签页」→「**把当前页交给 Dogear**」：连接态下把当前活动 tab 设为操作焦点（只设焦点，**不入组**——组在 agent 窗口，入组会把用户正在看的页面拉走；组外身份让 close_tab 组保护天然生效，agent 关不掉用户页面）
  - 「断开连接」保留；断开 = 记 manualDisconnected 标记，停止自动重连，用户再点连接或重启浏览器后恢复自动
- 安全层不动：域名授权、提交确认、支付黑名单全部维持

### 2. agent 独立窗口

- open_tab 不再在用户当前窗口开页，改为解析/维护 **Dogear 专属后台窗口**：
  1. `storage.local.dogearWindowId` 存在且 `windows.get` 存活 → 复用
  2. 否则查 Dogear 组（tabGroups.query）→ 组所在窗口 → 复用并存 id
  3. 都无 → `chrome.windows.create({ focused: false })` 建后台窗口并存 id
- tabs.create 指定 windowId；ensureDogearGroup 逻辑不变（组跟 tab 走，自然锚定在 agent 窗口）
- 窗口生命周期：组空后**窗口保留**（后台不碍事，下次复用）；用户手动关掉整个 agent 窗口 = 组消失 = list_tabs 空（用户主动干预，语义可接受），下次 open_tab 自动重建
- 「把当前页交给 Dogear」指定的 tab 留在用户窗口，跨窗口 executeScript 按 tabId 操作无障碍

## 主题二：移交草稿引用

- 右键/popup「发送到 Dogear」→ handoff 帧到达后**不再 session.sendMessage 直发**
- 新链路：gateway page_handoff → tipc 广播 → 渲染层新 store（`stores/handoff-draft-store.ts`）挂起草稿（conversationId → 引用块数组）；目标会话打开时输入框上方渲染待发送引用块（标题+URL+正文快照折叠），用户可删可补意图，随下一条消息一起发出
- 同会话多次移交 → 引用块**累加**排队
- 通知中心：type conversation 通知文案改「有待编辑的浏览器移交」，点击跳目标会话
- 空会话场景不变（「未找到可接收的会话」通知）
- 目标会话路由不变（最近活跃存活会话，extension-handoff.ts 单点）

## 主题三：探索交互增强

### 4. click 新 tab 检测回报

- click 命令执行后，background 检测组内 tab 增量（点击前快照 vs 点击后 ~1.5s 内轮询 2 次）；新 tab 出现 → 回报「已在新标签页打开 {title}（tabId N）」替代误导性的「无明显变化」
- 依赖 Chrome 原生行为：组内 tab 打开的 _blank 新 tab 自动入组（第五轮已实证），无需自行入组

### 5. _blank 焦点跟随

- 检测到 click 诱导的新 tab → setFocusedTab(新 tab) + pushSnapshot，回报注明「焦点已切至新标签页」
- 与 open_tab 的焦点语义一致：开新页即焦点，探索流点开链接直接可读

### 6. 合成事件序列 + find 可见性

- `clickFn`（dom-actions.js）从单 `el.click()` 增强为完整序列：pointerdown → mousedown → pointerup → mouseup → click（PointerEvent/MouseEvent 构造，bubbles + composed）；兼容依赖 pointer events 的组件库
- find 结果每项加 `visible` 标注（offsetParent/getBoundingClientRect 判定），第五轮「热点频道」零效果疑似点中同名隐藏副本；click 命中不可见元素时回包附提示「目标是隐藏元素，结果可能无效，建议换 visible 元素」

## 模块边界

| 层 | 文件 | 改动 |
|----|------|------|
| 扩展 | background.js | 自动连接/重连、popup 命令改造、click 新 tab 检测+焦点跟随 |
| 扩展 | tab-commands.js | open_tab 走 agent 窗口、手动指定焦点入口 |
| 扩展 | dom-actions.js | clickFn 事件序列 |
| 扩展 | find-actions.js | visible 标注 |
| 扩展 | popup.html/js | 按钮/文案改造 |
| 桌面端 | browser-gateway.ts | （如需）焦点空态语义核对 |
| 桌面端 | extension-handoff.ts | 直发改广播草稿 |
| 桌面端 | tipc/browser.ts | handoff 广播接线 |
| 前端 | stores/handoff-draft-store.ts（新） | 草稿状态 |
| 前端 | 会话输入区组件 | 引用块渲染/删除/随消息发送 |

## 错误处理 / 边界

- 自动重连风暴防护：重试前检查 port 已存在则跳过；manualDisconnected 标记优先
- agent 窗口被用户关闭：open_tab 时 windows.get 抛错 → 走重建分支，不报错
- 草稿对应会话被删除：store 清理（订阅会话删除事件或渲染时校验）
- click 新 tab 检测窗口期内组被用户清空：轮询拿到空集 → 按无新 tab 回报，不抛错

## 未决问题（实施时定）

- click 新 tab 检测轮询参数（间隔/次数）真机调优
- 移交草稿与输入框已有草稿（用户未发完的文本）的拼接顺序：草稿引用块固定在用户文本之前
- agent 窗口 focused:false 在不同 OS/窗口管理器下的实际表现（Windows 下是否真的不抢前台）
