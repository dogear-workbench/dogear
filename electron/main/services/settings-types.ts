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

export interface ModelProfile {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  apiTimeoutMs: number;
  /** 自动压缩触发比例（50–95），缺省 80；阈值 = 上下文窗口 × 百分比 */
  autoCompactPercent?: number;
  /** pi 客户端的线协议；缺省视为 'anthropic-messages' */
  piWireApi?: 'anthropic-messages' | 'openai-responses';
  /** 可用的模型清单（ModelSelection.tier 取值域）；label 为显示名，缺省显示 id */
  piModels?: Array<{ id: string; label?: string }>;
}

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type PiPermissionMode = 'default' | 'autoExecute';

export type BasicToolName = 'read' | 'write' | 'edit' | 'bash' | 'Glob' | 'Grep' | 'Skill';
export type BasicToolPermission = 'ask' | 'allow';
export type BasicToolPermissions = Record<BasicToolName, BasicToolPermission>;

export const BASIC_TOOL_NAMES: readonly BasicToolName[] = ['read', 'write', 'edit', 'bash', 'Glob', 'Grep', 'Skill'];

export function createDefaultBasicToolPermissions(): BasicToolPermissions {
  return { read: 'ask', write: 'ask', edit: 'ask', bash: 'ask', Glob: 'ask', Grep: 'ask', Skill: 'ask' };
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
    /** 推理努力程度。null/undefined = 不传给 SDK，由模型自带默认决定 */
    effort?: EffortLevel | null;
    permissionMode: PiPermissionMode;
    settingSources?: ('user' | 'project')[];
    defaultModelSelection: ModelSelection | null;
    digestModelSelection: ModelSelection | null;
    reviewModelSelection: ModelSelection | null;
    categorizeModelSelection: ModelSelection | null;
  };
  basicToolPermissions: BasicToolPermissions;
  profiles: Record<string, ModelProfile>;
  /** 智能分类设置 */
  smartCategory?: {
    enabled?: boolean;          // 默认 true
    threshold?: number;         // 0–1，默认 0.5
    maxCategories?: number;     // 默认 10
  };
  /** 子会话派遣 Profile 列表 */
  subAgent: {
    profiles: SubAgentProfile[];
  };
  /** 热更新服务配置 */
  update?: {
    serverUrl: string;
  };
  /** Bash 命令 RTK 前缀重写开关（需系统安装 rtk 才生效） */
  rtkEnabled?: boolean;
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
    digestModelSelection: null,
    reviewModelSelection: null,
    categorizeModelSelection: null,
  },
  basicToolPermissions: createDefaultBasicToolPermissions(),
  subAgent: {
    profiles: [createDefaultSubAgentProfile()],
  },
  update: {
    serverUrl: 'http://localhost:9527',
  },
  rtkEnabled: false,
  profiles: {
    default: {
      id: 'default',
      name: '默认',
      apiKey: '',
      baseUrl: '',
      apiTimeoutMs: 3000000,
    },
  },
  smartCategory: { enabled: true, threshold: 0.5, maxCategories: 10 },
  migrated: {},
};

// ============================================================
// 纯函数
// ============================================================

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
    description: '标准派遣会话，具备全部基础工具和交付通信能力',
    modelSelection: null,
    timeoutMinutes: 30,
    enabledBasicTools: ['read', 'write', 'edit', 'bash', 'Glob', 'Grep'],
    enabledAbilities: {},
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
