/**
 * 影子快照保留窗口裁剪：近 recentDays 天全留 → recentDays+1~totalDays 每天留最后一条 → 超出丢弃。
 * 重写方式：cat-file 取原 commit 对象，保留 tree/作者/时间字节级不变，逐段 hash-object 重建链（首个保留项做新根）。
 * 只处理 [snapshot] 开头的 commit 链；调用方须走 shadow.ts 的按工作区串行队列，与快照/瘦身互斥
 */
import type { SnapshotRetention } from '../settings-types.js';
import { execGit, execGitCode, execGitInput } from './exec.js';

export const LOG_RECORD_SEP = '\x1e';
export const LOG_FIELD_SEP = '\x1f';

export interface ShadowCommit {
  hash: string;
  authorTs: number;
  subject: string;
}

export interface PruneSnapshotResult {
  before: number;
  after: number;
}

function localDayNumber(ms: number): number {
  const d = new Date(ms);
  return Math.floor((d.getTime() - d.getTimezoneOffset() * 60_000) / 86_400_000);
}

export function localDayKey(ms = Date.now()): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** commits 按新→旧排序；保留集合按本地日历日计算：age < recentDays 全留，age < totalDays 每天留第一条（即当日最新），其余丢弃。
 *  最新一条无条件保留（锚点），防止全部超窗时链清空、HEAD 悬空 */
export function selectKeptHashes(commits: ShadowCommit[], retention: SnapshotRetention, nowMs: number): Set<string> {
  const nowDay = localDayNumber(nowMs);
  const keep = new Set<string>();
  if (commits.length > 0) keep.add(commits[0].hash);
  const seenDays = new Set<number>();
  for (const c of commits) {
    const age = nowDay - localDayNumber(c.authorTs * 1000);
    if (age < retention.recentDays) {
      keep.add(c.hash);
      continue;
    }
    if (age >= retention.totalDays) continue;
    if (!seenDays.has(age)) {
      seenDays.add(age);
      keep.add(c.hash);
    }
  }
  return keep;
}

export async function listSnapshotChain(gitDir: string, workspacePath: string): Promise<ShadowCommit[]> {
  const stdout = await execGit(workspacePath, ['--git-dir', gitDir, 'log', `--pretty=%H%x1f%at%x1f%s${LOG_RECORD_SEP}`]);
  return stdout
    .split(LOG_RECORD_SEP)
    .map((chunk) => chunk.replace(/^\n+/, '').trim())
    .filter(Boolean)
    .map((chunk) => {
      const [hash = '', at = '', subject = ''] = chunk.split(LOG_FIELD_SEP);
      return { hash, authorTs: Number(at), subject };
    });
}

function rebuildCommitObject(raw: string, parent: string | undefined): string {
  const sep = raw.indexOf('\n\n');
  if (sep === -1) throw new Error('快照 commit 对象格式异常：缺少头/体分隔');
  const lines = raw.slice(0, sep).split('\n');
  const tree = lines.find((l) => l.startsWith('tree '))?.slice('tree '.length);
  if (!tree || !/^[0-9a-f]{40}$/.test(tree)) throw new Error('快照 commit 对象格式异常：tree 头非法');
  const preserved = lines.filter((l) => !l.startsWith('tree ') && !l.startsWith('parent '));
  const header = ['tree ' + tree, ...(parent ? ['parent ' + parent] : []), ...preserved];
  return header.join('\n') + raw.slice(sep);
}

export async function pruneSnapshotHistory(
  gitDir: string,
  workspacePath: string,
  retention: SnapshotRetention,
): Promise<PruneSnapshotResult> {
  const hasHead = (await execGitCode(workspacePath, ['--git-dir', gitDir, 'rev-parse', '--verify', '--quiet', 'HEAD'])) === 0;
  if (!hasHead) return { before: 0, after: 0 };
  const commits = await listSnapshotChain(gitDir, workspacePath);
  if (commits.length === 0) return { before: 0, after: 0 };
  // 链上混入非快照 commit（理论不存在）时保守停手，防止重写波及未知提交
  if (commits.some((c) => !c.subject.startsWith('[snapshot]'))) {
    console.warn('[shadow-prune] 快照链中发现非快照 commit，跳过裁剪:', workspacePath);
    return { before: commits.length, after: commits.length };
  }
  const keep = selectKeptHashes(commits, retention, Date.now());
  if (keep.size === commits.length) return { before: commits.length, after: commits.length };
  let newTip: string | undefined;
  for (let i = commits.length - 1; i >= 0; i--) {
    const c = commits[i];
    if (!keep.has(c.hash)) continue;
    const raw = await execGit(workspacePath, ['--git-dir', gitDir, 'cat-file', 'commit', c.hash]);
    const rebuilt = rebuildCommitObject(raw, newTip);
    newTip = (await execGitInput(workspacePath, ['--git-dir', gitDir, 'hash-object', '-t', 'commit', '-w', '--stdin'], rebuilt)).trim();
  }
  if (!newTip) return { before: commits.length, after: commits.length };
  await execGit(workspacePath, ['--git-dir', gitDir, 'update-ref', 'HEAD', newTip, commits[0].hash]);
  // 旧链靠 reflog 仍可达，必须先清 reflog 再 gc，否则 blob 剪不掉
  await execGit(workspacePath, ['--git-dir', gitDir, 'reflog', 'expire', '--expire=now', '--all']);
  await execGit(workspacePath, ['--git-dir', gitDir, 'gc', '--prune=now', '--quiet']);
  return { before: commits.length, after: keep.size };
}

const lastPruneDay = new Map<string, string>();

/** 每日首次快照时顺带裁剪（内存节流，不落盘）；失败只告警，不影响本次快照 */
export async function maybePruneSnapshotHistory(
  workspaceId: string,
  gitDir: string,
  workspacePath: string,
  retention: SnapshotRetention,
): Promise<void> {
  const today = localDayKey();
  if (lastPruneDay.get(workspaceId) === today) return;
  lastPruneDay.set(workspaceId, today);
  try {
    await pruneSnapshotHistory(gitDir, workspacePath, retention);
  } catch (error) {
    console.warn('[shadow-prune] 保留窗口裁剪失败（次日常规重试）:', error);
  }
}
