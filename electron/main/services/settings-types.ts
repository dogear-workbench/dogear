/**
 * 设置相关的纯类型定义和纯函数
 * 此文件无 electron 依赖，可在 Worker 线程中安全导入
 */

// ============================================================
// 类型定义（与 types/settings.ts 保持一致，主进程独立定义）
// ============================================================

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
  haikuModel: string;
  sonnetModel: string;
  opusModel: string;
  apiTimeoutMs: number;
  disableNonessentialTraffic: boolean;
  /** 自动压缩窗口 token 数（CLAUDE_CODE_AUTO_COMPACT_WINDOW）。空/0 走 SDK 默认（= 模型实际上下文窗口） */
  autoCompactWindow?: number;
  /** 主会话运行时格式；缺省视为 'anthropic-sdk'。'pi' 路由到 PiSessionManager（pi-ai + pi-agent-core） */
  apiFormat?: 'anthropic-sdk' | 'pi';
  /** 仅 apiFormat==='pi' 时生效：pi 客户端的线协议；缺省视为 'anthropic-messages' */
  piWireApi?: 'anthropic-messages' | 'openai-responses';
  /** 仅 apiFormat==='pi' 时生效：pi 分支可用的模型 ID 清单（ModelSelection.tier 取值域） */
  piModels?: string[];
}

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type ThinkingType = 'adaptive' | 'enabled' | 'disabled';

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
    /** 推理努力程度。null/undefined = 不传给 SDK，由模型自带默认决定 */
    effort?: EffortLevel | null;
    maxTurns?: number;
    permissionMode: PiPermissionMode;
    defaultSystemPrompt?: string; // 全局默认系统提示词
    settingSources?: ('user' | 'project')[];
    defaultModelSelection: ModelSelection | null;
    digestModelSelection: ModelSelection | null;
    reviewModelSelection: ModelSelection | null;
    categorizeModelSelection: ModelSelection | null;
    /** 注入 CLAUDE_CODE_SUBAGENT_MODEL，决定 Agent 工具（原 Task）子代理模型 */
    subagentModelTier?: ModelTier;
    /** SDK 0.2.119+：true 时环境上下文移到首条 user message，改善 prompt 缓存命中率（默认 true） */
    excludeDynamicSections?: boolean;
    /** SDK 0.2.119+：启用 Agent 回答后的下一步建议气泡（默认 true） */
    promptSuggestionsEnabled?: boolean;
    /** 思考模式：adaptive=模型自决 / enabled=固定 budget / disabled=不思考。默认 adaptive */
    thinkingType?: ThinkingType;
    /** 思考预算 tokens，仅 thinkingType='enabled' 时生效 */
    thinkingBudgetTokens?: number;
    /** 思考过程展示方式：summarized=显示摘要 / omitted=不展示。默认 summarized；thinkingType='disabled' 时无效 */
    thinkingDisplay?: 'summarized' | 'omitted';
  };
  basicToolPermissions: BasicToolPermissions;
  personas: Persona[]; // 人设列表
  profiles: Record<string, ModelProfile>;
  /** 智能分类设置 */
  smartCategory?: {
    enabled?: boolean;          // 默认 true
    threshold?: number;         // 0–1，默认 0.5
    maxCategories?: number;     // 默认 10
  };
  /** 子会话派遣默认配置 */
  subAgent: {
    modelSelection?: ModelSelection | null;
    /** 单个子会话最长允许跑的分钟数，默认 30 */
    timeoutMinutes: number;
    /** 提示缓存策略；缺省 '5m' */
    cachePolicy?: '5m' | '1h';
    /** 是否注入 core-profile.md；缺省 false */
    loadCoreProfile?: boolean;
    /** 是否加载 .claude/skills；缺省 false */
    loadSkills?: boolean;
    /** 是否挂载 dogear-article-parse；缺省 false */
    loadArticleParse?: boolean;
  };
  /** 启用的工具包名称列表，如 ['stock-analysis', 'stock-quote']。未列出的不会注册其 MCP server。 */
  enabledToolPacks?: string[];
  /** 热更新服务配置 */
  update?: {
    serverUrl: string;
  };
}

// ============================================================
// 常量
// ============================================================

/** 内置默认系统提示词（不可删除） */
export const BUILTIN_DEFAULT_SYSTEM_PROMPT = '你是一个帮助用户阅读和分析电子书的 AI 助手。';

export const DEFAULT_SETTINGS: AppSettings = {
  ai: {
    effort: null,
    permissionMode: 'default',
    settingSources: ['user', 'project'],
    defaultSystemPrompt: BUILTIN_DEFAULT_SYSTEM_PROMPT,
    excludeDynamicSections: true,
    promptSuggestionsEnabled: true,
    thinkingType: 'adaptive',
    thinkingDisplay: 'summarized',
    defaultModelSelection: null,
    digestModelSelection: null,
    reviewModelSelection: null,
    categorizeModelSelection: null,
  },
  basicToolPermissions: createDefaultBasicToolPermissions(),
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
  smartCategory: { enabled: true, threshold: 0.5, maxCategories: 10 },
};

// ============================================================
// 纯函数
// ============================================================

/**
 * 检查 Profile 是否配置完整
 */
export function isProfileComplete(profile: ModelProfile): boolean {
  if (!profile.apiKey || !profile.baseUrl) return false;
  if (profile.apiFormat === 'pi') {
    return (profile.piModels?.length ?? 0) > 0;
  }
  return !!(profile.haikuModel && profile.sonnetModel && profile.opusModel);
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
