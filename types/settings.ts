export interface ModelSelection {
  profileId: string;
  /** 存 piModels 里的某个模型 ID 原文（pi 请求体 model 字段） */
  tier: string;
}

export interface ModelProfile {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  apiTimeoutMs: number; // API_TIMEOUT_MS，默认 3000000
  /** 自动压缩触发比例（50–95），缺省 80；阈值 = 上下文窗口 × 百分比 */
  autoCompactPercent?: number;
  /** pi 客户端的线协议；缺省视为 'anthropic-messages' */
  piWireApi?: 'anthropic-messages' | 'openai-responses';
  /** 可用的模型清单（ModelSelection.tier 取值域）；label 为显示名，缺省显示 id；contextWindow 为手填生效窗口，优先于目录查表 */
  piModels?: Array<{ id: string; label?: string; contextWindow?: number }>;
}

/**
 * 检查 Profile 是否配置完整（可以用于创建会话）
 */
export function isProfileComplete(profile: ModelProfile): boolean {
  if (!profile.apiKey || !profile.baseUrl) return false;
  return (profile.piModels?.length ?? 0) > 0;
}

export type ThemePreference = 'light' | 'dark' | 'system';

export type EffortLevel = 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type PiPermissionMode = 'default' | 'autoExecute';

export type BrowserSearchEngine = 'auto' | 'google' | 'bing';

export type BasicToolName = 'read' | 'write' | 'edit' | 'bash' | 'Glob' | 'Grep' | 'Skill';
export type BasicToolPermission = 'ask' | 'allow';
export type BasicToolPermissions = Record<BasicToolName, BasicToolPermission>;

export const BASIC_TOOL_NAMES: readonly BasicToolName[] = ['read', 'write', 'edit', 'bash', 'Glob', 'Grep', 'Skill'];

export function createDefaultBasicToolPermissions(): BasicToolPermissions {
  return { read: 'ask', write: 'ask', edit: 'ask', bash: 'ask', Glob: 'ask', Grep: 'ask', Skill: 'ask' };
}

/**
 * 创建默认子会话 Profile 副本
 */
export function createDefaultSubAgentProfile(): SubAgentProfile {
  return {
    id: 'default',
    name: '默认',
    description: '标准派遣会话，具备全部基础工具和交付通信能力',
    modelSelection: null,
    timeoutMinutes: 30,
    enabledBasicTools: ['read', 'write', 'edit', 'bash', 'Glob', 'Grep'],
    enabledAbilities: {},
  };
}

export const BROWSER_PARSE_SUB_AGENT_PROFILE_ID = 'browser-parse';

/**
 * 创建内置「浏览器解析」子会话 Profile 副本（与主进程 settings-types.ts 保持一致）
 */
export function createBrowserParseSubAgentProfile(): SubAgentProfile {
  return {
    id: BROWSER_PARSE_SUB_AGENT_PROFILE_ID,
    name: '浏览器解析',
    description: '挂载扩展工具包在用户真实浏览器（登录态站点如小红书）执行只读调研，或用受控浏览器读取公开网页',
    modelSelection: null,
    timeoutMinutes: 30,
    enabledBasicTools: ['read', 'write', 'edit', 'Glob', 'Grep'],
    enabledAbilities: { browser: true, extension: true },
  };
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
  reference?: boolean;
  browser?: boolean;
  extension?: boolean;
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
    /** 推理努力程度。null/undefined = 不传给 SDK，由模型自带默认决定（推荐新装默认） */
    effort?: EffortLevel | null;
    permissionMode: PiPermissionMode;
    settingSources?: ('user' | 'project')[]; // SDK 设置源
    defaultModelSelection: ModelSelection | null;
    digestModelSelection: ModelSelection | null;
    reviewModelSelection: ModelSelection | null;
    categorizeModelSelection: ModelSelection | null;
    /** 文章解析 AI 兑底任务专用模型；null 时回退 defaultModelSelection */
    parseModelSelection: ModelSelection | null;
  };
  basicToolPermissions: BasicToolPermissions;
  profiles: Record<string, ModelProfile>;
  /** 子会话派遣 Profile 列表 */
  subAgent: {
    profiles: SubAgentProfile[];
  };
  failover?: FailoverConfig;
  /** 智能分类设置 */
  smartCategory?: {
    enabled?: boolean;          // 默认 true
    threshold?: number;         // 0–1，默认 0.5
    maxCategories?: number;     // 默认 10
  };
  /** 热更新服务配置 */
  update?: {
    serverUrl: string;
  };
  ui?: {
    messageDisplayMode: 'compact' | 'detailed'; // 工具/思考块显示模式
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
  /** 受控浏览器代理地址（host:port）；空 = 禁用代理引擎，搜索仅 Bing */
  browserProxyServer?: string;
  /** 浏览器搜索默认引擎；缺省视为 auto（代理可用时用 Google） */
  browserSearchEngine: BrowserSearchEngine;
}

export const DEFAULT_SETTINGS: AppSettings = {
  ai: {
    effort: null,
    permissionMode: 'default',
    settingSources: ['user', 'project'],
    defaultModelSelection: null,
    digestModelSelection: null,
    reviewModelSelection: null,
    categorizeModelSelection: null,
    parseModelSelection: null,
  },
  basicToolPermissions: createDefaultBasicToolPermissions(),
  smartCategory: { enabled: true, threshold: 0.5, maxCategories: 10 },
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
};
