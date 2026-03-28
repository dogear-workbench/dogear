/**
 * 对话索引服务
 * 管理 .dogear/workspaces/{workspaceId}/conversations.json — 按工作区存储的对话元数据索引
 * 实际消息内容由 Claude Agent SDK 的 .jsonl 文件管理
 */
import fs from 'fs/promises';
import path from 'path';
import electron from 'electron';
import { v4 as uuidv4 } from 'uuid';

const { app } = electron;

// ============================================================
// 类型定义
// ============================================================

/** 单条对话的索引信息 */
export interface ConversationIndex {
  id: string;
  title: string;
  sdkSessionId: string | null;
  workspaceId: string;
  bookId: string | null;
  parentConversationId: string | null;
  forkMessageSdkUuid: string | null;
  personaId?: string;    // 关联的人设 ID
  tempPrompt?: string;   // 临时提示词
  forkPending?: boolean; // 分叉已创建但 SDK 会话未建立
  createdAt: string;   // ISO 8601 字符串
  updatedAt: string;   // ISO 8601 字符串
}

/** 前端兼容格式（snake_case + camelCase 双格式） */
export interface ConversationCompat {
  id: string;
  title: string;
  model: string;
  book_id?: string;
  workspace_id: string;
  sdk_session_id?: string;
  parent_conversation_id?: string;
  fork_message_sdk_uuid?: string;
  persona_id?: string;
  temp_prompt?: string;
  fork_pending?: boolean;
  created_at: number;
  updated_at: number;
  bookId: string | null;
  workspaceId: string;
  sdkSessionId: string | null;
  parentConversationId: string | null;
  forkMessageSdkUuid: string | null;
  personaId: string | undefined;
  tempPrompt: string | undefined;
  createdAt: string;
  updatedAt: string;
}

/** 每工作区的 conversations.json 文件结构 */
export interface WorkspaceConversationsFile {
  version: number;
  conversations: Record<string, ConversationIndex>;
}

/** 旧版全局 conversations.json 文件结构（用于迁移） */
interface LegacyConversationsFile {
  version: number;
  conversations: Record<string, ConversationIndex>;
}

// ============================================================
// 路径函数
// ============================================================

/**
 * 获取 .dogear 配置目录
 * 开发阶段：项目根目录/.dogear
 * 打包后：AppData/Roaming/Dogear/.dogear
 */
function getConfigDir(): string {
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), '.dogear');
  }
  return path.join(process.cwd(), '.dogear');
}

/** 获取工作区数据目录 .dogear/workspaces/{workspaceId}/ */
function getWorkspaceDataDir(workspaceId: string): string {
  return path.join(getConfigDir(), 'workspaces', workspaceId);
}

/** 获取工作区 conversations.json 路径 */
function getWorkspaceConversationsPath(workspaceId: string): string {
  return path.join(getWorkspaceDataDir(workspaceId), 'conversations.json');
}

/** 获取旧版全局 conversations.json 路径（用于迁移） */
function getLegacyConversationsPath(): string {
  return path.join(getConfigDir(), 'conversations.json');
}

// ============================================================
// 读写函数
// ============================================================

/** 空的默认文件结构 */
function emptyFile(): WorkspaceConversationsFile {
  return { version: 2, conversations: {} };
}

/**
 * 读取指定工作区的 conversations.json
 * 文件不存在或解析失败时返回空结构
 */
async function loadWorkspaceConversations(workspaceId: string): Promise<WorkspaceConversationsFile> {
  try {
    const raw = await fs.readFile(getWorkspaceConversationsPath(workspaceId), 'utf-8');
    return JSON.parse(raw) as WorkspaceConversationsFile;
  } catch {
    return emptyFile();
  }
}

/**
 * 将数据写入工作区的 conversations.json
 * 自动创建目录
 */
async function saveWorkspaceConversations(workspaceId: string, data: WorkspaceConversationsFile): Promise<void> {
  const dir = getWorkspaceDataDir(workspaceId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    getWorkspaceConversationsPath(workspaceId),
    JSON.stringify(data, null, 2),
    'utf-8',
  );
}

// ============================================================
// CRUD 操作
// ============================================================

/**
 * 将 Record 转为数组并按 updatedAt 倒序排列
 */
function sortedList(conversations: Record<string, ConversationIndex>): ConversationIndex[] {
  return Object.values(conversations).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

/**
 * 获取指定工作区的所有对话（按 updatedAt 倒序）
 */
export async function getByWorkspaceId(workspaceId: string): Promise<ConversationIndex[]> {
  const file = await loadWorkspaceConversations(workspaceId);
  return sortedList(file.conversations);
}

/**
 * 获取指定书籍的所有对话（按 updatedAt 倒序）
 */
export async function getByBookId(workspaceId: string, bookId: string): Promise<ConversationIndex[]> {
  const file = await loadWorkspaceConversations(workspaceId);
  const filtered = Object.values(file.conversations).filter(
    (c) => c.bookId === bookId,
  );
  return filtered.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

/**
 * 根据 ID 获取单条对话，不存在则返回 null
 */
export async function getById(workspaceId: string, id: string): Promise<ConversationIndex | null> {
  const file = await loadWorkspaceConversations(workspaceId);
  return file.conversations[id] ?? null;
}

/**
 * 跨工作区按 ID 查找对话（遍历所有工作区目录）
 * 用于 agent.ts session_init 回调等不知道 workspaceId 的场景
 */
export async function getByIdGlobal(id: string): Promise<{ conv: ConversationIndex; workspaceId: string } | null> {
  const workspacesDir = path.join(getConfigDir(), 'workspaces');
  try {
    const entries = await fs.readdir(workspacesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const wsId = entry.name;
      const file = await loadWorkspaceConversations(wsId);
      if (file.conversations[id]) {
        return { conv: file.conversations[id], workspaceId: wsId };
      }
    }
  } catch {
    // workspaces 目录不存在
  }
  return null;
}

/**
 * 创建新对话
 * @returns 新对话的 ID
 */
export async function create(
  workspaceId: string,
  title: string = '新对话',
  bookId?: string,
): Promise<string> {
  const file = await loadWorkspaceConversations(workspaceId);
  const id = uuidv4();
  const now = new Date().toISOString();

  file.conversations[id] = {
    id,
    title,
    sdkSessionId: null,
    workspaceId,
    bookId: bookId ?? null,
    parentConversationId: null,
    forkMessageSdkUuid: null,
    createdAt: now,
    updatedAt: now,
  };

  await saveWorkspaceConversations(workspaceId, file);
  return id;
}

/**
 * 创建分叉对话
 * @returns 新对话的 ID
 */
export async function createFork(
  workspaceId: string,
  title: string,
  parentConversationId: string,
  forkMessageSdkUuid: string,
  bookId?: string,
): Promise<string> {
  const file = await loadWorkspaceConversations(workspaceId);
  const id = uuidv4();
  const now = new Date().toISOString();

  file.conversations[id] = {
    id,
    title,
    sdkSessionId: null,
    workspaceId,
    bookId: bookId ?? null,
    parentConversationId,
    forkMessageSdkUuid,
    forkPending: true,  // 标记为待分叉状态，用户发送首条消息时才启动 SDK fork
    createdAt: now,
    updatedAt: now,
  };

  await saveWorkspaceConversations(workspaceId, file);
  return id;
}

/**
 * 更新对话标题
 */
export async function updateTitle(workspaceId: string, id: string, title: string): Promise<void> {
  const file = await loadWorkspaceConversations(workspaceId);
  const conv = file.conversations[id];
  if (!conv) return;

  conv.title = title;
  conv.updatedAt = new Date().toISOString();
  await saveWorkspaceConversations(workspaceId, file);
}

/**
 * 更新对话的 SDK session ID
 */
export async function updateSdkSessionId(workspaceId: string, id: string, sdkSessionId: string): Promise<void> {
  const file = await loadWorkspaceConversations(workspaceId);
  const conv = file.conversations[id];
  if (!conv) return;

  conv.sdkSessionId = sdkSessionId;
  conv.updatedAt = new Date().toISOString();
  await saveWorkspaceConversations(workspaceId, file);
}

/**
 * 清除分叉待定状态（SDK 会话创建成功后调用）
 */
export async function clearForkPending(workspaceId: string, id: string): Promise<void> {
  const file = await loadWorkspaceConversations(workspaceId);
  const conv = file.conversations[id];
  if (!conv) return;
  conv.forkPending = false;
  conv.updatedAt = new Date().toISOString();
  await saveWorkspaceConversations(workspaceId, file);
}

/**
 * 清除分叉相关字段（分叉对话拿到新 sessionId 后变为独立对话）
 */
export async function clearForkFields(workspaceId: string, id: string): Promise<void> {
  const file = await loadWorkspaceConversations(workspaceId);
  const conv = file.conversations[id];
  if (!conv) return;
  conv.parentConversationId = null;
  conv.forkMessageSdkUuid = null;
  conv.forkPending = false;
  conv.updatedAt = new Date().toISOString();
  await saveWorkspaceConversations(workspaceId, file);
}

/**
 * 仅更新 updatedAt 时间戳
 */
export async function touch(workspaceId: string, id: string): Promise<void> {
  const file = await loadWorkspaceConversations(workspaceId);
  const conv = file.conversations[id];
  if (!conv) return;

  conv.updatedAt = new Date().toISOString();
  await saveWorkspaceConversations(workspaceId, file);
}

/**
 * 更新对话的人设关联和临时提示词
 */
export async function updatePersona(
  workspaceId: string,
  id: string,
  personaId?: string,
  tempPrompt?: string,
): Promise<void> {
  const file = await loadWorkspaceConversations(workspaceId);
  const conv = file.conversations[id];
  if (!conv) return;

  conv.personaId = personaId;
  conv.tempPrompt = tempPrompt;
  conv.updatedAt = new Date().toISOString();
  await saveWorkspaceConversations(workspaceId, file);
}

/**
 * 删除对话
 * 同时将引用此对话为父对话的子对话的 parentConversationId 设为 null
 */
export async function deleteConversation(workspaceId: string, id: string): Promise<void> {
  const file = await loadWorkspaceConversations(workspaceId);
  if (!file.conversations[id]) return;

  // 删除目标对话
  delete file.conversations[id];

  // 子分叉的 parentConversationId 置空
  for (const conv of Object.values(file.conversations)) {
    if (conv.parentConversationId === id) {
      conv.parentConversationId = null;
    }
  }

  await saveWorkspaceConversations(workspaceId, file);
}

// ============================================================
// 兼容转换
// ============================================================

/**
 * 将 ConversationIndex 转换为前端兼容格式（snake_case）
 * 前端 Conversation 接口使用 snake_case 字段名和数值时间戳，
 * 此函数同时提供 snake_case 和 camelCase 版本以便渐进迁移。
 */
export function toCompat(conv: ConversationIndex): ConversationCompat {
  return {
    id: conv.id,
    title: conv.title,
    model: '',  // 不再存储模型名称
    book_id: conv.bookId || undefined,
    workspace_id: conv.workspaceId,
    sdk_session_id: conv.sdkSessionId || undefined,
    parent_conversation_id: conv.parentConversationId || undefined,
    fork_message_sdk_uuid: conv.forkMessageSdkUuid || undefined,
    persona_id: conv.personaId || undefined,
    temp_prompt: conv.tempPrompt || undefined,
    fork_pending: conv.forkPending || false,
    created_at: new Date(conv.createdAt).getTime(),
    updated_at: new Date(conv.updatedAt).getTime(),
    // 同时提供 camelCase 版本，供新代码使用
    bookId: conv.bookId,
    workspaceId: conv.workspaceId,
    sdkSessionId: conv.sdkSessionId,
    parentConversationId: conv.parentConversationId,
    forkMessageSdkUuid: conv.forkMessageSdkUuid,
    personaId: conv.personaId,
    tempPrompt: conv.tempPrompt,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
  };
}

// ============================================================
// 数据迁移
// ============================================================

/**
 * 从旧版全局 conversations.json 迁移到按工作区存储
 * 幂等：仅在旧文件存在时执行，完成后备份旧文件
 */
export async function migrateFromLegacy(): Promise<void> {
  const legacyPath = getLegacyConversationsPath();

  try {
    await fs.access(legacyPath);
  } catch {
    return; // 旧文件不存在，无需迁移
  }

  console.log('[conversation-service] 开始迁移旧版 conversations.json...');

  const raw = await fs.readFile(legacyPath, 'utf-8');
  const legacyFile = JSON.parse(raw) as LegacyConversationsFile;

  // 按 workspaceId 分组
  const grouped = new Map<string, ConversationIndex[]>();
  for (const conv of Object.values(legacyFile.conversations)) {
    const wsId = conv.workspaceId;
    if (!grouped.has(wsId)) grouped.set(wsId, []);
    grouped.get(wsId)!.push(conv);
  }

  // 写入各工作区文件，并创建初始树
  for (const [wsId, convs] of grouped) {
    const convMap: Record<string, ConversationIndex> = {};
    for (const conv of convs) {
      convMap[conv.id] = conv;
    }
    await saveWorkspaceConversations(wsId, { version: 2, conversations: convMap });

    // 创建初始 conversation-tree.json（所有对话按 updatedAt 倒序放根级别）
    const sortedConvs = convs.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    const treeService = await import('./conversation-tree-service.js');
    await treeService.initializeTree(wsId, sortedConvs.map(c => c.id));
  }

  // 备份旧文件
  await fs.rename(legacyPath, legacyPath + '.bak');
  console.log('[conversation-service] 迁移完成');
}
