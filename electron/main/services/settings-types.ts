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
  tier: ModelTier;
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
  /** 启用 1M 长上下文模式：自动压缩阈值设为 900K token。默认 false */
  enable1MContext?: boolean;
}

export interface AppSettings {
  ai: {
    effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    maxTurns?: number;
    permissionMode: 'default' | 'acceptEdits' | 'plan' | 'dontAsk';
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
    /** 思考过程展示方式：summarized=显示摘要 / omitted=不展示。默认 summarized */
    thinkingDisplay?: 'summarized' | 'omitted';
  };
  permissionRules?: {
    allow?: string[];
    deny?: string[];
  };
  personas: Persona[]; // 人设列表
  profiles: Record<string, ModelProfile>;
  /** 智能分类设置 */
  smartCategory?: {
    enabled?: boolean;          // 默认 true
    threshold?: number;         // 0–1，默认 0.5
    maxCategories?: number;     // 默认 10
  };
  /** 启用的工具包名称列表，如 ['stock-analysis', 'stock-quote']。未列出的不会注册其 MCP server。 */
  enabledToolPacks?: string[];
}

// ============================================================
// 常量
// ============================================================

/** 内置默认系统提示词（不可删除） */
export const BUILTIN_DEFAULT_SYSTEM_PROMPT = '你是一个帮助用户阅读和分析电子书的 AI 助手。';

export const DEFAULT_SETTINGS: AppSettings = {
  ai: {
    effort: 'high',
    permissionMode: 'default',
    settingSources: ['user', 'project'],
    defaultSystemPrompt: BUILTIN_DEFAULT_SYSTEM_PROMPT,
    excludeDynamicSections: true,
    promptSuggestionsEnabled: true,
    thinkingDisplay: 'summarized',
    defaultModelSelection: null,
    digestModelSelection: null,
    reviewModelSelection: null,
    categorizeModelSelection: null,
  },
  personas: [],
  enabledToolPacks: [],
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
  return !!(
    profile.apiKey &&
    profile.baseUrl &&
    profile.haikuModel &&
    profile.sonnetModel &&
    profile.opusModel
  );
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
