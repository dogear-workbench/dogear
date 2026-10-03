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
  apiTimeoutMs: number; // API_TIMEOUT_MS，默认 3000000
  /** 自动压缩触发比例（50–95），缺省 80；阈值 = 上下文窗口 × 百分比 */
  autoCompactPercent?: number;
  /** pi 客户端的线协议；缺省视为 'anthropic-messages' */
  piWireApi?: PiWireApi;
  /** 可用的模型清单（ModelSelection.tier 取值域）；label 为显示名，缺省显示 id；contextWindow 为手填生效窗口，优先于目录查表；pricing 为手填价格（元/百万 tokens），优先于目录默认价 */
  piModels?: Array<{ id: string; label?: string; contextWindow?: number; maxTokens?: number; pricing?: ModelPricing; supportsVision?: boolean }>;
}

/**
 * 检查 Profile 是否配置完整（可以用于创建会话）
 */
export function isProfileComplete(profile: ModelProfile): boolean {
  if (!profile.apiKey || !profile.baseUrl) return false;
  return (profile.piModels?.length ?? 0) > 0;
}

import type { SnapshotSettings } from '@/electron/main/services/settings-types';

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
    description:
      '浏览器与扩展双通道调研 + 工作区文章读取与解析：公开网页用内嵌浏览器（dogear__browser__*），登录态站点（如小红书）用扩展通道（dogear__extension__*，用户真实浏览器）；扩展通道同一时间仅一个会话可用，并行调研请改串行派遣。文章解析随 article 能力启用，article-parser skill 直通无需单独配置。探索方法论见 browser-exploration skill，子会话启用 browser 能力时自动挂载。',
    modelSelection: null,
    timeoutMinutes: 30,
    enabledBasicTools: ['read', 'write', 'edit', 'Glob', 'Grep'],
    enabledAbilities: { web: true, browser: true, extension: true, article: true },
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

export interface WebAiSite {
  id: string;
  name: string;
  url: string;
}

export const DEFAULT_WEB_AI_SITES: WebAiSite[] = [
  { id: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com' },
  { id: 'kimi', name: 'Kimi', url: 'https://kimi.moonshot.cn' },
  { id: 'doubao', name: '豆包', url: 'https://www.doubao.com/chat' },
];

export const BACKUP_CATEGORY_KEYS = ['notes-groups', 'memory', 'tasks', 'sessions', 'app-config'] as const;
export type BackupCategoryKey = (typeof BACKUP_CATEGORY_KEYS)[number];
export type BackupFrequency = 'daily' | 'weekly' | 'monthly' | 'manual';

export interface BackupCategorySetting {
  enabled: boolean;
  frequency: BackupFrequency;
  keep: number;
}

export interface BackupSettings {
  categories: Record<BackupCategoryKey, BackupCategorySetting>;
}

export interface AppSettings {
  ai: {
    /** 推理努力程度。null/undefined = 不传给 SDK，由模型自带默认决定（推荐新装默认） */
    effort?: EffortLevel | null;
    permissionMode: PiPermissionMode;
    settingSources?: ('user' | 'project')[]; // SDK 设置源
    defaultModelSelection: ModelSelection | null;
    /** 文章解析 AI 兑底任务专用模型；null 时回退 defaultModelSelection */
    parseModelSelection: ModelSelection | null;
    /** 话题状态卡增量抽取任务专用模型；null 时回退 defaultModelSelection */
    stateModelSelection: ModelSelection | null;
    /** 图片识读转派模型；null 时自动取模型清单里第一个标记 supportsVision 的模型 */
    visionModelSelection?: ModelSelection | null;
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
  /** GLM Coding Plan API Key（联网搜索 MCP 工具用）；空 = 未配置，工具调用返回提示 */
  webMcpApiKey?: string;
  /** 浏览器搜索默认引擎；缺省视为 auto（代理可用时用 Google） */
  browserSearchEngine: BrowserSearchEngine;
  /** 用户追加的支付/网银拦截域名，与内置默认并集生效；缺省视为空 */
  paymentBlockedHosts?: string[];
  /** 应用数据备份配置；缺省分类走默认值（notes-groups/memory/tasks/app-config=daily·10·开，sessions=monthly·10·开） */
  backup?: BackupSettings;
  /** 影子快照配置；缺省走 SNAPSHOT_SETTING_DEFAULTS（类型自主进程 settings-types 导入，单一来源不另设镜像） */
  snapshot?: SnapshotSettings;
  /** 网页 AI 站点列表；缺省视为 DEFAULT_WEB_AI_SITES */
  webAiSites?: WebAiSite[];
}

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
  webAiSites: DEFAULT_WEB_AI_SITES,
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
