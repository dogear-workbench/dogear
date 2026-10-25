/**
 * 存量 harness 会话（0.99.2 v3/v4 JSONL）→ pi-durable JsonlStorage 目录布局的一次性转换。
 *
 * 新布局：sessions/<sessionId>/{main.jsonl, session.json, doc-*.jsonl}（拉平，去 encodeCwd 分层）。
 * 转换语义（plan 决策 2）：entry 行逐条转 durable EntryRecord（message 载荷按 role 映射内置
 * pi.user / pi.assistant / pi.tool-result kind）、usage 行聚合写 pi.usage conversation doc
 * （旧行无 model 归属，统一入 "legacy/legacy" 桶）、header 转 conversation 记录；pi.* 内部状态行
 * （value/list）有意丢弃并计数，运行时状态由新框架重建。durable 的 ConversationId/EntryId 是
 * storage 内递增数字，旧 UUID 不进存储，会话 id 以目录名保持不变。
 * 幂等：目标目录 main.jsonl 已存在即跳过该文件；实转写临时目录成功后原子 rename，源文件挪
 * sessions-legacy-backup/<原相对路径> 备份不删。dry-run 只出报告不落盘。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ConversationId, DocumentId, EntryId, EntryRecord, StorageWrite } from '@earendil-works/pi-durable';
import type { Usage } from '@earendil-works/pi-ai';
import { openNodeJsonlStorage } from '@earendil-works/pi-durable/storage/jsonl/node';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { getConfigDir } from '../../services/settings-service.js';
import { parseLegacySession, LegacyFormatError, type ParsedLegacySession } from './legacy-session-format.js';
import { getSessionDir, readSessionMeta, writeSessionMeta, SESSION_MAIN_FILE } from './session-meta.js';

export interface MigrationFileReport {
  file: string;
  format: 'v3' | 'v4';
  sessionId: string;
  entryCount: number;
}

export interface MigrationReport {
  workspaceId: string;
  totalFiles: number;
  v3: number;
  v4: number;
  unknownFormat: number;
  converted: number;
  skippedConverted: number;
  /** 活跃会话跳过：近期有写入的文件不在本次转（避免与运行中旧版进程并发写冲突），留给下次迁移 */
  skippedActive: number;
  emptySessions: number;
  entriesConverted: number;
  usageRowsAggregated: number;
  droppedInternalLines: number;
  droppedOffBranchEntries: number;
  failed: Array<{ file: string; error: string }>;
  convertedFiles: MigrationFileReport[];
}

interface ScannedFile {
  sessionId: string;
  sourcePath: string;
  /** 相对 sessions/ 的路径（backup 侧原样保留） */
  relativePath: string;
  /** header 读取/解析失败（无法定位目标目录）；migrateWorkspace 里直接进 failed */
  unreadable?: string;
}
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

function getSessionsRoot(workspaceId: string): string {
  return path.join(getConfigDir(), 'workspaces', workspaceId, 'sessions');
}

export function getBackupRoot(workspaceId: string): string {
  return path.join(getConfigDir(), 'workspaces', workspaceId, 'sessions-legacy-backup');
}

function getWorkspaceCwd(workspaceId: string): string {
  return path.join(getConfigDir(), 'workspaces', workspaceId);
}

const UUID_DIR_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 扫描 sessions/ 下全部旧格式 jsonl（含 encodeCwd 子目录），跳过已是新布局的会话目录 */
export async function scanLegacyFiles(workspaceId: string): Promise<ScannedFile[]> {
  const root = getSessionsRoot(workspaceId);
  let dirents: import('node:fs').Dirent[];
  try {
    dirents = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: ScannedFile[] = [];
  for (const entry of dirents) {
    if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      out.push({ sessionId: '', sourcePath: path.join(root, entry.name), relativePath: entry.name });
      continue;
    }
    if (!entry.isDirectory() || !entry.name.startsWith('--')) continue;
    const subDir = path.join(root, entry.name);
    for (const file of await fs.readdir(subDir).catch(() => [] as string[])) {
      if (file.endsWith('.jsonl')) {
        out.push({ sessionId: '', sourcePath: path.join(subDir, file), relativePath: path.join(entry.name, file) });
      }
    }
  }
  const withIds = await Promise.all(out.map(async (item) => {
    try {
      return { ...item, sessionId: await sessionIdOfLegacyFile(item.sourcePath) };
    } catch (error) {
      return { ...item, sessionId: '', unreadable: error instanceof Error ? error.message : String(error) };
    }
  }));
  return withIds;
}

async function sessionIdOfLegacyFile(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath, 'utf-8');
  const firstLine = content.split('\n', 1)[0];
  const parsed = JSON.parse(firstLine) as Record<string, unknown>;
  if (typeof parsed.id === 'string' && parsed.id) return parsed.id;
  throw new LegacyFormatError(`${filePath}: header is missing id`);
}

function aggregateUsage(total: Usage, incoming: Usage): void {
  total.input += num(incoming.input);
  total.output += num(incoming.output);
  total.cacheRead += num(incoming.cacheRead);
  total.cacheWrite += num(incoming.cacheWrite);
  if (incoming.cacheWrite1h !== undefined) total.cacheWrite1h = (total.cacheWrite1h ?? 0) + num(incoming.cacheWrite1h);
  if (incoming.reasoning !== undefined) total.reasoning = (total.reasoning ?? 0) + num(incoming.reasoning);
  total.totalTokens += num(incoming.totalTokens);
  total.cost.input += num(incoming.cost?.input);
  total.cost.output += num(incoming.cost?.output);
  total.cost.cacheRead += num(incoming.cost?.cacheRead);
  total.cost.cacheWrite += num(incoming.cost?.cacheWrite);
  total.cost.total += num(incoming.cost?.total);
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function legacyMessageToEntryDraft(
  sessionId: string,
  message: Record<string, unknown>,
  timestampMs: number,
): { kind: string; model: Record<string, unknown>[]; data?: unknown } | null {
  const role = (message as { role?: unknown }).role;
  const payload = { ...(message as Record<string, unknown>), timestamp: timestampMs };
  if (role === 'user') {
    return { kind: 'pi.user', model: [payload] };
  }
  if (role === 'assistant') {
    // v3 时代 assistant 只存 {role, content}，按 pi-ai 1.3.0 AssistantMessage 必填字段补 legacy 占位
    const normalized = {
      api: 'legacy',
      provider: 'legacy',
      model: 'legacy',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { ...ZERO_COST } },
      stopReason: 'stop',
      ...payload,
    };
    return { kind: 'pi.assistant', model: [normalized] };
  }
  if (role === 'toolResult') {
    return {
      kind: 'pi.tool-result',
      model: [payload],
      data: { diagnostics: [] },
    };
  }
  console.warn(`[storage-migrator] ${sessionId}: unknown message role ${String(role)}, dropped`);
  return null;
}

async function convertSession(
  workspaceId: string,
  scanned: ScannedFile,
  parsed: ParsedLegacySession,
): Promise<number> {
  const tmpDir = path.join(getSessionsRoot(workspaceId), `.migrate-tmp-${parsed.sessionId}`);
  let entryCount = 0;
  await fs.rm(tmpDir, { recursive: true, force: true });
  try {
    await fs.mkdir(tmpDir, { recursive: true });
    const storage = await openNodeJsonlStorage(tmpDir, BACKGROUND_CONTEXT);
    try {
      const conversationId = await storage.mintId<ConversationId>();
      const writes: StorageWrite[] = [{ type: 'conversation', value: { id: conversationId } }];
      for (const entry of parsed.branch) {
        if (entry.type !== 'message') continue;
        const message = (entry.payload as { message?: unknown }).message;
        if (typeof message !== 'object' || message === null) {
          entryCount++;
          continue;
        }
        const draft = legacyMessageToEntryDraft(parsed.sessionId, message as Record<string, unknown>, entry.timestamp);
        if (!draft) {
          entryCount++;
          continue;
        }
        const entryId = await storage.mintId<EntryId>();
        const record: EntryRecord = {
          id: entryId,
          conversationId,
          kind: draft.kind,
          ...(draft.model ? { model: draft.model as unknown as EntryRecord['model'] } : {}),
          ...(draft.data !== undefined ? { data: draft.data as unknown as EntryRecord['data'] } : {}),
        };
        writes.push({ type: 'entry', value: record });
        entryCount++;
      }
      if (parsed.usageRows.length > 0) {
        const total: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { ...ZERO_COST } };
        for (const row of parsed.usageRows) aggregateUsage(total, row.usage);
        const docId = await storage.mintId<DocumentId>();
        writes.push({
          type: 'document.create',
          record: {
            id: docId,
            kind: 'pi.usage',
            scope: { kind: 'conversation', conversationId },
            history: 'latest',
            fork: 'initial',
          },
          content: {
            version: 1,
            kind: 'base',
            value: { models: { 'legacy/legacy': total }, tools: {} } as unknown as Record<string, never>,
          },
        });
      }
      const BATCH = 500;
      for (let i = 0; i < writes.length; i += BATCH) {
        await storage.commit(writes.slice(i, i + BATCH), BACKGROUND_CONTEXT);
      }
      await writeSessionMeta(tmpDir, {
        id: parsed.sessionId,
        createdAt: parsed.createdAt,
        cwd: parsed.cwd,
        conversationId: Number(conversationId),
      });
    } finally {
      await storage.close(BACKGROUND_CONTEXT);
    }
    const targetDir = getSessionDir(getSessionsRoot(workspaceId), parsed.sessionId);
    await fs.mkdir(getSessionsRoot(workspaceId), { recursive: true });
    await fs.rename(tmpDir, targetDir);
  } catch (error) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  return entryCount;
}

async function backupSource(workspaceId: string, scanned: ScannedFile): Promise<void> {
  const backupPath = path.join(getBackupRoot(workspaceId), scanned.relativePath);
  await fs.mkdir(path.dirname(backupPath), { recursive: true });
  await fs.rename(scanned.sourcePath, backupPath);
}

async function cleanupStaleTmpDirs(workspaceId: string): Promise<void> {
  const root = getSessionsRoot(workspaceId);
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith('.migrate-tmp-')) {
      await fs.rm(path.join(root, entry.name), { recursive: true, force: true }).catch(() => {});
    }
  }
}

export async function migrateWorkspace(
  workspaceId: string,
  options: { dryRun: boolean; skipRecentlyModifiedMs?: number },
): Promise<MigrationReport> {
  const report: MigrationReport = {
    workspaceId,
    totalFiles: 0, v3: 0, v4: 0, unknownFormat: 0, converted: 0, skippedConverted: 0,
    skippedActive: 0, emptySessions: 0, entriesConverted: 0, usageRowsAggregated: 0,
    droppedInternalLines: 0, droppedOffBranchEntries: 0, failed: [], convertedFiles: [],
  };
  if (!options.dryRun) {
    await cleanupStaleTmpDirs(workspaceId);
    await fs.mkdir(getBackupRoot(workspaceId), { recursive: true }).catch(() => {});
  }
  const scannedFiles = await scanLegacyFiles(workspaceId);
  report.totalFiles = scannedFiles.length;
  for (const scanned of scannedFiles) {
    if (scanned.unreadable || !UUID_DIR_RE.test(scanned.sessionId)) {
      report.failed.push({
        file: scanned.relativePath,
        error: scanned.unreadable ?? `header id is not a session uuid: ${scanned.sessionId}`,
      });
      continue;
    }
    let content: string;
    try {
      content = await fs.readFile(scanned.sourcePath, 'utf-8');
    } catch (error) {
      report.failed.push({ file: scanned.relativePath, error: `read failed: ${error instanceof Error ? error.message : String(error)}` });
      continue;
    }
    const targetMain = path.join(getSessionDir(getSessionsRoot(workspaceId), scanned.sessionId), SESSION_MAIN_FILE);
    if (await fs.stat(targetMain).then(() => true).catch(() => false)) {
      report.skippedConverted++;
      continue;
    }
    if (options.skipRecentlyModifiedMs) {
      const mtime = (await fs.stat(scanned.sourcePath).catch(() => null))?.mtimeMs ?? 0;
      if (Date.now() - mtime < options.skipRecentlyModifiedMs) {
        report.skippedActive++;
        continue;
      }
    }
    let parsed: ParsedLegacySession;
    try {
      parsed = parseLegacySession(content, scanned.sourcePath);
    } catch (error) {
      report.unknownFormat++;
      report.failed.push({
        file: scanned.relativePath,
        error: error instanceof LegacyFormatError ? error.message : `parse failed: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }
    if (parsed.format === 'v3') report.v3++; else report.v4++;
    report.droppedInternalLines += parsed.droppedInternalLines;
    report.droppedOffBranchEntries += parsed.droppedOffBranchEntries;
    report.usageRowsAggregated += parsed.usageRows.length;
    if (parsed.branch.length === 0) report.emptySessions++;
    if (options.dryRun) {
      report.converted++;
      report.entriesConverted += parsed.branch.length;
      continue;
    }
    try {
      const entryCount = await convertSession(workspaceId, scanned, parsed);
      await backupSource(workspaceId, scanned);
      report.converted++;
      report.entriesConverted += entryCount;
      report.convertedFiles.push({
        file: scanned.relativePath,
        format: parsed.format,
        sessionId: parsed.sessionId,
        entryCount,
      });
    } catch (error) {
      report.failed.push({
        file: scanned.relativePath,
        error: `convert failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  return report;
}

const migrationLocks = new Map<string, Promise<void>>();

/**
 * 工作区迁移幂等闸：repository 所有按目录布局的入口先经此（in-flight 去重），
 * 已全部迁移（无可转文件）时无 IO 副作用仅一次目录扫描。
 */
export function ensureWorkspaceMigrated(workspaceId: string): Promise<void> {
  const existing = migrationLocks.get(workspaceId);
  if (existing) return existing;
  const run = (async () => {
    const report = await migrateWorkspace(workspaceId, { dryRun: false });
    if (report.converted > 0) {
      console.log(`[storage-migrator] workspace ${workspaceId}: converted ${report.converted} sessions, ` +
        `${report.entriesConverted} entries, ${report.failed.length} failed`);
    }
    if (report.failed.length > 0) {
      console.error(`[storage-migrator] workspace ${workspaceId} failures:`, report.failed);
    }
  })()
    .catch((error) => {
      console.error(`[storage-migrator] workspace ${workspaceId} migration failed:`, error);
    })
    .finally(() => migrationLocks.delete(workspaceId));
  migrationLocks.set(workspaceId, run);
  return run;
}

export async function migrateAllWorkspaces(
  options: { dryRun: boolean; skipRecentlyModifiedMs?: number },
): Promise<MigrationReport[]> {
  const workspacesDir = path.join(getConfigDir(), 'workspaces');
  const entries = await fs.readdir(workspacesDir, { withFileTypes: true }).catch(() => []);
  const reports: MigrationReport[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !UUID_DIR_RE.test(entry.name)) continue;
    reports.push(await migrateWorkspace(entry.name, options));
  }
  return reports;
}

const isCli = process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isCli) {
  const dryRun = !process.argv.includes('--apply');
  // 运行中应用（旧版进程）可能正持有并写入少量活跃会话文件：CLI 实转跳过 5 分钟内
  // 有写入的热文件，留给应用下次启动时的迁移窗口补转（启动序列先于会话打开执行）
  const skipActive = dryRun ? 0 : 5 * 60 * 1000;
  const label = dryRun ? 'DRY-RUN' : 'APPLY';
  migrateAllWorkspaces({ dryRun, skipRecentlyModifiedMs: skipActive })
    .then((reports) => {
      for (const report of reports) {
        console.log(`\n=== [${label}] workspace ${report.workspaceId} ===`);
        console.log(JSON.stringify({ ...report, convertedFiles: undefined }, null, 2));
        if (report.failed.length > 0) console.log('failed:', JSON.stringify(report.failed, null, 2));
      }
      const totals = reports.reduce((acc, r) => ({
        files: acc.files + r.totalFiles, converted: acc.converted + r.converted,
        skipped: acc.skipped + r.skippedConverted, entries: acc.entries + r.entriesConverted,
        active: acc.active + r.skippedActive, failed: acc.failed + r.failed.length,
      }), { files: 0, converted: 0, skipped: 0, entries: 0, active: 0, failed: 0 });
      console.log(`\n[${label}] TOTAL: files=${totals.files} converted=${totals.converted} skipped=${totals.skipped} active=${totals.active} entries=${totals.entries} failed=${totals.failed}`);
    })
    .then(async () => {
      const workspacesDir = path.join(getConfigDir(), 'workspaces');
      for (const entry of await fs.readdir(workspacesDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || !UUID_DIR_RE.test(entry.name)) continue;
        const root = getSessionsRoot(entry.name);
        const dirs = (await fs.readdir(root, { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory());
        const legacyDirs = dirs.filter((d) => d.name.startsWith('--')).length;
        const sessionDirs = dirs.filter((d) => UUID_DIR_RE.test(d.name)).length;
        console.log(`workspace ${entry.name}: sessions/ dirs=${dirs.length} legacyDirs=${legacyDirs} sessionDirs=${sessionDirs}`);
      }
    })
    .catch((error) => {
      console.error(`[${label}] migration crashed:`, error);
      process.exitCode = 1;
    });
}
