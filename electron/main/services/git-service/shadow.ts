/**
 * 影子 git 仓库：git-dir 在 configDir/workspaces/<id>/shadow-git/，work-tree 指向工作区
 * add 用 -f + pathspec exclude：绕过用户 .gitignore（安全网需覆盖被用户 ignore 的私人文件），
 * 目录排除规则走 pathspec（不污染用户工作区，info/exclude 挡不住用户 in-tree .gitignore）
 */
import fs from 'fs/promises';
import type { Dirent } from 'fs';
import path from 'path';
import { getConfigDir, loadSettings, SNAPSHOT_SETTING_DEFAULTS } from '../settings-service.js';
import { execGit, execGitCode, execGitInput, hasGit, assertSafeRef, workspaceGitPath, toGitPath, GitServiceError } from './exec.js';

function gitMissingError(): GitServiceError {
  return new GitServiceError('git-missing', '系统未安装 git，快照功能不可用');
}

export interface SnapshotEntry {
  hash: string;
  time: string;
  message: string;
}

export const SNAPSHOT_SOURCES = ['agent-write', 'agent-edit', 'ui-delete', 'ui-rename', 'ui-create', 'pre-restore'] as const;
export type SnapshotSource = (typeof SNAPSHOT_SOURCES)[number];

const LOG_RECORD_SEP = '\x1e';
const LOG_FIELD_SEP = '\x1f';

const queues = new Map<string, Promise<void>>();

async function enqueue<T>(workspaceId: string, task: () => Promise<T>): Promise<T> {
  const prev = queues.get(workspaceId) ?? Promise.resolve();
  const run = prev.then(task, task);
  queues.set(
    workspaceId,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

function shadowGitDir(workspaceId: string): string {
  return path.join(getConfigDir(), 'workspaces', workspaceId, 'shadow-git');
}

/** 影子仓库目录磁盘占用（字节，递归求和）；目录不存在返回 0 */
export async function getShadowRepoSizeBytes(workspaceId: string): Promise<number> {
  let total = 0;
  const walk = async (dir: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(p);
      } else if (entry.isFile()) {
        total += await fs.stat(p).then((st) => st.size, () => 0);
      }
    }
  };
  await walk(shadowGitDir(workspaceId));
  return total;
}

function shadowArgs(gitDir: string, workspacePath: string, args: string[]): string[] {
  return ['--git-dir', gitDir, '--work-tree', workspacePath, ...args];
}

async function execShadow(gitDir: string, workspacePath: string, args: string[]): Promise<string> {
  return execGit(workspacePath, shadowArgs(gitDir, workspacePath, args));
}

function excludePathspecs(excludeDirs: string[]): string[] {
  return excludeDirs.flatMap((dir) => [`:(exclude)${dir}`, `:(exclude)**/${dir}`]);
}

async function fileExists(p: string): Promise<boolean> {
  return fs
    .stat(p)
    .then(() => true)
    .catch(() => false);
}

async function hasShadowHead(gitDir: string, workspacePath: string): Promise<boolean> {
  return (await execGitCode(workspacePath, shadowArgs(gitDir, workspacePath, ['rev-parse', '--verify', '--quiet', 'HEAD']))) === 0;
}

async function hasStagedChanges(gitDir: string, workspacePath: string): Promise<boolean> {
  const code = await execGitCode(workspacePath, shadowArgs(gitDir, workspacePath, ['diff', '--cached', '--quiet']));
  if (code === 0) return false;
  if (code === 1) return true;
  throw new Error(`影子仓库状态检查失败，exit ${code}`);
}

function buildSnapshotMessage(source: SnapshotSource, relPath?: string, conversationId?: string): string {
  const parts = ['[snapshot]', source];
  if (relPath) parts.push(toGitPath(relPath));
  if (conversationId) parts.push(`(conv:${conversationId})`);
  return parts.join(' ');
}

/**
 * add 后从暂存区剔除超阈值 blob：diff --cached --raw 只枚举本轮新增/变更的 A/M 条目（拿 blob hash），
 * cat-file --batch-check 批量查大小（不读文件内容），超阈值的 reset 出暂存区（pathspec 用 literal 魔法防文件名通配字符）
 */
async function unstageOversized(gitDir: string, workspacePath: string, maxBytes: number): Promise<void> {
  const raw = await execShadow(gitDir, workspacePath, [
    'diff', '--cached', '--raw', '-z', '--no-renames', '--diff-filter=AM',
  ]);
  if (!raw) return;
  const records = raw.split('\0');
  const staged: Array<{ path: string; hash: string }> = [];
  for (let i = 0; i + 1 < records.length; i += 2) {
    const meta = records[i];
    const p = records[i + 1];
    if (!meta || !meta.startsWith(':') || !p) continue;
    const hash = meta.split(' ')[3];
    if (hash && /^[0-9a-f]{40}$/.test(hash)) staged.push({ path: p, hash });
  }
  if (staged.length === 0) return;
  const input = [...new Set(staged.map((s) => s.hash))].join('\n') + '\n';
  const out = await execGitInput(
    workspacePath,
    shadowArgs(gitDir, workspacePath, ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)']),
    input,
  );
  const sizeByHash = new Map<string, number>();
  for (const line of out.split('\n')) {
    const [hash, type, size] = line.trim().split(' ');
    if (hash && type === 'blob' && size && /^\d+$/.test(size)) sizeByHash.set(hash, Number(size));
  }
  const oversized = staged.filter((s) => (sizeByHash.get(s.hash) ?? 0) > maxBytes).map((s) => `:(literal)${s.path}`);
  if (oversized.length > 0) {
    await execShadow(gitDir, workspacePath, ['reset', '-q', '--', ...oversized]);
  }
}

export async function ensureShadowRepo(workspaceId: string, workspacePath: string): Promise<void> {
  const gitDir = shadowGitDir(workspaceId);
  await enqueue(workspaceId, async () => {
    if (await fileExists(path.join(gitDir, 'HEAD'))) return;
    await fs.mkdir(gitDir, { recursive: true });
    await execShadow(gitDir, workspacePath, ['init']);
    await execGit(workspacePath, ['--git-dir', gitDir, 'config', 'user.name', 'dogear-shadow']);
    await execGit(workspacePath, ['--git-dir', gitDir, 'config', 'user.email', 'dogear-shadow@local']);
    // 字节级一致：autocrlf 关掉，防止恢复时 CRLF/LF 漂移
    await execGit(workspacePath, ['--git-dir', gitDir, 'config', 'core.autocrlf', 'false']);
  });
}

export async function takeSnapshot(
  workspaceId: string,
  workspacePath: string,
  source: SnapshotSource,
  relPath?: string,
  conversationId?: string,
): Promise<void> {
  if (!(await hasGit())) return;
  const snapshotSettings = (await loadSettings()).snapshot ?? structuredClone(SNAPSHOT_SETTING_DEFAULTS);
  if (snapshotSettings.disabledWorkspaces?.includes(workspaceId)) return;
  await ensureShadowRepo(workspaceId, workspacePath);
  const gitDir = shadowGitDir(workspaceId);
  await enqueue(workspaceId, async () => {
    await execShadow(gitDir, workspacePath, ['add', '-A', '-f', '--', '.', ...excludePathspecs(snapshotSettings.excludeDirs)]);
    await unstageOversized(gitDir, workspacePath, snapshotSettings.maxFileSizeBytes);
    if (!(await hasStagedChanges(gitDir, workspacePath))) return;
    await execShadow(gitDir, workspacePath, ['commit', '-m', buildSnapshotMessage(source, relPath, conversationId)]);
  });
}

function parseLogEntries(stdout: string): SnapshotEntry[] {
  return stdout
    .split(LOG_RECORD_SEP)
    .map((chunk) => chunk.replace(/^\n+/, '').trim())
    .filter(Boolean)
    .map((chunk) => {
      const [hash = '', time = '', message = ''] = chunk.split(LOG_FIELD_SEP);
      return { hash, time, message };
    });
}

export async function listShadowHistory(
  workspaceId: string,
  workspacePath: string,
  relPath?: string,
): Promise<SnapshotEntry[]> {
  if (!(await hasGit())) throw gitMissingError();
  const gitDir = shadowGitDir(workspaceId);
  if (!(await fileExists(path.join(gitDir, 'HEAD')))) return [];
  return enqueue(workspaceId, async () => {
    if (!(await hasShadowHead(gitDir, workspacePath))) return [];
    const args = ['log', '--pretty=%H%x1f%aI%x1f%s%x1e'];
    if (relPath) args.push('--', workspaceGitPath(workspacePath, relPath));
    const stdout = await execShadow(gitDir, workspacePath, args);
    return parseLogEntries(stdout);
  });
}

export async function getShadowFileContent(
  workspaceId: string,
  workspacePath: string,
  ref: string,
  relPath: string,
): Promise<string | null> {
  if (!(await hasGit())) throw gitMissingError();
  assertSafeRef(ref);
  const gitDir = shadowGitDir(workspaceId);
  if (!(await fileExists(path.join(gitDir, 'HEAD')))) return null;
  const spec = `${ref}:${workspaceGitPath(workspacePath, relPath)}`;
  const exists = (await execGitCode(workspacePath, shadowArgs(gitDir, workspacePath, ['cat-file', '-e', spec]))) === 0;
  if (!exists) return null;
  return execShadow(gitDir, workspacePath, ['show', spec]);
}

export async function restoreFromSnapshot(
  workspaceId: string,
  workspacePath: string,
  ref: string,
  relPath?: string,
): Promise<void> {
  if (!(await hasGit())) throw gitMissingError();
  assertSafeRef(ref);
  await takeSnapshot(workspaceId, workspacePath, 'pre-restore');
  const gitDir = shadowGitDir(workspaceId);
  await enqueue(workspaceId, async () => {
    const target = relPath ? workspaceGitPath(workspacePath, relPath) : '.';
    await execShadow(gitDir, workspacePath, ['checkout', ref, '--', target]);
  });
}
