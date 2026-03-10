/**
 * 对话索引服务
 * 管理 .dogear/conversations.json — 精简的对话元数据索引
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
  createdAt: string;   // ISO 8601 字符串
  updatedAt: string;   // ISO 8601 字符串
}

/** conversations.json 的文件结构 */
export interface ConversationsFile {
  version: number;
  conversations: Record<string, ConversationIndex>;
}

// ============================================================
// 路径函数
// ============================================================

/**
 * 获取 .dogear 配置目录
 * 开发阶段：项目根目录/.dogear
 * 打包后：app.asar 同级目录/.dogear
 */
function getConfigDir(): string {
  if (app.isPackaged) {
    return path.join(path.dirname(app.getAppPath()), '.dogear');
  }
  return path.join(process.cwd(), '.dogear');
}

/** 获取 conversations.json 的完整路径 */
function getConversationsPath(): string {
  return path.join(getConfigDir(), 'conversations.json');
}

// ============================================================
// 读写函数
// ============================================================

/** 空的默认文件结构 */
function emptyFile(): ConversationsFile {
  return { version: 1, conversations: {} };
}

/**
 * 读取并解析 conversations.json
 * 文件不存在或解析失败时返回空结构
 */
async function loadConversationsFile(): Promise<ConversationsFile> {
  try {
    const raw = await fs.readFile(getConversationsPath(), 'utf-8');
    return JSON.parse(raw) as ConversationsFile;
  } catch {
    return emptyFile();
  }
}

/**
 * 将数据写入 conversations.json
 * 自动创建 .dogear 目录
 */
async function saveConversationsFile(data: ConversationsFile): Promise<void> {
  const configDir = getConfigDir();
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(
    getConversationsPath(),
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
  const file = await loadConversationsFile();
  const filtered = Object.values(file.conversations).filter(
    (c) => c.workspaceId === workspaceId,
  );
  return filtered.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

/**
 * 获取指定书籍的所有对话（按 updatedAt 倒序）
 */
export async function getByBookId(bookId: string): Promise<ConversationIndex[]> {
  const file = await loadConversationsFile();
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
export async function getById(id: string): Promise<ConversationIndex | null> {
  const file = await loadConversationsFile();
  return file.conversations[id] ?? null;
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
  const file = await loadConversationsFile();
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

  await saveConversationsFile(file);
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
  const file = await loadConversationsFile();
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
    createdAt: now,
    updatedAt: now,
  };

  await saveConversationsFile(file);
  return id;
}

/**
 * 更新对话标题
 */
export async function updateTitle(id: string, title: string): Promise<void> {
  const file = await loadConversationsFile();
  const conv = file.conversations[id];
  if (!conv) return;

  conv.title = title;
  conv.updatedAt = new Date().toISOString();
  await saveConversationsFile(file);
}

/**
 * 更新对话的 SDK session ID
 */
export async function updateSdkSessionId(id: string, sdkSessionId: string): Promise<void> {
  const file = await loadConversationsFile();
  const conv = file.conversations[id];
  if (!conv) return;

  conv.sdkSessionId = sdkSessionId;
  conv.updatedAt = new Date().toISOString();
  await saveConversationsFile(file);
}

/**
 * 仅更新 updatedAt 时间戳
 */
export async function touch(id: string): Promise<void> {
  const file = await loadConversationsFile();
  const conv = file.conversations[id];
  if (!conv) return;

  conv.updatedAt = new Date().toISOString();
  await saveConversationsFile(file);
}

/**
 * 删除对话
 * 同时将引用此对话为父对话的子对话的 parentConversationId 设为 null
 */
export async function deleteConversation(id: string): Promise<void> {
  const file = await loadConversationsFile();
  if (!file.conversations[id]) return;

  // 删除目标对话
  delete file.conversations[id];

  // 子分叉的 parentConversationId 置空
  for (const conv of Object.values(file.conversations)) {
    if (conv.parentConversationId === id) {
      conv.parentConversationId = null;
    }
  }

  await saveConversationsFile(file);
}

/**
 * 获取所有对话（按 updatedAt 倒序）
 */
export async function getAll(): Promise<ConversationIndex[]> {
  const file = await loadConversationsFile();
  return sortedList(file.conversations);
}

/**
 * 将 ConversationIndex 转换为前端兼容格式（snake_case）
 * 前端 Conversation 接口使用 snake_case 字段名和数值时间戳，
 * 此函数同时提供 snake_case 和 camelCase 版本以便渐进迁移。
 */
export function toCompat(conv: ConversationIndex): Record<string, any> {
  return {
    id: conv.id,
    title: conv.title,
    model: '',  // 不再存储模型名称
    book_id: conv.bookId || undefined,
    workspace_id: conv.workspaceId,
    sdk_session_id: conv.sdkSessionId || undefined,
    parent_conversation_id: conv.parentConversationId || undefined,
    fork_message_sdk_uuid: conv.forkMessageSdkUuid || undefined,
    created_at: new Date(conv.createdAt).getTime(),
    updated_at: new Date(conv.updatedAt).getTime(),
    // 同时提供 camelCase 版本，供新代码使用
    bookId: conv.bookId,
    workspaceId: conv.workspaceId,
    sdkSessionId: conv.sdkSessionId,
    parentConversationId: conv.parentConversationId,
    forkMessageSdkUuid: conv.forkMessageSdkUuid,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
  };
}
