# 执行文档：Step 0 - 清理遗留字段与 UI 文案

> 创建日期：2026-05-06
> 类型：可独立执行的实施文档（新会话可直接按此执行）
> 预估时长：0.5 天
> 所属里程碑：[里程碑 1：规则文件化 + 静态记忆系统](../2026-05-05/milestone-1-memory-foundation.md)
> 前置依赖：无

---

## 上下文（新会话必读）

dogear 项目即将开展"记忆大脑"功能（里程碑 1），在开始加新代码前需要先做一次清理。本次清理只做两件事：

1. **移除 `systemPromptAppend` 字段**（已 `@deprecated`，是全局 system prompt 污染源）
2. **修正 `tempPrompt` 的 UI 文案**（字段语义为"对话私有持久"，但 UI 叫"临时提示词"，词不达意）

**本次任务完全不改变字段行为、数据结构、存储位置**。只清除废弃代码 + 改文案。

### 为什么做这件事

- `systemPromptAppend` 是早期全局追加 prompt 字段，后被 `persona + tempPrompt` 替代。标记 `@deprecated` 但代码里还在拼接，`.dogear/settings.json` 里一条测试用的旧值一直被注入所有对话。
- `tempPrompt` 字段 UI 叫"临时提示词"，实际存在 `conversations.json` 里，跟随对话归档/重开都在——**实际是"对话私有持久"语义**。UI 文案让用户误以为用完就清。
- 不先清理，里程碑 1 要在 `buildSystemPrompt()` 里新增 `core-profile` 注入时，会变成拼接 6 个来源，心智负担过大。

### 项目约定

- 项目用 **Bun** 不用 npm
- 所有改动需 `bun run build:electron` 重新编译主进程（Vite 热重载只对前端生效）
- 项目 CLAUDE.md 明确"开发阶段不做兼容" —— 本次可大胆删除 deprecated 字段

---

## 任务清单

### 任务 1：移除 `systemPromptAppend` 字段

#### 1.1 修改类型定义

**文件**：`types/settings.ts`

找到 `AppSettings['ai']` 中的字段定义（约第 44 行附近）：

```typescript
systemPromptAppend?: string; // @deprecated 旧版追加提示词，向后兼容保留
```

**操作**：直接删除此行。

---

**文件**：`electron/main/services/settings-types.ts`

找到对应的字段定义（约第 38 行附近）：

```typescript
systemPromptAppend?: string;  // @deprecated 旧版追加提示词，向后兼容保留
```

**操作**：直接删除此行。

#### 1.2 移除 buildSystemPrompt 的拼接逻辑

**文件**：`electron/main/agents/query-based-session.ts`

找到 `buildSystemPrompt` 方法中的这段（约第 1404-1407 行）：

```typescript
    // 6. 向后兼容旧版 systemPromptAppend
    if (appSettings.ai.systemPromptAppend) {
      parts.push(`\n${appSettings.ai.systemPromptAppend}`);
    }
```

**操作**：整块删除（连同注释）。

同时更新同方法上方的注释（约第 1380 行）：

```typescript
   * append 组成顺序：默认提示词 → Skills 说明 → 人设 → 临时提示词 → 上下文 → 旧版兼容
```

**操作**：改为：

```typescript
   * append 组成顺序：默认提示词 → 人设 → 临时提示词
```

注：注释里提到的 "Skills 说明" "上下文" 等在当前代码里没有对应拼接，一并清理为实际内容。

#### 1.3 清理用户数据

**文件**：`.dogear/settings.json`

找到 `ai.systemPromptAppend` 字段（如果存在），**整行删除**。

> 注意：这是用户数据文件，不能通过自动迁移删除。手动编辑 JSON 即可。如果该字段不存在，跳过此步。

#### 1.4 全局搜索确认无残留

运行以下搜索，确认项目代码中不再有 `systemPromptAppend` 的使用（文档里的出现可以忽略）：

```bash
# 用 Grep 工具搜索
pattern: systemPromptAppend
```

**预期结果**：只在 `docs/` 目录下可能还有历史文档提到这个字段（例如 `docs/plans/2026-04/2026-04-26/deepseek-v4-integration-plan.md`），这些**不需要改**。

如果代码文件里（`.ts` / `.tsx`）还有残留，继续清理。

---

### 任务 2：修正 tempPrompt 的 UI 文案

**关键原则：不改字段名、不改数据结构、不改 IPC 接口。只改用户可见的文字描述。**

#### 2.1 修改 PromptSidebar 的 UI 文案

**文件**：`components/PromptSidebar.tsx`

**改动点 1**（约第 108 行）：

```tsx
                    临时提示词：已设置
```

改为：

```tsx
                    对话规则：已设置
```

**改动点 2**（约第 180 行的注释）：

```tsx
              {/* 临时提示词 */}
```

改为：

```tsx
              {/* 对话规则（持久绑定此对话） */}
```

**改动点 3**（约第 182 行的标签）：

```tsx
                <label className="text-xs font-medium text-muted-foreground">临时提示词</label>
```

改为：

```tsx
                <label className="text-xs font-medium text-muted-foreground">对话规则</label>
```

**改动点 4**（约第 185-187 行，Textarea 的 placeholder）：

```tsx
                <Textarea
                  value={localTempPrompt}
                  onChange={(e) => setLocalTempPrompt(e.target.value)}
                  placeholder="为当前对话添加额外指令..."
                  className="min-h-[100px] text-sm resize-y"
                />
```

改为（只改 placeholder）：

```tsx
                <Textarea
                  value={localTempPrompt}
                  onChange={(e) => setLocalTempPrompt(e.target.value)}
                  placeholder="为当前对话添加专属规则（会跟随对话保存）..."
                  className="min-h-[100px] text-sm resize-y"
                />
```

**改动点 5**（约第 189-191 行的说明文字）：

```tsx
                <p className="text-xs text-muted-foreground">
                  仅对当前对话生效，不会影响其他对话。
                </p>
```

改为：

```tsx
                <p className="text-xs text-muted-foreground">
                  仅对当前对话生效，与对话一同保存（包括归档后）。
                </p>
```

#### 2.2 BookConversationList.tsx 的注释（可选但推荐）

**文件**：`components/BookConversationList.tsx`

**改动点**（约第 48 行）：

```tsx
  temp_prompt?: string;              // 临时提示词
```

改为：

```tsx
  temp_prompt?: string;              // 对话规则（持久绑定此对话）
```

> 这是 interface 定义的行内注释。不改字段名 `temp_prompt`。只是把注释语义说清楚。

#### 2.3 后端注释同步（可选但推荐）

为了代码一致性，把后端相关注释也同步一下。

**文件**：`electron/main/services/conversation-service.ts`

找到（约第 28 行和第 47 行）：

```typescript
  tempPrompt?: string;   // 临时提示词
```

```typescript
  temp_prompt?: string;
```

**操作**：把有"临时提示词"注释的那行改为：

```typescript
  tempPrompt?: string;   // 对话规则（持久绑定此对话）
```

另一行保持不变。

**文件**：`electron/main/agents/query-based-session.ts`

找到（约第 70 行和第 1399 行）：

```typescript
  tempPrompt?: string;               // 临时提示词
```

```typescript
    // 4. 临时提示词
```

**操作**：改为：

```typescript
  tempPrompt?: string;               // 对话规则（持久绑定此对话）
```

```typescript
    // 4. 对话规则（持久绑定此对话）
```

> 注：`buildSystemPrompt` 里拼接时用的标题 `## 额外指令` 保持不变——这是注入给 AI 看的文字，用词已经合适。

---

## 验证步骤

### 验证 1：编译通过

```bash
bun run build:electron
```

**预期**：无 TypeScript 错误。

如果报错 `Property 'systemPromptAppend' does not exist on type`，说明有地方还在使用这个字段，回到任务 1.4 继续搜索清理。

### 验证 2：启动应用

```bash
bun run dev
```

**预期**：应用正常启动，没有报错。

### 验证 3：System prompt 日志确认

1. 在 dogear 中创建一个新对话，或打开一个已有对话
2. 发送一条消息
3. 查看 Electron 主进程日志（控制台输出）
4. 找到 "构建系统提示词" 或 `buildSystemPrompt` 相关的日志输出

**预期**：
- 日志中**不应出现** `systemPromptAppend` 相关内容
- 如果之前在 settings.json 里有过 `"systemPromptAppend": "这里是临时添加的提示，你如果读到这里请发出一声惊叹"` 这类值，且已按 1.3 手动清除，AI 的回复应该**不会再出现"惊叹"相关内容**

### 验证 4：UI 文案检查

1. 打开任意对话
2. 点击右上角对话设置按钮，打开 `PromptSidebar` 侧边栏
3. 检查：

- [ ] 标签显示为 "对话规则"（不是 "临时提示词"）
- [ ] Textarea placeholder 显示 "为当前对话添加专属规则（会跟随对话保存）..."
- [ ] 底部说明文字显示 "仅对当前对话生效，与对话一同保存（包括归档后）。"
- [ ] 顶部摘要区如果已设置，显示 "对话规则：已设置"

### 验证 5：功能回归（关键）

**确认改名没有破坏功能**：

1. 在一个对话中，通过侧边栏设置对话规则（原 tempPrompt）：输入 "测试：请在每句回复末尾加上'好的'"
2. 点击"保存并重启会话"
3. 发送一条消息
4. **预期**：AI 的回复末尾带有"好的"——证明字段仍然正确注入到 system prompt
5. 关闭 dogear，重新打开
6. 打开同一个对话，打开侧边栏
7. **预期**：对话规则文本框里还显示之前填的内容——证明持久化正常

---

## 失败回退

如果任何一步出错：

1. `git status` 查看改动文件
2. `git diff <文件>` 确认改动范围
3. 如需放弃当前改动：`git checkout -- <文件>`
4. **绝对不要 `git reset --hard`** 或其他破坏性操作

---

## 完成标志

本任务完成的判据：

- [ ] 任务 1.1-1.4 全部完成，代码中无 `systemPromptAppend` 引用（除文档）
- [ ] 任务 2.1 的 5 个 UI 改动点全部完成
- [ ] 任务 2.2、2.3 的注释改动完成
- [ ] 验证步骤 1-5 全部通过
- [ ] 项目正常启动并可正常对话

完成后可以进入**里程碑 1 的 Step 1：数据结构和 Service 层**。

---

## 此任务的 Todo 模板（供执行时使用）

```
1. 移除 systemPromptAppend 字段定义（types/settings.ts + settings-types.ts）
2. 移除 buildSystemPrompt 的拼接逻辑（query-based-session.ts）
3. 手动清理 .dogear/settings.json 中的 systemPromptAppend
4. 全局搜索确认无残留代码引用
5. 修改 PromptSidebar.tsx 的 5 个 UI 文案
6. 同步 BookConversationList.tsx 的注释
7. 同步后端 conversation-service.ts 和 query-based-session.ts 的注释
8. 编译 + 启动 + 验证 5 步
```
