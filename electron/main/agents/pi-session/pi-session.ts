/**
 * 基于 pi-ai + pi-agent-core（AgentHarness）的主会话运行时实现
 *
 * 主会话与派遣子会话唯一使用的会话类，旧 SDK 主会话实现已随迁移整体移除。
 * 方法面（getSessionId/start/sendMessage/close/interrupt/setPermissionMode/
 * respondPermissionRequest 等）覆盖完整的会话生命周期、权限确认、插话队列、
 * usage 采集等能力。
 */

import { EventEmitter } from 'events';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import type { AgentEvent, AgentHarnessTool, ExecutionEnv } from '@earendil-works/pi-agent-core';
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs';
import type { PiPermissionMode } from './permission-mode.js';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { mainLogger } from '../logger.js';
import { resolvePiModel, buildPiModels } from '../pi/provider.js';
import { toPiTools, type ToolDef } from '../pi/tool-adapter.js';
import { convertPiEvent } from './message-converter.js';
import { loadSkillIndex, formatSkillIndexForPrompt, createSkillTool } from './skill-loader.js';
import { WorkspaceExecutionEnv } from './workspace-execution-env.js';
import { createBuiltinFileTools } from './builtin-tools.js';
import { PiHarnessAdapter, type HarnessToolCallEvent, type HarnessToolCallResult } from './pi-harness-adapter.js';
import { createSearchToolDefs } from './search-tools.js';
import { buildGroupContextPrompt } from '../group-context-builder.js';
import { REFERENCE_APPEND, groupAppendFor, NOTES_GUIDANCE_APPEND, MEMORY_GUIDANCE_APPEND, subAgentContractFor, MAIN_AGENT_DELEGATION_APPEND } from '../session-append-templates.js';
import { isBasicToolName, decideToolPermission } from './permission-rules.js';
import { createMemoryToolDefs } from '../tools/memory-tools.js';
import { createArticleToolDefs } from '../tools/article-tools.js';
import { createStockToolDefs } from '../tools/stock-tools.js';
import { createStockAnalysisToolDefs } from '../tools/stock-analysis-tools.js';
import { createAnnouncementToolDefs } from '../tools/stock-announcement-tools.js';
import { createStockPickingToolDefs } from '../tools/stock-picking-tools.js';
import { createGroupToolDefs } from '../tools/group-tools.js';
import { createDelegationToolDefs, type DelegationToolsOpts } from '../tools/delegation-tools.js';
import { createReviewToolDefs } from '../tools/review-tools.js';
import { createReferenceToolDefs } from '../tools/reference-tools.js';
import { OPTIONAL_TOOL_PACKS } from '../../services/tool-packs.js';
import { loadSettings } from '../../services/settings-service.js';
import { loadCoreProfileForSession } from '../../services/memory/memory-loader.js';
import * as conversationService from '../../services/conversation-service.js';
import { getGroup } from '../../services/group-service.js';
import { getArticleParserSkillsDir } from '../../services/article-parser-skills-service.js';
import { getReviewSkillDir } from '../../services/memory/review-skill-service.js';
import {
  createPiUsageAccumulator,
  accumulatePiUsage,
  extractPiContextSnapshot,
  extractPiUsageEntry,
  type PiUsageAccumulator,
} from './usage-extractor.js';
import type { ModelSelection, ModelProfile, BasicToolPermissions } from '../../services/settings-types.js';
import type { ExtendedSessionMessage } from '../task-types.js';
import { getPiSessionRepository } from './pi-session-repository.js';

export interface PiSessionConfig {
  /** 所属对话 ID，用于 sessionClosed 等事件路由 */
  conversationId: string;
  /** 对话级模型选择；为空时在 start() 内回退到 settings.ai.defaultModelSelection */
  modelSelection: ModelSelection | null;
  /** 系统提示词。阶段一直接沿用全局默认提示词，不做人设/工作区/工具导览拼装 */
  systemPrompt?: string;
  /** 所属工作区绝对路径，用于文件类工具（Read/Write/Edit/Bash/Grep/Glob）的边界校验和 memory 工具存储位置 */
  workspacePath: string;
  workspaceId: string;
  harnessSessionId: string | null;
  /** 用户在设置页开启的可选工具包名（对齐 tool-packs.ts 的 OPTIONAL_TOOL_PACKS[].name），缺省视为空数组 */
  enabledToolPacks: string[];
  /** 对话所属会话组 ID；存在时挂载 dogear-group / dogear-delegation */
  groupId?: string;
  /** 与 Conversation.role 同语义，直接透传，决定 dogear-delegation 工具包给主会话集还是子会话集 */
  role: 'main' | 'sub';
  /** role='sub' 时必需：派出当前会话的会话 conversationId（对齐 SubDelegationOpts.parentConversationId）。
   * 由 conversation-runtime-service.ts 从 conversation.parentConversationId 透传；role='main' 时不使用 */
  parentConversationId?: string;
  subAgent?: {
    task: string;
    outputPath: string;
  };
  permissionMode: PiPermissionMode;
  basicToolPermissions: BasicToolPermissions;
}

export interface PiSessionLiveSnapshot {
  messages: ExtendedSessionMessage[];
  permissionRequests: Array<{
    requestId: string;
    toolName: string;
    toolInput: unknown;
  }>;
  sessionState: {
    running: boolean;
    pendingAction: boolean;
  };
}

export interface PiSessionTurnResult {
  subtype: 'success' | 'failed' | 'cancelled';
  error?: {
    kind: 'model' | 'runtime' | 'cancelled';
    message: string;
  };
}

enum PiSessionStatus {
  IDLE = 'idle',
  CLOSED = 'closed',
}

interface PendingPermissionRequest {
  resolve: (result: HarnessToolCallResult | undefined) => void;
  toolName: string;
  toolInput: unknown;
}

/** 从 SDK 风格的 ContentBlockParam[] 中提取纯文本（阶段一不支持图像，静默丢弃非文本块） */
function extractTextFromBlocks(blocks: ContentBlockParam[]): string {
  const texts: string[] = [];
  for (const block of blocks) {
    if (block && typeof block === 'object' && 'type' in block && block.type === 'text') {
      texts.push((block as { text: string }).text);
    }
  }
  return texts.join('\n');
}

/** 读文本文件，失败（不存在/无权限）静默返回空串。给 CLAUDE.md 这类"加分项"用，不阻塞会话启动 */
async function readTextFileSafe(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return '';
  }
}

export class PiSession extends EventEmitter {
  private sessionId: string;
  private config: PiSessionConfig;
  private logger = mainLogger;
  private adapter: PiHarnessAdapter | null = null;
  // Harness 不暴露 isStreaming 之类的运行状态查询，改由本地字段镜像 harness 的 phase：
  // sendMessage() 调用 prompt() 前置 true，onSettled 回调置 false；见 syncSessionState()。
  private running = false;
  private status: PiSessionStatus = PiSessionStatus.IDLE;
  // 缓存当前生效的 selection/profile，供 setModel 判断是否需要重启会话
  private currentModelSelection: ModelSelection | null = null;
  private currentResolvedProfile?: ModelProfile;
  private currentPermissionMode: PiPermissionMode = 'default';
  private basicToolPermissions: BasicToolPermissions;
  // requestId -> 挂起的权限确认请求，等待前端 respondPermissionRequest 调用来 resolve
  private pendingPermissionRequests: Map<string, PendingPermissionRequest> = new Map();
  // 本会话进程内免确认的工具名集合（allow_session 语义，不落盘，关闭会话即失效）
  private sessionAllowedTools: Set<string> = new Set();
  // steer 队列长度，由 adapter 的 onSteerQueueChanged 回调（Harness queue_update 事件）镜像，
  // 不再手动 +1/-1：queue_update 在 steer() 入队和 one-at-a-time drain 时都会触发，是权威数据源。
  private pendingSteerCount = 0;
  // sessionStateChanged 去重：记录上次广播的 running/pendingAction
  private lastEmittedRunning = false;
  private lastEmittedPendingAction = false;
  // 本轮 emit 出去的 ExtendedSessionMessage 快照，agent_end 时喂给 extractPiUsageEntry 聚合 toolActivity
  private currentTurnMessages: ExtendedSessionMessage[] = [];
  private liveTurnMessages: ExtendedSessionMessage[] = [];
  // usage 提取粒度对齐 SDK result：每次 sendMessage（agent_end）产一条 entry，自增
  private usageTurnIndex = 0;
  // 本轮累加器：message_end 时累加 AssistantMessage.usage，agent_end 时取出转 entry 后置 null
  private currentRunUsageAccum: PiUsageAccumulator | null = null;
  private currentTurnResult: PiSessionTurnResult | null = null;
  // close() 重入锁：并发调用（如用户连点两下关闭）复用同一个收尾 Promise，
  // 避免 removeAllListeners() 之类的收尾动作被并发触发两次
  private closingPromise: Promise<void> | null = null;
  // 工具名 → 所属工具包标识（OPTIONAL_TOOL_PACKS[].name 或 'dogear-group'/'dogear-delegation'/'dogear-memory-review'），
  // start() 组装 toolDefs 时同步填充，供 handleToolCall 的批量免确认判定使用
  private toolPackMap: Map<string, string> = new Map();

  constructor(sessionId: string, config: PiSessionConfig) {
    super();
    this.sessionId = sessionId;
    this.config = config;
    this.currentPermissionMode = config.permissionMode;
    this.basicToolPermissions = config.basicToolPermissions;
    this.logger = this.logger.child(`pi-session-${sessionId.substring(0, 8)}`);
  }

  getSessionId(): string {
    return this.sessionId;
  }

  /** Harness 的真实持久化 sessionId；start() 内两条分支（open 已有 / create 新建）都会同步赋值 config.harnessSessionId，resolve 时必定可用 */
  getHarnessSessionId(): string | undefined {
    return this.config.harnessSessionId ?? undefined;
  }

  getLiveSnapshot(): PiSessionLiveSnapshot {
    return {
      messages: [...this.liveTurnMessages],
      permissionRequests: Array.from(this.pendingPermissionRequests.entries()).map(([requestId, pending]) => ({
        requestId,
        toolName: pending.toolName,
        toolInput: pending.toolInput,
      })),
      sessionState: {
        running: this.running || this.pendingSteerCount > 0,
        pendingAction: this.pendingSteerCount > 0,
      },
    };
  }

  async start(): Promise<void> {
    if (this.adapter) {
      this.logger.warn('会话已经启动');
      return;
    }

    this.logger.info('=== 启动 pi 会话 ===', { sessionId: this.sessionId });

    const repository = getPiSessionRepository();
    const session = this.config.harnessSessionId
      ? await repository.open(this.config.workspaceId, this.config.harnessSessionId)
      : await (async () => {
          const { session: created, info } = await repository.create(this.config.workspaceId);
          this.config.harnessSessionId = info.id;
          return created;
        })();

    const appSettings = await loadSettings();
    const { model, profile, tier, thinkingLevel } = resolvePiModel(
      appSettings,
      this.config.modelSelection,
      null,
      appSettings.ai.defaultModelSelection,
    );

    this.currentModelSelection = this.config.modelSelection ?? appSettings.ai.defaultModelSelection;
    this.currentResolvedProfile = profile;

    const piModels = buildPiModels(profile);
    const isSubAgent = this.config.role === 'sub';
    const shouldLoadCoreProfile = !isSubAgent || appSettings.subAgent?.loadCoreProfile === true;
    const coreProfileText = shouldLoadCoreProfile
      ? await loadCoreProfileForSession(this.config.workspacePath)
      : null;
    const groupContextText = this.config.groupId
      ? await buildGroupContextPrompt(this.config.workspaceId, this.config.groupId)
      : '';
    let groupNameForAppend: string | null = null;
    if (!isSubAgent && this.config.groupId) {
      try {
        const conversations = await conversationService.getByWorkspaceId(this.config.workspaceId);
        const hasSibling = conversations.some((conversation) =>
          conversation.groupId === this.config.groupId
          && conversation.role !== 'sub'
          && conversation.id !== this.config.conversationId,
        );
        if (hasSibling) {
          const group = await getGroup(this.config.workspaceId, this.config.groupId);
          const title = group?.title?.trim();
          groupNameForAppend = title || `未命名组（创建于 ${group ? new Date(group.createdAt).toLocaleString('zh-CN') : '未知时间'}）`;
        }
      } catch (error) {
        this.logger.warn('计算组背景提示失败，跳过注入:', error);
      }
    }

    const projectClaudeMd = await readTextFileSafe(path.join(this.config.workspacePath, '.claude', 'CLAUDE.md'));
    const userClaudeMd = await readTextFileSafe(path.join(os.homedir(), '.claude', 'CLAUDE.md'));

    const env = new WorkspaceExecutionEnv(this.config.workspacePath);
    const skillEntries = await loadSkillIndex([
      path.join(this.config.workspacePath, '.claude', 'skills'),
      path.join(os.homedir(), '.claude', 'skills'),
      getArticleParserSkillsDir(),
      getReviewSkillDir(),
    ], env);
    const skillIndexText = formatSkillIndexForPrompt(skillEntries);

    const promptParts = [
      this.config.systemPrompt ?? '',
      projectClaudeMd,
      userClaudeMd,
      skillIndexText,
      coreProfileText ?? '',
      groupContextText,
    ];
    if (!isSubAgent) promptParts.push(REFERENCE_APPEND);
    if (groupNameForAppend) promptParts.push(groupAppendFor(groupNameForAppend));
    if (!isSubAgent && this.config.workspacePath) {
      promptParts.push(NOTES_GUIDANCE_APPEND);
      promptParts.push(MEMORY_GUIDANCE_APPEND);
    }
    if (isSubAgent && this.config.subAgent) promptParts.push(subAgentContractFor(this.config.subAgent));
    if (!isSubAgent && this.config.groupId) promptParts.push(MAIN_AGENT_DELEGATION_APPEND);
    const systemPrompt = promptParts.filter(Boolean).join('\n\n');

    // 工具集合：builtin-tools（Read/Write/Edit/Bash，harness 原生工具，env 经 toolContext 注入）
    // + toPiTools(Skill 工具 + Grep/Glob + dogear-memory 常驻工具 + 按 enabledToolPacks/groupId 挂载的可选工具包，
    //   统一 ToolDef 形状，不需要 env context）
    const registerPack = (packName: string, defs: ToolDef[]): ToolDef[] => {
      for (const def of defs) {
        if (isBasicToolName(def.name)) {
          throw new Error(`基础工具 ${def.name} 不得归类到工具包 ${packName}`);
        }
        if (this.toolPackMap.has(def.name)) {
          throw new Error(`工具 ${def.name} 重复归类到工具包 ${this.toolPackMap.get(def.name)} 与 ${packName}`);
        }
        this.toolPackMap.set(def.name, packName);
      }
      return defs;
    };

    const toolDefs: ToolDef[] = [
      createSkillTool(skillEntries),
      ...createSearchToolDefs(this.config.workspacePath),
      ...registerPack('dogear-memory', createMemoryToolDefs(this.config.workspacePath)),
    ];

    // 可选工具包（对齐旧 SDK 侧 enabledToolPacks 通配符体验）：article 依赖 workspacePath，其余四个不依赖
    for (const pack of OPTIONAL_TOOL_PACKS) {
      if (!this.config.enabledToolPacks.includes(pack.name)) continue;
      switch (pack.name) {
        case 'article':
          if (this.config.workspacePath) {
            toolDefs.push(...registerPack(pack.name, createArticleToolDefs(this.config.workspacePath)));
          }
          break;
        case 'stock-quote':
          toolDefs.push(...registerPack(pack.name, createStockToolDefs()));
          break;
        case 'stock-analysis':
          toolDefs.push(...registerPack(pack.name, createStockAnalysisToolDefs()));
          break;
        case 'stock-announcement':
          toolDefs.push(...registerPack(pack.name, createAnnouncementToolDefs()));
          break;
        case 'stock-picking':
          toolDefs.push(...registerPack(pack.name, createStockPickingToolDefs()));
          break;
        default:
          break;
      }
    }

    // dogear-group / dogear-delegation：按 conversation.groupId 存在放行，role 透传 this.config.role
    // 决定 dogear-delegation 拿主会话工具集（含 CreateSession/StopSession）还是子会话工具集（无法派孙子）
    if (this.config.groupId) {
      toolDefs.push(...registerPack('dogear-group', createGroupToolDefs(this.config.workspaceId, this.config.groupId)));
      // 判别联合按 this.config.role 收窄：sub 分支需要 parentConversationId
      const delegationOpts: DelegationToolsOpts = this.config.role === 'sub'
        ? {
            role: 'sub',
            workspaceId: this.config.workspaceId,
            groupId: this.config.groupId,
            conversationId: this.config.conversationId,
            parentConversationId: this.config.parentConversationId ?? '',
          }
        : {
            role: 'main',
            workspaceId: this.config.workspaceId,
            groupId: this.config.groupId,
            conversationId: this.config.conversationId,
          };
      toolDefs.push(...registerPack('dogear-delegation', createDelegationToolDefs(delegationOpts)));

      // dogear-reference：有 groupId 时主会话和子会话都注册
      if (this.config.groupId) {
        toolDefs.push(...registerPack('dogear-reference', createReferenceToolDefs({
          workspaceId: this.config.workspaceId,
          workspacePath: this.config.workspacePath,
          groupId: this.config.groupId,
          parentConversationId: this.config.parentConversationId,
        })));
      }
    }

    // dogear-memory-review：按 workspacePath 齐全放行，onSaved 主会话场景不传（无需感知落盘时机）
    if (this.config.workspacePath) {
      toolDefs.push(...registerPack('dogear-memory-review', createReviewToolDefs(this.config.workspaceId, this.config.workspacePath)));
    }

    const tools: AgentHarnessTool<{ env: ExecutionEnv }>[] = [
      ...createBuiltinFileTools(),
      ...toPiTools(toolDefs),
    ];

    this.adapter = new PiHarnessAdapter({
      session,
      models: piModels,
      tools,
      toolContext: { env },
      systemPrompt,
      model,
      thinkingLevel,
      timeoutMs: profile.apiTimeoutMs,
      onAgentEvent: (event) => this.handleAgentEvent(event),
      onSteerQueueChanged: (count) => this.handleSteerQueueChanged(count),
      onSettled: () => this.handleSettled(),
      onToolCall: (event) => this.handleToolCall(event),
    });

    this.logger.info('✅ pi 会话已创建', {
      profile: profile.name,
      tier,
      skills: skillEntries.map((e) => e.name),
      claudeMd: { project: !!projectClaudeMd, user: !!userClaudeMd },
    });
  }

  private handleAgentEvent(event: AgentEvent): void {
    // message_end：单次 LLM call 结束，AssistantMessage.usage 携带本轮 token 用量，累加进 currentRunUsageAccum
    if (event.type === 'message_end' && event.message && (event.message as { role?: string }).role === 'assistant') {
      const assistantMessage = event.message as AssistantMessage;
      if (!this.currentRunUsageAccum) this.currentRunUsageAccum = createPiUsageAccumulator();
      accumulatePiUsage(this.currentRunUsageAccum, assistantMessage);

      const conversationId = this.config.conversationId;
      const snapshot = extractPiContextSnapshot(assistantMessage, this.usageTurnIndex);
      if (conversationId && snapshot) {
        this.emit('usageContext', { conversationId, snapshot });
      }
    }

    const message = convertPiEvent(event);
    if (message) {
      // 缓存本轮 emit 出去的消息快照，agent_end 时喂给 extractPiUsageEntry 聚合 toolActivity
      this.currentTurnMessages.push(message);
      this.liveTurnMessages.push(message);
      this.emit('message', message);
      return;
    }

    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'error') {
      const errMsg = event.assistantMessageEvent.error.errorMessage || '模型请求失败';
      if (this.recordTurnFailure('model', errMsg)) {
        this.logger.error('pi 模型返回错误:', errMsg);
        this.emitErrorMessage(errMsg);
      }
      return;
    }

    if (event.type === 'agent_end') {
      const lastMessage = event.messages[event.messages.length - 1] as {
        role?: string;
        stopReason?: string;
        errorMessage?: string;
      } | undefined;
      if (lastMessage?.role === 'assistant' && lastMessage.stopReason === 'error') {
        const errorMessage = lastMessage.errorMessage || '模型请求失败';
        if (this.recordTurnFailure('model', errorMessage)) {
          this.logger.error('pi 模型返回错误:', errorMessage);
          this.emitErrorMessage(errorMessage);
        }
      } else if (lastMessage?.role === 'assistant' && lastMessage.stopReason === 'aborted') {
        this.recordTurnCancelled('会话已中断');
      }

      this.emitUsageEntry();
      this.currentTurnMessages = [];
      this.currentRunUsageAccum = null;
    }
  }

  /**
   * steer 队列长度变化（Harness queue_update 事件），入队与 one-at-a-time drain 都会触发。
   */
  private recordTurnFailure(kind: 'model' | 'runtime', message: string): boolean {
    if (this.currentTurnResult) return false;
    this.currentTurnResult = {
      subtype: 'failed',
      error: { kind, message },
    };
    return true;
  }

  private recordTurnCancelled(message: string): boolean {
    if (this.currentTurnResult) return false;
    this.currentTurnResult = {
      subtype: 'cancelled',
      error: { kind: 'cancelled', message },
    };
    return true;
  }

  private emitErrorMessage(message: string): void {
    this.emit('message', {
      type: 'error',
      error: message,
      timestamp: Date.now(),
    } as ExtendedSessionMessage);
  }

  private handleSteerQueueChanged(count: number): void {
    this.pendingSteerCount = count;
    this.emit('pendingCountChanged', { count });
    this.syncSessionState();
  }

  /**
   * 一次完整 run（含所有工具调用和插话）彻底结束（Harness settled 事件，晚于 agent_end），
   * 驱动 running=false 的最终结算，并通知 Manager 收集 orphan 会话。
   */
  private handleSettled(): void {
    this.running = false;
    this.liveTurnMessages = [];
    this.syncSessionState();
    this.emit('settled');
  }

  /**
   * agent_end 时把本轮累加器 + turn 消息快照转成 ConversationUsageEntry 并 emit 'usage'。
   * fire-and-forget：异常只 warn，不影响主流程。与 SDK 侧 result 消息分支的 usage 采集口径对称。
   */
  private emitUsageEntry(): void {
    try {
      const convId = this.config.conversationId;
      if (!convId) return;
      const accum = this.currentRunUsageAccum ?? createPiUsageAccumulator();
      const entry = extractPiUsageEntry(
        accum,
        this.currentTurnMessages,
        this.usageTurnIndex,
        this.currentResolvedProfile?.opusModel,
      );
      entry.uuid = uuidv4();
      this.usageTurnIndex += 1;
      this.emit('usage', { conversationId: convId, entry });
    } catch (err) {
      this.logger.warn('用量采集失败（忽略）:', err);
    }
  }

  /**
   * 去重广播当前跑步机状态（running/pendingAction），驱动前端 running/pendingAction 两个 Set。
   * running = this.running（onSettled 镜像的 harness phase）|| pendingSteerCount>0；pendingAction = pendingSteerCount>0。
   * close() 不走这里，靠 sessionClosed 让前端清 Set。
   */
  private syncSessionState(): void {
    const conversationId = this.config.conversationId;
    if (!conversationId) return;
    const running = this.running || this.pendingSteerCount > 0;
    const pendingAction = this.pendingSteerCount > 0;
    if (running !== this.lastEmittedRunning || pendingAction !== this.lastEmittedPendingAction) {
      this.lastEmittedRunning = running;
      this.lastEmittedPendingAction = pendingAction;
      this.emit('sessionStateChanged', { conversationId, running, pendingAction });
    }
  }

  /**
   * 工具调用权限拦截点（Harness tool_call hook）。
   *
   * 策略：
   * - 子会话或 autoExecute 模式：无条件放行。
   * - 默认主会话：
   *   - 已归类工具包的工具 → 自动放行。
   *   - 基础工具 → 按快照映射（allow=放行，ask=挂起请求）。
   *   - 本会话已允许的基础工具 → 放行。
   *   - 未分类工具 → 保守请求确认。
   *
   * 与裸 Agent 的 beforeToolCall 不同，Harness 的 tool_call hook 不带 AbortSignal 参数，
   * 因此这里不再有 signal.addEventListener('abort', ...) 的自动拒绝兜底：当前唯一会触发
   * harness 层面 abort 的路径就是 close()/interrupt()，两者都已经显式调用
   * rejectAllPendingPermissionRequests()，功能等价。
   */
  private async handleToolCall(context: HarnessToolCallEvent): Promise<HarnessToolCallResult | undefined> {
    const toolName = context.toolName;

    const decision = decideToolPermission(
      toolName,
      this.currentPermissionMode,
      this.toolPackMap,
      this.sessionAllowedTools,
      this.basicToolPermissions,
    );
    if (decision === 'allow') return undefined;

    const requestId = `perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.logger.info('权限确认请求:', { requestId, toolName });

    return new Promise<HarnessToolCallResult | undefined>((resolve) => {
      this.pendingPermissionRequests.set(requestId, { resolve, toolName, toolInput: context.input });

      this.emit('permissionRequest', {
        requestId,
        toolName,
        toolInput: context.input,
      });
    });
  }

  /** pi 阶段一不支持斜杠命令 */
  async getSupportedCommands(): Promise<Array<{ name: string; description: string; argumentHint: string }>> {
    return [];
  }

  async sendMessage(content: string | ContentBlockParam[]): Promise<void> {
    if (this.status === PiSessionStatus.CLOSED) {
      throw new Error('会话已关闭');
    }
    if (!this.adapter) {
      throw new Error('会话尚未启动');
    }

    const text = typeof content === 'string' ? content : extractTextFromBlocks(content);
    const adapter = this.adapter;
    const isRunning = this.running || this.pendingSteerCount > 0;
    if (!isRunning) this.liveTurnMessages = [];

    this.logger.info('发送用户消息到 pi 会话:', { length: text.length, isRunning, pendingSteer: this.pendingSteerCount });

    if (isRunning) {
      // 插话路径：steer 在当前 assistant turn 结束后注入（one-at-a-time 模式下排在已有队列后面）。
      // pendingSteerCount / pendingCountChanged / syncSessionState 由 onSteerQueueChanged
      // 回调（Harness queue_update 事件）驱动，这里不再手动计数。
      await adapter.steer(text);
      return;
    }

    this.currentTurnResult = null;
    this.running = true;
    this.syncSessionState();
    try {
      await adapter.prompt(text);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.recordTurnFailure('runtime', message)) {
        this.logger.error('pi 会话执行失败:', message);
        this.emitErrorMessage(message);
      }
      this.currentTurnMessages = [];
      this.currentRunUsageAccum = null;
      this.running = false;
    } finally {
      const result = this.currentTurnResult ?? { subtype: 'success' };
      this.emit('complete', result);
      this.currentTurnResult = null;
      this.syncSessionState();
    }
  }

  /**
   * 会话是否仍在运行（有活跃 turn 或 steer 队列）。供 PiSessionManager.release 归零时判断
   * 是否走 orphan 保活路径——running 时保留不销毁，等 settled 后再由 maybeCollectOrphan 收集。
   */
  isRunning(): boolean {
    return this.running || this.pendingSteerCount > 0;
  }

  /**
   * 空闲 = 无正在跑的 turn + 无 steer 队列 + 无挂起的权限请求。
   */
  isIdle(): boolean {
    return !this.running
      && this.pendingSteerCount === 0
      && this.pendingPermissionRequests.size === 0;
  }

  /**
   * 并发调用共享同一个收尾 Promise（closingPromise），保证 removeAllListeners()
   * 等一次性收尾动作只执行一次；status 只在收尾完成后才置 CLOSED。
   */
  close(): Promise<void> {
    if (this.status === PiSessionStatus.CLOSED) return Promise.resolve();
    if (!this.closingPromise) this.closingPromise = this.doClose();
    return this.closingPromise;
  }

  private async doClose(): Promise<void> {
    this.logger.info('关闭 pi 会话:', this.sessionId);

    // 顺序不可换：先拒绝挂起的权限确认请求，让卡在 tool_call hook 里的 Promise 立刻 resolve，
    // 工具调用才能收到 blocked 结果继续走完当前这一轮；否则 adapter.abort() 内部
    // harness.waitForIdle() 会一直等这一轮结束，永久死锁（见 pi-harness-adapter.ts abort() 注释）。
    this.rejectAllPendingPermissionRequests('会话已关闭');
    // resolve WaitForMessage 挂起等待，防止 adapter.abort() 内部 waitForIdle() 死锁
    await this.abortMessageWaitsForConversation();
    // await 到这里 resolve 即代表当前 run 已完全结束、settled 已触发，可以安全做收尾。
    await this.adapter?.abort();

    this.status = PiSessionStatus.CLOSED;
    this.pendingSteerCount = 0;
    this.running = false;
    this.emit('sessionClosed', { conversationId: this.config.conversationId });
    // 必须在 abort() 完成之后才摘监听器：abort 过程中 harness 仍可能 emit 最后的
    // agent_end/settled/usage 等事件，提前摘掉会让这些事件被静默丢弃。
    this.removeAllListeners();
  }

  /**
   * 未对 interrupt() 加重入锁：AgentHarness.abort() 对并发调用是安全的——
   * steerQueue/followUpQueue 在函数入口即被清空（第二次调用拿到空数组无副作用），
   * runAbortController?.abort() 对已 abort 的 controller 重复调用是 no-op，
   * waitForIdle() 各自 await 同一个 runPromise 都能正常 resolve（见 agent-harness.js:912-942）。
   * 本方法自身的 rejectAllPendingPermissionRequests / pendingSteerCount 清零也都是幂等操作，
   * 因此用户连点两次"中断"不会死锁或产生不一致状态。
   */
  async interrupt(): Promise<void> {
    // 不依赖 tool_call hook 收到 abort 信号（Harness 的 tool_call hook 不带 signal 参数），
    // 主动拒绝所有待处理权限请求兜底，避免中断后仍有请求悬挂等待
    if (this.running || this.pendingSteerCount > 0) this.recordTurnCancelled('用户中断');
    this.pendingSteerCount = 0;
    this.emit('pendingCountChanged', { count: 0 });
    this.rejectAllPendingPermissionRequests('用户中断');
    // resolve 所有 WaitForMessage 挂起等待，让卡在工具调用里的 prompt() 立即返回——
    // 否则 adapter.abort() 内部 waitForIdle() 会永远等这一轮结束，死锁。
    await this.abortMessageWaitsForConversation();
    await this.adapter?.abort();
  }

  private rejectAllPendingPermissionRequests(reason: string): void {
    if (this.pendingPermissionRequests.size === 0) return;
    for (const [, pending] of this.pendingPermissionRequests) {
      pending.resolve({ block: true, reason });
    }
    this.pendingPermissionRequests.clear();
  }

  /**
   * resolve 当前会话所有 WaitForMessage 挂起等待。动态 import 避免 pi-session → delegation-bridge
   * → pi-session-manager → pi-session 的循环依赖。
   */
  private async abortMessageWaitsForConversation(): Promise<void> {
    try {
      const { abortMessageWaits } = await import('../delegation-bridge.js');
      abortMessageWaits(this.config.conversationId);
    } catch (err) {
      this.logger.warn('abortMessageWaits 调用失败（忽略）:', err);
    }
  }

  async setPermissionMode(mode: PiPermissionMode): Promise<void> {
    const effectiveMode = this.config.role === 'sub' ? 'autoExecute' : mode;
    this.currentPermissionMode = effectiveMode;
    this.logger.info('更改 pi 权限模式:', effectiveMode);
    this.emit('permissionModeChanged', { mode: effectiveMode });
  }

  getPermissionMode(): PiPermissionMode {
    return this.currentPermissionMode;
  }

  /**
   * 响应权限确认请求：
   * - allow：本次放行
   * - allow_session：本次放行 + 本会话进程内记住该工具（仅基础工具有效；非基础工具降级为 allow）
   * - deny：tool_call hook 返回 block，工具收到一条 error 结果
   */
  respondPermissionRequest(
    requestId: string,
    behavior: 'allow' | 'deny' | 'allow_session',
    message?: string,
  ): void {
    const pending = this.pendingPermissionRequests.get(requestId);
    if (!pending) {
      this.logger.warn('respondPermissionRequest: 找不到请求:', requestId);
      return;
    }
    this.pendingPermissionRequests.delete(requestId);
    this.logger.info('权限确认响应:', { requestId, behavior, toolName: pending.toolName });

    if (behavior === 'deny') {
      pending.resolve({ block: true, reason: message || '用户拒绝了此操作' });
      return;
    }

    if (behavior === 'allow_session' && isBasicToolName(pending.toolName)) {
      this.sessionAllowedTools.add(pending.toolName);
    }

    pending.resolve(undefined);
  }

  /** pi 阶段一从不产生 AskUserQuestion，no-op */
  respondAskUserQuestion(): void {
    this.logger.warn('respondAskUserQuestion: pi 会话阶段一从不产生 AskUserQuestion，忽略');
  }

  /**
   * 切换模型选择。阶段一未实现热切（同 SDK 的"同 profile 换 tier"快速路径），
   * 只要 selection 与当前不完全一致就要求上层重建会话；完全一致时直接放行。
   */
  async setModel(selection: ModelSelection): Promise<{ ok: true; needsRestart?: boolean } | { ok: false; error: string }> {
    if (!this.currentModelSelection) {
      return { ok: false, error: '当前会话未初始化模型' };
    }
    if (
      this.currentModelSelection.profileId !== selection.profileId ||
      this.currentModelSelection.tier !== selection.tier
    ) {
      return { ok: true, needsRestart: true };
    }
    return { ok: true };
  }

  /** pi 阶段一无缓存策略概念（不涉及 SDK 的 1h prompt cache 环境变量），恒不需要重启 */
  setCachePolicy(): { ok: true; needsRestart: boolean } {
    return { ok: true, needsRestart: false };
  }

  isSessionActive(): boolean {
    return this.status !== PiSessionStatus.CLOSED;
  }
}
