import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ConversationId, EntryId, EntryRecord, Page, StorageWrite } from '@earendil-works/pi-durable';
import type { JsonValue } from '@earendil-works/chord';
import { JsonlStorage, openNodeJsonlStorage } from '@earendil-works/pi-durable/storage/jsonl/node';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { getConfigDir } from '../../services/settings-service.js';
import { ensureWorkspaceMigrated } from './storage-migrator.js';
import { getSessionDir, readSessionMeta, writeSessionMeta, SESSION_MAIN_FILE } from './session-meta.js';

export interface PiHarnessSession {
  id: string;
  filePath: string;
  createdAt: string;
  /** durable storage 内主 conversation 的数字 id（Step 5 Harness.open 后定位 conversation 用） */
  conversationId: number;
}

export interface SessionFileInfo {
  sessionId: string;
  filePath: string;
  sizeBytes: number;
}

export interface PiHarnessForkOptions {
  entryId?: string;
  position?: 'before' | 'at';
  id?: string;
}

/** 打开的会话：storage 归调用方所有（Step 5 交 Harness.open 消费，用毕 close） */
export interface OpenedHarnessSession {
  storage: JsonlStorage;
  info: PiHarnessSession;
}

function getSessionsRoot(workspaceId: string): string {
  return path.join(getConfigDir(), 'workspaces', workspaceId, 'sessions');
}

function getWorkspaceCwd(workspaceId: string): string {
  return path.join(getConfigDir(), 'workspaces', workspaceId);
}

function sessionMainPath(workspaceId: string, sessionId: string): string {
  return path.join(getSessionDir(getSessionsRoot(workspaceId), sessionId), SESSION_MAIN_FILE);
}

export class PiSessionRepository {
  // 会话元数据列表缓存（listSessions 的读放大闸：千级会话逐目录读 session.json）；
  // create/delete/fork/relocateSession 改变文件集合，各自完成后立即失效对应缓存。
  private metadataCache = new Map<string, PiHarnessSession[]>();

  private async listSessionMetas(workspaceId: string): Promise<PiHarnessSession[]> {
    const cached = this.metadataCache.get(workspaceId);
    if (cached) return cached;
    const root = getSessionsRoot(workspaceId);
    const dirents = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    const metas = await Promise.all(dirents
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => this.readSessionInfo(workspaceId, entry.name).catch(() => null)));
    const list = metas
      .filter((meta): meta is PiHarnessSession => meta !== null)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    this.metadataCache.set(workspaceId, list);
    return list;
  }

  /** 目录名即 sessionId 的直查；session.json 缺失/损坏时从 storage 主 conversation 自愈回写 */
  private async readSessionInfo(workspaceId: string, sessionId: string): Promise<PiHarnessSession> {
    const dir = getSessionDir(getSessionsRoot(workspaceId), sessionId);
    const filePath = path.join(dir, SESSION_MAIN_FILE);
    const stat = await fs.stat(filePath);
    let meta = await readSessionMeta(dir);
    if (!meta || meta.id !== sessionId) {
      meta = await recoverSessionMeta(dir, sessionId);
    }
    return {
      id: sessionId,
      filePath,
      createdAt: new Date(meta.createdAt).toISOString(),
      conversationId: meta.conversationId,
    };
  }

  /** 检索用批量定位：一次收集工作区全部会话 main.jsonl 的路径与大小 */
  async listSessionFiles(workspaceId: string): Promise<SessionFileInfo[]> {
    await ensureWorkspaceMigrated(workspaceId);
    const root = getSessionsRoot(workspaceId);
    const dirents = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    const infos = await Promise.all(dirents
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const filePath = path.join(root, entry.name, SESSION_MAIN_FILE);
        try {
          const stat = await fs.stat(filePath);
          return { sessionId: entry.name, filePath, sizeBytes: stat.size } satisfies SessionFileInfo;
        } catch {
          return null;
        }
      }));
    return infos.filter((info): info is SessionFileInfo => info !== null);
  }

  async listSessions(workspaceId: string): Promise<PiHarnessSession[]> {
    await ensureWorkspaceMigrated(workspaceId);
    return this.listSessionMetas(workspaceId);
  }

  private async createSessionDir(
    workspaceId: string,
    sessionId: string,
  ): Promise<{ storage: JsonlStorage; conversationId: number }> {
    const dir = getSessionDir(getSessionsRoot(workspaceId), sessionId);
    await fs.mkdir(dir, { recursive: true });
    const existing = await readSessionMeta(dir);
    if (existing) throw new Error(`Harness session already exists: ${sessionId}`);
    const storage = await openNodeJsonlStorage(dir, BACKGROUND_CONTEXT);
    try {
      const conversationId = await storage.mintId<ConversationId>();
      await storage.commit([{ type: 'conversation', value: { id: conversationId } }], BACKGROUND_CONTEXT);
      await writeSessionMeta(dir, {
        id: sessionId,
        createdAt: Date.now(),
        cwd: getWorkspaceCwd(workspaceId),
        conversationId,
      });
      return { storage, conversationId };
    } catch (error) {
      await storage.close(BACKGROUND_CONTEXT).catch(() => {});
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  async create(workspaceId: string, sessionId?: string): Promise<OpenedHarnessSession> {
    await ensureWorkspaceMigrated(workspaceId);
    const id = sessionId ?? randomUUID();
    const { storage, conversationId } = await this.createSessionDir(workspaceId, id);
    this.metadataCache.delete(workspaceId);
    return {
      storage,
      info: {
        id,
        filePath: sessionMainPath(workspaceId, id),
        createdAt: new Date().toISOString(),
        conversationId,
      },
    };
  }

  async open(workspaceId: string, sessionId: string): Promise<OpenedHarnessSession> {
    await ensureWorkspaceMigrated(workspaceId);
    const info = await this.readSessionInfo(workspaceId, sessionId).catch((error: unknown) => {
      throw new Error(`Harness session not found: ${sessionId}（${error instanceof Error ? error.message : String(error)}）`);
    });
    const storage = await openNodeJsonlStorage(
      getSessionDir(getSessionsRoot(workspaceId), sessionId),
      BACKGROUND_CONTEXT,
    );
    return { storage, info };
  }

  async getSessionPath(workspaceId: string, sessionId: string): Promise<string> {
    await ensureWorkspaceMigrated(workspaceId);
    const filePath = sessionMainPath(workspaceId, sessionId);
    await fs.stat(filePath);
    return filePath;
  }

  async delete(workspaceId: string, sessionId: string): Promise<boolean> {
    await ensureWorkspaceMigrated(workspaceId);
    const dir = getSessionDir(getSessionsRoot(workspaceId), sessionId);
    try {
      await fs.stat(path.join(dir, SESSION_MAIN_FILE));
    } catch {
      return false;
    }
    await fs.rm(dir, { recursive: true, force: true });
    this.metadataCache.delete(workspaceId);
    return true;
  }

  /**
   * 将会话目录整体搬到目标工作区：目录移动 + session.json 的 cwd 改写（durable 存储
   * 内 conversation/entry 与 cwd 无关，无需改写）。调用方须保证该 session 无打开的实例。
   * @returns 搬运后的目标 main.jsonl 绝对路径
   */
  async relocateSession(fromWorkspaceId: string, toWorkspaceId: string, sessionId: string): Promise<string> {
    await ensureWorkspaceMigrated(fromWorkspaceId);
    await ensureWorkspaceMigrated(toWorkspaceId);
    const fromDir = getSessionDir(getSessionsRoot(fromWorkspaceId), sessionId);
    await fs.stat(path.join(fromDir, SESSION_MAIN_FILE));
    const toDir = getSessionDir(getSessionsRoot(toWorkspaceId), sessionId);
    await fs.mkdir(getSessionsRoot(toWorkspaceId), { recursive: true });
    try {
      await fs.rename(fromDir, toDir);
    } catch {
      await fs.cp(fromDir, toDir, { recursive: true });
      await fs.rm(fromDir, { recursive: true, force: true });
    }
    const meta = await readSessionMeta(toDir);
    if (meta) {
      await writeSessionMeta(toDir, { ...meta, cwd: getWorkspaceCwd(toWorkspaceId) });
    }
    this.metadataCache.delete(fromWorkspaceId);
    this.metadataCache.delete(toWorkspaceId);
    return path.join(toDir, SESSION_MAIN_FILE);
  }

  /**
   * 分叉：把源会话当前可见历史复制为新目录下的独立会话（截断语义与旧 branch scope 一致：
   * at 含 entryId、before 到其 parent；无 entryId = 全量）。durable 原生 forkConversation 的
   * parent 链继承要求父子同 storage，与「一会话一目录」布局冲突，故降级为快照复制：
   * entry 内容原样、id 重铸为新 storage 递增 id，分叉点之后源会话新增消息不进入副本
   * （与旧 branch fork 语义等价）；ConversationRecord.parent 血缘不保留；pi.usage 按
   * durable fork:"initial" 语义从零开始不复制。
   */
  async fork(
    workspaceId: string,
    sourceSessionId: string,
    options: PiHarnessForkOptions = {},
  ): Promise<OpenedHarnessSession> {
    const source = await this.open(workspaceId, sourceSessionId);
    let visible: EntryRecord[];
    try {
      visible = await scanAllEntries(source.storage, source.info.conversationId);
    } finally {
      await source.storage.close(BACKGROUND_CONTEXT);
    }
    let entries = visible;
    if (options.entryId !== undefined) {
      const index = visible.findIndex((entry) => String(entry.id) === options.entryId);
      if (index < 0) {
        throw new Error(`分叉点不存在于源会话：${options.entryId}`);
      }
      entries = options.position === 'before'
        ? visible.slice(0, index)
        : visible.slice(0, index + 1);
    }
    const newId = options.id ?? randomUUID();
    const { storage, conversationId } = await this.createSessionDir(workspaceId, newId);
    try {
      const idMap = new Map<number, EntryId>();
      const parentConversationId = conversationId as ConversationId;
      // conversation 记录已由 createSessionDir 提交，这里只补 entries
      const writes: StorageWrite[] = [];
      for (const entry of entries) {
        const entryId = await storage.mintId<EntryId>();
        idMap.set(entry.id, entryId);
        const { head, ...rest } = entry;
        const mappedHead = head !== undefined && idMap.has(head) ? idMap.get(head) : undefined;
        writes.push({
          type: 'entry',
          value: {
            ...rest,
            id: entryId,
            conversationId: parentConversationId,
            ...(mappedHead !== undefined ? { head: mappedHead } : {}),
          },
        });
      }
      const BATCH = 500;
      for (let i = 0; i < writes.length; i += BATCH) {
        await storage.commit(writes.slice(i, i + BATCH), BACKGROUND_CONTEXT);
      }
    } catch (error) {
      await storage.close(BACKGROUND_CONTEXT).catch(() => {});
      await fs.rm(getSessionDir(getSessionsRoot(workspaceId), newId), { recursive: true, force: true }).catch(() => {});
      throw error;
    }
    this.metadataCache.delete(workspaceId);
    return {
      storage,
      info: {
        id: newId,
        filePath: sessionMainPath(workspaceId, newId),
        createdAt: new Date().toISOString(),
        conversationId,
      },
    };
  }

  /** 旁路写盘（如恢复会话备份）后失效缓存；create/delete/fork 等内部路径已自行失效 */
  invalidateMetadataCache(workspaceId?: string): void {
    if (workspaceId === undefined) this.metadataCache.clear();
    else this.metadataCache.delete(workspaceId);
  }
}

/** durable scanEntries 分页取全（创建顺序，id 递增） */
async function scanAllEntries(storage: JsonlStorage, conversationId: number): Promise<EntryRecord[]> {
  const out: EntryRecord[] = [];
  let cursor: Record<string, JsonValue> | undefined;
  for (;;) {
    const page: Page<EntryRecord, Readonly<Record<string, JsonValue>>> = await storage.scanEntries(
      { conversationId: conversationId as ConversationId, order: 'ascending' },
      500,
      cursor,
      BACKGROUND_CONTEXT,
    );
    out.push(...page.items);
    if (!page.next) break;
    cursor = { ...page.next };
  }
  return out;
}

/** session.json 缺失/损坏时从 storage 主 conversation 重建（scanConversations ascending 首个 = 创建的第一个） */
async function recoverSessionMeta(dir: string, sessionId: string): Promise<{ id: string; createdAt: number; cwd: string; conversationId: number }> {
  const storage = await openNodeJsonlStorage(dir, BACKGROUND_CONTEXT);
  try {
    const page = await storage.scanConversations({ order: 'ascending' }, 1, undefined, BACKGROUND_CONTEXT);
    const conversation = page.items[0];
    if (!conversation) throw new Error(`session ${sessionId} has no conversation record`);
    const stat = await fs.stat(path.join(dir, SESSION_MAIN_FILE));
    const meta = {
      id: sessionId,
      createdAt: stat.birthtimeMs || stat.mtimeMs,
      cwd: '',
      conversationId: Number(conversation.id),
    };
    await writeSessionMeta(dir, meta);
    return meta;
  } finally {
    await storage.close(BACKGROUND_CONTEXT);
  }
}

let repository: PiSessionRepository | null = null;

export function getPiSessionRepository(): PiSessionRepository {
  if (!repository) repository = new PiSessionRepository();
  return repository;
}
