export type ModelTier = 'haiku' | 'sonnet' | 'opus';

export interface ModelSelection {
  profileId: string;
  /** anthropic-sdk 分支是 ModelTier 三选一；pi 分支存 piModels 里的某个模型 ID 原文 */
  tier: string;
}

/** 人设预设 */
export interface Persona {
  id: string;
  name: string;
  description?: string;
  prompt: string;
  createdAt: string; // ISO 8601
}

export interface ModelProfile {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  // 模型映射（对应 SDK 环境变量）
  haikuModel: string;    // ANTHROPIC_DEFAULT_HAIKU_MODEL
  sonnetModel: string;   // ANTHROPIC_DEFAULT_SONNET_MODEL
  opusModel: string;     // ANTHROPIC_DEFAULT_OPUS_MODEL
  // 高级配置
  apiTimeoutMs: number;                // API_TIMEOUT_MS，默认 3000000
  disableNonessentialTraffic: boolean; // CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC，默认 true
  /** 自动压缩窗口 token 数（CLAUDE_CODE_AUTO_COMPACT_WINDOW）。空/0 走 SDK 默认（= 模型实际上下文窗口）。上限受模型本身约束 */
  autoCompactWindow?: number;
  /** 主会话运行时格式；缺省视为 'anthropic-sdk'。'pi' 路由到 PiSessionManager（pi-ai + pi-agent-core） */
  apiFormat?: 'anthropic-sdk' | 'pi';
  /** 仅 apiFormat==='pi' 时生效：pi 客户端的线协议；缺省视为 'anthropic-messages' */
  piWireApi?: 'anthropic-messages' | 'openai-responses';
  /** 仅 apiFormat==='pi' 时生效：pi 分支可用的模型 ID 清单（ModelSelection.tier 取值域） */
  piModels?: string[];
}

/**
 * 检查 Profile 是否配置完整（可以用于创建会话）
 */
export function isProfileComplete(profile: ModelProfile): boolean {
  if (!profile.apiKey || !profile.baseUrl) return false;
  if (profile.apiFormat === 'pi') {
    return (profile.piModels?.length ?? 0) > 0;
  }
  return !!(profile.haikuModel && profile.sonnetModel && profile.opusModel);
}

export type EffortLevel = 'off' | 'low' | 'medium' | 'high' | 'max';

export type PiPermissionMode = 'default' | 'autoExecute';

export type BasicToolName = 'read' | 'write' | 'edit' | 'bash' | 'Glob' | 'Grep' | 'Skill';
export type BasicToolPermission = 'ask' | 'allow';
export type BasicToolPermissions = Record<BasicToolName, BasicToolPermission>;

export const BASIC_TOOL_NAMES: readonly BasicToolName[] = ['read', 'write', 'edit', 'bash', 'Glob', 'Grep', 'Skill'];

export function createDefaultBasicToolPermissions(): BasicToolPermissions {
  return { read: 'ask', write: 'ask', edit: 'ask', bash: 'ask', Glob: 'ask', Grep: 'ask', Skill: 'ask' };
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
  };
  basicToolPermissions: BasicToolPermissions;
  personas: Persona[]; // 人设列表
  profiles: Record<string, ModelProfile>;
  /** 子会话派遣默认配置 */
  subAgent: {
    /** 默认模型；空时回退到 ai.defaultModelSelection */
    modelSelection?: ModelSelection | null;
    /** 单个子会话最长允许跑的分钟数，默认 30 */
    timeoutMinutes: number;
    /** 提示缓存策略；缺省 '5m'。子会话通常一轮跑完，1h 只在极特殊场景有价值 */
    cachePolicy?: '5m' | '1h';
    /** 是否注入工作区用户画像 core-profile.md；缺省 false */
    loadCoreProfile?: boolean;
    /** 是否加载 .claude/skills（brainstorming / staged-impl 等）；缺省 false */
    loadSkills?: boolean;
    /** 是否挂载 dogear-article-parse；缺省 false */
    loadArticleParse?: boolean;
  };
  /** 智能分类设置 */
  smartCategory?: {
    enabled?: boolean;          // 默认 true
    threshold?: number;         // 0–1，默认 0.5
    maxCategories?: number;     // 默认 10
  };
  /** 启用的工具包名称列表，如 ['stock-analysis', 'stock-quote']。未列出的不会注册其 MCP server。 */
  enabledToolPacks?: string[];
  /** 热更新服务配置 */
  update?: {
    serverUrl: string;
  };
  ui?: {
    messageDisplayMode: 'compact' | 'detailed'; // 工具/思考块显示模式
  };
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
  },
  basicToolPermissions: createDefaultBasicToolPermissions(),
  smartCategory: { enabled: true, threshold: 0.5, maxCategories: 10 },
  personas: [],
  subAgent: {
    timeoutMinutes: 30,
    cachePolicy: '5m',
    loadCoreProfile: false,
    loadSkills: false,
    loadArticleParse: false,
  },
  enabledToolPacks: [],
  update: {
    serverUrl: 'http://localhost:9527',
  },
  ui: {
    messageDisplayMode: 'compact',
  },
  profiles: {
    default: {
      id: 'default',
      name: '默认',
      apiKey: '',
      baseUrl: '',
      haikuModel: '',
      sonnetModel: '',
      opusModel: '',
      apiTimeoutMs: 3000000,
      disableNonessentialTraffic: true,
    },
  },
};
