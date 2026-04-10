export interface ThinkingConfig {
  type: 'adaptive' | 'enabled' | 'disabled';
  budgetTokens?: number; // 仅 type='enabled' 时有效
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
    thinking: ThinkingConfig;
    effort: 'low' | 'medium' | 'high' | 'max';
    activeProfileId: string;
    maxTurns?: number; // Agent 最大执行轮次（不设置则不限制）
    permissionMode: 'default' | 'acceptEdits' | 'plan' | 'dontAsk'; // 默认权限模式
    defaultSystemPrompt?: string; // 全局默认系统提示词（替代硬编码的 basePrompt）
    systemPromptAppend?: string; // @deprecated 旧版追加提示词，向后兼容保留
    settingSources?: ('user' | 'project')[]; // SDK 设置源
  };
  // 工具权限规则（声明式），通过 SDK settings.permissions 传递，在所有模式下生效
  permissionRules?: {
    allow?: string[];  // 自动允许的工具，如 ['Read', 'Glob', 'Grep']
    deny?: string[];   // 自动拒绝的工具，如 ['Bash']
    ask?: string[];    // 强制要求用户确认的工具
  };
  personas: Persona[]; // 人设列表
  profiles: Record<string, ModelProfile>;
}

/** 内置默认系统提示词（不可删除） */
export const BUILTIN_DEFAULT_SYSTEM_PROMPT = '你是一个帮助用户阅读和分析电子书的 AI 助手。';

export const DEFAULT_SETTINGS: AppSettings = {
  ai: {
    thinking: { type: 'adaptive' },
    effort: 'high',
    activeProfileId: 'default',
    permissionMode: 'default',
    settingSources: ['project'],
    defaultSystemPrompt: BUILTIN_DEFAULT_SYSTEM_PROMPT,
  },
  personas: [],
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
