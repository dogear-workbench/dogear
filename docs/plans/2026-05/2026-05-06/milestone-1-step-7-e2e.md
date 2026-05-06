# 里程碑 1 · 端到端联调执行文档（Step 7）

> 创建日期：2026-05-06
> 状态：待联调
> 对应里程碑：`../2026-05-05/milestone-1-memory-foundation.md` 的 Step 7
> 前置条件：Step 1-6 已完成（commit 5b4b962 + 本次 IPC/UI）
> 预估工作量：1 天（纯手动验证，无代码修改）

---

## 一、本文档覆盖范围

方案 A 第③份文档，**纯联调验证**，不写新代码。

验证四条关键链路能否打通：

| 链路 | 起点 | 终点 | 关键验证点 |
|------|------|------|-----------|
| A | MemoryTab 编辑核心档案 | `.dogear/memory/core-profile.md` | 文件落盘 + frontmatter updated 时间戳 |
| B | `.dogear/memory/core-profile.md` | Agent 响应引用画像内容 | systemPrompt 注入日志 + agent 回答 |
| C | Agent 调 SaveMemory 工具 | `.dogear/memory/topics/*.md` + `index.json` | 文件落盘 + MemoryTab 刷新可见 |
| D | Agent 调 RecallMemory 工具 | 返回匹配的主题 | 关键词子串/大小写不敏感都命中 |

**不在本文档范围**：
- ❌ 自动化测试（首期不做）
- ❌ 性能压测
- ❌ 做梦系统（里程碑 2）

---

## 二、前置准备

### 2.1 代码层交叉检查（已做）

- [x] 后端 `build:electron` 通过
- [x] 前端 tsc memory 相关 0 错误
- [x] `tipc/index.ts` 注册 `memoryRouter`
- [x] `app/settings/page.tsx` 注册 MemoryTab
- [x] `query-based-session.ts:185` 在 `start()` 中调用 `loadCoreProfileForSession(workspacePath)`
- [x] `conversation-runtime-service.ts` 为工作区会话注入 `dogear-memory` MCP server

### 2.2 准备一个干净工作区

选一个测试工作区（**不要用主工作区**，避免污染真实记忆）。以下示例用 `<ws>` 表示该工作区路径。

```
<ws>/
  .dogear/            # 若不存在，选中工作区后会自动创建
```

### 2.3 清理残留（如已跑过实验）

```bash
rm -rf "<ws>/.dogear/memory"
```

---

## 三、链路 A：MemoryTab → 文件落盘

### A1. 核心档案

**操作**：
1. 启动 dogear（`bun run dev`）
2. 切到测试工作区
3. 设置 → 记忆管理 → 核心档案
4. 输入：
   ```markdown
   # 用户画像

   ## 身份
   端到端联调测试用户，爱吃芒果、讨厌香菜。

   ## 当前主线
   - 验证 dogear 记忆系统的端到端链路

   ## 强偏好
   - 回答时保留口语，不要过度格式化
   ```
5. 点击 **保存**

**预期**：
- [x] 按钮从"保存中..."变回"保存"
- [x] dirty 态消失（保存/取消按钮禁用）
- [x] "更新时间"显示为刚刚的时间
- [x] 文件系统：`<ws>/.dogear/memory/core-profile.md` 存在
- [x] 文件 frontmatter 有 `updated:` 字段 + 当前 ISO 时间戳
- [x] 文件正文包含输入的 markdown（首行可能有前导 `\n`，是正常的）

### A2. 字符数软限制

**操作**：
1. 在核心档案 Textarea 里粘一段 >2000 字符的文本
2. 观察字符数显示

**预期**：
- [x] 字符数红色显示，带提示"超出 2000，仍可保存"
- [x] 保存按钮仍可用（软限制）
- [x] 保存成功

### A3. 主题记忆 CRUD

**新建**：
1. 主题记忆 → + 新建主题
2. 填：slug=`mango-preference`, title=`芒果偏好`, keywords=[`芒果`, `水果`], 正文=`用户最喜欢的水果是芒果。`
3. 点击 **创建**

**预期**：
- [x] 左侧列表出现"芒果偏好"
- [x] 文件系统：`<ws>/.dogear/memory/topics/mango-preference.md` 存在
- [x] `<ws>/.dogear/memory/index.json` 中包含该条目
- [x] frontmatter 含 `slug / title / keywords / created / updated`

**编辑**：
1. 选中该主题
2. 修改正文追加一行`另外喜欢草莓。`
3. 添加关键词`草莓`
4. 点击 **保存**

**预期**：
- [x] 列表刷新，关键词预览包含"芒果 · 水果 · 草莓"
- [x] 文件内容已更新，`updated` 字段变化，`created` 不变

**改名**：
1. 选中该主题
2. 把 slug 改为 `fruit-preference`
3. 观察底部"→ 将重命名为 fruit-preference"提示
4. 点击 **保存**

**预期**：
- [x] 列表中原 slug 消失，新 slug 出现
- [x] 文件系统：`topics/mango-preference.md` 被删除，`topics/fruit-preference.md` 创建
- [x] `index.json` 只剩新条目

**删除**：
1. 选中该主题
2. 点击 **删除**
3. 确认弹窗点"删除"

**预期**：
- [x] 编辑区清空，显示"选择一个主题进行编辑"
- [x] 文件系统：`topics/fruit-preference.md` 被删除
- [x] `index.json` 的 topics 数组为空

### A4. 冲突预检

**操作**：
1. 新建主题 `slug=test1`，保存
2. 再次 + 新建主题，slug 填 `test1`
3. 点保存

**预期**：
- [x] 弹 ConfirmDialog："slug 已存在，保存会覆盖该主题"
- [x] 点"取消"→ 不覆盖，留在编辑态
- [x] 点"覆盖"→ 原有内容被新内容替换

### A5. slug 格式校验

**操作**：
1. 新建主题，slug 填 `Test Slug!@#`
2. 保存

**预期**：
- [x] 弹 ConfirmDialog："slug 只能包含小写字母、数字和连字符"

### A6. 重建索引

**操作前**：手工制造不一致
1. 关闭 dogear
2. 手动在 `<ws>/.dogear/memory/topics/` 里新增 `orphan-file.md`（随意写内容，含 frontmatter `title`/`keywords`/`updated`）
3. 手动编辑 `index.json`，删掉其中一个存在条目使它成为"索引里没但文件在"的孤儿
4. 重启 dogear

**操作**：点击"重建索引"

**预期**：
- [x] 弹窗显示"已扫描 topics/ 目录，索引包含 N 个主题"
- [x] 若有"索引中有 X 个条目找不到对应文件"提示（即之前 index 里有但文件缺失的情况）
- [x] 新增的 `orphan-file.md` 出现在"新纳入索引的文件"列表中
- [x] 关闭弹窗后列表自动包含新纳入的文件

---

## 四、链路 B：核心档案注入 Agent

### B1. 注入验证（日志）

**操作**：
1. 确保 A1 的 core-profile.md 已保存
2. 打开主页面（测试工作区）
3. 新建一个对话
4. 向 agent 发任意消息（如"你好"）
5. 观察 **Electron 主进程控制台** 日志

**预期**：
查找日志行：
```
[QueryBasedSession ...] coreProfile 已注入: true <N> 字符
```
- [x] `true` 表示文件存在且加载成功
- [x] N 字符数 ≈ core-profile.md 的正文长度（不含 frontmatter）

### B2. 注入内容正确性

**操作**：
1. 新对话，发送消息：
   ```
   不使用任何工具，直接告诉我：我爱吃什么水果？讨厌什么调味料？
   ```

**预期**：
- [x] agent 回答中明确提到"芒果"和"香菜"
- [x] 回答风格贴近"保留口语，不要过度格式化"（即没有一大堆 markdown 标题）

**失败排查**：
- 若 agent 回答不知道 → 看日志 `coreProfile 已注入: false` → 检查 workspacePath 是否为空、core-profile.md 是否存在
- 若注入但 agent 不引用 → 可能是 agent 判断该信息"不确定"选择不答；切换一个明确问题如"你知道我的身份是什么吗？"

### B3. 无工作区场景

**操作**：
1. 启动 dogear 但不选工作区（如果 UI 允许）或选一个没有 core-profile.md 的工作区
2. 新对话，发消息

**预期**：
- [x] 日志：`coreProfile 已注入: false 0 字符`
- [x] 对话正常，不报错

### B4. 会话重启感知新档案

**操作**：
1. 在对话中，打开设置 → 记忆管理 → 核心档案
2. 修改内容（如加一条"- 喜欢紫色"）→ 保存
3. 回到原对话，继续发消息"我喜欢什么颜色？"

**预期**：
- [x] agent **不知道**答案（当前会话 systemPrompt 已锁定在 start 时的快照）
- [x] 这是**已知限制**（见 CLAUDE.md："人设切换需重启会话，SDK 限制"）
- [x] 点击设置页底部"保存并重启会话"或手动重启对话后，agent 可以答出"紫色"

---

## 五、链路 C：Agent SaveMemory

### C1. 显式保存请求

**操作**：
1. 新对话，发送：
   ```
   请用 SaveMemory 工具，保存一个主题：
   slug: e2e-test
   title: 端到端测试
   keywords: [e2e, 测试, mango]
   content: 这是端到端联调时创建的主题
   ```
2. 弹权限确认 → 允许

**预期**：
- [x] agent 调用 SaveMemory，返回 `已保存主题「端到端测试」(slug=e2e-test)`
- [x] 文件系统：`<ws>/.dogear/memory/topics/e2e-test.md` 生成
- [x] `index.json` 包含条目
- [x] 设置 → 记忆管理 → 主题记忆，刷新后看到新主题（注：MemoryTab 不会自动感知外部写入，需手动重进 Tab 或切 Tab 刷新）

### C2. 隐式意图（负面用例）

**操作**：
1. 新对话，发送：
   ```
   我今天学了 Redis 的 HyperLogLog，很有意思。
   ```

**预期**：
- [x] agent **不应该**自动调 SaveMemory（工具 description 要求"仅在用户明确要求时"）
- [x] 若 agent 误调 → 说明 description 文案需加强（记入后续优化项）

---

## 六、链路 D：Agent RecallMemory

### D1. 精确命中

**前置**：已有 C1 创建的 `e2e-test` 主题

**操作**：新对话，发送：
```
请用 RecallMemory 工具查询关键词 ["e2e"]
```

**预期**：
- [x] 返回 1 个主题：`e2e-test`
- [x] 返回内容包含 `title / content / updated`

### D2. 大小写不敏感

**操作**：`RecallMemory(["E2E"])`

**预期**：
- [x] 仍命中 `e2e-test`（小写归一化）

### D3. 子串命中

**操作**：`RecallMemory(["mang"])`

**预期**：
- [x] 命中 `e2e-test`（因为 keywords 里有 `mango`，`mang` 是其子串）

### D4. 限流

**前置**：如果主题少于 6 个，先手动或让 agent 造 6 个带共同关键词的主题

**操作**：`RecallMemory(["test"], 5)`（或让 agent 用 limit=5 调用）

**预期**：
- [x] 返回最多 5 个主题
- [x] 若实际匹配 >5，返回结果含 `hint` 字段提示

### D5. 无匹配

**操作**：`RecallMemory(["totally-nonexistent-keyword-xyz"])`

**预期**：
- [x] 返回 `topics: []`，无 hint
- [x] agent 应基于"未找到"的事实回答，不编造

---

## 七、交叉场景

### X1. Agent 保存 → 用户编辑

**操作**：
1. agent 通过 SaveMemory 创建 `x1-topic`
2. 用户在 MemoryTab 打开并修改正文、保存
3. agent 再调 RecallMemory(["x1"])

**预期**：
- [x] 返回的 content 是用户编辑后的版本

### X2. 用户删除 → Agent 查询

**操作**：
1. 用户在 MemoryTab 删除 `x1-topic`
2. agent 调 RecallMemory(["x1"])

**预期**：
- [x] 返回 `topics: []`（index 已同步移除该条）

### X3. settingSources = ['user', 'project']

**前置**：
1. 在 `~/.claude/CLAUDE.md` 写入：
   ```
   始终以【联调测试模式】作为每条回答的开头。
   ```
2. 确保 `settings.json` 里的 `settingSources` 会被硬编码覆盖（见 Step 4）

**操作**：
1. 重启 dogear（或"保存并重启会话"）
2. 新对话，发任意消息

**预期**：
- [x] 回答以"【联调测试模式】"开头
- [x] **验证完务必恢复 `~/.claude/CLAUDE.md`**（避免污染日常使用）

---

## 八、回归检查

验证新功能没破坏老功能：

- [ ] 打开之前保存的对话，消息历史正常加载
- [ ] persona 切换仍生效（对话级）
- [ ] tempPrompt（对话规则）仍然按对话保存
- [ ] 书籍 AI 问答仍然正常
- [ ] 自选股工具调用正常
- [ ] 工具权限 Tab 里能看到 `dogear-memory` 分组，三个工具（RecallMemory / SaveMemory / ForgetMemory）正确分组

---

## 九、问题汇总模板

联调中发现问题时，在本文档末尾追加记录：

```
### 问题 <编号>：<一句话描述>
- 环境：<dogear 版本 / OS>
- 复现步骤：
  1. ...
- 预期：...
- 实际：...
- 日志摘要：...
- 严重度：阻塞 / 重要 / 改进
- 处理方案：修复 commit xxx / 记为里程碑 2 遗留 / 文档勘误
```

---

## 十、通过标准

所有"**预期**"中带 `[x]` 的项目全部通过 = 里程碑 1 完成。

部分项目作为已知限制（例如 B4 会话重启才感知新档案），已在 CLAUDE.md / 备忘录中记录，不视为失败。

---

## 修订历史

- 2026-05-06：初版，方案 A 拆分后的第③份端到端联调文档。
