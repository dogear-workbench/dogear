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
  /** 自动压缩窗口 token 数（CLAUDE_CODE_AUTO_COMPACT_WINDOW）。空/0 走 SDK 默认（= 模型实际上下文窗口）。上限受模型本身约束 */
  autoCompactWindow?: number;
  /** pi 客户端的线协议；缺省视为 'anthropic-messages' */
  piWireApi?: 'anthropic-messages' | 'openai-responses';
  /** 可用的模型 ID 清单（ModelSelection.tier 取值域） */
  piModels?: string[];
}

/**
 * 检查 Profile 是否配置完整（可以用于创建会话）
 */
export function isProfileComplete(profile: ModelProfile): boolean {
  if (!profile.apiKey || !profile.baseUrl) return false;
  return (profile.piModels?.length ?? 0) > 0;
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

export interface SubAgentEnabledAbilities {
  memory?: boolean;
  stock?: boolean;
  article?: boolean;
  skills?: string[];
  customSkills?: string[];
  groupFiles?: boolean;
  reference?: boolean;
}

export interface SubAgentProfile {
  id: string;
  name: string;
  description: string;
  modelSelection?: ModelSelection | null;
  /** 单个子会话最长允许跑的分钟数，默认 30 */
  timeoutMinutes: number;
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
  };
  basicToolPermissions: BasicToolPermissions;
  profiles: Record<string, ModelProfile>;
  /** 子会话派遣 Profile 列表 */
  subAgent: {
    profiles: SubAgentProfile[];
  };
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
  /** Bash 命令 RTK 前缀重写开关（需系统安装 rtk 才生效） */
  rtkEnabled?: boolean;
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
  subAgent: {
    profiles: [createDefaultSubAgentProfile()],
  },
  update: {
    serverUrl: 'http://localhost:9527',
  },
  rtkEnabled: false,
  ui: {
    messageDisplayMode: 'compact',
  },
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
