/**
 * git execFile 封装与公共类型
 * 全部参数走数组传递不经 shell；统一 -c core.quotepath=false 保证中文路径输出可读
 */
import { execFile, spawn } from 'child_process';
import path from 'path';
import { promisify } from 'util';
import { resolveAndValidate } from '../workspace-fs-service.js';

const execFileP = promisify(execFile);

const MAX_GIT_BUFFER = 50 * 1024 * 1024;

export type GitServiceErrorCode =
  | 'git-missing'
  | 'not-git-repo'
  | 'repo-busy'
  | 'invalid-ref'
  | 'no-changes'
  | 'git-failed';

export class GitServiceError extends Error {
  constructor(
    public readonly code: GitServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'GitServiceError';
  }
}

let gitAvailable: boolean | null = null;

export async function hasGit(): Promise<boolean> {
  if (gitAvailable !== null) return gitAvailable;
  try {
    await execFileP('git', ['--version'], { windowsHide: true });
    gitAvailable = true;
  } catch {
    gitAvailable = false;
  }
  return gitAvailable;
}

async function runGit(cwd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileP('git', ['-c', 'core.quotepath=false', ...args], {
      cwd,
      maxBuffer: MAX_GIT_BUFFER,
      windowsHide: true,
    });
    return { code: 0, stdout, stderr };
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    if (e.code === 'ENOENT') {
      throw new GitServiceError('git-missing', '系统未安装 git 或 git 不在 PATH 中');
    }
    return {
      code: typeof e.code === 'number' ? e.code : -1,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? e.message ?? '',
    };
  }
}

export async function execGit(cwd: string, args: string[]): Promise<string> {
  const { code, stdout, stderr } = await runGit(cwd, args);
  if (code !== 0) {
    throw new GitServiceError('git-failed', `git ${args[0]} 执行失败: ${stderr.trim() || `exit ${code}`}`);
  }
  return stdout;
}

export async function execGitCode(cwd: string, args: string[]): Promise<number> {
  return (await runGit(cwd, args)).code;
}

/** 带标准输入的 git 调用（cat-file --batch-check 等批处理接口）；流式收 stdout，无 maxBuffer 上限 */
export async function execGitInput(cwd: string, args: string[], input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-c', 'core.quotepath=false', ...args], { cwd, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk;
    });
    child.on('error', (err: NodeJS.ErrnoException) => {
      reject(err.code === 'ENOENT' ? new GitServiceError('git-missing', '系统未安装 git 或 git 不在 PATH 中') : err);
    });
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new GitServiceError('git-failed', `git ${args[0]} 执行失败: ${stderr.trim() || `exit ${code}`}`));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

export function assertSafeRef(ref: string): void {
  if (!ref.trim() || ref.startsWith('-')) {
    throw new GitServiceError('invalid-ref', `非法的 git 引用: ${ref}`);
  }
}

export function toGitPath(p: string): string {
  return p.replace(/\\/g, '/');
}

export function workspaceGitPath(workspacePath: string, relPath: string): string {
  const abs = resolveAndValidate(workspacePath, relPath);
  const rel = path.relative(workspacePath, abs);
  return rel ? toGitPath(rel) : '.';
}
