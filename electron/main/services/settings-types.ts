/**
 * 设置相关的纯类型定义和纯函数
 * 此文件无 electron 依赖，可在 Worker 线程中安全导入
 */
import { DATA_ITEMS, syncItemMetas } from './data-items.js';

// ============================================================
// 类型定义（与 types/settings.ts 保持一致，主进程独立定义）
// ============================================================

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
  apiTimeoutMs: number;
  /** 自动压缩触发比例（50–95），缺省 80；阈值 = 上下文窗口 × 百分比 */
  autoCompactPercent?: number;
  /** pi 客户端的线协议；缺省视为 'anthropic-messages' */
  piWireApi?: PiWireApi;
  /** 可用的模型清单（ModelSelection.tier 取值域）；label 为显示名，缺省显示 id；contextWindow 为手填生效窗口，优先于目录查表；pricing 为手填价格（元/百万 tokens），优先于目录默认价；supportsVision 标记视觉能力（未标记 = 假定无视觉） */
  piModels?: Array<{ id: string; label?: string; contextWindow?: number; maxTokens?: number; pricing?: ModelPricing; supportsVision?: boolean; /** 模型预设推理力度；缺省/null = 关闭 */ effort?: EffortLevel | null }>;
}

export type EffortLevel = 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const EFFORT_LEVELS: readonly EffortLevel[] = ['off', 'low', 'medium', 'high', 'xhigh', 'max'];

export type ThemePreference = 'light' | 'dark' | 'system';

export type PiPermissionMode = 'default' | 'autoExecute';

export type BrowserSearchEngine = 'auto' | 'google' | 'bing';

export type TaskBrowserId = 'chrome' | 'edge';

/** 任务浏览器：扩展通道断连时自动拉起的目标浏览器与账户（profileDirectory 为 User Data 下的目录名） */
export interface TaskBrowserConfig {
  browser: TaskBrowserId;
  profileDirectory: string;
  profileName: string;
}

/** taskBrowser 节归一化：形状非法整体丢弃（视为未配置），profile 有效性由 listTaskBrowsers/launchTaskBrowser 运行时校验 */
export function normalizeTaskBrowser(raw: unknown): TaskBrowserConfig | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  if (obj.browser !== 'chrome' && obj.browser !== 'edge') return undefined;
  if (typeof obj.profileDirectory !== 'string' || obj.profileDirectory === '') return undefined;
  if (typeof obj.profileName !== 'string' || obj.profileName === '') return undefined;
  return { browser: obj.browser, profileDirectory: obj.profileDirectory, profileName: obj.profileName };
}

export type BasicToolName = 'read' | 'write' | 'edit' | 'bash' | 'Glob' | 'Grep' | 'Skill';
export type BasicToolPermission = 'ask' | 'allow';
export type BasicToolPermissions = Record<BasicToolName, BasicToolPermission>;

export const BASIC_TOOL_NAMES: readonly BasicToolName[] = ['read', 'write', 'edit', 'bash', 'Glob', 'Grep', 'Skill'];

export const BROWSER_PARSE_SUB_AGENT_PROFILE_ID = 'browser-parse';
export const EXPLORE_SUB_AGENT_PROFILE_ID = 'explore';
export const STOCK_SUB_AGENT_PROFILE_ID = 'stock';

/** 内置预设 slug 有序集合（default/browser-parse/explore/stock）；文案以代码模板为单一真源 */
export const BUILTIN_SUB_AGENT_PROFILE_IDS: readonly string[] = [
  'default',
  BROWSER_PARSE_SUB_AGENT_PROFILE_ID,
  EXPLORE_SUB_AGENT_PROFILE_ID,
  STOCK_SUB_AGENT_PROFILE_ID,
];

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

// 与 data-registry 的 BACKUP_CATEGORY_KEYS 同步；此文件承诺无 electron 依赖（Worker/前端导入），不能 import registry（其依赖 settings-service→electron）
export const BACKUP_SETTING_KEYS = ['notes-groups', 'memory', 'tasks', 'sessions', 'app-config'] as const;
export type BackupSettingCategoryKey = (typeof BACKUP_SETTING_KEYS)[number];
export type BackupSettingFrequency = 'daily' | 'weekly' | 'monthly' | 'manual';
export const BACKUP_SETTING_FREQUENCIES: readonly BackupSettingFrequency[] = ['daily', 'weekly', 'monthly', 'manual'];

/** 与 backup-service 的 BackupCategoryConfig 同形（enabled/frequency/keep），settings 节可直传服务层 */
export interface BackupCategorySetting {
  enabled: boolean;
  frequency: BackupSettingFrequency;
  keep: number;
}

/** 备份分类默认配置唯一源：backup-service BACKUP_CATEGORIES 与前端 backup-meta 均从此导入 */
export const BACKUP_CATEGORY_DEFAULTS: Record<BackupSettingCategoryKey, BackupCategorySetting> = {
  'notes-groups': { enabled: true, frequency: 'daily', keep: 10 },
  memory: { enabled: true, frequency: 'daily', keep: 10 },
  tasks: { enabled: true, frequency: 'daily', keep: 10 },
  sessions: { enabled: true, frequency: 'monthly', keep: 10 },
  'app-config': { enabled: true, frequency: 'daily', keep: 10 },
};

export interface BackupSettings {
  categories: Record<BackupSettingCategoryKey, BackupCategorySetting>;
}

/** 影子快照保留窗口：近 recentDays 天全留 → recentDays+1~totalDays 每天留最后一条 → 超过 totalDays 丢弃 */
export interface SnapshotRetention {
  recentDays: number;
  totalDays: number;
}

export interface SnapshotSettings {
  /** 单文件大小阈值（字节），超过不进快照 */
  maxFileSizeBytes: number;
  /** 按工作区的排除路径清单：键为工作区 id，值为相对该工作区根的顶层锚定路径（命中即整子树不进快照）；未列工作区视为空 */
  excludedPaths: Record<string, string[]>;
  retention: SnapshotRetention;
  /** 关闭快照的工作区 id；缺省/空 = 全部开启 */
  disabledWorkspaces?: string[];
  /** 名字级 → 路径级对照扫描迁移已完成标记；真值后启动迁移不再重扫 */
  exclusionScanDone?: boolean;
}

/** 影子快照默认配置唯一源：shadow.ts 与前端设置页均从此导入 */
export const SNAPSHOT_SETTING_DEFAULTS: SnapshotSettings = {
  maxFileSizeBytes: 8 * 1024 * 1024,
  excludedPaths: {},
  retention: { recentDays: 7, totalDays: 30 },
  disabledWorkspaces: [],
};

/** 名字级时代的默认排除名单，仅作对照扫描种子（迁移/新工作区注册/恢复默认重扫），不参与运行时判定 */
export const DEFAULT_SNAPSHOT_DIR_NAMES = [
  'node_modules',
  'out',
  'dist',
  'release',
  'tmp',
  '.dogear',
  '.git',
  'update-server',
  'release2',
] as const;

/** 已配对的同步对端；secret 为两端共享的 hex 密钥，之后请求经 header 校验 */
export interface PairedDevice {
  deviceId: string;
  deviceName?: string;
  secret: string;
  pairedAt: number;
}

/** 局域网交接同步选项；syncStocksData/syncFeishu 默认 false（行情缓存与飞书数据默认不随同步搬运） */
export interface SyncOptions {
  deviceName?: string;
  syncStocksData: boolean;
  syncFeishu: boolean;
  pairedDevices: PairedDevice[];
  /** 关闭的同步项 id（SyncItemId 白名单）；缺省/[] = 全开。stocks/feishu 由独立布尔键控制，不在此生效 */
  disabledSyncItems?: string[];
  /** .conflict-* 冲突留底副本是否跨设备同步；默认 false（副本仅留在产生冲突的设备上） */
  syncConflictCopies?: boolean;
  /** shadow-git/ 影子快照仓库是否同步；默认 false（git 内部文件跨端 mtime 裁决覆盖有损坏风险） */
  syncShadowGit?: boolean;
  /** 用户勾选跨设备同步的工作区文件（键为工作区 id，值为相对该工作区根的路径列表）；缺省/{} = 无勾选；随本节走 rev-LWW，两端必须一致 */
  userSyncPaths?: Record<string, string[]>;
  /** 范围字段修订号：本端改范围字段时自增（applySyncOptionsPatch 维护）；merge 取 rev 大的一端整组采纳 */
  syncOptionsRev?: number;
}

export interface AppSettings {
  ai: {
    permissionMode: PiPermissionMode;
    /** 无人值守：打开后权限全放行、浏览器人工介入自动跳过、断联自动重试、事件推飞书 */
    unattended: boolean;
    settingSources?: ('user' | 'project')[];
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
    messageDisplayMode: 'compact' | 'detailed';
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
  /** 受控浏览器代理地址（host:port，可含 http/socks5 前缀）；空/缺省 = 禁用代理引擎，搜索仅 Bing */
  browserProxyServer?: string;
  /** GLM Coding Plan API Key（联网搜索 MCP 工具用）；空/缺省 = 未配置，工具调用返回提示 */
  webMcpApiKey?: string;
  /** 浏览器搜索默认引擎；缺省视为 auto（代理可用时用 Google） */
  browserSearchEngine: BrowserSearchEngine;
  /** 任务浏览器：扩展通道断连时自动拉起；缺省视为未配置（扩展命令失败返回引导文案） */
  taskBrowser?: TaskBrowserConfig;
  /** 用户追加的支付/网银拦截域名，与内置默认并集生效；缺省视为空 */
  paymentBlockedHosts?: string[];
  /** 一次性迁移标记 */
  migrated?: {
    workspaceConfig?: boolean;
  };
  /** 应用数据备份配置；缺省分类走默认值（notes-groups/memory/tasks/app-config=daily·10·开，sessions=monthly·10·开） */
  backup?: BackupSettings;
  /** 影子快照配置；缺省走 SNAPSHOT_SETTING_DEFAULTS */
  snapshot?: SnapshotSettings;
  /** 局域网交接同步配置；缺省字段走默认值（可选项全关、无配对设备） */
  syncOptions?: SyncOptions;
}

// ============================================================
// 常量
// ============================================================

export const DEFAULT_SETTINGS: AppSettings = {
  ai: {
    permissionMode: 'default',
    unattended: false,
    settingSources: ['user', 'project'],
    defaultModelSelection: null,
    parseModelSelection: null,
    visionModelSelection: null,
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
  migrated: {},
  backup: {
    categories: { ...BACKUP_CATEGORY_DEFAULTS },
  },
  snapshot: structuredClone(SNAPSHOT_SETTING_DEFAULTS),
  syncOptions: {
    deviceName: '',
    syncStocksData: false,
    syncFeishu: false,
    pairedDevices: [],
    disabledSyncItems: [],
    syncConflictCopies: false,
    syncShadowGit: false,
    userSyncPaths: {},
    syncOptionsRev: 0,
  },
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
 * 创建内置「浏览器解析」子会话 Profile 副本；normalize 保证存在并接管文案，UI 禁止删除（同 default）
 */
export function createBrowserParseSubAgentProfile(): SubAgentProfile {
  return {
    id: BROWSER_PARSE_SUB_AGENT_PROFILE_ID,
    name: '浏览器解析',
    description:
      '网页与文章调研：公开网页查证、登录态站点（公众号/知乎/小红书等，用用户浏览器登录态）、网页文章抓取入库与摘要、工作区文章库读取与深度解析（含自进化解析工具集，可修静态解析失败的文章）。派遣时 task 写清：目标数据、候选站点、哪些站点需要登录、交付格式。通道约束：扩展通道全局独占（并行调研串行派遣），需用户浏览器在线且 Dogear 扩展已连接。验收：结论与数据须标注来源 URL。',
    modelSelection: null,
    timeoutMinutes: 30,
    enabledBasicTools: ['read', 'write', 'edit', 'Glob', 'Grep'],
    enabledAbilities: { web: true, extension: true, article: true },
  };
}

/**
 * 创建内置「探索」子会话 Profile 副本；收编自用户自建配置，能力域照抄（extension 显式 false = 产品收敛结果）
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

/**
 * 创建内置「股票」子会话 Profile 副本；收编自用户自建配置，默认停用（enabled: false）
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

/** 按序生成全部内置预设模板副本 */
export function createBuiltinSubAgentProfiles(): SubAgentProfile[] {
  return [
    createDefaultSubAgentProfile(),
    createBrowserParseSubAgentProfile(),
    createExploreSubAgentProfile(),
    createStockSubAgentProfile(),
  ];
}

/**
 * backup 节归一化：非法输入归一为全默认，单字段非法回落该分类默认，不丢弃其他合法字段
 */
export function normalizeBackupSettings(raw: unknown): BackupSettings {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const catsRaw =
    obj.categories && typeof obj.categories === 'object' && !Array.isArray(obj.categories)
      ? (obj.categories as Record<string, unknown>)
      : {};
  const categories = {} as BackupSettings['categories'];
  for (const key of BACKUP_SETTING_KEYS) {
    const c = catsRaw[key] && typeof catsRaw[key] === 'object' ? (catsRaw[key] as Record<string, unknown>) : {};
    const def = DEFAULT_SETTINGS.backup!.categories[key];
    categories[key] = {
      enabled: typeof c.enabled === 'boolean' ? c.enabled : def.enabled,
      frequency: BACKUP_SETTING_FREQUENCIES.includes(c.frequency as BackupSettingFrequency)
        ? (c.frequency as BackupSettingFrequency)
        : def.frequency,
      keep: typeof c.keep === 'number' && Number.isInteger(c.keep) && c.keep >= 1 ? c.keep : def.keep,
    };
  }
  return { categories };
}

/**
 * 相对路径列表条目归一化：反斜杠转斜杠、剥 ./ 前缀、去首尾斜杠、空串丢弃、按首现顺序去重；非数组输入返回空数组。
 * snapshot excludedPaths 与 syncOptions userSyncPaths 共用同一清洗规则，两处分叉即为 bug
 */
function cleanRelPathList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const p = item.replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+|\/+$/g, '');
    if (p === '' || seen.has(p)) continue;
    seen.add(p);
  }
  return [...seen];
}

/**
 * snapshot 节归一化：非法输入归一为全默认，单字段非法回落默认，不丢弃其他合法字段；
 * excludedPaths 按工作区归一：值非数组的键回落空数组（不丢弃其他键），条目反斜杠转斜杠、剥 ./ 前缀、
 * 去首尾斜杠、去重，否则段前缀判定与 pathspec 拼接会静默失效；
 * 旧名字级 excludeDirs 字段直接忽略（对照迁移由启动扫描承担，不在此转换）；
 * disabledWorkspaces 清洗非空字符串并按首现顺序去重；retention.totalDays 不低于 recentDays
 */
export function normalizeSnapshotSettings(raw: unknown): SnapshotSettings {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const def = SNAPSHOT_SETTING_DEFAULTS;
  const retentionRaw =
    obj.retention && typeof obj.retention === 'object' && !Array.isArray(obj.retention)
      ? (obj.retention as Record<string, unknown>)
      : {};
  const recentDays =
    typeof retentionRaw.recentDays === 'number' && Number.isInteger(retentionRaw.recentDays) && retentionRaw.recentDays >= 1
      ? retentionRaw.recentDays
      : def.retention.recentDays;
  const totalDaysRaw =
    typeof retentionRaw.totalDays === 'number' && Number.isInteger(retentionRaw.totalDays) && retentionRaw.totalDays >= 1
      ? retentionRaw.totalDays
      : def.retention.totalDays;
  const cleanStringList = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    for (const item of value) {
      if (typeof item !== 'string' || item === '' || seen.has(item)) continue;
      seen.add(item);
    }
    return [...seen];
  };
  const pathsRaw =
    obj.excludedPaths && typeof obj.excludedPaths === 'object' && !Array.isArray(obj.excludedPaths)
      ? (obj.excludedPaths as Record<string, unknown>)
      : {};
  const excludedPaths: Record<string, string[]> = {};
  for (const [wsId, value] of Object.entries(pathsRaw)) {
    if (wsId === '') continue;
    excludedPaths[wsId] = cleanRelPathList(value);
  }
  return {
    maxFileSizeBytes:
      typeof obj.maxFileSizeBytes === 'number' && Number.isInteger(obj.maxFileSizeBytes) && obj.maxFileSizeBytes >= 1
        ? obj.maxFileSizeBytes
        : def.maxFileSizeBytes,
    excludedPaths,
    retention: { recentDays, totalDays: Math.max(totalDaysRaw, recentDays) },
    disabledWorkspaces: cleanStringList(obj.disabledWorkspaces),
    ...(obj.exclusionScanDone === true ? { exclusionScanDone: true } : {}),
  };
}

/**
 * 同步范围项 id 与元数据均从数据字典派生（data-items.ts DATA_ITEMS 单一来源），此处只做类型收窄与 re-export；
 * 历史手写 14 项清单已废，新增同步项在字典条目上挂 syncItemId 即自动进 UI 与白名单
 */
export type SyncItemId = Extract<(typeof DATA_ITEMS)[number], { syncItemId: string }>['syncItemId'];

/** 同步范围可配置项元数据（UI 展示 + disabledSyncItems 白名单共用） */
export interface SyncItemMeta {
  id: SyncItemId;
  /** UI 展示名 */
  name: string;
  /** UI 说明文案 */
  description: string;
  /** 必选项（settings.json）：UI 置灰标注，不可关闭 */
  required?: boolean;
}

/**
 * 同步范围项（目录 + 工作区子树 + 文件 + 可选目录），全部由字典条目派生。
 * stocks/feishu 的开关联动 syncStocksData/syncFeishu 独立布尔键（避免迁移），不进 disabledSyncItems 生效路径。
 * cast 安全性：派生 id 集合与 SyncItemId 联合的一致性由 data-items.test 锁定
 */
export const SYNC_ITEM_IDS: readonly SyncItemMeta[] = syncItemMetas() as readonly SyncItemMeta[];

const SYNC_ITEM_ID_SET: ReadonlySet<string> = new Set(SYNC_ITEM_IDS.map((m) => m.id));
const REQUIRED_SYNC_ITEM_IDS: ReadonlySet<string> = new Set(
  SYNC_ITEM_IDS.filter((m) => m.required === true).map((m) => m.id),
);

/**
 * settings 顶层字段跨设备传播白名单（A 白名单传播制，Step 5 逐字段核对定稿，16 顶层字段全覆盖）：
 * 仅列出的字段三方合并跨设备，其余（含未知新字段）一律保本端；
 * 保本端：snapshot/backup/ui/profiles/browserProxyServer/migrated/webMcpApiKey/syncOptions。
 * 原草案里的 enabledToolPacks 已迁工作区 config（不再属于 settings），不在此列；webAiSites 随网页 AI 下架删除；
 * ai 核对无 API key（key 在 profiles.apiKey 与 webMcpApiKey，均已保本端），模型选择仅为 profileId 引用
 */
export const SETTINGS_SYNC_FIELDS = [
  'ai',
  'basicToolPermissions',
  'subAgent',
  'failover',
  'update',
  'appearance',
  'browserSearchEngine',
  'paymentBlockedHosts',
] as const satisfies readonly (keyof AppSettings)[];

export type SettingsSyncField = (typeof SETTINGS_SYNC_FIELDS)[number];

/**
 * disabledSyncItems 清洗：只保留 SYNC_ITEM_IDS 白名单内的字符串 id（防路径穿越/注入），按首现顺序去重。
 * required 必选项（settings.json）不接受关闭——否则 rev 大的对端可经合并剥夺本端必选同步项（U6）。
 * 非数组输入返回空数组。
 */
export function normalizeDisabledSyncItems(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || !SYNC_ITEM_ID_SET.has(item) || seen.has(item)) continue;
    if (REQUIRED_SYNC_ITEM_IDS.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

/**
 * userSyncPaths 归一化：键（工作区 id）非空字符串，值必须为数组否则整键丢弃（形态非法）；
 * 条目清洗同 snapshot excludedPaths（cleanRelPathList）；清洗后为空数组的键保留（= 该工作区无勾选）
 */
export function normalizeUserSyncPaths(raw: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [wsId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (wsId === '' || !Array.isArray(value)) continue;
    out[wsId] = cleanRelPathList(value);
  }
  return out;
}

/**
 * syncOptions 节归一化：开关仅接受布尔 true；pairedDevices 校验 deviceId/secret（64 位 hex）并按 deviceId 去重，
 * secret 统一小写避免两端大小写不一致比对失败；非法条目丢弃，不丢弃其他合法字段。
 * 范围字段补默认值（disabledSyncItems=[] 全开 / syncConflictCopies=false / syncShadowGit=false /
 * userSyncPaths={} 无勾选 / syncOptionsRev=0），
 * 输出恒含全部键（旧版本 settings.json 首次 load 后即补齐写回）。
 */
export function normalizeSyncOptions(raw: unknown): SyncOptions {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const devicesRaw = Array.isArray(obj.pairedDevices) ? obj.pairedDevices : [];
  const pairedDevices: PairedDevice[] = [];
  const seen = new Set<string>();
  for (const item of devicesRaw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const d = item as Record<string, unknown>;
    if (typeof d.deviceId !== 'string' || d.deviceId === '') continue;
    if (typeof d.secret !== 'string' || !/^[0-9a-f]{64}$/i.test(d.secret)) continue;
    if (seen.has(d.deviceId)) continue;
    seen.add(d.deviceId);
    pairedDevices.push({
      deviceId: d.deviceId,
      ...(typeof d.deviceName === 'string' && d.deviceName !== '' ? { deviceName: d.deviceName } : {}),
      secret: d.secret.toLowerCase(),
      pairedAt: typeof d.pairedAt === 'number' && Number.isFinite(d.pairedAt) ? d.pairedAt : Date.now(),
    });
  }
  return {
    deviceName: typeof obj.deviceName === 'string' ? obj.deviceName : '',
    syncStocksData: obj.syncStocksData === true,
    syncFeishu: obj.syncFeishu === true,
    pairedDevices,
    disabledSyncItems: normalizeDisabledSyncItems(obj.disabledSyncItems),
    syncConflictCopies: obj.syncConflictCopies === true,
    syncShadowGit: obj.syncShadowGit === true,
    userSyncPaths: normalizeUserSyncPaths(obj.userSyncPaths),
    syncOptionsRev:
      typeof obj.syncOptionsRev === 'number' && Number.isInteger(obj.syncOptionsRev) && obj.syncOptionsRev >= 0
        ? obj.syncOptionsRev
        : 0,
  };
}

/**
 * paymentBlockedHosts 归一化：字符串 trim + 小写，`*.example.com` 归一为 `example.com`（拦截语义本就含自身与子域），
 * 非法项丢弃、按首现顺序去重；非数组输入返回空数组
 */
export function normalizePaymentBlockedHosts(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    let host = item.trim().toLowerCase();
    if (host.startsWith('*.')) host = host.slice(2);
    if (host === '' || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(host)) continue;
    if (seen.has(host)) continue;
    seen.add(host);
    out.push(host);
  }
  return out;
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
