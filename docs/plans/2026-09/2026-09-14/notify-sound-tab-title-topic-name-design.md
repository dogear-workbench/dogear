# 通知声音统一 / tab 标题同步 / 话题初始名 设计

**背景**：三个独立小问题——① 系统 Toast 弹出时播 Windows 默认通知音，与应用内合成提示音（用户已调好响度/音色）不一致，后台时两音齐响；② 会话 tab 标题是打开瞬间的快照，后端自动起名后左侧列表更新但 tab 不更新；③ 话题名只在用户触发提炼（ReadGroupBackground）时生成，从不提炼的单会话话题永远显示"未命名话题"。

**目标**：
1. 通知声音统一走合成提示音（Toast 静音、行为保留）。
2. tab 标题实时反映会话最新标题。
3. 话题在第一个会话自动起名时获得初始名（打 `autoTitle` 标记），AI 提炼/用户改名可覆盖转正。

**架构**（核心做法 + 排除的选项）：

## ① Toast 静音
- `electron/main/services/session-notification-service.ts:93` `new Notification({ ..., silent: true })`。
- 通知触发场景、前台抑制、去重逻辑全部不变；声音只走 `playCue → playDogearSound` 合成链路。
- 用户关闭提示音开关（`ui.sound.enabled=false`）时后台事件完全无声——预期行为，与设置页文案"不调用 Windows 通知或系统提示音"一致。
- 排除：让 Toast 播放自定义音频文件（Electron Windows 下 `sound` 只支持系统音文件路径，无法指向合成音）；压制父会话唤醒轮通知（用户拍板保留）。

## ② tab 标题实时取
- `components/WorkspaceTabBar.tsx:105` 渲染时不再只用 `tab.conversationTitle` 快照，改为从 conversation-store 当前 conversations 里按 `tab.conversationId` 查最新 `title`，查到用实时值（空/'新对话' 兜底同现状），查不到（跨工作区/已删除）回退快照。
- 排除：主进程起名后发专用事件、loadConversations 后回写 tabs 快照——都新增事件链/写路径，渲染层直读最简且覆盖所有标题变更来源（自动起名、手动重命名等）。现有 `updateTitle` 快照写入路径保留不动。

## ③ 话题初始名 + autoTitle 标记
- `Group` 增加 `autoTitle?: boolean` 字段（`group-service.ts`，normalizeGroup 兼容旧数据：无字段=非自动）。
- 占坑：`electron/main/services/conversation-service.ts` autoUpdateTitleFromFirstMessage 写入 conv.title 成功后，若 conv.groupId 的 group 满足 `!group.title?.trim()`（不含 autoTitle 占坑名，占坑名存在时不重复占坑），`updateGroup({ title: 同样的截断标题, autoTitle: true })`，广播刷新照抄手动重命名路径（tipc/group.ts:53-58 的链路）。
- 提炼覆盖：`state-extract-prompt.ts:22-25` initialTitle 分支的条件从"组标题为空"放宽为"组标题为空**或为 autoTitle 占坑名**"；`background-store.ts:71-84` mergeIncrementAndSave 的守卫同步放宽，initialTitle 写入时清 `autoTitle`（转正）。
- 转正：手动重命名（tipc/group.ts）与 topicChange 用户确认联动（background-store.ts:113-121）写入 title 时一并清 `autoTitle`。
- UI 显示：占坑名正常显示，不做视觉区分。

**模块边界**：session-notification-service.ts / WorkspaceTabBar.tsx / group-service.ts + conversation-service.ts + state-extract-prompt.ts + background-store.ts + tipc/group.ts。三块互相独立，均为小改动。

**数据流**：
- ①：事件触发 → notify()（Toast silent）+ playCue()（唯一声音来源，走原有 soundCue IPC → playDogearSound）。
- ②：后端 title 变更 → conversationListChanged → loadConversations 刷 conversations → TabBar 渲染时实时读取。
- ③：首条消息 → autoUpdateTitleFromFirstMessage → conv.title +（组无名时）group.title{autoTitle:true} → 用户触发提炼 → initialTitle 覆盖并清标记，或用户手动改名/话题变更确认覆盖并清标记。

**错误处理 / 边界情况**：
- ① 用户关提示音后完全无声——预期。
- ② tab 对应会话已删除或属于其他工作区——回退快照，不报错。
- ③ 占坑时组已有名（含另一个会话先占坑）——跳过；旧 groups.json 无 autoTitle 字段——normalizeGroup 兼容，视为正式名。
- 提炼 initialTitle 与占坑名相同时：覆盖写入无副作用。

**未决问题**：无。
