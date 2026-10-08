import type { ModelSelection, BasicToolPermissions, SubAgentProfile } from '../../services/settings-types.js';
import type { PiPermissionMode } from './permission-mode.js';

export interface PiSessionConfig {
  /** 所属对话 ID，用于 sessionClosed 等事件路由 */
  conversationId: string;
  /** 对话级模型选择；为空时在 start() 内回退到 settings.ai.defaultModelSelection */
  modelSelection: ModelSelection | null;
  /** 所属工作区绝对路径，用于文件类工具（Read/Write/Edit/Bash/Grep/Glob）的边界校验和 memory 工具存储位置 */
  workspacePath: string;
  /** 已过滤 enabled 的附加路径绝对路径数组，与 workspacePath 一起构成 env 的 allowedPaths */
  additionalPaths: string[];
  workspaceId: string;
  harnessSessionId: string | null;
  /** 用户在设置页开启的可选工具包名（对齐 tool-packs.ts 的 OPTIONAL_TOOL_PACKS[].name），缺省视为空数组 */
  enabledToolPacks: string[];
  /** 对话所属会话组 ID；存在时挂载 dogear-group / dogear-delegation */
  groupId?: string;
  /** 与 Conversation.role 同语义，直接透传，决定 dogear-delegation 工具包给主会话集还是子会话集 */
  role: 'main' | 'sub';
  /** 任务系统无人值守执行会话；start() 据此裁剪 systemPrompt（组上下文只留组头 + 跳过笔记纪律） */
  executor?: boolean;
  /** role='sub' 时必需：派出当前会话的会话 conversationId（对齐 SubDelegationOpts.parentConversationId）。
   * 由 conversation-runtime-service.ts 从 conversation.parentConversationId 透传；role='main' 时不使用 */
  parentConversationId?: string;
  subAgent?: {
    task: string;
    outputPath: string;
  };
  /** role='sub' 时传入的 Profile 配置，驱动提示词段/工具/skill 的按需加载 */
  subAgentProfile?: SubAgentProfile;
  /** 明确装载的 skill 全集：执行会话按任务类型恒传查表清单（default 空清单=基础版）；undefined = 不覆盖跟随工作区 enabledSkills，保留给非执行场景 */
  skillsOverride?: readonly string[];
  permissionMode: PiPermissionMode;
  basicToolPermissions: BasicToolPermissions;
  /** usage turnIndex 起始值：manager 建会话时从该会话 usage JSONL 尾部 ENTRY 读出（+1），缺省 0（全新会话） */
  usageTurnIndexStart?: number;
}
