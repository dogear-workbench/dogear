export interface ModelSelection {
  profileId: string;
  /** 存 piModels 里的某个模型 ID 原文（pi 请求体 model 字段） */
  tier: string;
  /** 手调推理力度；缺省/null = 跟随模型预设 */
  effort?: EffortLevel | null;
}

export type PiWireApi = 'anthropic-messages' | 'openai-responses';

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
  piModels?: Array<{ id: string; label?: string; contextWindow?: number; maxTokens?: number; pricing?: ModelPricing; supportsVision?: boolean; /** 模型预设推理力度；缺省/null = 关闭 */ effort?: EffortLevel | null }>;
}

/**
 * 检查 Profile 是否配置完整（可以用于创建会话）
 */
export function isProfileComplete(profile: ModelProfile): boolean {
  if (!profile.apiKey || !profile.baseUrl) return false;
  return (profile.piModels?.length ?? 0) > 0;
}

import type { SnapshotSettings, TaskBrowserConfig } from '@/electron/main/services/settings-types';

export type ThemePreference = 'light' | 'dark' | 'system';

export type EffortLevel = 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const EFFORT_LEVELS: readonly EffortLevel[] = ['off', 'low', 'medium', 'high', 'xhigh', 'max'];

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
 * 创建默认子会话 Profile 副本（与主进程 settings-types.ts 保持一致）
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

export const BROWSER_PARSE_SUB_AGENT_PROFILE_ID = 'browser-parse';

/**
 * 创建内置「浏览器解析」子会话 Profile 副本（与主进程 settings-types.ts 保持一致）
 */
export function createBrowserParseSubAgentProfile(): SubAgentProfile {
  return {
    id: BROWSER_PARSE_SUB_AGENT_PROFILE_ID,
    name: '浏览器解析',
    description:
      '网页与文章调研：公开网页查证、登录态站点（公众号/知乎/小红书等，用用户浏览器登录态）、工作区文章库读取与解析。派遣时 task 写清：目标数据、候选站点、哪些站点需要登录、交付格式。通道约束：扩展通道全局独占（并行调研串行派遣），需用户浏览器在线且 Dogear 扩展已连接。验收：结论与数据须标注来源 URL。',
    modelSelection: null,
    timeoutMinutes: 30,
    enabledBasicTools: ['read', 'write', 'edit', 'Glob', 'Grep'],
    enabledAbilities: { web: true, extension: true, article: true },
  };
}

export const EXPLORE_SUB_AGENT_PROFILE_ID = 'explore';

/**
 * 创建内置「探索」子会话 Profile 副本（与主进程 settings-types.ts 保持一致）
 */
export function createExploreSubAgentProfile(): SubAgentProfile {
  return {
    id: EXPLORE_SUB_AGENT_PROFILE_ID,
    name: '探索',
    description: '只读调研类任务：查代码在哪/怎么实现、跨文件梳理逻辑、收集资料写调研报告。不改代码、不写工作区文件；交付默认在消息正文，复杂报告才写共享区。',
    modelSelection: null,
    timeoutMinutes: 30,
    enabledBasicTools: ['read', 'bash', 'Glob', 'Grep'],
    enabledAbilities: { reference: true, memory: true, extension: false, web: true },
  };
}

export const STOCK_SUB_AGENT_PROFILE_ID = 'stock';

/**
 * 创建内置「股票」子会话 Profile 副本（与主进程 settings-types.ts 保持一致），默认停用
 */
export function createStockSubAgentProfile(): SubAgentProfile {
  return {
    id: STOCK_SUB_AGENT_PROFILE_ID,
    name: '股票',
    description: '股票分析类任务：查行情、财务指标、选股筛选、回测计算；能跑 Python 计算脚本，分析报告走共享区交付。',
    modelSelection: null,
    timeoutMinutes: 30,
    enabledBasicTools: ['read', 'write', 'edit', 'bash', 'Glob', 'Grep'],
    enabledAbilities: { stock: true },
    enabled: false,
  };
}

/** 内置预设 slug 有序集合；文案以代码模板为单一真源，与主进程镜像双份 */
export const BUILTIN_SUB_AGENT_PROFILE_IDS: readonly string[] = [
  'default',
  BROWSER_PARSE_SUB_AGENT_PROFILE_ID,
  EXPLORE_SUB_AGENT_PROFILE_ID,
  STOCK_SUB_AGENT_PROFILE_ID,
];

/** 按序生成全部内置预设模板副本 */
export function createBuiltinSubAgentProfiles(): SubAgentProfile[] {
  return [
    createDefaultSubAgentProfile(),
    createBrowserParseSubAgentProfile(),
    createExploreSubAgentProfile(),
    createStockSubAgentProfile(),
  ];
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
  /** 历史固定层能力键，装配与 UI 均不消费，仅存量数据兼容 */
  reference?: boolean;
  stock?: boolean;
  article?: boolean;
  skills?: string[];
  customSkills?: string[];
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
    permissionMode: PiPermissionMode;
    /** 无人值守：打开后权限全放行、浏览器人工介入自动跳过、断联自动重试、事件推飞书（与主进程 settings-types 保持一致） */
    unattended: boolean;
    settingSources?: ('user' | 'project')[]; // SDK 设置源
    defaultModelSelection: ModelSelection | null;
    /** 文章解析 AI 兑底任务专用模型；null 时回退 defaultModelSelection */
    parseModelSelection: ModelSelection | null;
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
    /** 人工介入卡出现时激活所在窗口并滚动定位；缺省视为 true */
    interventionFocusJump?: boolean;
    /** 会话活跃指示的活跃窗档位：会话距最近活动在此窗内则亮活跃标记；off = 不显示；缺省视为 '1h' */
    aliveWindow?: 'off' | '30m' | '1h' | '4h';
    /** 聊天向上滚动时用户消息吸顶；缺省视为 true */
    stickyUserMessage?: boolean;
    /** 左栏会话列表宽度（px）；越界 clamp 180~420；缺省视为 256；无设置页控件，拖动手柄写入 */
    conversationListWidth?: number;
    /** 笔记左栏宽度（px）；越界 clamp 220~420；缺省视为 300；笔记/任务两视图共用；无设置页控件，拖动手柄写入 */
    notesListWidth?: number;
    /** 任务面板左栏宽度（px）；越界 clamp 220~560；缺省视为 300；无设置页控件，拖动手柄写入 */
    tasksListWidth?: number;
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
  /** 任务浏览器：扩展通道断连时自动拉起；缺省视为未配置（与主进程 settings-types 保持一致） */
  taskBrowser?: TaskBrowserConfig;
  /** 用户追加的支付/网银拦截域名，与内置默认并集生效；缺省视为空 */
  paymentBlockedHosts?: string[];
  /** 应用数据备份配置；缺省分类走默认值（notes-groups/memory/tasks/app-config=daily·10·开，sessions=monthly·10·开） */
  backup?: BackupSettings;
  /** 影子快照配置；缺省走 SNAPSHOT_SETTING_DEFAULTS（类型自主进程 settings-types 导入，单一来源不另设镜像） */
  snapshot?: SnapshotSettings;
}

export const DEFAULT_SETTINGS: AppSettings = {
  ai: {
    permissionMode: 'default',
    unattended: false,
    settingSources: ['user', 'project'],
    defaultModelSelection: null,
    parseModelSelection: null,
  },
  basicToolPermissions: createDefaultBasicToolPermissions(),
  subAgent: {
    profiles: createBuiltinSubAgentProfiles(),
  },
  failover: { enabled: false, chain: [] },
  update: {
    serverUrl: 'http://localhost:9527',
  },
  ui: {
    messageDisplayMode: 'compact',
    fontSize: 'medium',
    sound: { enabled: true, volume: 0.25, backgroundOnly: true },
    interventionFocusJump: true,
    aliveWindow: '1h',
    stickyUserMessage: true,
    conversationListWidth: 256,
    notesListWidth: 300,
    tasksListWidth: 300,
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
