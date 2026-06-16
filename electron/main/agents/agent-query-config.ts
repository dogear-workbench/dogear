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
  type ModelSelection,
  type ModelTier,
  DEFAULT_SETTINGS,
  deepMerge,
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
 * 拼装单个 Profile 的凭证 + 模型映射环境变量（不含 ANTHROPIC_MODEL/SUBAGENT 档位决策）。
 * buildQueryBaseConfig 与后台 digest 任务共用，确保换 Profile 时凭证整体切换。
 */
export function buildProfileEnv(
  profile: ModelProfile,
  claudeConfigDir: string,
): Record<string, string> {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ANTHROPIC_AUTH_TOKEN: profile.apiKey,
    ANTHROPIC_BASE_URL: profile.baseUrl,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: profile.haikuModel,
    ANTHROPIC_DEFAULT_SONNET_MODEL: profile.sonnetModel,
    ANTHROPIC_DEFAULT_OPUS_MODEL: profile.opusModel,
    API_TIMEOUT_MS: String(profile.apiTimeoutMs),
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: profile.disableNonessentialTraffic ? '1' : '0',
    CLAUDE_CONFIG_DIR: claudeConfigDir,
  };
  // 1M 长上下文：按 Profile 配置显式控制，避免继承父进程环境中的值
  if (profile.enable1MContext) {
    env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = '900000';
  } else {
    delete env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
  }
  return env;
}

// 把 ModelSelection 解析为完整的 env / profile / tier
export function resolveModelSelection(
  appSettings: AppSettings,
  selection: ModelSelection | null,
  fallback: ModelSelection | null,
  configDir: string,
): { profile: ModelProfile; tier: ModelTier; modelId: string; env: Record<string, string> } {
  const target = selection ?? fallback;
  if (!target) {
    throw new Error('未指定模型，请先在对话或设置中选择模型');
  }
  const profile = appSettings.profiles[target.profileId];
  if (!profile) {
    throw new Error(`模型方案「${target.profileId}」不存在`);
  }
  if (!isProfileComplete(profile)) {
    throw new Error(`模型方案「${profile.name}」配置不完整（缺 API Key / Base URL / 模型映射）`);
  }
  const claudeConfigDir = path.join(configDir, 'conversations');
  const env = buildProfileEnv(profile, claudeConfigDir);
  const tierMap: Record<ModelTier, string> = {
    haiku: profile.haikuModel,
    sonnet: profile.sonnetModel,
    opus: profile.opusModel,
  };
  env.ANTHROPIC_MODEL = tierMap[target.tier];
  // 子代理：未显式指定且 effort 非空时，回退到 sonnet
  // (SDK 默认 haiku，haiku 不支持 effort 参数会 API 400)
  const subagentTier = appSettings.ai.subagentModelTier
    ?? (appSettings.ai.effort ? 'sonnet' as const : undefined);
  if (subagentTier) {
    env.CLAUDE_CODE_SUBAGENT_MODEL = tierMap[subagentTier];
  }
  return { profile, tier: target.tier, modelId: tierMap[target.tier], env };
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
  const env = buildProfileEnv(activeProfile, claudeConfigDir);

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
