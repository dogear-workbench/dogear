import fs from 'fs/promises';
import path from 'path';
import electron from 'electron';
import { withFileLock } from '../safe-json.js';
import { mainLogger } from '../../agents/logger.js';
import type {
  ConversationUsageEntry,
  CompactMarker,
  ContextSnapshot,
  ConversationUsage,
  UsageJsonlLine,
  PermissionWaitRecord,
} from '../../types.js';

const { app } = electron;

const logger = mainLogger.child('usage-service');

// ============================================================
// 路径工具
// ============================================================

function getConfigDir(): string {
  // 与 session-paths.ts 对齐：优先读 env（worker 线程 / 测试场景无 electron app）
  if (process.env.DOGEAR_CONFIG_DIR) {
    return process.env.DOGEAR_CONFIG_DIR;
  }
  if (app?.isPackaged) {
    return path.join(app.getPath('userData'), '.dogear');
  }
  return path.join(process.cwd(), '.dogear');
}

function usageFilePath(conversationId: string): string {
  return path.join(getConfigDir(), 'usage', `${conversationId}.jsonl`);
}

/** 防止路径穿越：id 不能含路径分隔符或 '..' */
function assertSafeId(conversationId: string): void {
  if (conversationId.includes('..') || conversationId.includes('/') || conversationId.includes('\\')) {
    throw new Error(`不安全的 conversationId: ${conversationId}`);
  }
}

// ============================================================
// 空 totals 形状（ENOENT 或出错时返回）
// ============================================================

function emptyUsage(): ConversationUsage {
  return {
    entries: [],
    compactMarkers: [],
    totals: {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      totalCostUsd: 0,
      turnCount: 0,
      toolCallCount: 0,
    },
  };
}

// ============================================================
// 公开 API
// ============================================================

/**
 * 追加一条用量记录到 JSONL 文件。
 * fire-and-forget：IO 出错只 warn，不抛异常。
 */
export async function appendEntry(
  conversationId: string,
  entry: ConversationUsageEntry,
): Promise<void> {
  try {
    assertSafeId(conversationId);
    const file = usageFilePath(conversationId);
    await withFileLock(file, async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.appendFile(file, JSON.stringify({ kind: 'entry', ...entry } satisfies UsageJsonlLine) + '\n', 'utf-8');
    });
  } catch (err) {
    logger.warn('appendEntry 失败', err);
  }
}

/**
 * 追加一条压缩标记到 JSONL 文件。
 * fire-and-forget：IO 出错只 warn，不抛异常。
 */
export async function appendCompactMarker(
  conversationId: string,
  marker: CompactMarker,
): Promise<void> {
  try {
    assertSafeId(conversationId);
    const file = usageFilePath(conversationId);
    await withFileLock(file, async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.appendFile(file, JSON.stringify({ kind: 'compact', ...marker } satisfies UsageJsonlLine) + '\n', 'utf-8');
    });
  } catch (err) {
    logger.warn('appendCompactMarker 失败', err);
  }
}

/**
 * 追加一条权限等待记录到 JSONL 文件。
 * 独立 JSONL 行（kind='permission'），readUsage 读取时聚合到最近一条 entry 的 permissionWaits。
 * fire-and-forget：IO 出错只 warn，不抛异常。
 */
export async function appendPermissionWait(
  conversationId: string,
  record: PermissionWaitRecord,
): Promise<void> {
  try {
    assertSafeId(conversationId);
    const file = usageFilePath(conversationId);
    await withFileLock(file, async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.appendFile(file, JSON.stringify({ kind: 'permission', ...record } satisfies UsageJsonlLine) + '\n', 'utf-8');
    });
  } catch (err) {
    logger.warn('appendPermissionWait 失败', err);
  }
}

/**
 * 追加一条上下文快照到 JSONL 文件。
 * fire-and-forget：IO 出错只 warn，不抛异常。
 */
export async function appendContext(
  conversationId: string,
  snapshot: ContextSnapshot,
): Promise<void> {
  try {
    assertSafeId(conversationId);
    const file = usageFilePath(conversationId);
    await withFileLock(file, async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.appendFile(file, JSON.stringify({ kind: 'context', ...snapshot } satisfies UsageJsonlLine) + '\n', 'utf-8');
    });
  } catch (err) {
    logger.warn('appendContext 失败', err);
  }
}

/**
 * 读取对话的全部用量记录并计算汇总。
 * 文件不存在返回空结构，其他 IO 错误 warn 后也返回空结构。
 */
export async function readUsage(conversationId: string): Promise<ConversationUsage> {
  try {
    assertSafeId(conversationId);
  } catch (err) {
    logger.warn('readUsage id 校验失败', err);
    return emptyUsage();
  }

  const file = usageFilePath(conversationId);

  let content: string;
  try {
    content = await fs.readFile(file, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return emptyUsage();
    }
    logger.warn('readUsage 读取文件失败', err);
    return emptyUsage();
  }

  const entries: ConversationUsageEntry[] = [];
  const compactMarkers: CompactMarker[] = [];
  let latestContext: ContextSnapshot | undefined;
  // permission 记录可能先于其所属 entry 落盘（响应时即 append，entry 待本轮结束才 append）
  // → 先入暂存队列，扫描结束后按 requestedAt 归属到时间窗口匹配的 entry
  const pendingPermissions: PermissionWaitRecord[] = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as UsageJsonlLine;
      const { kind, ...rest } = parsed as any;
      if (kind === 'entry') {
        entries.push(rest as ConversationUsageEntry);
      } else if (kind === 'compact') {
        compactMarkers.push(rest as CompactMarker);
      } else if (kind === 'context') {
        latestContext = rest as ContextSnapshot;
      } else if (kind === 'permission') {
        pendingPermissions.push(rest as PermissionWaitRecord);
      }
    } catch {
      // 跳过无法解析的行
    }
  }

  // permission 归属：分配到 requestedAt ≤ entry.timestamp 且最接近的 entry（即该权限发生在那一轮内）
  // 找不到所属 entry（如所有 entry 都早于该 permission）时挂到最后一条 entry，无 entry 则丢弃
  for (const p of pendingPermissions) {
    let target: ConversationUsageEntry | undefined;
    for (const e of entries) {
      if (e.timestamp >= p.requestedAt) {
        target = e;
        break;
      }
    }
    if (!target) target = entries[entries.length - 1];
    if (!target) continue;
    if (!target.permissionWaits) target.permissionWaits = [];
    target.permissionWaits.push(p);
  }

  // 计算汇总
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreationInputTokens = 0;
  let cacheReadInputTokens = 0;
  let totalCostUsd = 0;
  let toolCallCount = 0;

  for (const e of entries) {
    inputTokens += e.usage.inputTokens;
    outputTokens += e.usage.outputTokens;
    cacheCreationInputTokens += e.usage.cacheCreationInputTokens;
    cacheReadInputTokens += e.usage.cacheReadInputTokens;
    totalCostUsd += e.totalCostUsd;
    toolCallCount += e.toolActivity?.totalCalls ?? 0;
  }

  return {
    entries,
    compactMarkers,
    latestContext,
    totals: {
      inputTokens,
      outputTokens,
      cacheCreationInputTokens,
      cacheReadInputTokens,
      totalCostUsd,
      turnCount: entries.length,
      toolCallCount,
    },
  };
}

/**
 * 删除对话的用量 JSONL 文件。
 * ENOENT 静默忽略，其他错误 warn，不抛异常。
 */
export async function deleteUsage(conversationId: string): Promise<void> {
  try {
    assertSafeId(conversationId);
    const file = usageFilePath(conversationId);
    await fs.unlink(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    logger.warn('deleteUsage 失败', err);
  }
}
