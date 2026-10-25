import { Agent, type AgentEvent, type ThinkingLevel } from '@earendil-works/pi-agent-core';
import type { Api, AssistantMessage, ImageContent, Model, Message, TextContent, ToolCall } from '@earendil-works/pi-ai';
import type { ModelProfile } from '../../services/settings-types.js';
import { type ToolDef, toPiTools } from './tool-adapter.js';
import { buildPiModels } from './provider.js';

/** 单次 runOnce 的 LLM 用量累加（口径对齐 usage-extractor 的 accumulatePiUsage：每条 AssistantMessage.usage 逐次累加） */
export interface RunOnceUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

/** 单条消息流水行：user/assistant 文本、工具调用名与参数摘要、工具结果截断 */
export interface RunOnceTranscriptLine {
  role: 'user' | 'assistant' | 'toolCall' | 'toolResult';
  /** user/assistant 文本；toolCall/toolResult 为工具名 */
  text: string;
  /** toolCall 参数 JSON（截断）；toolResult 结果文本（截断） */
  detail?: string;
  isError?: boolean;
}

const TOOL_ARG_TRACE_MAX = 400;
const TOOL_RESULT_TRACE_MAX = 600;

function toolArgsSummary(call: ToolCall): string {
  const args = JSON.stringify(call.arguments) ?? '{}';
  return args.length > TOOL_ARG_TRACE_MAX ? `${args.slice(0, TOOL_ARG_TRACE_MAX)}…` : args;
}

function buildTranscript(messages: Message[]): RunOnceTranscriptLine[] {
  const lines: RunOnceTranscriptLine[] = [];
  for (const msg of messages) {
    if (msg.role === 'user') {
      const text = typeof msg.content === 'string'
        ? msg.content
        : msg.content.filter((b): b is TextContent => b.type === 'text').map((b) => b.text).join('\n').trim();
      if (text) lines.push({ role: 'user', text });
    } else if (msg.role === 'assistant') {
      for (const block of msg.content) {
        if (block.type === 'text' && block.text.trim()) lines.push({ role: 'assistant', text: block.text.trim() });
        else if (block.type === 'toolCall') lines.push({ role: 'toolCall', text: block.name, detail: toolArgsSummary(block) });
      }
    } else if (msg.role === 'toolResult') {
      const text = msg.content.filter((b): b is TextContent => b.type === 'text').map((b) => b.text).join('\n').trim();
      lines.push({
        role: 'toolResult',
        text: msg.toolName,
        detail: text.length > TOOL_RESULT_TRACE_MAX ? `${text.slice(0, TOOL_RESULT_TRACE_MAX)}…` : text,
        isError: msg.isError,
      });
    }
  }
  return lines;
}

function extractRunOutcome(messages: Extract<AgentEvent, { type: 'agent_end' }>['messages']): {
  lastText?: string;
  usage?: RunOnceUsage;
} {
  let lastText: string | undefined;
  let usage: RunOnceUsage | undefined;
  for (const msg of messages) {
    if ((msg as AssistantMessage).role !== 'assistant') continue;
    const assistant = msg as AssistantMessage;
    const text = assistant.content
      .filter((block): block is TextContent => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();
    if (text) lastText = text;
    const u = assistant.usage;
    if (u) {
      usage = usage ?? { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };
      usage.inputTokens += u.input ?? 0;
      usage.outputTokens += u.output ?? 0;
      usage.cacheReadInputTokens += u.cacheRead ?? 0;
      usage.cacheCreationInputTokens += u.cacheWrite ?? 0;
    }
  }
  return { lastText, usage };
}

/** 续跑兜底：某些模型在多步工具链中途会输出「宣布下一步」的纯文本就结束回合（无工具调用），
 * agent 循环视为任务完成。调用方用 revive 在「未完成但轮次未尽」时自动续跑。 */
export interface ReviveOptions {
  /** prompt 结束后调用，返回 true 表示任务未完成需要续跑 */
  shouldContinue: () => boolean;
  /** 续跑注入的提示词（可用函数按当前进度生成） */
  continuePrompt: string | (() => string);
  /** 最多续跑次数，默认 3 */
  maxRevives?: number;
}

/**
 * 对 pi Agent 发起一次性提炼任务，带轮次上限与外部取消支持。
 * 不抛出——失败以 { ok: false } 形式返回。
 */
export async function runOnce(opts: {
  systemPrompt?: string;
  prompt: string;
  images?: ImageContent[];
  tools: ToolDef[];
  model: Model<Api>;
  profile: ModelProfile;
  thinkingLevel?: ThinkingLevel;
  signal?: AbortSignal;
  maxTurns?: number;
  revive?: ReviveOptions;
  onLog?: (msg: string) => void;
  /** agent_end 时透出全量消息流水（排障留痕用；其他调用方零影响） */
  collectMessages?: boolean;
}): Promise<
    { ok: true; lastText?: string; usage?: RunOnceUsage; transcript?: RunOnceTranscriptLine[] }
    | { ok: false; error: string; cancelled?: boolean; transcript?: RunOnceTranscriptLine[] }
  > {
  const { systemPrompt = '', prompt, images, tools, model, profile, thinkingLevel = 'off', signal, maxTurns = 30, onLog } = opts;

  let turnCount = 0;
  let hitTurnLimit = false;
  let cancelled = false;
  let outcome: { lastText?: string; usage?: RunOnceUsage } = {};
  let transcript: RunOnceTranscriptLine[] | undefined;

  const piModels = buildPiModels(profile);

  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      tools: toPiTools(tools),
      thinkingLevel,
    },
    streamFn: (m, ctx, streamOpts) =>
      piModels.streamSimple(m, ctx, { ...streamOpts, timeoutMs: profile.apiTimeoutMs }),
    finishTurn: async (turn) => {
      turnCount++;
      if (turnCount >= maxTurns) {
        if (turn.toolResults.length > 0) hitTurnLimit = true;
        return { action: 'end' };
      }
      return undefined;
    },
  });

  agent.subscribe((e) => {
    if (e.type === 'tool_execution_start') {
      onLog?.(`[tool] ${e.toolName}`);
    } else if (e.type === 'tool_execution_end' && e.isError) {
      const raw = typeof e.result?.content?.[0]?.text === 'string'
        ? e.result.content[0].text
        : String(e.result ?? '');
      onLog?.(`[tool-error] ${e.toolName}: ${raw.slice(0, 300)}`);
    } else if (e.type === 'agent_end') {
      onLog?.(`[done] turns=${turnCount}`);
      outcome = extractRunOutcome(e.messages);
      if (opts.collectMessages) transcript = buildTranscript(e.messages);
    }
  });

  if (signal?.aborted) {
    return { ok: false, error: '已取消', cancelled: true };
  }
  if (signal) {
    signal.addEventListener('abort', () => {
      cancelled = true;
      agent.abort();
    }, { once: true });
  }

  try {
    await agent.prompt(prompt, images);
    let revives = 0;
    while (
      !cancelled && !hitTurnLimit && opts.revive
      && revives < (opts.revive.maxRevives ?? 3)
      && !signal?.aborted
      && opts.revive.shouldContinue()
    ) {
      revives++;
      onLog?.(`[revive] 收笔未完成，第 ${revives} 次续跑`);
      const msg = typeof opts.revive.continuePrompt === 'function'
        ? opts.revive.continuePrompt()
        : opts.revive.continuePrompt;
      await agent.prompt(msg);
    }
  } catch (e) {
    if (cancelled) return { ok: false, error: '已取消', cancelled: true, transcript };
    return { ok: false, error: e instanceof Error ? e.message : String(e), transcript };
  }

  if (cancelled) return { ok: false, error: '已取消', cancelled: true, transcript };
  if (hitTurnLimit) return { ok: false, error: `超过最大轮次 ${maxTurns}`, transcript };
  return { ok: true, ...outcome, transcript };
}
