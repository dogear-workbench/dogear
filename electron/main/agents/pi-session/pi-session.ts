/**
 * 基于 pi-ai + pi-agent-core 的会话实现（阶段二 Step 1：walking skeleton）
 *
 * 与 QueryBasedSession 是两个独立的类，长期并存，不共享运行时接口。
 * 方法面对齐 QueryBasedSession（getSessionId/start/sendMessage/close/interrupt/...），
 * 但本步骤只有 start()/sendMessage()/close()/getSessionId() 是真实实现，
 * 其余方法（权限/插话/工具相关）返回安全默认值或 no-op，留给后续 step 补全。
 */

import { EventEmitter } from 'events';
import { Agent, type AgentEvent, type BeforeToolCallContext, type BeforeToolCallResult } from '@earendil-works/pi-agent-core';
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs';
import type { UserMessage } from '@earendil-works/pi-ai';
import { mainLogger } from '../logger.js';
import { resolvePiModel, buildPiModels } from '../pi/provider.js';
import { toPiTools } from '../pi/tool-adapter.js';
import { convertPiEvent } from './message-converter.js';
import { loadSkillIndex, formatSkillIndexForPrompt, createSkillTool } from './skill-loader.js';
import { createBuiltinFileTools } from './builtin-tools.js';
import { createSearchToolDefs } from './search-tools.js';
import { isPermissionExempt, isToolPreapproved } from './permission-rules.js';
import { createMemoryToolDefs } from '../tools/memory-tools.js';
import { loadSettings, appendPermissionAllowRules } from '../../services/settings-service.js';
import { getArticleParserSkillsDir } from '../../services/article-parser-skills-service.js';
import { getReviewSkillDir } from '../../services/memory/review-skill-service.js';
import type { ModelSelection, ModelProfile } from '../../services/settings-types.js';
import type { ExtendedSessionMessage } from '../task-types.js';

export interface PiSessionConfig {
  /** 所属对话 ID，用于 sessionClosed 等事件路由 */
  conversationId: string;
  /** 对话级模型选择；为空时在 start() 内回退到 settings.ai.defaultModelSelection */
  modelSelection: ModelSelection | null;
  /** 系统提示词。阶段一直接沿用全局默认提示词，不做人设/工作区/工具导览拼装 */
  systemPrompt?: string;
  /** 所属工作区绝对路径，用于文件类工具（Read/Write/Edit/Bash/Grep/Glob）的边界校验和 memory 工具存储位置 */
  workspacePath: string;
}

enum PiSessionStatus {
  IDLE = 'idle',
  CLOSED = 'closed',
}

interface PendingPermissionRequest {
  resolve: (result: BeforeToolCallResult | undefined) => void;
  toolName: string;
  /** beforeToolCall 收到的原始 args 引用；agent-loop.js 里这个引用与后续 tool.execute 用的是同一个对象，
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

export class PiSession extends EventEmitter {
  private sessionId: string;
  private config: PiSessionConfig;
  private logger = mainLogger;
  private agent: Agent | null = null;
  private status: PiSessionStatus = PiSessionStatus.IDLE;
  // 缓存当前生效的 selection/profile，供 setModel 判断是否需要重启会话
  private currentModelSelection: ModelSelection | null = null;
  private currentResolvedProfile?: ModelProfile;
  // requestId -> 挂起的权限确认请求，等待前端 respondPermissionRequest 调用来 resolve
  private pendingPermissionRequests: Map<string, PendingPermissionRequest> = new Map();
  // 本会话进程内免确认的工具名集合（allow_session 语义，不落盘，关闭会话即失效）
  private sessionAllowedTools: Set<string> = new Set();
  // steer 队列长度（pi 没暴露 .length，dogear 自己计数）。
  // pi 的 steeringMode 配置成 'one-at-a-time'：每个 turn_start drain 一条，
  // 因此 steer() 时 +1，turn_start 事件处理时 -1（不发负数）。
  private pendingSteerCount = 0;
  // sessionStateChanged 去重：记录上次广播的 running/pendingAction
  private lastEmittedRunning = false;
  private lastEmittedPendingAction = false;

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
    if (this.agent) {
      this.logger.warn('会话已经启动');
      return;
    }

    this.logger.info('=== 启动 pi 会话 ===', { sessionId: this.sessionId });

    const appSettings = await loadSettings();
    const { model, profile, tier } = resolvePiModel(
      appSettings,
      this.config.modelSelection,
      null,
      appSettings.ai.defaultModelSelection,
    );

    this.currentModelSelection = this.config.modelSelection ?? appSettings.ai.defaultModelSelection;
    this.currentResolvedProfile = profile;

    const piModels = buildPiModels(profile);

    const skillEntries = await loadSkillIndex([getArticleParserSkillsDir(), getReviewSkillDir()]);
    const skillIndexText = formatSkillIndexForPrompt(skillEntries);
    const systemPrompt = [this.config.systemPrompt ?? '', skillIndexText].filter(Boolean).join('\n\n');

    // 工具集合：builtin-tools（Read/Write/Edit/Bash，原生 pi AgentTool）
    // + toPiTools(Skill 工具 + Grep/Glob + dogear-memory 常驻工具，统一 ToolDef 形状)
    const toolDefs = [
      createSkillTool(skillEntries),
      ...createSearchToolDefs(this.config.workspacePath),
      ...createMemoryToolDefs(this.config.workspacePath),
    ];
    const tools = [...createBuiltinFileTools(this.config.workspacePath), ...toPiTools(toolDefs)];

    this.agent = new Agent({
      initialState: {
        systemPrompt,
        model,
        tools,
      },
      // 'one-at-a-time' 与 dogear 现有插话语义一致（SDK 侧 pendingMessages 也是一条条 shift 消费）：
      // 每次 steer 进队列后，在下一个 turn_start 边界只 drain 一条注入，多余的留在队列里等下个 turn。
      steeringMode: 'one-at-a-time',
      streamFn: (m, ctx, streamOpts) =>
        piModels.streamSimple(m, ctx, { ...streamOpts, timeoutMs: profile.apiTimeoutMs }),
      beforeToolCall: (context, signal) => this.handleBeforeToolCall(context, signal),
    });

    this.agent.subscribe((event) => this.handleAgentEvent(event));

    this.logger.info('✅ pi 会话已创建', { profile: profile.name, tier, skills: skillEntries.map((e) => e.name) });
  }

  private handleAgentEvent(event: AgentEvent): void {
    // turn_start：one-at-a-time 模式下 pi 在此刻 drain 一条 steer 消息。
    // 即使本次 turn 不是被 steer 触发的（比如 prompt 直接开的），只要队列里有货就会被 drain 一条，
    // 所以这里无条件在有队列时 -1。安全：if > 0 才减，防漂移。
    if (event.type === 'turn_start' && this.pendingSteerCount > 0) {
      this.pendingSteerCount--;
      this.emit('pendingCountChanged', { count: this.pendingSteerCount });
      this.syncSessionState();
    }

    const message = convertPiEvent(event);
    if (message) {
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

    // agent_end：一次完整 run（可能含多轮工具调用）结束。兜底：如果还有 steer 残留
    // （理论上 turn_start 应该已清完，但中断/异常路径可能漏发），强制归零并广播一次状态。
    if (event.type === 'agent_end') {
      if (this.pendingSteerCount > 0) {
        this.logger.warn('agent_end 时 steer 队列仍非空，强制清零:', this.pendingSteerCount);
        this.pendingSteerCount = 0;
        this.emit('pendingCountChanged', { count: 0 });
      }
      this.syncSessionState();
    }
  }

  /**
   * 与 SDK 侧 QueryBasedSession.syncSessionState 对称的去重广播。
   * running = agent.isStreaming || pendingSteerCount>0；pendingAction = pendingSteerCount>0。
   * close() 不走这里，靠 sessionClosed 让前端清 Set。
   */
  private syncSessionState(): void {
    const conversationId = this.config.conversationId;
    if (!conversationId) return;
    const running = !!this.agent?.state.isStreaming || this.pendingSteerCount > 0;
    const pendingAction = this.pendingSteerCount > 0;
    if (running !== this.lastEmittedRunning || pendingAction !== this.lastEmittedPendingAction) {
      this.lastEmittedRunning = running;
      this.lastEmittedPendingAction = pendingAction;
      this.emit('sessionStateChanged', { conversationId, running, pendingAction });
    }
  }

  /**
   * 工具调用权限拦截点。对齐 SDK 侧 canUseTool 语义：
   * 只读工具（read/Glob/Grep）和本会话/持久化规则已允许的工具直接放行；
   * 其余工具 emit 'permissionRequest' 事件（走独立 IPC 通道，不经过 ExtendedSessionMessage 流，
   * 与 SDK 侧 conversation-runtime-service 的 permissionRequest 广播路径完全对称），
   * 挂起等待前端 respondPermissionRequest 调用来 resolve。
   */
  private async handleBeforeToolCall(
    context: BeforeToolCallContext,
    signal?: AbortSignal,
  ): Promise<BeforeToolCallResult | undefined> {
    const toolName = context.toolCall.name;
    if (isPermissionExempt(toolName) || this.sessionAllowedTools.has(toolName)) {
      return undefined;
    }

    const appSettings = await loadSettings();
    if (isToolPreapproved(appSettings.permissionRules?.allow, toolName)) {
      return undefined;
    }

    const requestId = `perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.logger.info('权限确认请求:', { requestId, toolName });

    return new Promise<BeforeToolCallResult | undefined>((resolve) => {
      // 必须先注册到 pending map 再 emit：respondPermissionRequest 可能被同步调用
      // （例如测试场景），emit 在前会导致 map 里还查不到这个 requestId。
      this.pendingPermissionRequests.set(requestId, { resolve, toolName, args: context.args });

      signal?.addEventListener('abort', () => {
        if (this.pendingPermissionRequests.has(requestId)) {
          this.pendingPermissionRequests.delete(requestId);
          resolve({ block: true, reason: '操作已取消' });
        }
      });

      this.emit('permissionRequest', {
        requestId,
        toolName,
        toolInput: context.args,
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
    if (!this.agent) {
      throw new Error('会话尚未启动');
    }

    const text = typeof content === 'string' ? content : extractTextFromBlocks(content);
    const agent = this.agent;
    const isRunning = !!agent.state.isStreaming || this.pendingSteerCount > 0;

    this.logger.info('发送用户消息到 pi 会话:', { length: text.length, isRunning, pendingSteer: this.pendingSteerCount });

    if (isRunning) {
      // 插话路径：steer 在当前 assistant turn 结束后注入（one-at-a-time 模式下排在已有队列后面）。
      // prompt 的 Promise 只代表"消息进入管道"，不等整轮跑完；steer 本身是同步入队，立刻返回。
      const steerMessage: UserMessage = {
        role: 'user',
        content: text,
        timestamp: Date.now(),
      };
      agent.steer(steerMessage);
      this.pendingSteerCount++;
      this.emit('pendingCountChanged', { count: this.pendingSteerCount });
      this.syncSessionState();
      return;
    }

    try {
      await agent.prompt(text);
      // agent_end 事件已经会触发 syncSessionState；complete 也只是给上层 conversation-runtime
      // 一个"本次 sendMessage 的 Promise resolved"信号，不代表 turn 跑完。
      this.emit('complete', { subtype: 'success' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('pi 会话执行失败:', message);
      this.emit('error', {
        type: 'error',
        error: message,
        timestamp: Date.now(),
      } as ExtendedSessionMessage);
    }
  }

  /**
   * 空闲 = 无正在跑的 turn + 无 steer 队列 + 无挂起的权限请求。
   * PiSessionManager.release 归零直接销毁（pi 阶段一无跑步机模式），但 isIdle 仍给上层一个
   * "现在关掉是否安全"的判据。
   */
  isIdle(): boolean {
    return !this.agent?.state.isStreaming
      && this.pendingSteerCount === 0
      && this.pendingPermissionRequests.size === 0;
  }

  close(): void {
    if (this.status === PiSessionStatus.CLOSED) return;
    this.logger.info('关闭 pi 会话:', this.sessionId);

    this.agent?.clearAllQueues();
    this.agent?.abort();
    this.status = PiSessionStatus.CLOSED;
    this.pendingSteerCount = 0;
    this.rejectAllPendingPermissionRequests('会话已关闭');

    this.emit('sessionClosed', { conversationId: this.config.conversationId });
    this.removeAllListeners();
  }

  async interrupt(): Promise<void> {
    // 不依赖 abort signal 是否会传导到 beforeToolCall 的挂起 Promise，主动拒绝兜底
    // （与 SDK 侧 QueryBasedSession.interrupt() 的处理方式一致）
    this.agent?.clearAllQueues();
    this.pendingSteerCount = 0;
    this.emit('pendingCountChanged', { count: 0 });
    this.rejectAllPendingPermissionRequests('用户中断');
    this.agent?.abort();
  }

  private rejectAllPendingPermissionRequests(reason: string): void {
    if (this.pendingPermissionRequests.size === 0) return;
    for (const [, pending] of this.pendingPermissionRequests) {
      pending.resolve({ block: true, reason });
    }
    this.pendingPermissionRequests.clear();
  }

  /** pi 阶段一没有工具/canUseTool，因此没有权限模式概念，no-op */
  async setPermissionMode(): Promise<void> {
    this.logger.warn('setPermissionMode: pi 会话阶段一不支持权限模式，忽略');
  }

  /**
   * 响应权限确认请求，四种行为语义对齐 SDK 侧 QueryBasedSession.respondPermissionRequest：
   * - allow：本次放行；有 updatedInput 时原地改写 context.args
   * - allow_session：本次放行 + 本会话进程内记住该工具（不落盘，关闭会话即失效）
   * - always_allow：本次放行 + 落盘到 settings.permissionRules.allow（工具粒度，跨会话保留）
   * - deny：beforeToolCall 返回 block，工具收到一条 error 结果
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
