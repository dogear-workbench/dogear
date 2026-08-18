/**
 * Agent 框架日志工具
 * 提供统一的日志格式和级别管理
 * 支持控制台输出和文件写入（WARN/ERROR 级别）
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * 日志级别枚举
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

/**
 * 日志配置选项
 */
export interface LoggerOptions {
  level?: LogLevel;        // 最低日志级别
  prefix?: string;         // 日志前缀
  enableTimestamp?: boolean; // 是否显示时间戳
  enableConsole?: boolean;  // 是否输出到控制台 (默认 true)
  logDir?: string;          // 日志文件目录路径，设置后 WARN/ERROR 级别写入文件
}

// 缓存配置目录路径，避免重复计算
let _configDir: string | null = null;

/**
 * 获取 .dogear 配置目录
 * 开发阶段：项目根目录/.dogear
 * 打包后：AppData/Roaming/Dogear/.dogear
 *
 * Worker 线程中无法访问 electron app，通过 DOGEAR_CONFIG_DIR 环境变量获取
 * （由 agent-manager.ts 创建 Worker 时通过 process.env 传递）
 */
export function getConfigDir(): string {
  if (_configDir) return _configDir;

  // 优先使用环境变量（Worker 线程 + 主进程均可）
  if (process.env.DOGEAR_CONFIG_DIR) {
    _configDir = process.env.DOGEAR_CONFIG_DIR;
    return _configDir;
  }

  // 回退：开发环境
  _configDir = path.join(process.cwd(), '.dogear');
  return _configDir;
}

/**
 * 由主进程在 app ready 后调用，设置配置目录环境变量
 * 这样 logger 和 Worker 线程都能获取到正确的路径
 */
export function initConfigDir(configDir: string): void {
  _configDir = configDir;
  process.env.DOGEAR_CONFIG_DIR = configDir;
}

/**
 * 获取日志目录路径
 */
export function getLogDir(): string {
  return path.join(getConfigDir(), 'logs');
}

/**
 * 初始化日志目录：确保目录存在 + 清理 7 天以前的日志文件
 */
export async function initLogDir(logDir: string): Promise<void> {
  // 确保日志目录存在
  await fs.promises.mkdir(logDir, { recursive: true });

  // 清理 7 天以前的日志文件
  try {
    const files = await fs.promises.readdir(logDir);
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    for (const file of files) {
      if (!file.endsWith('.log')) continue;

      const filePath = path.join(logDir, file);
      try {
        const stat = await fs.promises.stat(filePath);
        if (now - stat.mtimeMs > sevenDaysMs) {
          await fs.promises.unlink(filePath);
        }
      } catch {
        // 单个文件清理失败，跳过
      }
    }
  } catch {
    // 清理失败不影响正常运行
  }
}

/**
 * Logger 类
 */
export class Logger {
  private level: LogLevel;
  private prefix: string;
  private enableTimestamp: boolean;
  private enableConsole: boolean;
  private logDir: string | undefined;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? LogLevel.INFO;
    this.prefix = options.prefix ?? '[Agent]';
    this.enableTimestamp = options.enableTimestamp ?? true;
    this.enableConsole = options.enableConsole ?? true;
    this.logDir = options.logDir;
  }

  /**
   * 设置日志文件目录（运行时动态设置）
   */
  setLogDir(logDir: string) {
    this.logDir = logDir;
  }

  /**
   * 格式化日志消息
   */
  private formatMessage(level: string, message: string, ...args: any[]): string {
    const parts: string[] = [];

    // 添加时间戳
    if (this.enableTimestamp) {
      const timestamp = new Date().toISOString();
      parts.push(timestamp);
    }

    // 添加日志级别
    parts.push(`[${level}]`);

    // 添加前缀
    if (this.prefix) {
      parts.push(this.prefix);
    }

    // 添加消息
    parts.push(message);

    return parts.join(' ');
  }

  /**
   * 将日志写入文件（异步，不阻塞调用方）
   * 仅在 logDir 设置时调用，写入失败只打 console.error
   */
  private writeToFile(formattedMessage: string, args: any[]): void {
    if (!this.logDir) return;

    const logDir = this.logDir;

    // 构建完整的日志行内容
    let line = formattedMessage;

    // 序列化额外参数
    if (args.length > 0) {
      const serialized = args.map(arg => {
        if (arg instanceof Error) {
          // Error 对象序列化 stack
          return arg.stack || arg.message;
        }
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      });
      line += ' ' + serialized.join(' ');
    }

    line += '\n';

    // 异步写入文件，fire-and-forget
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const logFilePath = path.join(logDir, `dogear-${today}.log`);

    fs.promises.appendFile(logFilePath, line, 'utf-8').catch((err) => {
      // 写入失败只打 console.error，绝不抛出（避免无限递归）
      console.error('日志文件写入失败:', err);
    });
  }

  /**
   * 输出日志
   */
  private log(level: LogLevel, levelName: string, message: string, ...args: any[]) {
    // 检查日志级别
    if (level < this.level) {
      return;
    }

    // 格式化消息
    const formattedMessage = this.formatMessage(levelName, message, ...args);

    // 输出到控制台
    if (this.enableConsole) {
      switch (level) {
        case LogLevel.DEBUG:
          console.debug(formattedMessage, ...args);
          break;
        case LogLevel.INFO:
          console.info(formattedMessage, ...args);
          break;
        case LogLevel.WARN:
          console.warn(formattedMessage, ...args);
          break;
        case LogLevel.ERROR:
          console.error(formattedMessage, ...args);
          break;
      }
    }

    // WARN/ERROR 级别写入文件
    if (level >= LogLevel.WARN && this.logDir) {
      this.writeToFile(formattedMessage, args);
    }
  }

  /**
   * DEBUG 级别日志
   */
  debug(message: string, ...args: any[]) {
    this.log(LogLevel.DEBUG, 'DEBUG', message, ...args);
  }

  /**
   * INFO 级别日志
   */
  info(message: string, ...args: any[]) {
    this.log(LogLevel.INFO, 'INFO', message, ...args);
  }

  /**
   * WARN 级别日志
   */
  warn(message: string, ...args: any[]) {
    this.log(LogLevel.WARN, 'WARN', message, ...args);
  }

  /**
   * ERROR 级别日志
   */
  error(message: string, ...args: any[]) {
    this.log(LogLevel.ERROR, 'ERROR', message, ...args);
  }

  /**
   * 设置日志级别
   */
  setLevel(level: LogLevel) {
    this.level = level;
  }

  /**
   * 创建子 Logger (带有额外前缀)
   */
  child(additionalPrefix: string): Logger {
    const newPrefix = this.prefix ? `${this.prefix}:${additionalPrefix}` : additionalPrefix;
    return new Logger({
      level: this.level,
      prefix: newPrefix,
      enableTimestamp: this.enableTimestamp,
      enableConsole: this.enableConsole,
      logDir: this.logDir,
    });
  }
}

// ==================== 默认 Logger 实例 ====================

/**
 * 主进程 Logger
 */
export const mainLogger = new Logger({
  prefix: '[AgentManager]',
  level: LogLevel.INFO
});

/**
 * Worker 进程 Logger
 */
export const workerLogger = new Logger({
  prefix: '[AgentWorker]',
  level: LogLevel.DEBUG // Worker 进程默认更详细的日志
});

/**
 * 任务 Logger (用于记录任务相关的日志)
 */
export function createTaskLogger(taskId: string): Logger {
  return new Logger({
    prefix: `[Task:${taskId.substring(0, 8)}]`,
    level: LogLevel.DEBUG
  });
}

/**
 * 设置全局日志级别
 */
export function setGlobalLogLevel(level: LogLevel) {
  mainLogger.setLevel(level);
  workerLogger.setLevel(level);
}

/**
 * 初始化文件日志写入
 * 在 app ready 后调用，设置 logDir 到 mainLogger 和 workerLogger
 * 仅在主进程中有效（Worker 线程中不应调用）
 */
export async function initFileLogging(): Promise<void> {
  const logDir = getLogDir();
  await initLogDir(logDir);

  // 为默认实例设置日志目录
  mainLogger.setLogDir(logDir);
  workerLogger.setLogDir(logDir);
}
