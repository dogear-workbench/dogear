/**
 * pi 内建工具（Read/Write/Edit/Bash）复用的 harness ExecutionEnv 实现。
 *
 * 委托给 pi-durable 官方 NodeExecutionEnv 做实际的文件 IO / 子进程执行（跨平台 bash 探测、
 * 截断安全的读写、mutation queue 等都是它已经做好的），本类只加一层工作区边界校验：
 * 所有带路径参数的方法在委托前先过 resolveWithinPaths（含 `../` 穿越 + 符号链接逃逸检测）。
 *
 * Bash 的 shell 执行本身不做沙箱（与现有 SDK 侧 Bash 工具信任边界一致），
 * 只保证 exec 的 cwd 落在工作区内。
 */
import path from 'path';
import fs from 'fs/promises';
import {
  ok,
  err,
  FileError,
  ExecutionError,
  type BinaryReader,
  type DirReader,
  type ExecutionEnv,
  type FileInfo,
  type FileListing,
  type FileWatcher,
  type ListFilesOptions,
  type Result,
  type ShellExecOptions,
  type ShellExecResult,
  type WatchChange,
  type WatchTarget,
} from '@earendil-works/pi-durable/env';
import type { Context } from '@earendil-works/chord';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { listFilesTree } from './list-files.js';
import { resolveWithinPaths } from './workspace-boundary.js';

function boundaryError(error: unknown, path: string): FileError {
  const message = error instanceof Error ? error.message : String(error);
  return new FileError('permission_denied', message, path);
}

export class WorkspaceExecutionEnv implements ExecutionEnv {
  readonly cwd: string;

  get id(): string {
    return this.inner.id;
  }

  private readonly inner: NodeExecutionEnv;
  private allowedPaths: string[];
  private writeExcludedPaths: string[] = [];
  private tempRoots: string[] = [];

  constructor(allowedPaths: string[]) {
    this.allowedPaths = allowedPaths;
    this.cwd = allowedPaths[0];
    this.inner = new NodeExecutionEnv({ cwd: allowedPaths[0] });
  }

  updateAllowedPaths(paths: string[]): void {
    this.allowedPaths = paths;
  }

  updateWriteExcludedPaths(paths: string[]): void {
    this.writeExcludedPaths = paths;
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

  /** 写边界 = 读边界 + 禁写区检查；临时目录白名单优先于禁写检查（bash 输出暂存不在边界内） */
  private async guardWrite(candidate: string): Promise<Result<string, FileError>> {
    if (this.isOwnTemp(candidate)) return ok(path.resolve(candidate));
    const g = await this.guard(candidate);
    if (!g.ok) return g;
    const normalized = g.value.toLowerCase();
    const hit = this.writeExcludedPaths.some((excluded) => {
      const e = excluded.toLowerCase();
      return normalized === e || normalized.startsWith(e + path.sep);
    });
    if (hit) {
      return err(new FileError(
        'permission_denied',
        `路径越权：${candidate} 位于应用数据禁写区（运行时数据与笔记/记忆由应用及专用工具独占管理，文件工具对其只读）。` +
        '笔记与记忆请改用 dogear__ 笔记、dogear__ 记忆工具写入。',
        candidate,
      ));
    }
    return g;
  }

  async absolutePath(path: string, _context: Context): Promise<Result<string, FileError>> {
    return this.guard(path);
  }

  async joinPath(parts: string[], _context: Context): Promise<Result<string, FileError>> {
    return this.inner.joinPath(parts, _context);
  }

  // TextLineReader 未从主入口导出，返回类型由 inner 推断并经 implements 校验
  async openTextLineReader(path: string, context: Context) {
    const g = await this.guard(path);
    if (!g.ok) return g;
    return this.inner.openTextLineReader(g.value, context);
  }

  async readTextFile(path: string, context: Context): Promise<Result<string, FileError>> {
    const g = await this.guard(path);
    if (!g.ok) return g;
    return this.inner.readTextFile(g.value, context);
  }

  async readTextLines(
    path: string,
    options: { maxLines?: number } | undefined,
    context: Context,
  ): Promise<Result<string[], FileError>> {
    const g = await this.guard(path);
    if (!g.ok) return g;
    return this.inner.readTextLines(g.value, options, context);
  }

  async readBinaryFile(path: string, context: Context): Promise<Result<Uint8Array, FileError>> {
    const g = await this.guard(path);
    if (!g.ok) return g;
    return this.inner.readBinaryFile(g.value, context);
  }

  async openBinaryReader(
    path: string,
    options: { noFollow?: boolean } | undefined,
    context: Context,
  ): Promise<Result<BinaryReader, FileError>> {
    const g = await this.guard(path);
    if (!g.ok) return g;
    return this.inner.openBinaryReader(g.value, options, context);
  }

  async truncateFile(path: string, size: number, context: Context): Promise<Result<void, FileError>> {
    const g = await this.guardWrite(path);
    if (!g.ok) return g;
    return this.inner.truncateFile(g.value, size, context);
  }

  async flushFile(path: string, context: Context): Promise<Result<void, FileError>> {
    const g = await this.guardWrite(path);
    if (!g.ok) return g;
    return this.inner.flushFile(g.value, context);
  }

  async openDirReader(path: string, context: Context): Promise<Result<DirReader, FileError>> {
    const g = await this.guard(path);
    if (!g.ok) return g;
    // Bun 的 fs.promises.opendir 对缺失目录不抛 ENOENT、Dir.close() 不返回 Promise，此处预检与包装归一为接口契约
    try {
      const stat = await fs.stat(g.value);
      if (!stat.isDirectory()) return err(new FileError('not_directory', `不是目录: ${path}`, path));
    } catch (error) {
      return err(new FileError('not_found', `目录不存在: ${path}`, path, error instanceof Error ? error : undefined));
    }
    const reader = await this.inner.openDirReader(g.value, context);
    if (!reader.ok) return reader;
    const inner = reader.value;
    return ok({
      next: (maxEntries: number, ctx: Context) => inner.next(maxEntries, ctx),
      close: async (ctx: Context) => {
        try {
          await inner.close(ctx);
        } catch {
          // Bun 的 Dir.close() 返回值非 Promise，inner 的 .catch 链会同步抛 TypeError；close 语义本就静默容错
        }
      },
    });
  }

  async watch(
    targets: readonly WatchTarget[],
    onChange: (change: WatchChange) => void,
    context: Context,
  ): Promise<Result<FileWatcher, FileError>> {
    const guarded: WatchTarget[] = [];
    for (const target of targets) {
      const g = await this.guard(target.path);
      if (!g.ok) return g;
      guarded.push({ ...target, path: g.value });
    }
    return this.inner.watch(guarded, onChange, context);
  }

  async writeFile(path: string, content: string | Uint8Array, context: Context): Promise<Result<void, FileError>> {
    const g = await this.guardWrite(path);
    if (!g.ok) return g;
    return this.inner.writeFile(g.value, content, context);
  }

  async appendFile(path: string, content: string | Uint8Array, context: Context): Promise<Result<void, FileError>> {
    const g = await this.guardWrite(path);
    if (!g.ok) return g;
    return this.inner.appendFile(g.value, content, context);
  }

  async renameFile(sourcePath: string, destinationPath: string, context: Context): Promise<Result<void, FileError>> {
    const src = await this.guardWrite(sourcePath);
    if (!src.ok) return src;
    const dest = await this.guardWrite(destinationPath);
    if (!dest.ok) return dest;
    return this.inner.renameFile(src.value, dest.value, context);
  }

  async fileInfo(path: string, context: Context): Promise<Result<FileInfo, FileError>> {
    const g = await this.guard(path);
    if (!g.ok) return g;
    return this.inner.fileInfo(g.value, context);
  }

  async listDir(path: string, context: Context): Promise<Result<FileInfo[], FileError>> {
    const g = await this.guard(path);
    if (!g.ok) return g;
    return this.inner.listDir(g.value, context);
  }

  async listFiles(
    path: string,
    options: ListFilesOptions | undefined,
    context: Context,
  ): Promise<Result<FileListing, FileError>> {
    const g = await this.guard(path);
    if (!g.ok) return g;
    return listFilesTree(g.value, options, context);
  }

  async canonicalPath(path: string, context: Context): Promise<Result<string, FileError>> {
    const g = await this.guard(path);
    if (!g.ok) return g;
    return this.inner.canonicalPath(g.value, context);
  }

  async exists(path: string, context: Context): Promise<Result<boolean, FileError>> {
    const g = await this.guard(path);
    if (!g.ok) return g;
    return this.inner.exists(g.value, context);
  }

  async createDir(path: string, options: { recursive?: boolean } | undefined, context: Context): Promise<Result<void, FileError>> {
    const g = await this.guardWrite(path);
    if (!g.ok) return g;
    return this.inner.createDir(g.value, options, context);
  }

  async remove(path: string, options: { recursive?: boolean; force?: boolean } | undefined, context: Context): Promise<Result<void, FileError>> {
    const g = await this.guardWrite(path);
    if (!g.ok) return g;
    return this.inner.remove(g.value, options, context);
  }

  /** temp 路径记入白名单：pi-agent-core 的 bash 输出溢出暂存会经 appendFile/readTextFile 过 guard，不放行会整条命令报路径越权 */
  async createTempDir(prefix: string | undefined, _context: Context): Promise<Result<string, FileError>> {
    const result = await this.inner.createTempDir(prefix, _context);
    if (result.ok) this.tempRoots.push(result.value);
    return result;
  }

  async createTempFile(options: { prefix?: string; suffix?: string } | undefined, _context: Context): Promise<Result<string, FileError>> {
    const result = await this.inner.createTempFile(options, _context);
    if (result.ok) this.tempRoots.push(path.dirname(result.value));
    return result;
  }

  async exec(
    command: string | readonly string[],
    options: ShellExecOptions | undefined,
    context: Context,
  ): Promise<Result<ShellExecResult, ExecutionError>> {
    if (!options?.cwd) return this.inner.exec(command, options, context);
    const g = await this.guard(options.cwd);
    if (!g.ok) return err(new ExecutionError('spawn_error', g.error.message));
    return this.inner.exec(command, { ...options, cwd: g.value }, context);
  }

  async cleanup(_context: Context): Promise<void> {
    return this.inner.cleanup(_context);
  }
}
