export interface ThinkingConfig {
  type: 'adaptive' | 'enabled' | 'disabled';
  budgetTokens?: number; // 仅 type='enabled' 时有效
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
  };
  // 工具权限规则（声明式）
  permissionRules?: {
    allow?: string[];  // 自动允许的工具，如 ['Read', 'Glob', 'Grep']
    deny?: string[];   // 自动拒绝的工具，如 ['Bash']
  };
  profiles: Record<string, ModelProfile>;
}

export const DEFAULT_SETTINGS: AppSettings = {
  ai: {
    thinking: { type: 'adaptive' },
    effort: 'high',
    activeProfileId: 'default',
    permissionMode: 'default',
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
