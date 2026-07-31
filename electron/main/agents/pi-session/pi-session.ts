/**
 * 基于 pi-ai + pi-agent-core 的会话实现（阶段二 Step 1：walking skeleton）
 *
 * 与 QueryBasedSession 是两个独立的类，长期并存，不共享运行时接口。
 * 方法面对齐 QueryBasedSession（getSessionId/start/sendMessage/close/interrupt/...），
 * 但本步骤只有 start()/sendMessage()/close()/getSessionId() 是真实实现，
 * 其余方法（权限/插话/工具相关）返回安全默认值或 no-op，留给后续 step 补全。
 */

import { EventEmitter } from 'events';
import { Agent, type AgentEvent } from '@earendil-works/pi-agent-core';
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs';
import { mainLogger } from '../logger.js';
import { resolvePiModel, buildPiModels } from '../pi/provider.js';
import { toPiTools } from '../pi/tool-adapter.js';
import { convertPiEvent } from './message-converter.js';
import { loadSkillIndex, formatSkillIndexForPrompt, createSkillTool } from './skill-loader.js';
import { loadSettings } from '../../services/settings-service.js';
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
}

enum PiSessionStatus {
  IDLE = 'idle',
  CLOSED = 'closed',
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
    const tools = toPiTools([createSkillTool(skillEntries)]);

    this.agent = new Agent({
      initialState: {
        systemPrompt,
        model,
        tools,
      },
      streamFn: (m, ctx, streamOpts) =>
        piModels.streamSimple(m, ctx, { ...streamOpts, timeoutMs: profile.apiTimeoutMs }),
    });

    this.agent.subscribe((event) => this.handleAgentEvent(event));

    this.logger.info('✅ pi 会话已创建', { profile: profile.name, tier, skills: skillEntries.map((e) => e.name) });
  }

  private handleAgentEvent(event: AgentEvent): void {
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
    }
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

    this.logger.info('发送用户消息到 pi 会话:', { length: text.length });

    try {
      await this.agent.prompt(text);
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
   * 阶段一没有插话队列/权限请求概念，agent 不在流式输出即视为空闲。
   * agent 尚未 start() 时同样视为空闲（安全默认值）。
   */
  isIdle(): boolean {
    return !this.agent?.state.isStreaming;
  }

  close(): void {
    if (this.status === PiSessionStatus.CLOSED) return;
    this.logger.info('关闭 pi 会话:', this.sessionId);

    this.agent?.abort();
    this.status = PiSessionStatus.CLOSED;

    this.emit('sessionClosed', { conversationId: this.config.conversationId });
    this.removeAllListeners();
  }

  async interrupt(): Promise<void> {
    this.agent?.abort();
  }

  /** pi 阶段一没有工具/canUseTool，因此没有权限模式概念，no-op */
  async setPermissionMode(): Promise<void> {
    this.logger.warn('setPermissionMode: pi 会话阶段一不支持权限模式，忽略');
  }

  /** pi 阶段一从不产生权限请求，no-op */
  respondPermissionRequest(): void {
    this.logger.warn('respondPermissionRequest: pi 会话阶段一从不产生权限请求，忽略');
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
