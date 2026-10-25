/**
 * 用户 git 仓库（工作区就地仓库）操作：只读查询 + 显式提交 + 回退 + 一键初始化
 * 工作区不在 git 仓库时统一抛 GitServiceError('not-git-repo')（initUserRepo 是创建侧，例外）
 */
import fs from 'fs/promises';
import path from 'path';
import { execGit, execGitCode, GitServiceError, assertSafeRef, hasGit, workspaceGitPath } from './exec.js';
import { loadSettings, SNAPSHOT_SETTING_DEFAULTS } from '../settings-service.js';
import { isExcludedRelPath } from './shadow-protection.js';

export interface UserStatusEntry {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
}

export interface UserRepoStatus {
  branch: string;
  entries: UserStatusEntry[];
}

export interface UserLogEntry {
  hash: string;
  author: string;
  time: string;
  message: string;
}

export interface UserLogOptions {
  relPath?: string;
  keyword?: string;
  limit?: number;
}

const LOG_RECORD_SEP = '\x1e';
const LOG_FIELD_SEP = '\x1f';

function notGitRepoError(): GitServiceError {
  return new GitServiceError('not-git-repo', '当前工作区不是 git 仓库');
}

async function resolveGitDir(workspacePath: string): Promise<string | null> {
  try {
    const stdout = await execGit(workspacePath, ['rev-parse', '--absolute-git-dir']);
    return stdout.trim();
  } catch (err: unknown) {
    if (err instanceof GitServiceError && err.code === 'git-failed') return null;
    throw err;
  }
}

async function assertUserRepo(workspacePath: string): Promise<void> {
  if (!(await resolveGitDir(workspacePath))) throw notGitRepoError();
}

async function hasHead(workspacePath: string): Promise<boolean> {
  return (await execGitCode(workspacePath, ['rev-parse', '--verify', '--quiet', 'HEAD'])) === 0;
}

async function pathExists(p: string): Promise<boolean> {
  return fs
    .stat(p)
    .then(() => true)
    .catch(() => false);
}

async function assertRepoNotBusy(workspacePath: string): Promise<void> {
  const gitDir = await resolveGitDir(workspacePath);
  if (!gitDir) throw notGitRepoError();
  const busy: string[] = [];
  for (const marker of ['MERGE_HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']) {
    if (await pathExists(path.join(gitDir, marker))) busy.push(marker);
  }
  for (const dir of ['rebase-merge', 'rebase-apply']) {
    if (await pathExists(path.join(gitDir, dir))) busy.push(dir);
  }
  if (busy.length > 0) {
    throw new GitServiceError(
      'repo-busy',
      `git 仓库处于进行中的合并/变基/拣选操作（${busy.join(', ')}），请先完成或中止该操作再提交`,
    );
  }
}

export async function getUserRepoStatus(workspacePath: string): Promise<UserRepoStatus> {
  await assertUserRepo(workspacePath);
  const stdout = await execGit(workspacePath, ['status', '--porcelain=v1', '-b']);
  const headLine = stdout.split('\n').find((l) => l.startsWith('## ')) ?? '';
  let branch = headLine.slice(3).trim();
  if (branch.startsWith('No commits yet on ')) {
    branch = branch.slice('No commits yet on '.length);
  } else {
    branch = branch.split('...')[0].split(' ')[0];
  }
  const entries: UserStatusEntry[] = [];
  for (const line of stdout.split('\n')) {
    if (!line || line.startsWith('## ')) continue;
    const indexStatus = line[0] ?? ' ';
    const worktreeStatus = line[1] ?? ' ';
    let p = line.slice(3);
    if (p.includes(' -> ')) p = p.split(' -> ').pop() ?? p;
    entries.push({ path: p, indexStatus, worktreeStatus });
  }
  return { branch, entries };
}

/** 文件树 git 分组用未跟踪集（porcelain ?? 项，纯未跟踪目录折叠为目录路径自身）；非 git 仓库/执行失败返回 null 由调用方静默降级 */
export async function getUntrackedPaths(workspacePath: string): Promise<Set<string> | null> {
  try {
    const stdout = await execGit(workspacePath, ['status', '--porcelain', '--untracked-files=normal']);
    const paths = new Set<string>();
    for (const line of stdout.split('\n')) {
      if (!line.startsWith('?? ')) continue;
      const p = line.slice(3);
      paths.add(p.endsWith('/') ? p.slice(0, -1) : p);
    }
    return paths;
  } catch {
    return null;
  }
}

export async function getUserRepoDiff(workspacePath: string, relPath?: string): Promise<string> {
  await assertUserRepo(workspacePath);
  const args = (await hasHead(workspacePath)) ? ['diff', 'HEAD'] : ['diff', '--cached'];
  if (relPath) args.push('--', workspaceGitPath(workspacePath, relPath));
  return execGit(workspacePath, args);
}

function parseUserLog(stdout: string): UserLogEntry[] {
  return stdout
    .split(LOG_RECORD_SEP)
    .map((chunk) => chunk.replace(/^\n+/, '').trim())
    .filter(Boolean)
    .map((chunk) => {
      const [hash = '', author = '', time = '', message = ''] = chunk.split(LOG_FIELD_SEP);
      return { hash, author, time, message };
    });
}

export async function getUserRepoLog(workspacePath: string, options?: UserLogOptions): Promise<UserLogEntry[]> {
  await assertUserRepo(workspacePath);
  if (!(await hasHead(workspacePath))) return [];
  const limit = options?.limit ?? 50;
  const args = ['log', `-n${limit}`, '--pretty=%H%x1f%an%x1f%aI%x1f%s%x1e'];
  if (options?.keyword) args.push(`--grep=${options.keyword}`);
  if (options?.relPath) args.push('--', workspaceGitPath(workspacePath, options.relPath));
  return parseUserLog(await execGit(workspacePath, args));
}

export async function getUserRepoShow(workspacePath: string, ref: string, relPath?: string): Promise<string> {
  await assertUserRepo(workspacePath);
  assertSafeRef(ref);
  const args = ['show', ref];
  if (relPath) args.push('--', workspaceGitPath(workspacePath, relPath));
  return execGit(workspacePath, args);
}

export async function getUserRepoFileContent(workspacePath: string, ref: string, relPath: string): Promise<string | null> {
  await assertUserRepo(workspacePath);
  assertSafeRef(ref);
  const spec = `${ref}:${workspaceGitPath(workspacePath, relPath)}`;
  if ((await execGitCode(workspacePath, ['cat-file', '-e', spec])) !== 0) return null;
  return execGit(workspacePath, ['show', spec]);
}

export async function getUserRepoBlame(workspacePath: string, relPath: string): Promise<string> {
  await assertUserRepo(workspacePath);
  return execGit(workspacePath, ['blame', '--date=short', '--', workspaceGitPath(workspacePath, relPath)]);
}

async function hasStagedChanges(workspacePath: string): Promise<boolean> {
  const code = await execGitCode(workspacePath, ['diff', '--cached', '--quiet']);
  if (code === 0) return false;
  if (code === 1) return true;
  throw new GitServiceError('git-failed', `仓库状态检查失败，exit ${code}`);
}

export async function commitToUserRepo(workspacePath: string, message: string, paths?: string[]): Promise<string> {
  await assertUserRepo(workspacePath);
  await assertRepoNotBusy(workspacePath);
  const addArgs = paths?.length
    ? ['add', '-A', '--', ...paths.map((p) => workspaceGitPath(workspacePath, p))]
    : ['add', '-A', '--', '.'];
  await execGit(workspacePath, addArgs);
  if (!(await hasStagedChanges(workspacePath))) {
    throw new GitServiceError('no-changes', '没有可提交的变更');
  }
  await execGit(workspacePath, ['commit', '-m', message]);
  return (await execGit(workspacePath, ['rev-parse', 'HEAD'])).trim();
}

export async function revertUserRepo(workspacePath: string, ref: string, relPath?: string): Promise<void> {
  await assertUserRepo(workspacePath);
  await assertRepoNotBusy(workspacePath);
  assertSafeRef(ref);
  if (relPath) {
    await execGit(workspacePath, ['checkout', ref, '--', workspaceGitPath(workspacePath, relPath)]);
    return;
  }
  await execGit(workspacePath, ['revert', '--no-edit', ref]);
}

export interface InitUserRepoResult {
  committedFiles: number;
  ignoredCount: number;
}

/** .gitignore 没有 pathspec 的 :(literal) 魔法，字面 []#! 需转义才与快照排除语义一致 */
function escapeGitIgnorePath(p: string): string {
  return p.replace(/^!/, '\\!').replace(/^#/, '\\#').replace(/[[\]]/g, (c) => `\\${c}`);
}

function buildGitignoreContent(excludedDirs: string[], oversizedFiles: string[]): string {
  const rules = [...excludedDirs, ...oversizedFiles].map(escapeGitIgnorePath);
  return ['# 由 Dogear 初始化生成，排除规则与自动快照一致，可自行调整', ...rules, '.DS_Store', 'Thumbs.db'].join('\n') + '\n';
}

async function scanOversizedFiles(workspacePath: string, excludedPaths: string[], maxBytes: number): Promise<string[]> {
  const found: string[] = [];
  const walk = async (rel: string): Promise<void> => {
    const entries = await fs
      .readdir(rel ? path.join(workspacePath, rel) : workspacePath, { withFileTypes: true })
      .catch(() => []);
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const segments = childRel.split('/');
      // 嵌套 .git（子模块/worktree）未必在排除清单内，统一跳过防扫入 git 对象库
      if (segments.includes('.git') || isExcludedRelPath(segments, excludedPaths)) continue;
      if (entry.isDirectory()) {
        await walk(childRel);
        continue;
      }
      if (!entry.isFile()) continue;
      const st = await fs.stat(path.join(workspacePath, childRel)).catch(() => null);
      if (st && st.size > maxBytes) found.push(childRel);
    }
  };
  await walk('');
  return found.sort((a, b) => a.localeCompare(b));
}

async function gitConfigValue(workspacePath: string, key: string): Promise<string | null> {
  try {
    return (await execGit(workspacePath, ['config', key])).trim() || null;
  } catch {
    return null;
  }
}

/**
 * 一键初始化：按快照排除规则生成 .gitignore（已有则不覆盖）+ git init + 全量初始提交。
 * 先落 .gitignore 再 init，中途失败不留半初始化仓库，重试可从头来
 */
export async function initUserRepo(workspaceId: string, workspacePath: string): Promise<InitUserRepoResult> {
  if (!(await hasGit())) throw new GitServiceError('git-missing', '系统未安装 git 或 git 不在 PATH 中');
  if (await pathExists(path.join(workspacePath, '.git'))) {
    throw new GitServiceError('git-failed', '已存在 git 仓库');
  }
  // 身份缺失时 init 能成功但 commit 必败，先拦避免留下只 init 未提交的空仓库
  const [name, email] = await Promise.all([
    gitConfigValue(workspacePath, 'user.name'),
    gitConfigValue(workspacePath, 'user.email'),
  ]);
  if (!name || !email) {
    throw new GitServiceError('git-failed', 'git 未配置用户身份（user.name / user.email），请先配置后再初始化');
  }
  const snapshot = (await loadSettings()).snapshot ?? structuredClone(SNAPSHOT_SETTING_DEFAULTS);
  const excludedPaths = snapshot.excludedPaths[workspaceId] ?? [];
  const oversized = await scanOversizedFiles(workspacePath, excludedPaths, snapshot.maxFileSizeBytes);
  const ignorePath = path.join(workspacePath, '.gitignore');
  let ignoredCount = oversized.length + 2;
  if (!(await pathExists(ignorePath))) {
    await fs.writeFile(ignorePath, buildGitignoreContent(excludedPaths, oversized), 'utf8');
    ignoredCount += excludedPaths.length;
  }
  await execGit(workspacePath, ['init']);
  await execGit(workspacePath, ['add', '-A']);
  const committedFiles = (await execGit(workspacePath, ['ls-files'])).split('\n').filter(Boolean).length;
  if (committedFiles > 0) await execGit(workspacePath, ['commit', '-m', 'init: 初始提交']);
  return { committedFiles, ignoredCount };
}
