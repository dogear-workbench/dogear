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
  /** 可用的模型清单（ModelSelection.tier 取值域）；label 为显示名，缺省显示 id；contextWindow 为手填生效窗口，优先于目录查表；pricing 为手填价格（元/百万 tokens），优先于目录默认价；supportsVision 标记视觉能力（未标记 = 假定无视觉） */
  piModels?: Array<{ id: string; label?: string; contextWindow?: number; maxTokens?: number; pricing?: ModelPricing; supportsVision?: boolean }>;
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
    /** 推理努力程度。null/undefined = 不传给 SDK，由模型自带默认决定 */
    effort?: EffortLevel | null;
    permissionMode: PiPermissionMode;
    settingSources?: ('user' | 'project')[];
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
  /** 网页 AI 站点列表；缺省视为 DEFAULT_WEB_AI_SITES */
  webAiSites?: WebAiSite[];
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
    visionModelSelection: null,
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
  webAiSites: DEFAULT_WEB_AI_SITES,
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
 * 创建内置「浏览器解析」子会话 Profile 副本；normalize 保证存在，UI 禁止删除（同 default）
 */
export function createBrowserParseSubAgentProfile(): SubAgentProfile {
  return {
    id: BROWSER_PARSE_SUB_AGENT_PROFILE_ID,
    name: '浏览器解析',
    description:
      '浏览器与扩展双通道调研 + 工作区文章读取与解析：公开网页用内嵌浏览器（dogear__browser__*），登录态站点（如小红书）用扩展通道（dogear__extension__*，用户真实浏览器）；扩展通道同一时间仅一个会话可用，并行调研请改串行派遣。文章解析随 article 能力启用，article-parser skill 直通无需单独配置。探索方法论见 browser-exploration skill，随浏览器方法论包与 Profile skill 细选挂载。',
    modelSelection: null,
    timeoutMinutes: 30,
    enabledBasicTools: ['read', 'write', 'edit', 'Glob', 'Grep'],
    enabledAbilities: { web: true, browser: true, extension: true, article: true, skills: ['browser-exploration'] },
  };
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

/** 同步范围项 id（目录 7 项 + 工作区外部数据 2 项 + 文件 3 项 + 可选 2 项；字符串字面量联合，disabledSyncItems 白名单） */
export type SyncItemId =
  | 'workspaces'
  | 'conversations'
  | 'memory'
  | 'usage'
  | 'article-parser'
  | 'site-knowledge'
  | 'run-history'
  | 'tasks'
  | 'articles'
  | 'settings.json'
  | 'plans.json'
  | 'notifications.json'
  | 'stocks'
  | 'feishu';

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
 * 同步范围 14 项：目录 7 项 + 工作区外部数据 2 项（tasks/articles，虚拟路径 __ws-external__/{wsid}/）+ 文件 3 项 + 可选目录 2 项。
 * stocks/feishu 的开关联动 syncStocksData/syncFeishu 独立布尔键（避免迁移），不进 disabledSyncItems 生效路径。
 */
export const SYNC_ITEM_IDS: readonly SyncItemMeta[] = [
  { id: 'workspaces', name: '工作区数据', description: '工作区笔记、文档与会话数据；关闭后所有工作区数据不跨设备' },
  { id: 'conversations', name: '会话记录', description: 'AI 会话历史' },
  { id: 'memory', name: '记忆库', description: '跨会话记忆数据' },
  { id: 'usage', name: '使用统计', description: '模型用量与使用统计' },
  { id: 'article-parser', name: '文章解析', description: '文章解析结果数据' },
  { id: 'site-knowledge', name: '站点知识', description: '站点知识库数据' },
  { id: 'run-history', name: '运行历史', description: '运行记录数据' },
  { id: 'tasks', name: '任务', description: '工作区计划栏任务数据；关闭后任务不跨设备' },
  { id: 'articles', name: '文章库', description: '工作区文章实体库（原文与元数据）；关闭后文章不跨设备' },
  { id: 'settings.json', name: '应用设置', description: '全局设置（含同步配置本身，必选）', required: true },
  { id: 'plans.json', name: '任务数据', description: '定时任务数据；关闭后任务不跨设备' },
  { id: 'notifications.json', name: '通知记录', description: '通知历史；关闭后通知不跨设备' },
  { id: 'stocks', name: '行情数据', description: '行情缓存较大且可重新拉取；自选股配置始终同步' },
  { id: 'feishu', name: '飞书数据', description: '飞书相关缓存数据' },
] as const;

const SYNC_ITEM_ID_SET: ReadonlySet<string> = new Set(SYNC_ITEM_IDS.map((m) => m.id));
const REQUIRED_SYNC_ITEM_IDS: ReadonlySet<string> = new Set(
  SYNC_ITEM_IDS.filter((m) => m.required === true).map((m) => m.id),
);

/**
 * settings 顶层字段跨设备传播白名单（A 白名单传播制，草案待后续 step 逐字段核对定稿）：
 * 仅列出的字段三方合并跨设备，其余（含未知新字段）一律保本端；
 * 保本端：snapshot/backup/ui/profiles/browserProxyServer/migrated/webMcpApiKey/syncOptions。
 * 原草案里的 enabledToolPacks 已迁工作区 config（不再属于 settings），不在此列
 */
export const SETTINGS_SYNC_FIELDS = [
  'ai',
  'basicToolPermissions',
  'subAgent',
  'failover',
  'update',
  'appearance',
  'browserSearchEngine',
  'webAiSites',
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
 * webAiSites 节归一化：非对象/缺 id·name·url 的条目丢弃，清洗后为空回默认三项（切换器与主进程兑底都依赖非空列表）；
 * url 的 http(s) 合法性由设置页 UI 校验提示，不在 normalize 层拦截，避免与设置页防抖写回互搏
 */
export function normalizeWebAiSites(raw: unknown): WebAiSite[] {
  const sites: WebAiSite[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const s = item as Record<string, unknown>;
      if (typeof s.id !== 'string' || s.id === '') continue;
      if (typeof s.name !== 'string' || s.name === '') continue;
      if (typeof s.url !== 'string' || s.url === '') continue;
      sites.push({ id: s.id, name: s.name, url: s.url });
    }
  }
  return sites.length > 0 ? sites : structuredClone(DEFAULT_WEB_AI_SITES);
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
