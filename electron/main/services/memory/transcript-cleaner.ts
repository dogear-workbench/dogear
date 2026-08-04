// A1 · 会话逐字稿清洗：类型无关的薄转发层
// 核心解析逻辑（涉及 Harness SessionTreeEntry/MessageEntry 类型）留在
// electron/main/agents/pi-session/transcript-adapter.ts —— 全局决策：
// Harness 事件/Session/Session Tree 类型不得泄漏出 electron/main/agents/pi-session/ 目录，
// 这里只做签名转发，保留原有调用方 import 路径不变。
export type {
  CleanedMessage,
  ReadCleanTranscriptOptions,
  ReadCleanTranscriptResult,
} from '../../agents/pi-session/transcript-adapter.js';
export { readCleanTranscript } from '../../agents/pi-session/transcript-adapter.js';
