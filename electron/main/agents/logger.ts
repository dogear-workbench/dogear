/**
 * Agent 框架日志工具
 * 提供统一的日志格式和级别管理
 */

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
}

/**
 * Logger 类
 */
export class Logger {
  private level: LogLevel;
  private prefix: string;
  private enableTimestamp: boolean;
  private enableConsole: boolean;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? LogLevel.INFO;
    this.prefix = options.prefix ?? '[Agent]';
    this.enableTimestamp = options.enableTimestamp ?? true;
    this.enableConsole = options.enableConsole ?? true;
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
      enableConsole: this.enableConsole
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
