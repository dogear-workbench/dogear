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
  /** 启用 1M 长上下文模式：自动压缩阈值设为 900K token。默认 false */
  enable1MContext?: boolean;
}

/**
 * 检查 Profile 是否配置完整（可以用于创建会话）
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

export interface AppSettings {
  ai: {
    effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    activeProfileId: string;
    maxTurns?: number; // Agent 最大执行轮次（不设置则不限制）
    permissionMode: 'default' | 'acceptEdits' | 'plan' | 'dontAsk'; // 默认权限模式
    defaultSystemPrompt?: string; // 全局默认系统提示词（替代硬编码的 basePrompt）
    settingSources?: ('user' | 'project')[]; // SDK 设置源
    /** 注入 ANTHROPIC_MODEL，决定 CLI 默认模型 */
    defaultModelTier?: 'haiku' | 'sonnet' | 'opus';
    /** 注入 CLAUDE_CODE_SUBAGENT_MODEL，决定 Agent 工具（原 Task）子代理模型 */
    subagentModelTier?: 'haiku' | 'sonnet' | 'opus';
    /** 会话提炼（DIGEST_SESSION）使用的模型档位。默认 haiku */
    digestModelTier?: 'haiku' | 'sonnet' | 'opus';
    /** SDK 0.2.119+：true 时环境上下文移到首条 user message，改善 prompt 缓存命中率（默认 true） */
    excludeDynamicSections?: boolean;
    /** SDK 0.2.119+：启用 Agent 回答后的下一步建议气泡（默认 true） */
    promptSuggestionsEnabled?: boolean;
    /** 思考过程展示方式：summarized=显示摘要 / omitted=不展示。默认 summarized */
    thinkingDisplay?: 'summarized' | 'omitted';
  };
  // 工具权限规则（声明式），通过 SDK settings.permissions 传递，在所有模式下生效
  permissionRules?: {
    allow?: string[];  // 自动允许的工具，如 ['Read', 'Glob', 'Grep']
    deny?: string[];   // 自动拒绝的工具，如 ['Bash']
    ask?: string[];    // 强制要求用户确认的工具
  };
  personas: Persona[]; // 人设列表
  profiles: Record<string, ModelProfile>;
  /** 启用的工具包名称列表，如 ['stock-analysis', 'stock-quote']。未列出的不会注册其 MCP server。 */
  enabledToolPacks?: string[];
  ui?: {
    messageDisplayMode: 'compact' | 'detailed'; // 工具/思考块显示模式
  };
}

/** 内置默认系统提示词（不可删除） */
export const BUILTIN_DEFAULT_SYSTEM_PROMPT = '你是一个帮助用户阅读和分析电子书的 AI 助手。';

export const DEFAULT_SETTINGS: AppSettings = {
  ai: {
    effort: 'high',
    activeProfileId: 'default',
    permissionMode: 'default',
    settingSources: ['user', 'project'],
    defaultSystemPrompt: BUILTIN_DEFAULT_SYSTEM_PROMPT,
    excludeDynamicSections: true,
    promptSuggestionsEnabled: true,
    thinkingDisplay: 'summarized',
    digestModelTier: 'haiku',
  },
  personas: [],
  enabledToolPacks: [],
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
