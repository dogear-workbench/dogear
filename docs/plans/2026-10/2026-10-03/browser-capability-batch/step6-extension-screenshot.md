---
step: 6
title: 扩展通道截图
status: done
---

## 目标

扩展通道补 `extension__screenshot`：agent 可截取 Chrome 侧页面（含用户焦点页与蓝组 tab），产出 PNG 供 read 识图。

## 依赖上下文（接力棒输入）

- **依赖 Step 1**：read 图片分支已修（否则截图无人能看），复测已证 Flash 识图可用
- 权限：manifest 现有 `tabs`（`chrome.tabs.captureVisibleTab` 在 tabs 权限下可用；实施时核对 manifest 权限声明与安装警告变化，若需 `<all_urls>` 或 activeTab 需在文档说明权衡）
- 内嵌对照：`browser-tools.ts` screenshot 工具（存 `.dogear/tmp/dogear-browser-{ts}.png`、返回 file+url、emitAction 动作流）
- 协议：双副本加 `capture` 命令（params：tabId 可选，缺省焦点 tab），background 用 `chrome.tabs.captureVisibleTab`（注意：只能截**可见** tab——目标 tab 需 active；蓝组在后台窗口，需 `chrome.tabs.update(tabId, {active:true})` 瞬时激活或用 `chrome.windows.update` 聚焦窗口，截完还原；实施时验证这条约束）
- manifest 全局决策：bump 0.5.0（与 step3 同版本一起发）

## 计划改动

- [ ] 协议双副本加 capture 命令；background.js 实现：激活目标 tab → captureVisibleTab → 还原原 active tab → 回传 base64
- [ ] 主进程 `extension-tools.ts` 注册 `extension__screenshot`：base64 落盘 `.dogear/tmp/`（对齐内嵌命名）、返回路径 + read 引导文案、emitAction
- [ ] 工具描述与内嵌 screenshot 对齐（「read 可读」）
- [ ] 验证：真机——agent 截蓝组 tab 与用户焦点页各一张，read 后能描述内容；扩展断连/窗口关闭返回明确错误

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 权限结论：无需新增权限——manifest 已有 <all_urls>，captureVisibleTab 直接可用，安装警告无变化，仅 bump 0.5.0
  - 蓝组后台窗口约束核实：captureVisibleTab 物理上必须截「窗口当前激活 tab」，后台窗口瞬时拉前台再还原（getLastFocused 记录原聚焦窗口，截完还原焦点+激活 tab），UI 闪动不可避免（工具描述已说明）；切走再切回留出合成器重绘时间防截到旧帧
  - 节奏/预算决策：截图不纳入 paceActionGate（零网站请求）、不接 policyGate/预算（返回图片非文本，对齐内嵌 screenshot），接 acquireGate 通道独占
  - 组内安全双保险：工具层校验 tab_id ∈ status.tabs + 扩展侧 isInDogearGroup（tab-commands.js 导出）权威校验，截不了分组外 tab
  - 配套改动：createExtensionToolDefs 加 workspacePath opts（落盘需要），tool-assembly 主/子会话两处传入；runCommand 加 opts 参数透传帧级 tabId
- 改动文件清单：
  - `electron/main/services/browser/nm-protocol.ts` + `extension/src/nm-protocol.js`（capture 命令，params: tabId? 缺省焦点 tab）
  - `extension/src/background.js`（激活→captureVisibleTab→还原，含蓝组窗口与重绘等待）
  - `extension/src/tab-commands.js`（isInDogearGroup 导出）
  - `extension/manifest.json`（bump 0.5.0，无权限变更）
  - `electron/main/agents/tools/extension-tools.ts`（注册 dogear__extension__screenshot：落盘 .dogear/tmp/dogear-extension-{ts}.png + read 引导 + emitAction + 描述对齐内嵌）
  - `electron/main/agents/tools/extension-command-shared.ts`（runCommand opts 透传 tabId）
  - `electron/main/agents/pi-session/tool-assembly.ts`（workspacePath 传入，主/子会话两处）
- 验证：node --check 扩展 js、build:electron、lint 零新增均过；真机 6 场景验证清单在共享区交付文档，留用户重载扩展 0.5.0 + 重启桌面端后执行

### 给下一步的接力棒
- 截图落盘路径约定：`.dogear/tmp/dogear-extension-{Date.now()}.png`（与内嵌 dogear-browser-{ts}.png 命名区分）；read 工具两链路均支持图片（Step 1 已验证）
- 待办或已知限制：DRM 页可能黑帧；截图期间用户手动切窗会与还原逻辑竞争；真机验证待用户（重载扩展 + 重启桌面端）
