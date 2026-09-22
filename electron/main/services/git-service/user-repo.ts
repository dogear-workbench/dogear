/**
 * 用户 git 仓库（工作区就地仓库）操作：只读查询 + 显式提交 + 回退
 * 工作区不在 git 仓库时统一抛 GitServiceError('not-git-repo')
 */
import fs from 'fs/promises';
import path from 'path';
import { execGit, execGitCode, GitServiceError, assertSafeRef, workspaceGitPath } from './exec.js';

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
