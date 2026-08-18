/**
 * 对话索引服务
 * 管理 .dogear/workspaces/{workspaceId}/conversations.json — 按工作区存储的对话元数据索引
 * 实际消息内容由 Claude Agent SDK 的 .jsonl 文件管理
 */
import fs from 'fs/promises';
import path from 'path';
import electron from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { safeJsonWrite, safeJsonRead, withFileLock } from './safe-json.js';
import { readUsage } from './usage/usage-service.js';
import { listActiveGroups, requireActiveGroup } from './group-service.js';
import type { ConversationUsageEntry } from '../types.js';
import type { ModelSelection } from './settings-types.js';

const { app } = electron;

// ============================================================
// 类型定义
// ============================================================

/**
 * 契约元数据（Agent 协作模式）
 * 手动创建的会话此字段为 undefined；agent 派出的会话必填
 * 与 types/electron-api.ts 的同名接口镜像（主进程 rootDir 限制无法跨目录 import 前端类型）
 */
export interface ContractMetadata {
  parentSessionId: string;
  task: string;
  expectedOutputPath?: string;
  createdBy: 'agent' | 'human';
  /** 派出时选用的子会话 Profile id；缺省视为默认 Profile */
  subAgentProfileId?: string;
}

/** 单条对话的索引信息 */
export interface ConversationIndex {
  id: string;
  title: string;
  sessionId: string | null;
  workspaceId: string;
  parentConversationId: string | null;
  /** 分叉点标识；SDK 时代是 Claude JSONL 消息 uuid，Harness 迁移后是 fork 时使用的 SessionTreeEntry id */
  forkMessageSdkUuid: string | null;
  modelSelection: ModelSelection | null;
  cachePolicy?: '5m' | '1h'; // 提示缓存策略；缺省视为 5m
  /** @deprecated SDK 时代"分叉待定，等首条消息才建会话"的状态位；Harness fork 已改为同步创建，不再产生新值 */
  forkPending?: boolean;
  /** @deprecated 仅为话题生命周期 v1 迁移读取；所有存量清理后可随迁移代码移除。 */
  archivedAt?: string;
  groupId?: string;          // 所属会话组 ID；老数据迁移前可能缺失
  role?: 'main' | 'sub';    // P1 只产生 'main'
  contractMetadata?: ContractMetadata; // Agent 派出契约元数据；手动会话为 undefined
  createdAt: string;   // ISO 8601 字符串
  updatedAt: string;   // ISO 8601 字符串
  usageSummary?: {
    turnCount: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheReadTokens: number;
    lastContextSize?: number;
    lastContextWindow?: number;
  };
}

/** 前端兼容格式（snake_case + camelCase 双格式） */
export interface ConversationCompat {
  id: string;
  title: string;
  model: string;
  workspace_id: string;
  session_id?: string;
  parent_conversation_id?: string;
  fork_message_sdk_uuid?: string;
  fork_pending?: boolean;
  created_at: number;
  updated_at: number;
  workspaceId: string;
  sessionId: string | null;
  parentConversationId: string | null;
  forkMessageSdkUuid: string | null;
  modelSelection: ModelSelection | null;
  cachePolicy: '5m' | '1h' | undefined;
  createdAt: string;
  updatedAt: string;
  usageSummary?: {
    turnCount: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheReadTokens: number;
    lastContextSize?: number;
    lastContextWindow?: number;
  };
  groupId: string;
  role: 'main' | 'sub';
  contractMetadata?: ContractMetadata;
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
  // Worker 线程无 electron app，优先读注入的 DOGEAR_CONFIG_DIR
  if (process.env.DOGEAR_CONFIG_DIR) return process.env.DOGEAR_CONFIG_DIR;
  if (app?.isPackaged) return path.join(app.getPath('userData'), '.dogear');
  return path.join(process.cwd(), '.dogear');
}

/** 获取工作区数据目录 .dogear/workspaces/{workspaceId}/ */
export function getWorkspaceDataDir(workspaceId: string): string {
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
  return safeJsonRead<WorkspaceConversationsFile>(
    getWorkspaceConversationsPath(workspaceId),
    { version: 1, conversations: {} },
  );
}

/**
 * 将数据写入工作区的 conversations.json
 * 自动创建目录
 */
async function saveWorkspaceConversations(workspaceId: string, data: WorkspaceConversationsFile): Promise<void> {
  await safeJsonWrite(getWorkspaceConversationsPath(workspaceId), data);
}

/**
 * 读-改-写事务：同一工作区的 conversations.json 修改串行化，
 * 防止并发写者（如 fire-and-forget 的 usage 结算）用旧快照覆盖彼此的字段
 * （曾导致子会话 updateSessionId 写回被 applyUsageSummary 抹掉、sessionId 永久丢失）。
 * 锁键加 '#txn' 后缀与 safeJsonWrite 内部的同路径写锁隔离——promise 链锁不可重入，同键嵌套会死锁。
 */
async function withConversationsTxn<T>(
  workspaceId: string,
  fn: (file: WorkspaceConversationsFile) => Promise<T>,
): Promise<T> {
  return withFileLock(getWorkspaceConversationsPath(workspaceId) + '#txn', async () => {
    const file = await loadWorkspaceConversations(workspaceId);
    const result = await fn(file);
    await saveWorkspaceConversations(workspaceId, file);
    return result;
  });
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
 * 获取指定工作区的所有对话（按 updatedAt 倒序，默认只返回活跃话题）
 * @param options.includeArchived 是否包含归档话题中的对话，默认 false
 */
export async function getByWorkspaceId(
  workspaceId: string,
  options?: { includeArchived?: boolean },
): Promise<ConversationIndex[]> {
  const file = await loadWorkspaceConversations(workspaceId);
  if (options?.includeArchived) return sortedList(file.conversations);

  const activeGroupIds = new Set((await listActiveGroups(workspaceId)).map((group) => group.id));
  return sortedList(Object.fromEntries(
    Object.entries(file.conversations).filter(([, conversation]) =>
      !!conversation.groupId && activeGroupIds.has(conversation.groupId),
    ),
  ));
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
 * 跨工作区按 sessionId 查找对话（遍历所有工作区目录）
 * 用于 delegation-tools 反查派出者会话
 */
export async function getBySessionId(
  sessionId: string,
): Promise<{ conv: ConversationIndex; workspaceId: string } | null> {
  const workspacesDir = path.join(getConfigDir(), 'workspaces');
  try {
    const entries = await fs.readdir(workspacesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const wsId = entry.name;
      const file = await loadWorkspaceConversations(wsId);
      for (const conv of Object.values(file.conversations)) {
        if (conv.sessionId === sessionId) {
          return { conv, workspaceId: wsId };
        }
      }
    }
  } catch {
    // workspaces 目录不存在
  }
  return null;
}

/**
 * 批量按 conversationId 拿索引（找不到的跳过，不抛错）。供 ListCategories 拉样例标题用。
 * 跨工作区扫描，返回的列表顺序与传入 ids 顺序一致（缺失项不出现，不留 undefined 占位）。
 */
export async function getConversationsByIds(ids: string[]): Promise<ConversationIndex[]> {
  const out: ConversationIndex[] = [];
  for (const id of ids) {
    const found = await getByIdGlobal(id);
    if (found) out.push(found.conv);
  }
  return out;
}

/**
 * 创建新对话
 * @returns 新对话的 ID
 */
export async function create(
  workspaceId: string,
  groupId: string,
  title: string = '新对话',
  modelSelection: ModelSelection | null = null,
  options?: {
    role?: 'main' | 'sub';
    parentConversationId?: string;
    cachePolicy?: '5m' | '1h';
    contractMetadata?: ContractMetadata;
  },
): Promise<string> {
  return withConversationsTxn(workspaceId, async (file) => {
    await requireActiveGroup(workspaceId, groupId);
    const id = uuidv4();
    const now = new Date().toISOString();

    file.conversations[id] = {
      id,
      title,
      sessionId: null,
      workspaceId,
      parentConversationId: options?.parentConversationId ?? null,
      forkMessageSdkUuid: null,
      modelSelection: modelSelection ? { ...modelSelection } : null,
      cachePolicy: options?.cachePolicy ?? '5m',
      groupId,
      role: options?.role ?? 'main',
      contractMetadata: options?.contractMetadata,
      createdAt: now,
      updatedAt: now,
    };
    return id;
  }).then(async (id) => {
    const { touchGroup } = await import('./group-service.js');
    await touchGroup(workspaceId, groupId);
    return id;
  });
}

/**
 * 创建分叉对话。分叉现在是同步/即时的：调用方必须已经用 Harness repository fork
 * 出新 sessionId，此函数只落 Conversation metadata，不再有 forkPending 待定态。
 * @returns 新对话的 ID
 */
export async function createFork(
  workspaceId: string,
  groupId: string,
  title: string,
  parentConversationId: string,
  sessionId: string,
  forkMessageSdkUuid: string,
  modelSelection: ModelSelection | null = null,
  cachePolicy: '5m' | '1h' = '5m',
): Promise<string> {
  return withConversationsTxn(workspaceId, async (file) => {
    await requireActiveGroup(workspaceId, groupId);
    const id = uuidv4();
    const now = new Date().toISOString();
    const parent = file.conversations[parentConversationId];

    file.conversations[id] = {
      id,
      title,
      sessionId,
      workspaceId,
      parentConversationId,
      forkMessageSdkUuid,
      modelSelection: modelSelection ? { ...modelSelection } : null,
      contractMetadata: parent?.contractMetadata ? { ...parent.contractMetadata } : undefined,
      cachePolicy,
      groupId,
      role: 'main',
      createdAt: now,
      updatedAt: now,
    };
    return id;
  });
}

/**
 * 更新对话标题
 */
export async function updateTitle(workspaceId: string, id: string, title: string): Promise<void> {
  await withConversationsTxn(workspaceId, async (file) => {
    const conv = file.conversations[id];
    if (!conv) return;
    if (!conv.groupId) throw new Error('对话未关联话题');
    await requireActiveGroup(workspaceId, conv.groupId);

    conv.title = title;
    conv.updatedAt = new Date().toISOString();
  });
}

/** 默认 title（新建对话时设置）——用于识别"用户尚未修改过 title"的状态 */
const DEFAULT_TITLE = '新对话';
/** 自动生成 title 时截取的最大长度 */
const AUTO_TITLE_MAX_LENGTH = 30;

/**
 * 从用户第一条消息自动生成 title。
 *
 * 仅当当前 title 是默认值（DEFAULT_TITLE）时执行，避免覆盖用户手动修改的标题。
 * 截取规则：去除换行与首尾空白，取前 AUTO_TITLE_MAX_LENGTH 字，超长加 "…"。
 *
 * @returns 是否实际更新了 title
 */
export async function autoUpdateTitleFromFirstMessage(
  workspaceId: string,
  id: string,
  messageText: string,
): Promise<boolean> {
  return withConversationsTxn(workspaceId, async (file) => {
    const conv = file.conversations[id];
    if (!conv) return false;
    if (!conv.groupId) return false;
    await requireActiveGroup(workspaceId, conv.groupId);

    // 仅默认 title 时才自动生成（保护用户已修改的标题）
    if (conv.title !== DEFAULT_TITLE) return false;

    const cleaned = messageText.replace(/\s+/g, ' ').trim();
    if (!cleaned) return false;

    const truncated = cleaned.length > AUTO_TITLE_MAX_LENGTH
      ? cleaned.slice(0, AUTO_TITLE_MAX_LENGTH) + '…'
      : cleaned;

    conv.title = truncated;
    conv.updatedAt = new Date().toISOString();
    return true;
  });
}

export async function updateSessionId(workspaceId: string, id: string, sessionId: string): Promise<void> {
  await withConversationsTxn(workspaceId, async (file) => {
    const conv = file.conversations[id];
    if (!conv) throw new Error(`Conversation not found: ${id}`);
    if (!conv.groupId) throw new Error('对话未关联话题');
    await requireActiveGroup(workspaceId, conv.groupId);

    conv.sessionId = sessionId;
    conv.updatedAt = new Date().toISOString();
  });
}

/**
 * 仅更新 updatedAt 时间戳
 */
export async function touch(workspaceId: string, id: string): Promise<void> {
  let groupId: string | null = null;
  await withConversationsTxn(workspaceId, async (file) => {
    const conv = file.conversations[id];
    if (!conv) return;
    if (!conv.groupId) throw new Error('对话未关联话题');
    await requireActiveGroup(workspaceId, conv.groupId);

    conv.updatedAt = new Date().toISOString();
    groupId = conv.groupId;
  });
  if (groupId) {
    const { touchGroup } = await import('./group-service.js');
    await touchGroup(workspaceId, groupId);
  }
}

export async function updateModelSelection(
  workspaceId: string,
  id: string,
  modelSelection: ModelSelection | null,
): Promise<void> {
  await withConversationsTxn(workspaceId, async (file) => {
    const conv = file.conversations[id];
    if (!conv) return;
    if (!conv.groupId) throw new Error('对话未关联话题');
    await requireActiveGroup(workspaceId, conv.groupId);
    conv.modelSelection = modelSelection ? { ...modelSelection } : null;
    conv.updatedAt = new Date().toISOString();
  });
}

export async function updateCachePolicy(
  workspaceId: string,
  id: string,
  policy: '5m' | '1h',
): Promise<void> {
  await withConversationsTxn(workspaceId, async (file) => {
    const conv = file.conversations[id];
    if (!conv) return;
    if (!conv.groupId) throw new Error('对话未关联话题');
    await requireActiveGroup(workspaceId, conv.groupId);
    conv.cachePolicy = policy;
    conv.updatedAt = new Date().toISOString();
  });
}

/**
 * 删除对话（硬删除：从索引中彻底移除）
 * 同时将引用此对话为父对话的子对话的 parentConversationId 设为 null
 *
 * 注意：本函数只删索引。如需同时清理 SDK 会话历史 JSONL 文件，
 * 请使用 tipc 层的 deleteConversation RPC（会调用 SDK deleteSession）。
 */
export async function deleteConversation(workspaceId: string, id: string): Promise<void> {
  await withConversationsTxn(workspaceId, async (file) => {
    if (!file.conversations[id]) return;

    // 删除目标对话
    delete file.conversations[id];

    // 子分叉的 parentConversationId 置空
    for (const conv of Object.values(file.conversations)) {
      if (conv.parentConversationId === id) {
        conv.parentConversationId = null;
      }
    }
  });
}


/**
 * 导入一条对话索引到目标工作区（用于会话恢复，保留原 ID）
 * 如果目标工作区已存在相同 ID 的对话则跳过。
 */
export async function importConversation(
  targetWorkspaceId: string,
  conv: ConversationIndex,
): Promise<void> {
  await withConversationsTxn(targetWorkspaceId, async (file) => {
    if (file.conversations[conv.id]) return; // 已存在则跳过
    file.conversations[conv.id] = { ...conv, workspaceId: targetWorkspaceId };
  });
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
    workspace_id: conv.workspaceId,
    session_id: conv.sessionId || undefined,
    parent_conversation_id: conv.parentConversationId || undefined,
    fork_message_sdk_uuid: conv.forkMessageSdkUuid || undefined,
    fork_pending: conv.forkPending || false,
    created_at: new Date(conv.createdAt).getTime(),
    updated_at: new Date(conv.updatedAt).getTime(),
    // 同时提供 camelCase 版本，供新代码使用
    workspaceId: conv.workspaceId,
    sessionId: conv.sessionId ?? null,
    parentConversationId: conv.parentConversationId,
    forkMessageSdkUuid: conv.forkMessageSdkUuid,
    modelSelection: conv.modelSelection ?? null,
    cachePolicy: conv.cachePolicy,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
    usageSummary: conv.usageSummary,
    groupId: conv.groupId ?? '',
    role: conv.role ?? 'main',
    contractMetadata: conv.contractMetadata,
  };
}

// ============================================================
// 用量汇总
// ============================================================

function pickMainContextWindow(entry: ConversationUsageEntry): number | undefined {
  const models = Object.values(entry.modelUsage ?? {});
  if (models.length === 0) return undefined;
  const main = models.reduce((a, b) => (b.inputTokens > a.inputTokens ? b : a));
  return main.contextWindow || undefined;
}

/**
 * 将一条用量记录增量合并到对话索引的 usageSummary 字段。
 * 不更新 updatedAt（用量采集是后台行为，不影响排序）。
 */
export async function applyUsageSummary(
  conversationId: string,
  entry: ConversationUsageEntry,
): Promise<void> {
  const found = await getByIdGlobal(conversationId);
  if (!found) return;
  const { workspaceId } = found;
  await withConversationsTxn(workspaceId, async (file) => {
    const conv = file.conversations[conversationId];
    if (!conv) return;

    const prev = conv.usageSummary;
    const lastContextSize =
      entry.usage.inputTokens + entry.usage.cacheReadInputTokens + entry.usage.cacheCreationInputTokens;
    const lastContextWindow = pickMainContextWindow(entry);

    conv.usageSummary = {
      turnCount: (prev?.turnCount ?? 0) + 1,
      totalInputTokens: (prev?.totalInputTokens ?? 0) + entry.usage.inputTokens,
      totalOutputTokens: (prev?.totalOutputTokens ?? 0) + entry.usage.outputTokens,
      totalCacheReadTokens: (prev?.totalCacheReadTokens ?? 0) + entry.usage.cacheReadInputTokens,
      lastContextSize,
      lastContextWindow,
    };
  });
}

/**
 * 若 usageSummary.turnCount 与 JSONL 实际轮次不一致，则重建 summary。
 * 懒触发：由 getUsage IPC handler 调用，fire-and-forget。
 */
export async function recomputeUsageSummaryIfStale(conversationId: string): Promise<void> {
  const found = await getByIdGlobal(conversationId);
  if (!found) return;
  const { workspaceId, conv } = found;
  const usage = await readUsage(conversationId);
  if ((conv.usageSummary?.turnCount ?? 0) === usage.totals.turnCount) return;

  await withConversationsTxn(workspaceId, async (file) => {
    const target = file.conversations[conversationId];
    if (!target) return;

    const lastEntry = usage.entries[usage.entries.length - 1];
    target.usageSummary = {
      turnCount: usage.totals.turnCount,
      totalInputTokens: usage.totals.inputTokens,
      totalOutputTokens: usage.totals.outputTokens,
      totalCacheReadTokens: usage.totals.cacheReadInputTokens,
      lastContextSize: lastEntry
        ? lastEntry.usage.inputTokens + lastEntry.usage.cacheReadInputTokens + lastEntry.usage.cacheCreationInputTokens
        : undefined,
      lastContextWindow: lastEntry ? pickMainContextWindow(lastEntry) : undefined,
    };
  });
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

    // 创建初始 conversation-tree.json（Phase 3 后 root 只装 folderId，新装空树即可；
    // 历史会话由 migrateOrphanConversations 各自创建独立组，组本身存于 group-service）
    const treeService = await import('./conversation-tree-service.js');
    await treeService.initializeTree(wsId);
  }

  // 备份旧文件
  await fs.rename(legacyPath, legacyPath + '.bak');
  console.log('[conversation-service] 迁移完成');
}

/**
 * 给工作区内缺少 groupId 的对话补齐会话组（每条对话对应一个独立组）。
 * 幂等：已有 groupId 的跳过。返回实际迁移条数。
 */
export async function migrateOrphanConversations(workspaceId: string): Promise<number> {
  // 延迟导入避免循环依赖（group-service 不依赖 conversation-service）
  const groupService = await import('./group-service.js');
  const file = await loadWorkspaceConversations(workspaceId);
  let count = 0;

  for (const conv of Object.values(file.conversations)) {
    if (conv.groupId) continue; // 已有 groupId，跳过
    const group = await groupService.createGroup(workspaceId, { title: conv.title });
    conv.groupId = group.id;
    conv.role = 'main';
    count++;
  }

  if (count > 0) {
    await saveWorkspaceConversations(workspaceId, file);
  }
  return count;
}
