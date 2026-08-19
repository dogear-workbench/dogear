/**
 * pi 内建工具（Read/Write/Edit/Bash）复用的 harness ExecutionEnv 实现。
 *
 * 委托给 pi-agent-core 官方 NodeExecutionEnv 做实际的文件 IO / 子进程执行（跨平台 bash 探测、
 * 截断安全的读写、mutation queue 等都是它已经做好的），本类只加一层工作区边界校验：
 * 所有带路径参数的方法在委托前先过 resolveWithinPaths（含 `../` 穿越 + 符号链接逃逸检测）。
 *
 * Bash 的 shell 执行本身不做沙箱（与现有 SDK 侧 Bash 工具信任边界一致），
 * 只保证 exec 的 cwd 落在工作区内。
 */
import path from 'path';
import {
  ok,
  err,
  FileError,
  ExecutionError,
  type ExecutionEnv,
  type FileInfo,
  type Result,
  type ShellExecOptions,
} from '@earendil-works/pi-agent-core';
import { NodeExecutionEnv } from '@earendil-works/pi-agent-core/node';
import { resolveWithinPaths } from './workspace-boundary.js';

function boundaryError(error: unknown, path: string): FileError {
  const message = error instanceof Error ? error.message : String(error);
  return new FileError('permission_denied', message, path);
}

export class WorkspaceExecutionEnv implements ExecutionEnv {
  readonly cwd: string;
  private readonly inner: NodeExecutionEnv;
  private allowedPaths: string[];
  private tempRoots: string[] = [];

  constructor(allowedPaths: string[]) {
    this.allowedPaths = allowedPaths;
    this.cwd = allowedPaths[0];
    this.inner = new NodeExecutionEnv({ cwd: allowedPaths[0] });
  }

  updateAllowedPaths(paths: string[]): void {
    this.allowedPaths = paths;
  }

  private isOwnTemp(candidate: string): boolean {
    const normalized = path.resolve(candidate).toLowerCase();
    return this.tempRoots.some(root => {
      const r = root.toLowerCase();
      return normalized === r || normalized.startsWith(r + path.sep);
    });
  }

  private async guard(candidate: string): Promise<Result<string, FileError>> {
    if (this.isOwnTemp(candidate)) return ok(path.resolve(candidate));
    try {
      return ok(await resolveWithinPaths(this.allowedPaths, candidate));
    } catch (error) {
      return err(boundaryError(error, candidate));
    }
  }

  async absolutePath(path: string): Promise<Result<string, FileError>> {
    return this.guard(path);
  }

  async joinPath(parts: string[]): Promise<Result<string, FileError>> {
    return this.inner.joinPath(parts);
  }

  async readTextFile(path: string, abortSignal?: AbortSignal): Promise<Result<string, FileError>> {
    const g = await this.guard(path);
    if (!g.ok) return g;
    return this.inner.readTextFile(g.value, abortSignal);
  }

  async readTextLines(
    path: string,
    options?: { maxLines?: number; abortSignal?: AbortSignal },
  ): Promise<Result<string[], FileError>> {
    const g = await this.guard(path);
    if (!g.ok) return g;
    return this.inner.readTextLines(g.value, options);
  }

  async readBinaryFile(path: string, abortSignal?: AbortSignal): Promise<Result<Uint8Array, FileError>> {
    const g = await this.guard(path);
    if (!g.ok) return g;
    return this.inner.readBinaryFile(g.value, abortSignal);
  }

  async writeFile(path: string, content: string | Uint8Array, abortSignal?: AbortSignal): Promise<Result<void, FileError>> {
    const g = await this.guard(path);
    if (!g.ok) return g;
    return this.inner.writeFile(g.value, content, abortSignal);
  }

  async appendFile(path: string, content: string | Uint8Array): Promise<Result<void, FileError>> {
    const g = await this.guard(path);
    if (!g.ok) return g;
    return this.inner.appendFile(g.value, content);
  }

  async fileInfo(path: string): Promise<Result<FileInfo, FileError>> {
    const g = await this.guard(path);
    if (!g.ok) return g;
    return this.inner.fileInfo(g.value);
  }

  async listDir(path: string, abortSignal?: AbortSignal): Promise<Result<FileInfo[], FileError>> {
    const g = await this.guard(path);
    if (!g.ok) return g;
    return this.inner.listDir(g.value, abortSignal);
  }

  async canonicalPath(path: string): Promise<Result<string, FileError>> {
    const g = await this.guard(path);
    if (!g.ok) return g;
    return this.inner.canonicalPath(g.value);
  }

  async exists(path: string): Promise<Result<boolean, FileError>> {
    const g = await this.guard(path);
    if (!g.ok) return g;
    return this.inner.exists(g.value);
  }

  async createDir(path: string, options?: { recursive?: boolean }): Promise<Result<void, FileError>> {
    const g = await this.guard(path);
    if (!g.ok) return g;
    return this.inner.createDir(g.value, options);
  }

  async remove(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<Result<void, FileError>> {
    const g = await this.guard(path);
    if (!g.ok) return g;
    return this.inner.remove(g.value, options);
  }

  /** temp 路径记入白名单：pi-agent-core 的 bash 输出溢出暂存会经 appendFile/readTextFile 过 guard，不放行会整条命令报路径越权 */
  async createTempDir(prefix?: string): Promise<Result<string, FileError>> {
    const result = await this.inner.createTempDir(prefix);
    if (result.ok) this.tempRoots.push(result.value);
    return result;
  }

  async createTempFile(options?: { prefix?: string; suffix?: string }): Promise<Result<string, FileError>> {
    const result = await this.inner.createTempFile(options);
    if (result.ok) this.tempRoots.push(path.dirname(result.value));
    return result;
  }

  async exec(
    command: string,
    options?: ShellExecOptions,
  ): Promise<Result<{ stdout: string; stderr: string; exitCode: number }, ExecutionError>> {
    if (!options?.cwd) return this.inner.exec(command, options);
    const g = await this.guard(options.cwd);
    if (!g.ok) return err(new ExecutionError('spawn_error', g.error.message));
    return this.inner.exec(command, { ...options, cwd: g.value });
  }

  async cleanup(): Promise<void> {
    return this.inner.cleanup();
  }
}
