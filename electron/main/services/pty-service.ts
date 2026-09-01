import { execFile } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { EventEmitter } from 'events';
import { promisify } from 'util';
import * as pty from 'node-pty';
import { v4 as uuidv4 } from 'uuid';
import { resolveWithinPaths } from '../agents/pi-session/workspace-boundary.js';

const execFileP = promisify(execFile);

export type PtyEvent =
  | { type: 'created'; terminalId: string; conversationId: string | null; command: string }
  | { type: 'data'; terminalId: string; data: string }
  | { type: 'exit'; terminalId: string; exitCode: number };

type PtyEventBroadcaster = (event: PtyEvent) => void;

// 注册制而非直接 import renderer-broadcast：服务层保持零 electron 依赖（bun test 可加载 node-pty 真跑）
let broadcaster: PtyEventBroadcaster | null = null;

export function setPtyEventBroadcaster(fn: PtyEventBroadcaster): void {
  broadcaster = fn;
}

function broadcast(event: PtyEvent): void {
  broadcaster?.(event);
}

export interface PtyTerminalInfo {
  terminalId: string;
  conversationId: string | null;
  command: string;
  cwd: string;
  shell: string;
  cols: number;
  rows: number;
  exited: boolean;
  exitCode?: number;
}

export interface PtyCreateOptions {
  /** agent 后台命令归属的会话；用户 shell 传 null */
  conversationId: string | null;
  /** 缺省时直接起交互 shell；非空则以 `shell -c <command>` 执行 */
  command?: string;
  cwd: string;
  shell?: string;
  /** 传入时 cwd 按 resolveWithinPaths 校验必须落在其中之一 */
  workspaceRoots?: string[];
  cols?: number;
  rows?: number;
}

interface PtyInstance extends PtyTerminalInfo {
  buffer: string;
  proc: pty.IPty;
}

// 按 UTF-16 字符数封顶，与 terminal-stream-service 同策略
const MAX_BUFFER_CHARS = 100 * 1024;

const instances = new Map<string, PtyInstance>();

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function isWslBash(p: string): boolean {
  return /^[a-z]:\\windows\\(?:system32|sysnative)\\bash\.exe$/i.test(p.replace(/\//g, '\\'));
}

async function findBashOnPath(): Promise<string | null> {
  try {
    const { stdout } = await execFileP(
      process.platform === 'win32' ? 'where' : 'which',
      [process.platform === 'win32' ? 'bash.exe' : 'bash'],
      { timeout: 5000 },
    );
    for (const line of stdout.trim().split(/\r?\n/)) {
      if (!line) continue;
      if (process.platform === 'win32' && isWslBash(line)) continue;
      if (await pathExists(line)) return line;
    }
  } catch {
    // PATH 上没有 bash
  }
  return null;
}

async function detectShell(): Promise<string> {
  if (process.platform === 'win32') {
    const candidates = [
      process.env.ProgramFiles && `${process.env.ProgramFiles}\\Git\\bin\\bash.exe`,
      process.env['ProgramFiles(x86)'] && `${process.env['ProgramFiles(x86)']}\\Git\\bin\\bash.exe`,
    ].filter((p): p is string => !!p);
    for (const candidate of candidates) {
      if (await pathExists(candidate)) return candidate;
    }
    const onPath = await findBashOnPath();
    if (onPath) return onPath;
    throw new Error('未找到可用 shell：请安装 Git for Windows，或显式指定 shell 路径');
  }
  if (await pathExists('/bin/bash')) return '/bin/bash';
  return (await findBashOnPath()) ?? 'sh';
}

async function resolveCwd(cwd: string, workspaceRoots?: string[]): Promise<string> {
  if (workspaceRoots?.length) {
    return resolveWithinPaths(workspaceRoots, cwd);
  }
  const resolved = path.resolve(cwd);
  if (!(await pathExists(resolved))) {
    throw new Error(`cwd 不存在: ${cwd}`);
  }
  return resolved;
}

function buildEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function capBuffer(buffer: string): string {
  return buffer.length > MAX_BUFFER_CHARS ? buffer.slice(buffer.length - MAX_BUFFER_CHARS) : buffer;
}

function toInfo(instance: PtyInstance): PtyTerminalInfo {
  const { proc: _proc, ...info } = instance;
  return info;
}

export async function createTerminal(options: PtyCreateOptions): Promise<string> {
  const cwd = await resolveCwd(options.cwd, options.workspaceRoots);
  const shell = options.shell ?? (await detectShell());
  const command = options.command ?? '';
  const cols = options.cols ?? 80;
  const rows = options.rows ?? 24;

  const proc = pty.spawn(shell, command ? ['-c', command] : [], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    env: buildEnv(),
  });

  const terminalId = uuidv4();
  const instance: PtyInstance = {
    terminalId,
    conversationId: options.conversationId,
    command,
    cwd,
    shell,
    cols,
    rows,
    buffer: '',
    exited: false,
    proc,
  };
  instances.set(terminalId, instance);

  // WHY: node-pty Windows 对非 EIO socket error 在 listeners('error')<2 时直接 throw（uncaught 炸主进程），
  // >=2 时静默；ConPTY 偶发断连不该上炸，错误由 write/kill 的 try-catch 与 exited 标记自然收敛
  const ptyEmitter = proc as unknown as EventEmitter;
  ptyEmitter.on('error', () => {});
  ptyEmitter.on('error', () => {});

  proc.onData((data) => {
    instance.buffer = capBuffer(instance.buffer + data);
    broadcast({ type: 'data', terminalId, data });
  });

  proc.onExit(({ exitCode }) => {
    instance.exited = true;
    instance.exitCode = exitCode;
    broadcast({ type: 'exit', terminalId, exitCode });
  });

  broadcast({ type: 'created', terminalId, conversationId: instance.conversationId, command });

  return terminalId;
}

export function writeTerminal(terminalId: string, data: string): void {
  const instance = instances.get(terminalId);
  if (!instance || instance.exited) return;
  try {
    instance.proc.write(data);
  } catch (error) {
    console.warn(`[pty] write 失败 (${terminalId}):`, error);
  }
}

export function resizeTerminal(terminalId: string, cols: number, rows: number): void {
  const instance = instances.get(terminalId);
  if (!instance || instance.exited) return;
  instance.cols = cols;
  instance.rows = rows;
  try {
    instance.proc.resize(cols, rows);
  } catch (error) {
    console.warn(`[pty] resize 失败 (${terminalId}):`, error);
  }
}

/** 终止并从管理器移除；已退出/不存在的 id 幂等返回 */
export function killTerminal(terminalId: string): void {
  const instance = instances.get(terminalId);
  if (!instance) return;
  instances.delete(terminalId);
  try {
    instance.proc.kill();
  } catch (error) {
    console.warn(`[pty] kill 失败 (${terminalId}):`, error);
  }
}

export function killConversationTerminals(conversationId: string): void {
  for (const [id, instance] of [...instances]) {
    if (instance.conversationId === conversationId) killTerminal(id);
  }
}

export function killAll(): void {
  for (const id of [...instances.keys()]) killTerminal(id);
}

/** 尾部缓冲；实例不存在返回 null */
export function getBuffer(terminalId: string): string | null {
  return instances.get(terminalId)?.buffer ?? null;
}

export function listTerminals(conversationId?: string): PtyTerminalInfo[] {
  return [...instances.values()]
    .filter((instance) => conversationId === undefined || instance.conversationId === conversationId)
    .map(toInfo);
}
