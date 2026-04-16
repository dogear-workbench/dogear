# 移除 SQLite，全面迁移到 JSON 文件存储

> 日期：2026-03-10
> 状态：设计完成，待实施

## 背景

当前系统使用三层存储：SQLite（元数据）、.dogear/（分析数据）、.claude-history/（SDK 会话历史）。实践中发现 SQLite 的使用较轻量，对话内容已由 Agent SDK 自动管理。本次重构目标是：

1. **彻底移除 SQLite**，所有数据迁移到 `.dogear/` 下的 JSON 文件
2. **简化对话管理**，用 `conversations.json` 作为精简索引，SDK `.jsonl` 作为真实数据源
3. **统一分叉机制**，Fork 创建新对话，编辑重发用 `resume + resumeSessionAt` 截断重写
4. **SDK 会话历史路径**从 `.claude-history` 移到 `.dogear/conversations`

---

## 一、数据存储架构

### 1.1 目录结构

```
.dogear/                            # 全局应用数据目录
├── settings.json                   # 已有 — AI 配置、模型方案
├── workspaces.json                 # 新增 — 工作区列表
├── conversations.json              # 新增 — 对话精简索引
└── conversations/                  # 新增 — SDK 会话历史（从 .claude-history 移入）
    └── projects/
        └── {normalized-path}/
            └── {session-id}.jsonl  # SDK 自动管理的会话文件

{workspace-path}/                   # 工作区根目录
└── {book-id}/                      # 每本书的目录
    ├── book-file.{epub|pdf|txt}    # 书籍文件
    └── .dogear/
        ├── meta.json               # 书籍元数据（扩展，合并原 books 表字段）
        ├── chapters.json           # 章节索引 + 内容（替代 chapters 表）
        ├── analysis.json           # 分析结果（已有）
        └── chapters/               # 章节分析数据（已有）
```

### 1.2 conversations.json

```json
{
  "version": 1,
  "conversations": {
    "<conversation-id>": {
      "id": "uuid",
      "title": "对话标题",
      "sdkSessionId": "sdk-session-id | null",
      "workspaceId": "workspace-id",
      "bookId": "book-id | null",
      "parentConversationId": "parent-conversation-id | null",
      "forkMessageSdkUuid": "assistant-message-uuid | null",
      "createdAt": "ISO timestamp",
      "updatedAt": "ISO timestamp"
    }
  }
}
```

**字段说明：**
- `sdkSessionId`：SDK 返回的 session ID，用于 resume。创建时为 null，session_init 后回填
- `parentConversationId` + `forkMessageSdkUuid`：分叉关系追踪，非 fork 对话为 null
- 不存储消息内容 — 由 SDK 的 `.jsonl` 文件管理

### 1.3 workspaces.json

```json
{
  "version": 1,
  "workspaces": [
    {
      "id": "uuid",
      "name": "我的书架",
      "path": "C:/Users/.../books",
      "isDefault": true,
      "createdAt": "ISO timestamp"
    }
  ]
}
```

### 1.4 书籍 meta.json（扩展）

```json
{
  "id": "book-uuid",
  "title": "书名",
  "author": "作者",
  "fileType": "epub|pdf|txt",
  "fileName": "file.epub",
  "filePath": "relative/path/to/file",
  "coverPath": "cover.jpg | null",
  "processingStatus": "pending|processing|completed|failed",
  "currentChapterId": "chapter-uuid | null",
  "analysisStatus": "none|analyzing|completed",
  "analyzedAt": "ISO timestamp | null",
  "createdAt": "ISO timestamp",
  "updatedAt": "ISO timestamp"
}
```

### 1.5 chapters.json

```json
{
  "bookId": "book-uuid",
  "chapters": [
    {
      "id": "chapter-uuid",
      "title": "第一章 引言",
      "content": "完整章节文本...",
      "charCount": 5000,
      "previewText": "前200字预览...",
      "order": 0
    }
  ]
}
```

---

## 二、对话管理逻辑

### 2.1 对话生命周期

#### 创建新对话
1. 生成 UUID 作为 conversationId
2. 写入 `conversations.json` 索引
3. 启动 QueryBasedSession，SDK 自动创建 `.jsonl`
4. 捕获 `session_init` 事件，回填 `sdkSessionId`

#### Resume 对话（继续聊天）
1. 从索引读取 `sdkSessionId`
2. `query({ resume: sdkSessionId })` — SDK 从 `.jsonl` 恢复
3. 新消息追加到原 `.jsonl`

#### 编辑重发（截断重写）
1. 从索引读取 `sdkSessionId`
2. `query({ resume: sdkSessionId, resumeSessionAt: targetUuid })` — 截断到指定消息
3. **不 fork**（`forkSession` 默认 false），直接在原会话上重写
4. SDK 自动截断 `.jsonl` 并追加新内容
5. 索引不变，同一个 sdkSessionId

#### 分叉对话（Fork）
1. 创建新 conversationId
2. `query({ resume: parentSdkSessionId, forkSession: true, resumeSessionAt: forkPointUuid })`
3. 捕获新 `session_id`
4. 写入索引：`parentConversationId` + `forkMessageSdkUuid`

### 2.2 删除对话
1. 从 `conversations.json` 移除记录
2. 删除对应 `.jsonl` 文件
3. 子 fork 对话的 `parentConversationId` 设为 null（断链不删除）

### 2.3 消息展示
- **新消息**：通过 `sessionMessage` 事件实时展示（不变）
- **历史消息**：Resume 时 SDK 重放历史消息，前端展示回放内容
- 无需额外存储消息副本

### 2.4 索引重建
当 `conversations.json` 丢失但 `.dogear/conversations/` 下 `.jsonl` 文件还在时：
- 扫描所有 `.jsonl` 文件
- 从首条 init 消息提取 session_id
- 生成基础索引（无分叉关系）
- 用户可选择接受或舍弃

---

## 三、SDK 会话历史路径变更

### 3.1 路径映射
- **旧路径**：`.claude-history/projects/{normalized-path}/{session-id}.jsonl`
- **新路径**：`.dogear/conversations/projects/{normalized-path}/{session-id}.jsonl`

### 3.2 实现方式
`QueryBasedSession` 中的 `CLAUDE_CONFIG_DIR` 环境变量：
```typescript
// 旧
env.CLAUDE_CONFIG_DIR = path.join(process.cwd(), '.claude-history')
// 新
env.CLAUDE_CONFIG_DIR = path.join(getDogearBasePath(), 'conversations')
```

---

## 四、移除 SQLite

### 4.1 删除的文件/目录
- `electron/main/database/` — 整个目录（schema.sql + index.ts）
- `data/` — SQLite 数据文件目录
- `.claude-history/` — 旧的 SDK 会话历史目录（数据迁移后删除）

### 4.2 移除的依赖
- `better-sqlite3`
- `@types/better-sqlite3`
- `electron-rebuild` 相关配置（如果仅为 better-sqlite3 服务）

### 4.3 新增服务
```
electron/main/services/
├── conversation-service.ts    # 新增：conversations.json 读写、索引重建
├── workspace-service.ts       # 修改：集成 workspaces.json 读写
├── book-service.ts            # 修改：改用 meta.json + chapters.json
└── settings-service.ts        # 已有：不变
```

### 4.4 IPC 路由调整
- `tipc/conversations.ts` — 改为调用 conversation-service（JSON 读写）
- `tipc/db.ts` — 删除（直接数据库访问不再需要）
- `tipc/book.ts` — 改为读取 meta.json / chapters.json
- `tipc/workspace.ts` — 改为使用 workspaces.json

---

## 五、实施步骤概要

### Phase 1: 基础设施
1. 创建 `conversation-service.ts`（conversations.json CRUD）
2. 扩展 `workspace-service.ts`（workspaces.json 读写）
3. 修改 `book-service.ts`（meta.json 扩展 + chapters.json）

### Phase 2: 对话系统迁移
4. 修改 `query-based-session.ts`（CLAUDE_CONFIG_DIR 指向新路径）
5. 重写 `tipc/conversations.ts`（从 db 调用改为 service 调用）
6. 重写 `tipc/agent.ts`（适配新的对话管理）
7. 修改前端 `conversation-store.ts`（适配新接口）
8. 修改 `AgentChat.tsx`（移除 branch 相关逻辑，统一使用 fork + resume 截断）

### Phase 3: books/workspaces 迁移
9. 修改 `tipc/book.ts`（改为文件读取）
10. 修改 `tipc/workspace.ts`（改为 JSON 读写）
11. 修改 `tipc/db.ts` → 删除
12. 修改前端 `hooks.ts` 和 `workspace-store.ts`

### Phase 4: 清理
13. 删除 `electron/main/database/` 目录
14. 删除 `data/` 目录
15. 移除 `better-sqlite3` 依赖
16. 清理 `.claude-history/`（确认数据已迁移）
17. 更新 `.gitignore`

### Phase 5: 索引重建功能
18. 实现 `.jsonl` 扫描 → conversations.json 重建逻辑
