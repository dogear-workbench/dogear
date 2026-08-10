/**
 * AgentHarness 构造与事件订阅的唯一入口（阶段二 Step 2B）。
 *
 * 把 AgentHarness / Session / AgentHarnessOwnEvent 等持久化相关类型封在本文件内，
 * 对 pi-session.ts 只暴露 Dogear 语义的方法和事件回调（prompt/steer/abort + 消息/队列/settled/权限回调）。
 * pi-session.ts 仍然拿到裸 `AgentEvent`（text/thinking/tool_execution_start/end/agent_end 等），
 * 因为这批类型是 bare Agent 和 AgentHarness 共用的中立事件，不属于"Harness 专有类型"，
 * 复用现有 convertPiEvent() 不需要改造。
 */
import {
  AgentHarness,
  type AgentEvent,
  type AgentHarnessTool,
  type ExecutionEnv,
  type Session,
  type JsonlSessionMetadata,
} from '@earendil-works/pi-agent-core';
import type { Api, Model, Models, ModelThinkingLevel } from '@earendil-works/pi-ai';
import { mainLogger } from '../logger.js';

const logger = mainLogger.child('pi-harness-adapter');

/** AgentEvent 的全部 type 字面量，用于从 subscribe() 的并集事件流里筛出裸 Agent 事件 */
const AGENT_EVENT_TYPES = new Set<string>([
  'agent_start',
  'agent_end',
  'turn_start',
  'turn_end',
  'message_start',
  'message_update',
  'message_end',
  'tool_execution_start',
  'tool_execution_update',
  'tool_execution_end',
]);

export interface HarnessToolCallEvent {
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface HarnessToolCallResult {
  block?: boolean;
  reason?: string;
}

/**
 * 与裸 Agent 的 beforeToolCall 不同，Harness 的 tool_call hook 不传 AbortSignal，
 * 见 pi-session.ts handleBeforeToolCall 的调整说明。
 */
export type HarnessToolCallHandler = (
  event: HarnessToolCallEvent,
) => Promise<HarnessToolCallResult | undefined> | HarnessToolCallResult | undefined;

export interface PiHarnessAdapterOptions {
  session: Session<JsonlSessionMetadata>;
  models: Models;
  tools: AgentHarnessTool<{ env: ExecutionEnv }>[];
  toolContext: { env: ExecutionEnv };
  systemPrompt: string;
  model: Model<Api>;
  thinkingLevel: ModelThinkingLevel;
  /** 对齐旧 streamFn 里强制覆盖的 profile.apiTimeoutMs */
  timeoutMs?: number;
  /** 子会话场景的白名单工具名集合；undefined 表示全部激活（主会话）。仅列出实际已注册的工具名 */
  activeToolNames?: string[];
  /** 裸 Agent 事件透传（text/thinking/tool_execution_start/end/agent_end 等），语义与旧 agent.subscribe 完全一致 */
  onAgentEvent: (event: AgentEvent) => void;
  /** steer 队列真实长度变化（steer() 入队和 one-at-a-time drain 都会触发），替代旧的手动 +1/-1 计数 */
  onSteerQueueChanged: (steerCount: number) => void;
  /** 一次完整 run（含所有工具调用和插话）彻底结束，晚于 agent_end，用于驱动 running=false 的最终结算 */
  onSettled: () => void;
  onToolCall: HarnessToolCallHandler;
}

export class PiHarnessAdapter {
  private harness: AgentHarness<{ env: ExecutionEnv }>;

  constructor(options: PiHarnessAdapterOptions) {
    this.harness = new AgentHarness<{ env: ExecutionEnv }>({
      session: options.session,
      models: options.models,
      tools: options.tools,
      toolContext: options.toolContext,
      systemPrompt: options.systemPrompt,
      model: options.model,
      thinkingLevel: options.thinkingLevel,
      streamOptions: options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : undefined,
      activeToolNames: options.activeToolNames,
    });

    // 关键实现事实（已读 agent-harness.js 源码确认）：queue_update/settled/save_point/abort 等
    // AgentHarnessOwnEvent 走 emitOwn()，emitOwn 只遍历 subscribe() 注册的通配符监听器，
    // 完全不读取 .on(type, handler) 按类型注册的 handler map——.on() 只对 emitHook() 分发的
    // 事件类型有效（tool_call/tool_result/context/before_agent_start/before_provider_*/
    // session_before_*）。这意味着 queue_update/settled 必须在 subscribe() 里按 type 分支处理，
    // 用 .on('settled', ...) 注册会被静默忽略（handler 永远不被调用，无报错无警告）。
    this.harness.subscribe((event) => {
      if (AGENT_EVENT_TYPES.has(event.type)) {
        options.onAgentEvent(event as AgentEvent);
        return;
      }
      if (event.type === 'queue_update') {
        options.onSteerQueueChanged(event.steer.length);
        return;
      }
      if (event.type === 'settled') {
        options.onSettled();
      }
    });

    // tool_call 走 emitHook()，.on() 在这里是有效的分发路径
    this.harness.on('tool_call', (event) =>
      options.onToolCall({ toolCallId: event.toolCallId, toolName: event.toolName, input: event.input }),
    );
  }

  async prompt(text: string): Promise<void> {
    await this.harness.prompt(text);
  }

  async steer(text: string): Promise<void> {
    await this.harness.steer(text);
  }

  /**
   * await 到 harness.abort() resolve 即代表当前 run（含正在跑的工具调用）已完全结束、
   * settled 已触发——这是 close()/interrupt() 等待落盘完成的唯一同步点（harness 无独立
   * waitForIdle() 出口）。调用方必须先拒绝所有挂起的权限确认请求再调用本方法：
   * runAbortController.abort() 只发取消信号，不会主动 resolve 卡在 tool_call hook 里的
   * pending permission Promise，若不先清理会导致 harness 内部 waitForIdle() 永久等待、
   * 本方法死锁挂起。
   *
   * harness.abort() 内部把 emitQueueUpdate/waitForIdle/emitOwn 三步的异常收集进 errors[]，
   * 全部执行完后才可能抛 AggregateError；这里吞掉并 warn，不向上抛——"关闭/中断会话"是产品
   * 级操作，不应该因为 harness 内部收尾错误而卡死或让调用方处理一个无法预期的聚合异常。
   */
  async abort(): Promise<void> {
    try {
      await this.harness.abort();
    } catch (error) {
      logger.warn('harness.abort() 内部出现错误（已忽略）:', error);
    }
  }
}
