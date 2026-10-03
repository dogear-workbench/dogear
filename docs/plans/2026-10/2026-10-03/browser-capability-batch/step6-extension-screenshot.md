---
step: 6
title: 扩展通道截图
status: pending
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
- 改动文件清单：

### 给下一步的接力棒
- 截图落盘路径约定：
- 待办或已知限制：
