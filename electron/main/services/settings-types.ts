/**
 * 设置相关的纯类型定义和纯函数
 * 此文件无 electron 依赖，可在 Worker 线程中安全导入
 */

// ============================================================
// 类型定义（与 types/settings.ts 保持一致，主进程独立定义）
// ============================================================

export interface ModelSelection {
  profileId: string;
  /** 存 piModels 里的某个模型 ID 原文（pi 请求体 model 字段） */
  tier: string;
}

export type PiWireApi = 'anthropic-messages' | 'openai-responses' | 'openai-completions';

/** 模型价格，单位元/百万 tokens；缓存写存储费不计 */
export interface ModelPricing {
  input: number;
  output: number;
  cacheRead: number;
}

export interface ModelProfile {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  apiTimeoutMs: number;
  /** 自动压缩触发比例（50–95），缺省 80；阈值 = 上下文窗口 × 百分比 */
  autoCompactPercent?: number;
  /** pi 客户端的线协议；缺省视为 'anthropic-messages' */
  piWireApi?: PiWireApi;
  /** 可用的模型清单（ModelSelection.tier 取值域）；label 为显示名，缺省显示 id；contextWindow 为手填生效窗口，优先于目录查表；pricing 为手填价格（元/百万 tokens），优先于目录默认价 */
  piModels?: Array<{ id: string; label?: string; contextWindow?: number; pricing?: ModelPricing }>;
}

export type EffortLevel = 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type ThemePreference = 'light' | 'dark' | 'system';

export type PiPermissionMode = 'default' | 'autoExecute';

export type BrowserSearchEngine = 'auto' | 'google' | 'bing';

export type BasicToolName = 'read' | 'write' | 'edit' | 'bash' | 'Glob' | 'Grep' | 'Skill';
export type BasicToolPermission = 'ask' | 'allow';
export type BasicToolPermissions = Record<BasicToolName, BasicToolPermission>;

export const BASIC_TOOL_NAMES: readonly BasicToolName[] = ['read', 'write', 'edit', 'bash', 'Glob', 'Grep', 'Skill'];

export const BROWSER_PARSE_SUB_AGENT_PROFILE_ID = 'browser-parse';

export function createDefaultBasicToolPermissions(): BasicToolPermissions {
  return { read: 'ask', write: 'ask', edit: 'ask', bash: 'ask', Glob: 'ask', Grep: 'ask', Skill: 'ask' };
}

export interface FailoverEntry {
  profileId: string;
  tier: string;
}

export interface FailoverConfig {
  enabled: boolean;
  chain: FailoverEntry[];
}

export interface SubAgentEnabledAbilities {
  memory?: boolean;
  stock?: boolean;
  article?: boolean;
  skills?: string[];
  customSkills?: string[];
  browser?: boolean;
  extension?: boolean;
  web?: boolean;
}

export interface SubAgentProfile {
  id: string;
  name: string;
  description: string;
  modelSelection?: ModelSelection | null;
  /** 单个子会话最长允许跑的分钟数，默认 30 */
  timeoutMinutes: number;
  /** 仅非 default Profile 有意义：false 时 agent 侧不可见、不可派遣；缺省视为启用 */
  enabled?: boolean;
  enabledBasicTools: string[];
  enabledAbilities: SubAgentEnabledAbilities;
}

export interface AppSettings {
  ai: {
    /** 推理努力程度。null/undefined = 不传给 SDK，由模型自带默认决定 */
    effort?: EffortLevel | null;
    permissionMode: PiPermissionMode;
    settingSources?: ('user' | 'project')[];
    defaultModelSelection: ModelSelection | null;
    /** 文章解析 AI 兑底任务专用模型；null 时回退 defaultModelSelection */
    parseModelSelection: ModelSelection | null;
    /** 话题状态卡增量抽取任务专用模型；null 时回退 defaultModelSelection */
    stateModelSelection: ModelSelection | null;
  };
  basicToolPermissions: BasicToolPermissions;
  profiles: Record<string, ModelProfile>;
  /** 子会话派遣 Profile 列表 */
  subAgent: {
    profiles: SubAgentProfile[];
  };
  failover?: FailoverConfig;
  /** 热更新服务配置 */
  update?: {
    serverUrl: string;
  };
  ui?: {
    messageDisplayMode: 'compact' | 'detailed';
    /** 界面整体缩放档位；缺省视为 medium */
    fontSize?: 'small' | 'medium' | 'large';
    /** Dogear 自己播放的提示音 */
    sound?: {
      enabled: boolean;
      volume: number;
      backgroundOnly: boolean;
    };
  };
  /** 外观主题；缺省视为 light */
  appearance?: {
    theme: ThemePreference;
  };
  /** 受控浏览器代理地址（host:port，可含 http/socks5 前缀）；空/缺省 = 禁用代理引擎，搜索仅 Bing */
  browserProxyServer?: string;
  /** GLM Coding Plan API Key（联网搜索 MCP 工具用）；空/缺省 = 未配置，工具调用返回提示 */
  webMcpApiKey?: string;
  /** 浏览器搜索默认引擎；缺省视为 auto（代理可用时用 Google） */
  browserSearchEngine: BrowserSearchEngine;
  /** 一次性迁移标记 */
  migrated?: {
    workspaceConfig?: boolean;
  };
}

// ============================================================
// 常量
// ============================================================

export const DEFAULT_SETTINGS: AppSettings = {
  ai: {
    effort: null,
    permissionMode: 'default',
    settingSources: ['user', 'project'],
    defaultModelSelection: null,
    parseModelSelection: null,
    stateModelSelection: null,
  },
  basicToolPermissions: createDefaultBasicToolPermissions(),
  subAgent: {
    profiles: [createDefaultSubAgentProfile(), createBrowserParseSubAgentProfile()],
  },
  failover: { enabled: false, chain: [] },
  update: {
    serverUrl: 'http://localhost:9527',
  },
  ui: {
    messageDisplayMode: 'compact',
    fontSize: 'medium',
    sound: { enabled: true, volume: 0.25, backgroundOnly: true },
  },
  appearance: {
    theme: 'light',
  },
  browserSearchEngine: 'auto',
  profiles: {
    default: {
      id: 'default',
      name: '默认',
      apiKey: '',
      baseUrl: '',
      apiTimeoutMs: 3000000,
    },
  },
  migrated: {},
};

// ============================================================
// 纯函数
// ============================================================

/**
 * piModels 在磁盘上可能仍是迁移前的 string[]（normalize 先于 migratePiProfiles 执行），两种形状都取 id
 */
function piModelIds(profile: ModelProfile | undefined): string[] {
  const raw: unknown[] = Array.isArray(profile?.piModels) ? ((profile as ModelProfile).piModels as unknown[]) : [];
  return raw
    .map((m) => (typeof m === 'string' ? m : (m as { id?: unknown } | null | undefined)?.id))
    .filter((id): id is string => typeof id === 'string' && id !== '');
}

/**
 * 规范化 failover 链：条目按 profileId 去重；profile 已删或 piModels 为空时移出链；
 * tier 失效回退该家首个模型；按 profiles 顺序把未入链的供应商追加链尾；failover 缺失时生成完整链（enabled: false）。
 * 纯函数，不修改入参。
 */
export function normalizeFailoverChain(
  profiles: Record<string, ModelProfile>,
  failover: FailoverConfig | undefined,
): FailoverConfig {
  const idsByProfile = new Map<string, string[]>();
  for (const [id, profile] of Object.entries(profiles)) {
    idsByProfile.set(id, piModelIds(profile));
  }

  const seen = new Set<string>();
  const chain: FailoverEntry[] = [];
  const rawChain: unknown[] = Array.isArray(failover?.chain) ? (failover?.chain as unknown[]) : [];
  for (const raw of rawChain) {
    if (!raw || typeof raw !== 'object') continue;
    const { profileId, tier } = raw as Partial<FailoverEntry>;
    if (typeof profileId !== 'string' || profileId === '' || seen.has(profileId)) continue;
    const ids = idsByProfile.get(profileId);
    if (!ids || ids.length === 0) continue;
    seen.add(profileId);
    chain.push({ profileId, tier: typeof tier === 'string' && ids.includes(tier) ? tier : ids[0] });
  }

  for (const [id, ids] of idsByProfile) {
    if (ids.length === 0 || seen.has(id)) continue;
    chain.push({ profileId: id, tier: ids[0] });
  }

  return { enabled: failover?.enabled === true, chain };
}

/**
 * 检查 Profile 是否配置完整
 */
export function isProfileComplete(profile: ModelProfile): boolean {
  if (!profile.apiKey || !profile.baseUrl) return false;
  return (profile.piModels?.length ?? 0) > 0;
}

/**
 * 创建默认子会话 Profile 副本
 */
export function createDefaultSubAgentProfile(): SubAgentProfile {
  return {
    id: 'default',
    name: '默认',
    description: '实施类任务：改代码、写文件、跑命令，需要动工作区时用。',
    modelSelection: null,
    timeoutMinutes: 30,
    enabledBasicTools: ['read', 'write', 'edit', 'bash', 'Glob', 'Grep'],
    enabledAbilities: { web: true },
  };
}

/**
 * 创建内置「浏览器解析」子会话 Profile 副本；normalize 保证存在，UI 禁止删除（同 default）
 */
export function createBrowserParseSubAgentProfile(): SubAgentProfile {
  return {
    id: BROWSER_PARSE_SUB_AGENT_PROFILE_ID,
    name: '浏览器解析',
    description:
      '网页与文章调研：公开网页用内嵌浏览器；登录态站点（如小红书）走用户浏览器扩展通道（全局独占，并行串行派遣）；也用于解析工作区文章库的文章。',
    modelSelection: null,
    timeoutMinutes: 30,
    enabledBasicTools: ['read', 'write', 'edit', 'Glob', 'Grep'],
    enabledAbilities: { web: true, browser: true, extension: true, article: true },
  };
}

/**
 * 深度合并两个对象
 * target 中已有的值保留，缺失的字段从 source 补充默认值
 */
export function deepMerge<T extends Record<string, any>>(target: T, source: T): T {
  const result = { ...source };

  for (const key of Object.keys(target) as (keyof T)[]) {
    const targetVal = target[key];
    const sourceVal = source[key];

    if (
      targetVal !== null &&
      sourceVal !== null &&
      typeof targetVal === 'object' &&
      typeof sourceVal === 'object' &&
      !Array.isArray(targetVal) &&
      !Array.isArray(sourceVal)
    ) {
      // 递归合并嵌套对象
      (result as Record<string, unknown>)[key as string] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
      );
    } else {
      // 使用 target（用户已保存的值）覆盖 source（默认值）
      (result as Record<string, unknown>)[key as string] = targetVal;
    }
  }

  return result as T;
}
