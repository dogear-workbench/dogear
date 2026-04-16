/**
 * Python Bridge — Electron ↔ Python 进程通信桥
 *
 * 通过 child_process.spawn 启动持久化的 Python 守护进程，
 * 使用 NDJSON (Newline-Delimited JSON) 通过 stdin/stdout 通信。
 *
 * 特性：
 *   - 懒启动（首次调用时 spawn）
 *   - 自动环境检测（python → python3 → py）
 *   - 健康检查（ping/pong）
 *   - 请求超时管理
 *   - 崩溃自动恢复
 *   - 断路器保护（连续 3 次崩溃触发冷却）
 *   - 优雅关闭
 */

import { spawn, execSync, type ChildProcess } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import electron from 'electron';

const { app } = electron;

// ============================================================
// 类型定义
// ============================================================

/** JSON-RPC 请求 */
interface PythonRequest {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

/** JSON-RPC 响应 */
interface PythonResponse {
  id: string;
  result?: unknown;
  error?: { code: number; message: string };
  progress?: { current: number; total: number; message: string };
}

/** 挂起的请求 */
interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  onProgress?: (progress: { current: number; total: number; message: string }) => void;
}

/** Bridge 状态 */
export interface PythonBridgeStatus {
  available: boolean;
  pythonPath: string | null;
  processRunning: boolean;
  consecutiveCrashes: number;
  pendingRequests: number;
}

// ============================================================
// 常量
// ============================================================

/** 默认请求超时 */
const DEFAULT_TIMEOUT_MS = 30_000;
/** 健康检查超时 */
const HEALTH_CHECK_TIMEOUT_MS = 10_000;
/** 崩溃冷却时间 */
const CRASH_COOLDOWN_MS = 30_000;
/** 崩溃阈值 */
const CRASH_THRESHOLD = 3;
/** 关闭等待时间 */
const SHUTDOWN_WAIT_MS = 2_000;

// ============================================================
// PythonBridge 类
// ============================================================

class PythonBridge {
  private process: ChildProcess | null = null;
  private pythonPath: string | null = null;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private buffer = '';
  private consecutiveCrashes = 0;
  private cooldownUntil: number | null = null;
  private initializing = false;
  private initPromise: Promise<void> | null = null;

  constructor() {
    // 注册应用退出时的清理
    app.on('will-quit', () => {
      this.shutdown();
    });
  }

  // ----------------------------------------------------------
  // 公开 API
  // ----------------------------------------------------------

  /**
   * 调用 Python 方法
   *
   * @param method 方法名
   * @param params 参数对象
   * @param timeoutMs 超时毫秒数（默认 30s）
   * @param onProgress 进度回调（可选）
   */
  async call<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
    onProgress?: (progress: { current: number; total: number; message: string }) => void,
  ): Promise<T> {
    await this.ensureRunning();

    const id = uuidv4();
    const request: PythonRequest = { id, method, params };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Python 请求超时（${timeoutMs}ms）: method=${method}`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
        onProgress,
      });

      const line = JSON.stringify(request) + '\n';
      this.process!.stdin!.write(line);
    });
  }

  /** 获取 Bridge 状态 */
  getStatus(): PythonBridgeStatus {
    return {
      available: this.pythonPath !== null,
      pythonPath: this.pythonPath,
      processRunning: this.process !== null && this.process.exitCode === null,
      consecutiveCrashes: this.consecutiveCrashes,
      pendingRequests: this.pendingRequests.size,
    };
  }

  /** 优雅关闭 */
  shutdown(): void {
    if (!this.process) return;

    try {
      const shutdownReq = JSON.stringify({ id: 'shutdown', method: 'shutdown', params: {} }) + '\n';
      this.process.stdin!.write(shutdownReq);
    } catch {
      // stdin 可能已关闭
    }

    const proc = this.process;
    setTimeout(() => {
      if (proc && proc.exitCode === null) {
        proc.kill('SIGTERM');
      }
    }, SHUTDOWN_WAIT_MS);

    this.process = null;
    this.rejectAllPending(new Error('Python Bridge 正在关闭'));
  }

  // ----------------------------------------------------------
  // 内部方法
  // ----------------------------------------------------------

  /** 确保 Python 进程在运行 */
  private async ensureRunning(): Promise<void> {
    if (this.process && this.process.exitCode === null) {
      return; // 进程正在运行
    }

    // 断路器检查
    if (this.cooldownUntil && Date.now() < this.cooldownUntil) {
      throw new Error(
        `Python Bridge 断路器已打开（连续崩溃 ${this.consecutiveCrashes} 次），` +
        `冷却至 ${new Date(this.cooldownUntil).toLocaleTimeString()}`
      );
    }

    // 防止并发初始化
    if (this.initializing && this.initPromise) {
      return this.initPromise;
    }

    this.initializing = true;
    this.initPromise = this.startProcess();

    try {
      await this.initPromise;
    } finally {
      this.initializing = false;
      this.initPromise = null;
    }
  }

  /** 检测 Python 解释器路径 */
  private detectPython(): string {
    // 如果已缓存，直接返回
    if (this.pythonPath) return this.pythonPath;

    const candidates = process.platform === 'win32'
      ? ['python', 'python3', 'py']
      : ['python3', 'python'];

    for (const cmd of candidates) {
      try {
        const version = execSync(`${cmd} --version`, {
          timeout: 5000,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();

        // 确保是 Python 3
        if (version.startsWith('Python 3')) {
          this.pythonPath = cmd;
          console.log(`[PythonBridge] 检测到 Python: ${cmd} (${version})`);
          return cmd;
        }
      } catch {
        // 该命令不可用，继续尝试
      }
    }

    throw new Error(
      'Python 3 未找到。请安装 Python 3.10+ 并确保在 PATH 中。\n' +
      '下载地址: https://www.python.org/downloads/'
    );
  }

  /** 获取 Python 脚本目录 */
  private getPythonDir(): string {
    if (!app.isPackaged) {
      // 开发模式：项目根目录/python/
      return path.join(process.cwd(), 'python');
    }
    // 打包模式：extraResources 解压到 resources/python/
    return path.join(process.resourcesPath, 'python');
  }

  /** 获取 Python 脚本路径 */
  private getScriptPath(): string {
    return path.join(this.getPythonDir(), 'main.py');
  }

  /** 依赖已验证标记，避免每次启动都检测 */
  private depsVerified = false;

  /**
   * 检测并安装 Python 依赖
   * 首次运行时自动 pip install requirements.txt 中的依赖
   */
  private async ensureDependencies(pythonCmd: string): Promise<void> {
    if (this.depsVerified) return;

    const pythonDir = this.getPythonDir();
    const reqFile = path.join(pythonDir, 'requirements.txt');

    if (!fs.existsSync(reqFile)) {
      console.log('[PythonBridge] requirements.txt 不存在，跳过依赖检测');
      this.depsVerified = true;
      return;
    }

    // 用 Python 检测核心依赖是否可导入
    const checkScript = 'import pandas,numpy,akshare,lark';

    try {
      execSync(`${pythonCmd} -c "${checkScript}"`, {
        timeout: 15_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      console.log('[PythonBridge] Python 依赖检测通过');
      this.depsVerified = true;
      return;
    } catch {
      console.log('[PythonBridge] 检测到缺失依赖，开始自动安装...');
    }

    // 执行 pip install
    try {
      execSync(
        `${pythonCmd} -m pip install -r "${reqFile}" --quiet`,
        {
          timeout: 300_000, // 5分钟超时（大包如 numpy 可能较慢）
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
      console.log('[PythonBridge] 依赖安装完成');
      this.depsVerified = true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Python 依赖安装失败。请手动执行:\n  ${pythonCmd} -m pip install -r "${reqFile}"\n${msg}`
      );
    }
  }

  /** 启动 Python 进程 */
  private async startProcess(): Promise<void> {
    const pythonCmd = this.detectPython();
    const scriptPath = this.getScriptPath();

    // 首次启动前确保依赖已安装
    await this.ensureDependencies(pythonCmd);

    console.log(`[PythonBridge] 启动 Python 进程: ${pythonCmd} ${scriptPath}`);

    this.process = spawn(pythonCmd, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',       // 禁用 Python 输出缓冲
        PYTHONIOENCODING: 'utf-8',   // 确保 UTF-8 编码
      },
    });

    // 监听 stdout（JSON 响应）
    this.process.stdout!.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf-8');
      this.processBuffer();
    });

    // 监听 stderr（日志）
    this.process.stderr!.on('data', (chunk: Buffer) => {
      const msg = chunk.toString('utf-8').trim();
      if (msg) {
        console.log(`[PythonBridge:stderr] ${msg}`);
      }
    });

    // 监听进程退出
    this.process.on('exit', (code, signal) => {
      console.warn(`[PythonBridge] Python 进程退出: code=${code}, signal=${signal}`);
      this.process = null;
      this.consecutiveCrashes++;

      if (this.consecutiveCrashes >= CRASH_THRESHOLD) {
        this.cooldownUntil = Date.now() + CRASH_COOLDOWN_MS;
        console.error(
          `[PythonBridge] 连续崩溃 ${this.consecutiveCrashes} 次，` +
          `断路器开启，冷却 ${CRASH_COOLDOWN_MS / 1000}s`
        );
      }

      this.rejectAllPending(new Error(`Python 进程异常退出 (code=${code})`));
    });

    this.process.on('error', (err) => {
      console.error(`[PythonBridge] 进程启动失败:`, err);
      this.process = null;
      this.rejectAllPending(new Error(`Python 进程启动失败: ${err.message}`));
    });

    // 健康检查
    try {
      const pong = await this.call<string>('ping', {}, HEALTH_CHECK_TIMEOUT_MS);
      if (pong !== 'pong') {
        throw new Error(`健康检查失败: 期望 "pong"，收到 "${pong}"`);
      }
      // 健康检查成功，重置崩溃计数
      this.consecutiveCrashes = 0;
      this.cooldownUntil = null;
      console.log('[PythonBridge] 健康检查通过');
    } catch (err) {
      // 健康检查失败，杀掉进程
      this.process?.kill();
      this.process = null;
      throw new Error(`Python Bridge 健康检查失败: ${err}`);
    }
  }

  /** 处理 stdout 缓冲区中的完整 JSON 行 */
  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    // 最后一个元素可能是不完整的行，保留在 buffer 中
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const response: PythonResponse = JSON.parse(trimmed);
        this.handleResponse(response);
      } catch {
        console.warn(`[PythonBridge] 无法解析响应: ${trimmed}`);
      }
    }
  }

  /** 处理单条响应 */
  private handleResponse(response: PythonResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      // 可能是超时后收到的响应，忽略
      return;
    }

    // 进度更新（不完成请求）
    if (response.progress) {
      pending.onProgress?.(response.progress);
      return;
    }

    // 完成请求
    this.pendingRequests.delete(response.id);
    clearTimeout(pending.timer);

    if (response.error) {
      pending.reject(new Error(response.error.message));
    } else {
      pending.resolve(response.result);
    }
  }

  /** 拒绝所有挂起的请求 */
  private rejectAllPending(error: Error): void {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }
}

// ============================================================
// 导出单例
// ============================================================

/** 全局 PythonBridge 单例 */
export const pythonBridge = new PythonBridge();
