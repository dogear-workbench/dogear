/**
 * 基于 pi-ai + pi-agent-core 的会话实现（阶段二 Step 1：walking skeleton）
 *
 * 与 QueryBasedSession 是两个独立的类，长期并存，不共享运行时接口。
 * 方法面对齐 QueryBasedSession（getSessionId/start/sendMessage/close/interrupt/...），
 * 但本步骤只有 start()/sendMessage()/close()/getSessionId() 是真实实现，
 * 其余方法（权限/插话/工具相关）返回安全默认值或 no-op，留给后续 step 补全。
 */

import { EventEmitter } from 'events';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import type { AgentEvent, AgentHarnessTool, ExecutionEnv } from '@earendil-works/pi-agent-core';
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs';
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';
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
import { isPermissionExempt, isToolPreapproved, isToolInEnabledPack } from './permission-rules.js';
import { createMemoryToolDefs } from '../tools/memory-tools.js';
import { createArticleToolDefs } from '../tools/article-tools.js';
import { createStockToolDefs } from '../tools/stock-tools.js';
import { createStockAnalysisToolDefs } from '../tools/stock-analysis-tools.js';
import { createAnnouncementToolDefs } from '../tools/stock-announcement-tools.js';
import { createStockPickingToolDefs } from '../tools/stock-picking-tools.js';
import { createGroupToolDefs } from '../tools/group-tools.js';
import { createDelegationToolDefs } from '../tools/delegation-tools.js';
import { createReviewToolDefs } from '../tools/review-tools.js';
import { OPTIONAL_TOOL_PACKS } from '../../services/tool-packs.js';
import { loadSettings, appendPermissionAllowRules } from '../../services/settings-service.js';
import { getArticleParserSkillsDir } from '../../services/article-parser-skills-service.js';
import { getReviewSkillDir } from '../../services/memory/review-skill-service.js';
import {
  createPiUsageAccumulator,
  accumulatePiUsage,
  extractPiContextSnapshot,
  extractPiUsageEntry,
  type PiUsageAccumulator,
} from './usage-extractor.js';
import type { ModelSelection, ModelProfile } from '../../services/settings-types.js';
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
  onHarnessSessionCreated: (sessionId: string) => Promise<void>;
  /** 用户在设置页开启的可选工具包名（对齐 tool-packs.ts 的 OPTIONAL_TOOL_PACKS[].name），缺省视为空数组 */
  enabledToolPacks: string[];
  /** 对话所属会话组 ID；存在时挂载 dogear-group / dogear-delegation（role='main'） */
  groupId?: string;
}

enum PiSessionStatus {
  IDLE = 'idle',
  CLOSED = 'closed',
}

interface PendingPermissionRequest {
  resolve: (result: HarnessToolCallResult | undefined) => void;
  toolName: string;
  /** tool_call hook 收到的原始 input 引用；agent-harness.js 里这个引用与后续 tool.execute 用的是同一个对象，
   * 原地修改字段即可让"编辑参数后允许"生效，不需要额外的回写机制 */
  args: unknown;
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
  private currentPermissionMode: PermissionMode = 'default';
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
  // usage 提取粒度对齐 SDK result：每次 sendMessage（agent_end）产一条 entry，自增
  private usageTurnIndex = 0;
  // 本轮累加器：message_end 时累加 AssistantMessage.usage，agent_end 时取出转 entry 后置 null
  private currentRunUsageAccum: PiUsageAccumulator | null = null;
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
    this.logger = this.logger.child(`pi-session-${sessionId.substring(0, 8)}`);
  }

  getSessionId(): string {
    return this.sessionId;
  }

  /** pi 阶段一没有 SDK 式的持久化 session_id / resume 概念，预留字段供后续 step 对齐 */
  getSdkSessionId(): string | undefined {
    return undefined;
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
          await this.config.onHarnessSessionCreated(info.id);
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

    // systemPrompt 拼装顺序（极简策略，不接 persona / temp_prompt，不迁移 SDK 的 6 段隐形系统契约）：
    // config.systemPrompt（外部传入，tipc 那边拼的 preset）→ 项目 CLAUDE.md → 用户 CLAUDE.md → skill 索引
    const systemPrompt = [
      this.config.systemPrompt ?? '',
      projectClaudeMd,
      userClaudeMd,
      skillIndexText,
    ].filter(Boolean).join('\n\n');

    // 工具集合：builtin-tools（Read/Write/Edit/Bash，harness 原生工具，env 经 toolContext 注入）
    // + toPiTools(Skill 工具 + Grep/Glob + dogear-memory 常驻工具 + 按 enabledToolPacks/groupId 挂载的可选工具包，
    //   统一 ToolDef 形状，不需要 env context）
    const registerPack = (packName: string, defs: ToolDef[]): ToolDef[] => {
      for (const def of defs) this.toolPackMap.set(def.name, packName);
      return defs;
    };

    const toolDefs: ToolDef[] = [
      createSkillTool(skillEntries),
      ...createSearchToolDefs(this.config.workspacePath),
      ...createMemoryToolDefs(this.config.workspacePath),
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

    // dogear-group / dogear-delegation：按 conversation.groupId 存在放行（本 step 只服务主会话，role 固定 'main'；
    // 子会话的 pi 化工具包接入留给 Step 5）
    if (this.config.groupId) {
      toolDefs.push(...registerPack('dogear-group', createGroupToolDefs(this.config.workspaceId, this.config.groupId)));
      toolDefs.push(...registerPack('dogear-delegation', createDelegationToolDefs({
        role: 'main',
        workspaceId: this.config.workspaceId,
        groupId: this.config.groupId,
        conversationId: this.config.conversationId,
      })));
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
      this.emit('message', message);
      return;
    }

    // 模型请求失败/被中断：assistantMessageEvent 里携带最终错误信息
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'error') {
      const errMsg = event.assistantMessageEvent.error.errorMessage || '模型请求失败';
      this.logger.error('pi 模型返回错误:', errMsg);
      this.emit('error', {
        type: 'error',
        error: errMsg,
        timestamp: Date.now(),
      } as ExtendedSessionMessage);
      return;
    }

    // agent_end：一次完整 run（可能含多轮工具调用）结束。
    // pi-agent-core 不单独 emit error 事件：模型 4xx/5xx 时 pi-ai 把异常 catch 转成 stopReason='error' + errorMessage 塞进 message，
    // agent-loop.js:108 / agent.js handleRunFailure 走 error 路径时只在 messages[last] 上携带 errorMessage。
    // 这里兜底把它转成 error 消息推给前端，避免 GLM 1211 这类错被静默吞掉。
    if (event.type === 'agent_end') {
      const lastMessage = event.messages[event.messages.length - 1] as {
        role?: string;
        stopReason?: string;
        errorMessage?: string;
      } | undefined;
      if (lastMessage?.role === 'assistant' && lastMessage.stopReason === 'error' && lastMessage.errorMessage) {
        this.logger.error('pi 模型返回错误:', lastMessage.errorMessage);
        this.emit('message', {
          type: 'error',
          error: lastMessage.errorMessage,
          timestamp: Date.now(),
        } as ExtendedSessionMessage);
      }

      this.emitUsageEntry();
      this.currentTurnMessages = [];
      this.currentRunUsageAccum = null;
      // running=false 的最终结算交给 onSettled（Harness settled 事件晚于 agent_end，
      // 此时 steer 队列的真实状态已经由 queue_update 同步过，这里不再需要强制清零兜底）
    }
  }

  /**
   * steer 队列长度变化（Harness queue_update 事件），入队与 one-at-a-time drain 都会触发。
   */
  private handleSteerQueueChanged(count: number): void {
    this.pendingSteerCount = count;
    this.emit('pendingCountChanged', { count });
    this.syncSessionState();
  }

  /**
   * 一次完整 run（含所有工具调用和插话）彻底结束（Harness settled 事件，晚于 agent_end），
   * 驱动 running=false 的最终结算。
   */
  private handleSettled(): void {
    this.running = false;
    this.syncSessionState();
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
   * 与 SDK 侧 QueryBasedSession.syncSessionState 对称的去重广播。
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
   * 工具调用权限拦截点（Harness tool_call hook）。对齐 SDK 侧 canUseTool 语义：
   * 只读工具（read/Glob/Grep）和本会话/持久化规则已允许的工具直接放行；
   * 其余工具 emit 'permissionRequest' 事件（走独立 IPC 通道，不经过 ExtendedSessionMessage 流，
   * 与 SDK 侧 conversation-runtime-service 的 permissionRequest 广播路径完全对称），
   * 挂起等待前端 respondPermissionRequest 调用来 resolve。
   *
   * 与裸 Agent 的 beforeToolCall 不同，Harness 的 tool_call hook 不带 AbortSignal 参数，
   * 因此这里不再有 signal.addEventListener('abort', ...) 的自动拒绝兜底：当前唯一会触发
   * harness 层面 abort 的路径就是 close()/interrupt()，两者都已经显式调用
   * rejectAllPendingPermissionRequests()，功能等价。
   */
  private async handleToolCall(context: HarnessToolCallEvent): Promise<HarnessToolCallResult | undefined> {
    const toolName = context.toolName;
    if (this.currentPermissionMode === 'dontAsk') {
      return undefined;
    }

    if (isPermissionExempt(toolName) || this.sessionAllowedTools.has(toolName)) {
      return undefined;
    }

    // 工具包粒度批量免确认（对齐旧 SDK allowedTools: mcp__<server>__* 通配符体验）：
    // 已启用的可选工具包 + dogear-group/dogear-delegation/dogear-memory-review 常驻放行类别，
    // 整包不弹确认（不区分包内读写工具，口径与旧 SDK 侧 conversation-runtime-service 一致）
    if (isToolInEnabledPack(toolName, this.toolPackMap, this.config.enabledToolPacks)) {
      return undefined;
    }

    const appSettings = await loadSettings();
    if (isToolPreapproved(appSettings.permissionRules?.allow, toolName)) {
      return undefined;
    }

    const requestId = `perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.logger.info('权限确认请求:', { requestId, toolName });

    return new Promise<HarnessToolCallResult | undefined>((resolve) => {
      // 必须先注册到 pending map 再 emit：respondPermissionRequest 可能被同步调用
      // （例如测试场景），emit 在前会导致 map 里还查不到这个 requestId。
      this.pendingPermissionRequests.set(requestId, { resolve, toolName, args: context.input });

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

    this.logger.info('发送用户消息到 pi 会话:', { length: text.length, isRunning, pendingSteer: this.pendingSteerCount });

    if (isRunning) {
      // 插话路径：steer 在当前 assistant turn 结束后注入（one-at-a-time 模式下排在已有队列后面）。
      // pendingSteerCount / pendingCountChanged / syncSessionState 由 onSteerQueueChanged
      // 回调（Harness queue_update 事件）驱动，这里不再手动计数。
      await adapter.steer(text);
      return;
    }

    this.running = true;
    try {
      await adapter.prompt(text);
      // settled 事件已经会触发 syncSessionState；complete 也只是给上层 conversation-runtime
      // 一个"本次 sendMessage 的 Promise resolved"信号，不代表 turn 跑完。
      this.emit('complete', { subtype: 'success' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('pi 会话执行失败:', message);
      // 兜底：harness.prompt() 在 createTurnState() 等阶段抛出时不会走到 agent_end/settled，
      // 主动清本轮 usage 状态和 running 标记，避免会话卡在"运行中"、污染下一轮
      this.currentTurnMessages = [];
      this.currentRunUsageAccum = null;
      this.running = false;
      this.emit('error', {
        type: 'error',
        error: message,
        timestamp: Date.now(),
      } as ExtendedSessionMessage);
    } finally {
      this.syncSessionState();
    }
  }

  /**
   * 空闲 = 无正在跑的 turn + 无 steer 队列 + 无挂起的权限请求。
   * PiSessionManager.release 归零直接销毁（pi 阶段一无跑步机模式），但 isIdle 仍给上层一个
   * "现在关掉是否安全"的判据。
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
    // 主动拒绝兜底（与 SDK 侧 QueryBasedSession.interrupt() 的处理方式一致）
    this.pendingSteerCount = 0;
    this.emit('pendingCountChanged', { count: 0 });
    this.rejectAllPendingPermissionRequests('用户中断');
    await this.adapter?.abort();
  }

  private rejectAllPendingPermissionRequests(reason: string): void {
    if (this.pendingPermissionRequests.size === 0) return;
    for (const [, pending] of this.pendingPermissionRequests) {
      pending.resolve({ block: true, reason });
    }
    this.pendingPermissionRequests.clear();
  }

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    this.currentPermissionMode = mode;
    this.logger.info('更改 pi 权限模式:', mode);
    this.emit('permissionModeChanged', { mode });
  }

  getPermissionMode(): PermissionMode {
    return this.currentPermissionMode;
  }

  /**
   * 响应权限确认请求，四种行为语义对齐 SDK 侧 QueryBasedSession.respondPermissionRequest：
   * - allow：本次放行；有 updatedInput 时原地改写 context.args
   * - allow_session：本次放行 + 本会话进程内记住该工具（不落盘，关闭会话即失效）
   * - always_allow：本次放行 + 落盘到 settings.permissionRules.allow（工具粒度，跨会话保留）
   * - deny：tool_call hook 返回 block，工具收到一条 error 结果
   */
  respondPermissionRequest(
    requestId: string,
    behavior: 'allow' | 'deny' | 'always_allow' | 'allow_session',
    message?: string,
    updatedInput?: Record<string, unknown>,
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

    if (updatedInput && pending.args && typeof pending.args === 'object') {
      Object.assign(pending.args as Record<string, unknown>, updatedInput);
    }

    if (behavior === 'allow_session') {
      this.sessionAllowedTools.add(pending.toolName);
    } else if (behavior === 'always_allow') {
      this.sessionAllowedTools.add(pending.toolName);
      appendPermissionAllowRules([pending.toolName]).catch((error) =>
        this.logger.warn('持久化 always_allow 规则失败:', error),
      );
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
