/**
 * 共享的 query() 配置构建器
 *
 * 此文件无 electron 依赖，可在 Worker 线程中安全导入。
 * 主进程（QueryBasedSession）和 Worker 线程（后台任务）都通过此函数
 * 获取统一的 API 配置，避免重复和遗漏。
 */

import path from 'path';
import { safeJsonRead } from '../services/safe-json.js';

/**
 * 解析当前平台的 Claude CLI 原生二进制路径（打包环境使用）
 *
 * SDK 0.2.113+ 架构变化：claude CLI 从主包中的 cli.js 改为 optionalDependencies
 * 平台子包里的原生可执行文件，例如：
 *   - win32 x64  → @anthropic-ai/claude-agent-sdk-win32-x64/claude.exe
 *   - darwin arm → @anthropic-ai/claude-agent-sdk-darwin-arm64/claude
 *   - linux x64  → @anthropic-ai/claude-agent-sdk-linux-x64/claude
 *
 * 必须配合 electron-builder.yml 的 asarUnpack 规则，把对应平台子包解压到
 * app.asar.unpacked/ 下，否则子进程 spawn 无法执行 asar 内的虚拟路径。
 *
 * @param appPath electron.app.getAppPath() 的返回值（通常是 app.asar 路径）
 */
export function resolveClaudeCliPath(appPath: string): string {
  const platform = process.platform; // 'win32' | 'darwin' | 'linux'
  const arch = process.arch;         // 'x64' | 'arm64' | ...
  const binaryName = platform === 'win32' ? 'claude.exe' : 'claude';
  const subPkg = `claude-agent-sdk-${platform}-${arch}`;
  return path.join(
    path.dirname(appPath),
    'app.asar.unpacked',
    'node_modules', '@anthropic-ai', subPkg,
    binaryName,
  );
}
import {
  type AppSettings,
  type ModelProfile,
  DEFAULT_SETTINGS,
  deepMerge,
  getActiveProfile,
  isProfileComplete,
} from '../services/settings-types.js';

/**
 * 运行时上下文
 * 调用方负责提供这些值：
 * - 主进程：从 electron.app 获取
 * - Worker 线程：从 AgentWorkerConfig 接收（由主进程 createWorker() 预计算后传入）
 */
export interface QueryRuntimeContext {
  /** .dogear 配置目录路径 */
  configDir: string;
  /** 是否打包环境（影响 CLI 路径和 configDir 计算） */
  isPackaged: boolean;
  /** SDK CLI 可执行文件路径（打包环境需要，开发环境不需要） */
  cliPath?: string;
}

/**
 * query() 调用所需的基础配置
 * 调用方将此对象的字段注入到 query() options 中
 */
export interface QueryBaseConfig {
  /** 包含 API Key、Base URL、模型映射等的环境变量（传给 query() 的 env 参数） */
  env: Record<string, string>;
  /** 努力程度 */
  effort: AppSettings['ai']['effort'];
  /** 权限模式 */
  permissionMode: AppSettings['ai']['permissionMode'];
  /** 声明式权限规则（allow/deny 列表） */
  permissionRules?: AppSettings['permissionRules'];
  /** 最大回合数（如果设置了的话） */
  maxTurns?: number;
  /** SDK CLI 路径（打包环境专用，开发环境为 undefined） */
  pathToClaudeCodeExecutable?: string;
  /** 设置来源（用于控制是否加载 .claude/skills/ 等） */
  settingSources?: AppSettings['ai']['settingSources'];
  /** 完整的 AppSettings（供调用方使用，如构建 systemPrompt） */
  appSettings: AppSettings;
  /** 当前激活的 ModelProfile（供调用方日志使用） */
  activeProfile: ModelProfile;
}

/**
 * 从指定 configDir 读取 settings.json 并合并默认值
 * （不依赖 electron.app，可在 Worker 线程中调用）
 */
async function loadSettingsFromDir(configDir: string): Promise<AppSettings> {
  const settingsPath = path.join(configDir, 'settings.json');
  const saved = await safeJsonRead<AppSettings | null>(settingsPath, null);
  if (saved === null) {
    return structuredClone(DEFAULT_SETTINGS);
  }
  return deepMerge(saved, DEFAULT_SETTINGS);
}

/**
 * 构建 query() 所需的通用配置
 *
 * 主进程和 Worker 线程都调用此函数，传入各自的运行时上下文。
 * 返回的配置可直接注入到 query() options 中。
 *
 * @throws 当 API 配置不完整时抛出错误
 */
export async function buildQueryBaseConfig(ctx: QueryRuntimeContext): Promise<QueryBaseConfig> {
  // 读取设置
  const appSettings = await loadSettingsFromDir(ctx.configDir);
  const activeProfile = getActiveProfile(appSettings);

  // 校验 Profile 完整性
  if (!isProfileComplete(activeProfile)) {
    throw new Error(
      `模型方案 "${activeProfile.name}" 配置不完整，请在设置页面完善 API Key、Base URL 和模型映射`
    );
  }

  // CLAUDE_CONFIG_DIR 与 getClaudeConfigDir() 保持一致：{configDir}/conversations
  const claudeConfigDir = path.join(ctx.configDir, 'conversations');

  // 构建环境变量（合并系统 env + Profile 凭据）
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ANTHROPIC_AUTH_TOKEN: activeProfile.apiKey,
    ANTHROPIC_BASE_URL: activeProfile.baseUrl,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: activeProfile.haikuModel,
    ANTHROPIC_DEFAULT_SONNET_MODEL: activeProfile.sonnetModel,
    ANTHROPIC_DEFAULT_OPUS_MODEL: activeProfile.opusModel,
    API_TIMEOUT_MS: String(activeProfile.apiTimeoutMs),
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: activeProfile.disableNonessentialTraffic ? '1' : '0',
    CLAUDE_CONFIG_DIR: claudeConfigDir,
  };

  // 打包环境：设置 CLI 可执行文件路径
  const pathToClaudeCodeExecutable = ctx.isPackaged && ctx.cliPath ? ctx.cliPath : undefined;

  // 根据用户配置注入 ANTHROPIC_MODEL / CLAUDE_CODE_SUBAGENT_MODEL
  const tierMap: Record<'haiku' | 'sonnet' | 'opus', string> = {
    haiku:  activeProfile.haikuModel,
    sonnet: activeProfile.sonnetModel,
    opus:   activeProfile.opusModel,
  };

  if (appSettings.ai.defaultModelTier) {
    env.ANTHROPIC_MODEL = tierMap[appSettings.ai.defaultModelTier];
  }
  // Subagent 模型：用户显式指定优先；未指定但 effort 非空时兜底到 sonnet
  // 原因：Claude Code 子代理默认 haiku，haiku 不支持 effort 参数会 API 400
  const subagentTier = appSettings.ai.subagentModelTier
    ?? (appSettings.ai.effort ? 'sonnet' as const : undefined);
  if (subagentTier) {
    env.CLAUDE_CODE_SUBAGENT_MODEL = tierMap[subagentTier];
  }

  // 1M 长上下文：把自动压缩窗口设为 900K（留 100K 缓冲给最后几轮 messages）
  // 必须走环境变量，SDK 的 autoCompactWindow 属于 Settings 类型，设在 query Options 上会被忽略
  if (activeProfile.enable1MContext) {
    env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = '900000';
  }

  return {
    env,
    effort: appSettings.ai.effort,
    permissionMode: appSettings.ai.permissionMode,
    permissionRules: appSettings.permissionRules,
    maxTurns: appSettings.ai.maxTurns,
    pathToClaudeCodeExecutable,
    settingSources: appSettings.ai.settingSources,
    appSettings,
    activeProfile,
  };
}
