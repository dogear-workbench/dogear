/**
 * pi-durable Harness（1.3.0 durable 目录格式）构造、事件订阅与 pause 的唯一入口。
 *
 * 把 Harness / Conversation / Submission / watchEvents 等 durable 类型封在本文件内，
 * 对 pi-session.ts 只暴露 Dogear 语义的方法和事件回调（prompt/steer/abort + 消息/队列/settled/权限回调）。
 *
 * durable 事件模型：watchEvents(harness, conversationId) 返回 AgentEventStream，listener 按
 * commit 批次接收 AgentEvent（0.99.2 的 harness.events.on 按类型注册已废弃）；
 * prompt/steer/compact/abort 下沉到 Conversation/Submission API。
 * 对外广播协议不变：Dogear 侧回调语义与 0.83 完全一致，durable 事件名/载荷 → Dogear 事件的
 * 映射全部在本文件与 message-converter 内完成。
 *
 * ⚠ listener 抛异常会终止整个事件流（CommittedWatch 以 listener_error 收尾）——listener 内
 * 必须防御一切异常（handleEvent 内 try/catch），且同步执行、不 await 任何 harness 方法。
 * 批次派发在微任务上，与 Submission.wait() 等操作 resolve 的先后无保证。
 *
 * settled 双信号：durable 同样没有 settled 事件。onSettled 统一在 drive（prompt/compact 的
 * wait resolve）与 run_end 事件都到达后触发一次，消除派发时序差；abort 路径 run_end 同样
 * 只结算一次。compact 是独立 task 不产生 run_end，不再需要 0.99.2 的 suppressSettle。
 */
import {
  createRegistry,
  Harness,
  watchEvents,
  type AgentEvent,
  type AgentEventStream,
  type CompactionPolicy,
  type CompactionFailure,
  type Conversation,
  type ConversationId,
  type Extension,
  type InputEntry,
  type PromptSection,
  type SubmissionId,
  type ToolExecutionResult,
  type ToolHookCall,
  type ToolHooks,
  type ToolRegistration,
  type WatchEnd,
} from '@earendil-works/pi-durable';
import type { ExecutionEnv } from '@earendil-works/pi-durable/env';
import type { JsonlStorage } from '@earendil-works/pi-durable/storage/jsonl/node';
import { createToolSearchExtension, createToolSearchTool } from '@earendil-works/pi-durable/tool-search';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { Api, ImageContent, Model, Models, ModelThinkingLevel } from '@earendil-works/pi-ai';
import { mainLogger } from '../logger.js';

const logger = mainLogger.child('pi-harness-adapter');

const DOGEAR_EXTENSION = 'dogear';

/** 转发给 onAgentEvent 的 durable 事件集合（对应 0.83 的裸 Agent 事件集；其余 durable 事件内部消费） */
const FORWARDED_AGENT_EVENT_TYPES = [
  'run_start',
  'run_end',
  'turn_start',
  'turn_end',
  'message_start',
  'message_update',
  'message_end',
  'tool_execution_start',
  'tool_execution_update',
  'tool_execution_end',
] as const;

export type PiHarnessAgentEvent = Extract<AgentEvent, { type: (typeof FORWARDED_AGENT_EVENT_TYPES)[number] }>;

export interface HarnessToolCallEvent {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}

/** 内层溢出保护参数按窗口推导：128K≈上游默认，200K 起封顶=上游默认，仅对小窗口收紧；backgroundTokens=0 关闭后台压缩（0.83 语义无此层） */
export function deriveCompactionSettings(contextWindow: number): Partial<CompactionPolicy> {
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  return {
    enabled: true,
    reserveTokens: clamp(Math.round(contextWindow * 0.125), 4096, 16384),
    keepRecentTokens: clamp(Math.round(contextWindow * 0.15), 6144, 20000),
    backgroundTokens: 0,
  };
}

/** 压缩失败持续态信号：failed=置位（error 为失败原因），failed=false=已恢复（下次压缩成功落 summary） */
export interface CompactionFailureSignal {
  failed: boolean;
  error?: string;
}

/**
 * 从 durable 事件流推导 snapshot.compactionFailure 持续态。该字段只在 snapshot（溢出替代/attach
 * 初始态）里整体出现，不产生独立事件；但其写入（compaction task failed/faulted/orphaned）与
 * compaction_end(error) 同 commit，清除与 summary entry 落盘（entry_appended kind=pi.compaction）
 * 同 commit，因此按这两类事件精确推导，snapshot 分支仅做对账（漏事件或重启恢复时校正）。
 */
export class CompactionFailureTracker {
  private failure: CompactionFailure | undefined;

  isFailed(): boolean {
    return this.failure !== undefined;
  }

  current(): CompactionFailure | undefined {
    return this.failure;
  }

  /** 处理一个 durable 事件，状态翻转时返回信号，否则返回 undefined */
  consume(event: AgentEvent): CompactionFailureSignal | undefined {
    switch (event.type) {
      case 'compaction_end': {
        if (!event.error || this.failure) return undefined;
        this.failure = { taskId: event.taskId as CompactionFailure['taskId'], reason: event.reason, error: event.error };
        return { failed: true, error: event.error };
      }
      case 'entry_appended': {
        if (event.entry.kind !== 'pi.compaction' || !this.failure) return undefined;
        this.failure = undefined;
        return { failed: false };
      }
      case 'snapshot': {
        const failure = event.compactionFailure;
        const failed = failure !== undefined;
        if (failed === (this.failure !== undefined)) return undefined;
        this.failure = failure;
        return failed ? { failed: true, error: failure.error } : { failed: false };
      }
      default:
        return undefined;
    }
  }
}

/** inbox_update 载荷中 steer 项计数（followUp/summary write 不在前端队列语义内） */
function countSteerItems(items: readonly { mode: string }[]): number {
  let count = 0;
  for (const item of items) {
    if (item.mode === 'steer') count += 1;
  }
  return count;
}

export interface HarnessToolCallResult {
  block?: boolean;
  reason?: string;
}

export type HarnessToolCallHandler = (
  event: HarnessToolCallEvent,
) => Promise<HarnessToolCallResult | undefined> | HarnessToolCallResult | undefined;

export interface PiHarnessAdapterOptions {
  /** durable 存储实例（来自 repository.open/create，所有权随 Harness.open 转移，close 时一并释放） */
  storage: JsonlStorage;
  /** durable 主 conversation id（repository 预 mint，每目录独立数字空间的首个 conversation） */
  conversationId: number;
  models: Models;
  tools: ToolRegistration[];
  /** 工具执行环境（HarnessOptions.env 工厂每次调用返回该实例；热更新 allowedPaths 走实例方法） */
  env: ExecutionEnv;
  systemPrompt: string;
  model: Model<Api>;
  thinkingLevel: ModelThinkingLevel;
  /** 对齐旧 streamFn 里强制覆盖的 profile.apiTimeoutMs */
  timeoutMs?: number;
  /** 子会话场景的白名单工具名集合；undefined 表示全部激活（主会话）。仅列出实际已注册的工具名 */
  activeToolNames?: string[];
  /** durable 事件透传（tool_execution_* 等 durable 事件名），Dogear 消息转换由消费方的 convertPiEvent 完成 */
  onAgentEvent: (event: PiHarnessAgentEvent) => void;
  /** compaction summary 落盘（entry_appended kind=pi.compaction，含手动与 durable 内置压缩），携带 compaction entry id */
  onSessionCompact?: (compactionEntryId: string) => void;
  /** steer 队列长度变化（inbox_update），入队与 drain 都会触发 */
  onSteerQueueChanged: (steerCount: number) => void;
  /** 压缩失败持续态翻转（置位/恢复），仅翻转时触发；attach 时的初始态经 getCompactionFailure 查询 */
  onCompactionFailure?: (signal: CompactionFailureSignal) => void;
  /** 一次完整 run（含所有工具调用和插话）彻底结束，晚于 run_end 转发，用于驱动 running=false 的最终结算 */
  onSettled: () => void;
  onToolCall: HarnessToolCallHandler;
  /** 工具调用完成旁路（工具名/成败/耗时，不含参数）；回调异常只 warn 不影响工具执行 */
  onToolUsage?: (info: { toolName: string; ok: boolean; durationMs: number }) => void;
}

export class PiHarnessAdapter {
  private harness: Harness;
  private conversation: Conversation;
  private stream: AgentEventStream | null = null;
  private pauseRequested = false;
  /** adapter 发起的 drive（prompt/compact）在途数；归零且见 run_end 后才允许结算 onSettled */
  private drivesInFlight = 0;
  /** 已到达未消费的 run_end 计数 */
  private runEndsSeen = 0;
  private sessionFailed = false;
  private onAgentEvent: (event: PiHarnessAgentEvent) => void;
  private onSessionCompact?: (compactionEntryId: string) => void;
  private onSteerQueueChanged: (steerCount: number) => void;
  private onCompactionFailure?: (signal: CompactionFailureSignal) => void;
  private onSettled: () => void;
  private readonly compactionFailureTracker = new CompactionFailureTracker();
  private onToolCall: HarnessToolCallHandler;

  private constructor(harness: Harness, conversation: Conversation, options: PiHarnessAdapterOptions) {
    this.harness = harness;
    this.conversation = conversation;
    this.onAgentEvent = options.onAgentEvent;
    this.onSessionCompact = options.onSessionCompact;
    this.onSteerQueueChanged = options.onSteerQueueChanged;
    this.onCompactionFailure = options.onCompactionFailure;
    this.onSettled = options.onSettled;
    this.onToolCall = options.onToolCall;
  }

  /**
   * 异步工厂：registry 装配（工具 + system section + 权限/pause hooks）→ Harness.open →
   * conversation 定位与 configure → 事件流 attach → 遗留 run 清场。
   * 恢复会话可能带遗留 live task（上次进程中断时未收尾的 run，durable 调度恢复会继续执行），
   * 对齐 0.83 重启语义：conversation.abort 一律终止、withdraw 遗留排队输入，不恢复执行
   * （idle 时为 no-op）。abort 会启用调度，因此清场即 activation 点。
   */
  static async create(options: PiHarnessAdapterOptions): Promise<PiHarnessAdapter> {
    const registry = createRegistry<ToolRegistration>();
    let adapter: PiHarnessAdapter | undefined;
    const toolStartTimes = new Map<string, number>();
    const section: PromptSection = { key: `${DOGEAR_EXTENSION}-system`, tag: false, render: () => options.systemPrompt };
    const extension: Extension = {
      name: DOGEAR_EXTENSION,
      tools: options.tools,
      sections: [section],
      hooks: [{
        task: 'pi.tool',
        handlers: {
          beforeTool: async (call: ToolHookCall) => {
            const decision = await options.onToolCall({
              toolCallId: call.id,
              toolName: call.name,
              input: call.arguments,
            });
            if (decision?.block) return { block: decision.reason ?? '该工具调用已被阻止' };
            toolStartTimes.set(call.id, Date.now());
            return undefined;
          },
          afterTool: (call: ToolHookCall, result: ToolExecutionResult) => {
            const startedAt = toolStartTimes.get(call.id);
            if (startedAt !== undefined) {
              toolStartTimes.delete(call.id);
              if (options.onToolUsage) {
                try {
                  options.onToolUsage({ toolName: call.name, ok: !result.isError, durationMs: Date.now() - startedAt });
                } catch (error) {
                  logger.warn('onToolUsage 回调失败:', error);
                }
              }
            }
            return (adapter?.pauseRequested ? { ...result, control: { terminate: true as const } } : result);
          },
        } satisfies ToolHooks,
      }],
    };
    registry.install(extension);
    // 有按需工具才装 tool_search：搜索面为空时该工具只会返回 no match，纯噪音
    const hasDeferredTools = options.tools.some((tool) => tool.deferred);
    if (hasDeferredTools) registry.install(createToolSearchExtension());

    const harness = await Harness.open(
      options.storage,
      {
        models: options.models,
        registry,
        settings: {
          ...(options.timeoutMs !== undefined ? { stream: { timeoutMs: options.timeoutMs } } : {}),
          compaction: deriveCompactionSettings(options.model.contextWindow),
        },
        env: () => options.env,
        onReport: (error) => logger.warn('harness 非致命错误:', error),
      },
      BACKGROUND_CONTEXT,
    );
    const conversation = await harness.conversation(options.conversationId as ConversationId, BACKGROUND_CONTEXT);
    if (!conversation) {
      await harness.close(BACKGROUND_CONTEXT).catch(() => {});
      throw new Error(`durable conversation 不存在：${options.conversationId}`);
    }
    await conversation.configure(
      {
        model: { provider: options.model.provider, modelId: options.model.id },
        thinkingLevel: options.thinkingLevel,
        ...(options.activeToolNames
          ? {
              tools: hasDeferredTools
                ? [...options.tools.filter((tool) => options.activeToolNames!.includes(tool.name)), createToolSearchTool()]
                : options.tools.filter((tool) => options.activeToolNames!.includes(tool.name)),
            }
          : {}),
      },
      BACKGROUND_CONTEXT,
    );
    adapter = new PiHarnessAdapter(harness, conversation, options);
    const stream = await watchEvents(harness, options.conversationId as ConversationId, BACKGROUND_CONTEXT);
    adapter.stream = stream;
    stream.start(async (events) => {
      for (const event of events) adapter!.handleEvent(event);
    });
    adapter.compactionFailureTracker.consume(stream.snapshot);
    void stream.closed.then((end) => adapter!.handleStreamClosed(end));
    await conversation.abort(BACKGROUND_CONTEXT);
    return adapter;
  }

  /** 单事件防御：listener 抛异常会终止事件流，任何转换/回调错误只 warn */
  private handleEvent(event: AgentEvent): void {
    try {
      this.dispatch(event);
    } catch (error) {
      logger.warn(`agent 事件处理失败（type=${event.type}）:`, error);
    }
  }

  isSessionFailed(): boolean {
    return this.sessionFailed;
  }

  /** 压缩失败持续态当前值（attach 时已从初始 snapshot 对账），供会话创建后同步初始态 */
  getCompactionFailure(): CompactionFailureSignal {
    return this.compactionFailureTracker.isFailed()
      ? { failed: true, error: this.compactionFailureTracker.current()?.error }
      : { failed: false };
  }

  private feedCompactionFailure(event: AgentEvent): void {
    const signal = this.compactionFailureTracker.consume(event);
    if (signal) this.onCompactionFailure?.(signal);
  }

  private handleStreamClosed(end: WatchEnd): void {
    if (end.reason !== 'session_failed' && end.reason !== 'listener_error') return;
    if (end.reason === 'session_failed') this.sessionFailed = true;
    logger.error(`agent 事件流终止（${end.reason}），会话不再接收事件:`, end.error);
  }

  private dispatch(event: AgentEvent): void {
    switch (event.type) {
      case 'run_start':
        this.onAgentEvent(event);
        return;
      case 'message_update':
        this.onAgentEvent(event);
        return;
      case 'message_end':
        // 终态差量兑底（零 partial 快速响应与尾部缺块）在 converter 的 message_end 处理，
        // adapter 只透传
        this.onAgentEvent(event);
        return;
      case 'run_end':
        this.runEndsSeen += 1;
        this.onAgentEvent(event);
        this.maybeEmitSettled();
        return;
      case 'inbox_update':
        this.onSteerQueueChanged(countSteerItems(event.items));
        return;
      case 'entry_appended':
        if (event.entry.kind === 'pi.compaction') {
          this.onSessionCompact?.(String(event.entry.id));
          this.feedCompactionFailure(event);
        }
        return;
      case 'compaction_end':
        if (event.error) logger.warn(`compaction 失败（${event.reason}）:`, event.error);
        this.feedCompactionFailure(event);
        return;
      case 'snapshot':
        logger.warn('agent 事件流积压溢出，一批增量被快照替代（该轮前端增量展示可能缺块）');
        this.feedCompactionFailure(event);
        return;
      case 'task_failed':
        logger.warn(`durable task 失败（${event.kind}）:`, event.message);
        return;
      default:
        if (isForwardedEvent(event)) this.onAgentEvent(event);
    }
}

  private maybeEmitSettled(): void {
    if (this.drivesInFlight > 0 || this.runEndsSeen === 0) return;
    this.runEndsSeen = 0;
    this.onSettled();
  }

  private beginDrive(): void {
    this.drivesInFlight += 1;
    this.runEndsSeen = 0;
  }

  private endDrive(): void {
    this.drivesInFlight -= 1;
    this.maybeEmitSettled();
  }

  /**
   * 请求在当前轮收尾后暂停。机制：pi.tool 的 afterTool hook 命中 pauseRequested 时给结果附加
   * control.terminate，当前轮工具批次完成后 run 收尾（不再发下一轮请求）；无工具轮在
   * may_finish boundary 天然停点。恢复由消费方清标志后走 prompt。
   * 队列里已排队的 steer/followUp 不做任何处理：terminate 只挡新一轮 LLM 请求，已排队的
   * 插话会在暂停生效前被 drain 并回答，与 0.83「插话存队列等恢复注入」的行为差异已由产品
   * 接受记档；消息不丢失。
   */
  requestPause(): void {
    this.pauseRequested = true;
  }

  clearPause(): void {
    this.pauseRequested = false;
  }

  isPauseRequested(): boolean {
    return this.pauseRequested;
  }

  /** 主 conversation 的模型上下文消息（供 CTX 快照的构成估算）；system 消息是 durable 定位段，不计入消息桶 */
  async getContextMessages(): Promise<AgentMessage[]> {
    const view = await this.conversation.context(BACKGROUND_CONTEXT);
    return view.messages.filter((message) => message.role !== 'system') as AgentMessage[];
  }

  /**
   * 发起一轮新对话。idle 才可调用（busy 时 submit 以 reject 拒绝，对齐 0.99.2 的 LaneBusy）；
   * wait() 覆盖整个 run（含工具调用与插话 drain），abort 路径以 unanswered 收尾静默返回。
   */
  async prompt(text: string, images?: ImageContent[], entry?: InputEntry): Promise<void> {
    this.beginDrive();
    try {
      const submission = await this.conversation.submit(
        { type: 'input', content: toUserContent(text, images), whenBusy: 'reject', ...(entry ? { entry } : {}) },
        BACKGROUND_CONTEXT,
      );
      await submission.wait(BACKGROUND_CONTEXT);
    } finally {
      this.endDrive();
    }
  }

  /** 插话入队（one-at-a-time 模式下排在已有队列后面），入队即返回；恰好 idle 时会直接开跑（0.99.2 抛 invalid_state 的场景降级为正常发送，消息不丢） */
  async steer(text: string, images?: ImageContent[], entry?: InputEntry): Promise<void> {
    await this.conversation.submit(
      { type: 'input', content: toUserContent(text, images), whenBusy: 'steer', ...(entry ? { entry } : {}) },
      BACKGROUND_CONTEXT,
    );
  }

  /**
   * 手动压缩：要求 conversation idle（调用方保证）。等待压缩 task 终态并解析 summary entry
   * （conversation-owned 压缩的 summary 经 write submission 放置，等 submission 落定拿 entryId），
   * 同步回调 onSessionCompact——不依赖事件批次的异步派发时序。无可压缩内容（结果无 entry）
   * 与失败终态转异常上抛，由调用方处置。
   */
  async compact(): Promise<void> {
    this.beginDrive();
    try {
      const taskId = await this.conversation.compact(undefined, BACKGROUND_CONTEXT);
      const settled = await this.harness.waitForTask(taskId, BACKGROUND_CONTEXT);
      const outcome = settled.state.outcome;
      if (outcome.status !== 'completed') {
        const message = outcome.status === 'failed' || outcome.status === 'faulted'
          ? outcome.error.message
          : outcome.status === 'orphaned'
            ? outcome.reason
            : '压缩已被中断';
        throw new Error(message);
      }
      const entryId = outcome.result.entryId ?? (await this.resolveCompactionEntry(outcome.result.submissionId));
      if (entryId === undefined) throw new Error('Nothing to compact');
      this.onSessionCompact?.(String(entryId));
    } finally {
      this.endDrive();
    }
  }

  private async resolveCompactionEntry(submissionId: SubmissionId | undefined): Promise<number | undefined> {
    if (submissionId === undefined) return undefined;
    const submission = await this.harness.submission(submissionId, BACKGROUND_CONTEXT);
    if (!submission) throw new Error(`compaction summary submission 不存在：${submissionId}`);
    const record = await submission.wait(BACKGROUND_CONTEXT);
    if (record.status === 'unanswered') {
      throw new Error(`compaction summary 未能放置（${record.reason}）`);
    }
    return record.entry;
  }

  /**
   * 终止当前 run（无 run 时为 no-op）。await resolve 即 conversation 已 idle（durable abort
   * 内含 mark + signal + waitForIdle）——这是 close()/interrupt() 等待落盘完成的唯一同步点。
   * 调用方必须先拒绝所有挂起的权限确认请求：卡在 beforeTool hook 里的 pending Promise 若不
   * resolve，run 走不到终态，本方法会一直等待（见 pi-session doClose 的调用顺序）。
   * SessionFailed 与内部错误都吞掉 warn，不向上抛——"关闭/中断会话"是产品级操作，不应因
   * harness 收尾错误卡死或抛出无法预期的异常。
   */
  async abort(): Promise<void> {
    try {
      await this.conversation.abort(BACKGROUND_CONTEXT);
    } catch (error) {
      logger.warn('conversation.abort() 出现错误（已忽略）:', error);
    }
  }

  /** 关闭 harness（内含 storage.close，释放 repository 交付的存储实例）。调用方须保证单次（pi-session closingPromise 已保证） */
  async close(): Promise<void> {
    await this.harness.close(BACKGROUND_CONTEXT);
  }
}

function toUserContent(text: string, images?: ImageContent[]): string | (ImageContent | { type: 'text'; text: string })[] {
  if (!images || images.length === 0) return text;
  return [{ type: 'text' as const, text }, ...images];
}

function isForwardedEvent(event: AgentEvent): event is PiHarnessAgentEvent {
  return (FORWARDED_AGENT_EVENT_TYPES as readonly string[]).includes(event.type);
}
