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
import type { AgentEvent, AgentHarnessTool, ExecutionEnv, Session, JsonlSessionMetadata, AgentMessage } from '@earendil-works/pi-agent-core';
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs';
import type { PiPermissionMode } from './permission-mode.js';
import type { AssistantMessage, ImageContent } from '@earendil-works/pi-ai';
import { mainLogger } from '../logger.js';
import { resolvePiModel, buildPiModels } from '../pi/provider.js';
import { lookupContextWindow } from '../pi/model-catalog.js';
import { toPiTools, type ToolDef } from '../pi/tool-adapter.js';
import { convertPiEvent } from './message-converter.js';
import { loadSkillIndex, formatSkillIndexForPrompt, createSkillTool, type SkillEntry } from './skill-loader.js';
import { WorkspaceExecutionEnv } from './workspace-execution-env.js';
import { createBuiltinFileTools } from './builtin-tools.js';
import { killConversationTerminals } from '../../services/pty-service.js';
import { PiHarnessAdapter, type HarnessToolCallEvent, type HarnessToolCallResult } from './pi-harness-adapter.js';
import { createSearchToolDefs } from './search-tools.js';
import { buildGroupContextPrompt } from '../group-context-builder.js';
import { MEMORY_GUIDANCE_APPEND, subAgentContractFor, MAIN_AGENT_DELEGATION_APPEND, buildSubAgentProfileIndex, NOTES_DISCIPLINE_APPEND } from '../session-append-templates.js';
import { resolveAbilities, ABILITY_PACKS, TOOL_PACK_TO_ABILITY } from '../ability-registry.js';
import { isBasicToolName, decideToolPermission } from './permission-rules.js';
import { createMemoryToolDefs } from '../tools/memory-tools.js';
import { createArticleToolDefs } from '../tools/article-tools.js';
import { createBrowserToolDefs } from '../tools/browser-tools.js';
import { createExtensionToolDefs } from '../tools/extension-tools.js';
import { createStockToolDefs } from '../tools/stock-tools.js';
import { createStockAnalysisToolDefs } from '../tools/stock-analysis-tools.js';
import { createAnnouncementToolDefs } from '../tools/stock-announcement-tools.js';
import { createStockPickingToolDefs } from '../tools/stock-picking-tools.js';
import { createGroupToolDefs } from '../tools/group-tools.js';
import { createDelegationToolDefs, type DelegationToolsOpts } from '../tools/delegation-tools.js';
import { createNotesToolDefs } from '../tools/notes-tools.js';
import { createTaskToolDefs } from '../tools/task-tools.js';
import { createGroupContextToolDefs, createSiblingToolDefs, createHistorySearchToolDefs } from '../tools/reference-tools.js';
import { OPTIONAL_TOOL_PACKS } from '../../services/tool-packs.js';
import { loadSettings, getConfigDir } from '../../services/settings-service.js';
import { loadCoreProfileForSession } from '../../services/memory/memory-loader.js';
import { getTemplatesDir } from '../../services/skill-template-service.js';
import { getWorkspaceConfig } from '../../services/workspace-config-service.js';
import {
  createPiUsageAccumulator,
  accumulatePiUsage,
  extractPiContextSnapshot,
  extractPiUsageEntry,
  type PiUsageAccumulator,
} from './usage-extractor.js';
import type { ModelSelection, BasicToolPermissions, SubAgentProfile } from '../../services/settings-types.js';
import type { ExtendedSessionMessage, InjectionTag } from '../task-types.js';
import type { CompactMarker } from '../../types.js';
import { getPiSessionRepository } from './pi-session-repository.js';

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
  permissionMode: PiPermissionMode;
  basicToolPermissions: BasicToolPermissions;
  /** usage turnIndex 起始值：manager 建会话时从该会话 usage JSONL 尾部 ENTRY 读出（+1），缺省 0（全新会话） */
  usageTurnIndexStart?: number;
}

export interface PiSessionLiveSnapshot {
  messages: ExtendedSessionMessage[];
  /** 本 run 已落盘 entry 的 SessionTreeEntry.id 序列（与 messages 同生命周期），供前端历史去重/ID 对齐 */
  turnEntryIds: string[];
  permissionRequests: Array<{
    requestId: string;
    toolName: string;
    toolInput: unknown;
  }>;
  sessionState: {
    running: boolean;
    pendingAction: boolean;
    paused: boolean;
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

/**
 * 子会话按 Profile 过滤 skill entries。
 * builtin 段：article-parser 仅当 article===true，browser-exploration 仅当 browser===true，其余按 skills[] 匹配；
 * custom 段：仅保留 skills[] 中列出的；
 * user 段：仅保留 customSkills[] 中列出的。
 */
function filterSkillsForSubAgent(
  entries: SkillEntry[],
  profile: SubAgentProfile,
  scanDirs: { builtin: string; custom: string; user: string },
): SkillEntry[] {
  const ab = profile.enabledAbilities;
  const isUnder = (filePath: string, dir: string): boolean => {
    const rel = path.relative(dir, filePath);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  };
  return entries.filter((entry) => {
    const fp = entry.bodyPath;
    if (isUnder(fp, scanDirs.builtin)) {
      if (entry.name === 'article-parser') return ab.article === true;
      if (entry.name === 'browser-exploration') return ab.browser === true;
      return ab.skills?.includes(entry.name) ?? false;
    }
    if (isUnder(fp, scanDirs.custom)) return ab.skills?.includes(entry.name) ?? false;
    if (isUnder(fp, scanDirs.user)) return ab.customSkills?.includes(entry.name) ?? false;
    return false;
  });
}

/**
 * 计算子会话的 activeToolNames（白名单）。主会话返回 undefined = 全部激活。
 *
 * 基础文件工具（read/write/edit/bash）不在 toolDefs 中但始终创建，取 enabledBasicTools 的交集；
 * read_terminal/kill_terminal 无独立开关，跟随 bash 联动激活。
 * toolDefs 中的 Glob/Grep 属基础工具，靠 enabledBasicTools 控制可见性。
 * toolDefs 中的 Skill 工具如果已创建（有勾选 skill）则始终激活。
 * 非基础工具（能力域工具）一旦创建即激活。
 */
function computeSubAgentActiveTools(profile: SubAgentProfile, toolDefs: ToolDef[]): string[] {
  const names = new Set<string>();
  const enabledBasicSet = new Set(profile.enabledBasicTools);
  const BUILTIN_FILE_TOOLS = new Set(['read', 'write', 'edit', 'bash', 'read_terminal', 'kill_terminal']);

  for (const name of profile.enabledBasicTools) {
    if (BUILTIN_FILE_TOOLS.has(name)) names.add(name);
    if (name === 'bash') {
      names.add('read_terminal');
      names.add('kill_terminal');
    }
  }

  for (const def of toolDefs) {
    if (isBasicToolName(def.name) && def.name !== 'Skill') {
      if (enabledBasicSet.has(def.name)) names.add(def.name);
    } else {
      names.add(def.name);
    }
  }

  return [...names];
}

/** 把 SDK 风格的 ContentBlockParam[] 拆成 text + pi-ai ImageContent[]（tipc 传来的 Anthropic 形状 base64 image 块在此转换；url 形状与其他非文本块不支持，静默丢弃） */
function splitContentBlocks(blocks: ContentBlockParam[]): { text: string; images: ImageContent[] } {
  const texts: string[] = [];
  const images: ImageContent[] = [];
  for (const block of blocks) {
    if (!block || typeof block !== 'object' || !('type' in block)) continue;
    if (block.type === 'text') {
      texts.push((block as { text: string }).text);
    } else if (block.type === 'image' && block.source.type === 'base64') {
      images.push({ type: 'image', data: block.source.data, mimeType: block.source.media_type });
    }
  }
  return { text: texts.join('\n'), images };
}

/** 口径对齐 pi-agent-core compaction 的 calculateContextTokens：totalTokens 优先，否则 input+output+cacheRead+cacheWrite */
function extractLastContextTokens(messages: Extract<AgentEvent, { type: 'agent_end' }>['messages']): number | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as { role?: string; stopReason?: string };
    if (msg.role !== 'assistant' || msg.stopReason === 'aborted' || msg.stopReason === 'error') continue;
    const usage = (msg as AssistantMessage).usage;
    if (!usage) continue;
    const total = usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
    if (total > 0) return total;
  }
  return undefined;
}

/** 提取落盘 user 消息的纯文本（string 或 TextContent[] 两种形状） */
function userMessageText(message: AgentMessage): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((block) => (block as { type?: string } | null)?.type === 'text')
      .map((block) => (block as { text: string }).text)
      .join('');
  }
  return '';
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
  // 缓存当前生效的 selection，供 setModel 判断是否需要重启会话
  private currentModelSelection: ModelSelection | null = null;
  // start() 时 resolvePiModel 解析出的模型 ID，供 usage 兜底显示
  private currentModelId?: string;
  // 自动压缩判定用的窗口与百分比，start() 时从 resolvePiModel 结果赋值
  private currentContextWindow = 0;
  private currentAutoCompactPercent = 80;
  // start() 时从 profile.piModels 提取的手填窗口（正整数才收），usage 提取时优先于目录查表
  private manualWindows: Map<string, number> = new Map();
  // 最近一次 agent_end 逆序找到的可用 contextTokens（无可用 usage 时为 undefined），驱动 sendMessage 前的自动压缩
  private lastContextTokens: number | undefined;
  private currentPermissionMode: PiPermissionMode = 'default';
  private basicToolPermissions: BasicToolPermissions;
  // requestId -> 挂起的权限确认请求，等待前端 respondPermissionRequest 调用来 resolve
  private pendingPermissionRequests: Map<string, PendingPermissionRequest> = new Map();
  // 本会话进程内免确认的工具名集合（allow_session 语义，不落盘，关闭会话即失效）
  private sessionAllowedTools: Set<string> = new Set();
  // steer 队列长度，由 adapter 的 onSteerQueueChanged 回调（Harness queue_update 事件）镜像，
  // 不再手动 +1/-1：queue_update 在 steer() 入队和 one-at-a-time drain 时都会触发，是权威数据源。
  private pendingSteerCount = 0;
  // sessionStateChanged 去重：记录上次广播的 running/pendingAction/paused
  private lastEmittedRunning = false;
  private lastEmittedPendingAction = false;
  private lastEmittedPaused = false;
  // 本轮 emit 出去的 ExtendedSessionMessage 快照，agent_end 时喂给 extractPiUsageEntry 聚合 toolActivity
  private currentTurnMessages: ExtendedSessionMessage[] = [];
  private liveTurnMessages: ExtendedSessionMessage[] = [];
  // message 对象 → SessionTreeEntry.id（Proxy 拦截 appendMessage 返回值记录），message_end 时反查广播 message_id
  private messageEntryIds = new WeakMap<object, string>();
  // 本 run 已落盘 entry 的 id 累积，生命周期与 liveTurnMessages 完全一致，snapshot 携带给前端
  private turnEntryIds: string[] = [];
  // 最近一次 harness compact 的 compaction entry id（session_compact own 事件捕获，maybeAutoCompact 消费后置空）
  private lastCompactionEntryId: string | null = null;
  // usage 提取粒度对齐 SDK result：每次 sendMessage（agent_end）产一条 entry，自增；
  // 起始值由 manager 从会话 usage JSONL 续号注入，重启/failover 不归零
  private usageTurnIndex = 0;
  // 本轮累加器：message_end 时累加 AssistantMessage.usage，agent_end 时取出转 entry 后置 null
  private currentRunUsageAccum: PiUsageAccumulator | null = null;
  // 本轮最后一条 CTX 快照的 totalTokens（message_end 时更新），agent_end 时附到 entry.lastContextTokens 后置空
  private currentRunContextTokens: number | undefined;
  private currentTurnResult: PiSessionTurnResult | null = null;
  // close() 重入锁：并发调用（如用户连点两下关闭）复用同一个收尾 Promise，
  // 避免 removeAllListeners() 之类的收尾动作被并发触发两次
  private closingPromise: Promise<void> | null = null;
  // 工具名 → 所属工具包标识（OPTIONAL_TOOL_PACKS[].name，或 dogear-group/dogear-delegation/dogear-history 等组标识），
  // start() 组装 toolDefs 时同步填充，供 handleToolCall 的批量免确认判定使用
  private toolPackMap: Map<string, string> = new Map();
  // start() 内创建的 env 引用，供热更新 allowedPaths
  private env: WorkspaceExecutionEnv | null = null;
  // 带 injectionTag 的 sendMessage 入队，message_end(user) 按文本与队首匹配出队后广播内容事件；
  // interrupt/close 清空（harness 会同步清 steer 队列，残留项永无匹配时机）
  private pendingInjected: Array<{ text: string; tag: InjectionTag }> = [];
  // 设置快照域变更标记（updateSettings diff 命中本会话时由 manager 置位）；
  // 下一轮 sendMessage 且 isIdle 时按新设置重建，正在跑的轮不打断
  private snapshotDirty = false;

  constructor(sessionId: string, config: PiSessionConfig) {
    super();
    this.sessionId = sessionId;
    this.config = config;
    this.currentPermissionMode = config.permissionMode;
    this.basicToolPermissions = config.basicToolPermissions;
    this.usageTurnIndex = config.usageTurnIndexStart ?? 0;
    this.logger = this.logger.child(`pi-session-${sessionId.substring(0, 8)}`);
  }

  getSessionId(): string {
    return this.sessionId;
  }

  /** 热更新附加路径：重算 [primary, ...enabled] 全量覆盖 env.allowedPaths */
  updateWorkspacePaths(additionalPaths: string[]): void {
    this.config.additionalPaths = additionalPaths;
    this.env?.updateAllowedPaths([this.config.workspacePath, ...additionalPaths]);
  }

  getRole(): 'main' | 'sub' {
    return this.config.role;
  }

  /** 会话自身携带的模型选择；null = start() 时回退设置页默认模型 */
  getConfigModelSelection(): ModelSelection | null {
    return this.config.modelSelection;
  }

  /** start() 解析后的实际生效模型选择 */
  getCurrentModelSelection(): ModelSelection | null {
    return this.currentModelSelection;
  }

  getSubAgentProfileId(): string | undefined {
    return this.config.subAgentProfile?.id;
  }

  markSnapshotDirty(): void {
    this.snapshotDirty = true;
    this.logger.info('设置快照域变更，已标脏（下一轮 sendMessage 前重建）');
  }

  /**
   * 按新设置原位重建：先刷新 config 中的设置快照（basicToolPermissions / 子会话 Profile），
   * 再关旧 adapter 重走 start()。start() 内 repository.open(config.harnessSessionId)
   * 重开同一 JSONL（failover 同款路径），历史不丢；失败回滚全部字段沿用旧配置。
   * 仅在 isIdle 时调用：running/插话队列/挂起权限请求/paused 任一存在都可能丢状态。
   */
  private async rebuildForSettingsChange(): Promise<void> {
    const appSettings = await loadSettings();
    this.config.basicToolPermissions = appSettings.basicToolPermissions;
    this.basicToolPermissions = appSettings.basicToolPermissions;
    if (this.config.role === 'sub') {
      const profiles = appSettings.subAgent?.profiles ?? [];
      this.config.subAgentProfile = profiles.find((p) => p.id === this.config.subAgentProfile?.id)
        ?? profiles.find((p) => p.id === 'default');
    }

    const oldAdapter = this.adapter;
    const oldEnv = this.env;
    const oldToolPackMap = this.toolPackMap;
    this.toolPackMap = new Map();
    const oldModelSnapshot = {
      currentModelSelection: this.currentModelSelection,
      currentModelId: this.currentModelId,
      currentContextWindow: this.currentContextWindow,
      currentAutoCompactPercent: this.currentAutoCompactPercent,
      manualWindows: this.manualWindows,
    };
    this.adapter = null;
    this.env = null;
    try {
      await this.start();
      this.snapshotDirty = false;
      this.logger.info('已按新设置重建会话（同 harnessSessionId 重开，历史不丢）');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn('按新设置重建失败，沿用旧配置继续:', message);
      this.adapter = oldAdapter;
      this.env = oldEnv;
      this.toolPackMap = oldToolPackMap;
      this.currentModelSelection = oldModelSnapshot.currentModelSelection;
      this.currentModelId = oldModelSnapshot.currentModelId;
      this.currentContextWindow = oldModelSnapshot.currentContextWindow;
      this.currentAutoCompactPercent = oldModelSnapshot.currentAutoCompactPercent;
      this.manualWindows = oldModelSnapshot.manualWindows;
      return;
    }
    await oldAdapter?.abort();
  }

  /** Harness 的真实持久化 sessionId；start() 内两条分支（open 已有 / create 新建）都会同步赋值 config.harnessSessionId，resolve 时必定可用 */
  getHarnessSessionId(): string | undefined {
    return this.config.harnessSessionId ?? undefined;
  }

  getWorkspaceId(): string {
    return this.config.workspaceId;
  }

  getLiveSnapshot(): PiSessionLiveSnapshot {
    return {
      messages: [...this.liveTurnMessages],
      turnEntryIds: [...this.turnEntryIds],
      permissionRequests: Array.from(this.pendingPermissionRequests.entries()).map(([requestId, pending]) => ({
        requestId,
        toolName: pending.toolName,
        toolInput: pending.toolInput,
      })),
      sessionState: {
        running: !this.isPaused() && (this.running || this.pendingSteerCount > 0),
        pendingAction: this.pendingSteerCount > 0,
        paused: this.isPaused(),
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
    const rawSession = this.config.harnessSessionId
      ? await repository.open(this.config.workspaceId, this.config.harnessSessionId)
      : await (async () => {
          const { session: created, info } = await repository.create(this.config.workspaceId);
          this.config.harnessSessionId = info.id;
          return created;
        })();
    // 拦截 appendMessage 返回值（SessionTreeEntry.id）：harness 先落盘后 emit message_end 且
    // 同一 message 引用，message_end 时从 WeakMap 反查出 entryId 广播 message_id（见 handleAgentEvent）
    const session: Session<JsonlSessionMetadata> = new Proxy(rawSession, {
      get: (target, prop) => {
        if (prop !== 'appendMessage') return Reflect.get(target, prop) as unknown;
        return async (message: AgentMessage): Promise<string> => {
          const entryId = await target.appendMessage(message);
          this.messageEntryIds.set(message, entryId);
          return entryId;
        };
      },
    });

    const appSettings = await loadSettings();
    const { model, profile, tier, thinkingLevel } = resolvePiModel(
      appSettings,
      this.config.modelSelection,
      null,
      appSettings.ai.defaultModelSelection,
    );

    this.currentModelSelection = this.config.modelSelection ?? appSettings.ai.defaultModelSelection;
    this.currentModelId = model.id;
    this.currentContextWindow = model.contextWindow;
    this.currentAutoCompactPercent = profile.autoCompactPercent ?? 80;
    this.manualWindows = new Map(
      (profile.piModels ?? []).flatMap((m) =>
        typeof m.contextWindow === 'number' && m.contextWindow > 0 ? [[m.id, m.contextWindow] as const] : [],
      ),
    );

    const piModels = buildPiModels(profile);
    const isSubAgent = this.config.role === 'sub';
    const subAgentProfile = this.config.subAgentProfile;

    // ---- 能力包解析 ----
    const wsConfig = await getWorkspaceConfig(this.config.workspaceId);
    const activeAbilities = resolveAbilities(wsConfig, {
      role: this.config.role,
      isExecutor: this.config.executor,
      groupId: this.config.groupId ?? null,
      hasWorkspace: !!this.config.workspacePath,
      profile: subAgentProfile ?? null,
    });

    // ---- core-profile ----
    // 主会话始终加载 core-profile；子会话不再加载（loadCoreProfile 字段已移除）
    const coreProfileText = !isSubAgent && activeAbilities.has('core-profile')
      ? await loadCoreProfileForSession(this.config.workspacePath)
      : null;

    // ---- group context ----
    // 组上下文归「会话组」包：属组 ∧ 包开才注入（含子会话，不再跟随协作包裁剪）
    const needGroupContext = !!this.config.groupId && activeAbilities.has('group-context');
    const groupContextText = needGroupContext
      ? await buildGroupContextPrompt(this.config.workspaceId, this.config.groupId!, {
          selfConversationId: this.config.conversationId,
          executor: !isSubAgent && !!this.config.executor,
        })
      : '';

    // ---- agent.md ----
    const projectClaudeMd = activeAbilities.has('workspace-rules')
      ? await readTextFileSafe(path.join(getConfigDir(), 'workspaces', this.config.workspaceId, 'agent.md'))
      : '';
    const userClaudeMd = activeAbilities.has('global-rules')
      ? await readTextFileSafe(path.join(getConfigDir(), 'agent.md'))
      : '';

    // ---- skill 索引 ----
    const env = new WorkspaceExecutionEnv([this.config.workspacePath, ...this.config.additionalPaths]);
    this.env = env;
    const builtinSkillsDir = getTemplatesDir();
    const customSkillsDir = path.join(getConfigDir(), 'skills');
    const userSkillsDir = path.join(os.homedir(), '.claude', 'skills');
    const allSkillEntries = await loadSkillIndex([
      builtinSkillsDir,
      customSkillsDir,
      userSkillsDir,
    ]);

    const enabledSkillsSet = new Set(wsConfig.enabledSkills);
    // skill 型包未生效 → 包内 skill 整体剔除（enabledSkills 细闸之前先过包总闸）
    const disabledPackSkills = new Set<string>();
    for (const pack of ABILITY_PACKS) {
      if (pack.type !== 'skill-packs' || activeAbilities.has(pack.key)) continue;
      for (const name of pack.skills ?? []) disabledPackSkills.add(name);
    }
    const filteredByConfig = allSkillEntries.filter(
      (e) => enabledSkillsSet.has(e.name) && !disabledPackSkills.has(e.name),
    );

    let skillEntries: SkillEntry[];
    let skillIndexText: string;
    if (isSubAgent && subAgentProfile) {
      skillEntries = filterSkillsForSubAgent(filteredByConfig, subAgentProfile, {
        builtin: builtinSkillsDir,
        custom: customSkillsDir,
        user: userSkillsDir,
      });
      skillIndexText = formatSkillIndexForPrompt(skillEntries);
    } else {
      skillEntries = filteredByConfig;
      skillIndexText = formatSkillIndexForPrompt(skillEntries);
    }

    // ---- 提示词拼装 ----
    const promptParts: string[] = [
      projectClaudeMd,
      userClaudeMd,
      skillIndexText,
    ];
    if (coreProfileText) promptParts.push(coreProfileText);
    if (groupContextText) promptParts.push(groupContextText);

    if (isSubAgent) {
      if (activeAbilities.has('memory')) promptParts.push(MEMORY_GUIDANCE_APPEND);
      if (this.config.subAgent) promptParts.push(subAgentContractFor(this.config.subAgent));
    } else {
      if (activeAbilities.has('memory')) promptParts.push(MEMORY_GUIDANCE_APPEND);
      // executor 跳过存卡纪律是段级裁剪，不受包开关约束（工具组仍注册），保留现状
      if (activeAbilities.has('notes') && !this.config.executor) promptParts.push(NOTES_DISCIPLINE_APPEND);
      if (activeAbilities.has('agent-collab')) {
        promptParts.push(MAIN_AGENT_DELEGATION_APPEND);
        promptParts.push(buildSubAgentProfileIndex(appSettings.subAgent?.profiles ?? []));
      }
    }
    const systemPrompt = promptParts.filter(Boolean).join('\n\n');

    let toolDefs: ToolDef[];

    if (isSubAgent && subAgentProfile) {
      toolDefs = this.buildSubAgentToolDefs(subAgentProfile, skillEntries, activeAbilities);
    } else {
      toolDefs = this.buildMainAgentToolDefs(skillEntries, activeAbilities);
    }

    const activeToolNames = isSubAgent && subAgentProfile
      ? computeSubAgentActiveTools(subAgentProfile, toolDefs)
      : undefined;

    const tools: AgentHarnessTool<{ env: ExecutionEnv }>[] = [
      ...createBuiltinFileTools({
        conversationId: this.config.conversationId,
        workspaceRoots: [this.config.workspacePath, ...this.config.additionalPaths].filter(Boolean),
      }),
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
      activeToolNames,
      onAgentEvent: (event) => this.handleAgentEvent(event),
      onSessionCompact: (compactionEntryId) => { this.lastCompactionEntryId = compactionEntryId; },
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

  /** 工具包注册辅助：校验并记录工具名→工具包标识映射，供权限批量免确认判定使用 */
  private registerPack(packName: string, defs: ToolDef[]): ToolDef[] {
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
  }

  /**
   * 主会话工具构建：
   * Skill 工具 + Grep/Glob + dogear-memory（包开关或无工作区现状兜底） + 按 enabledToolPacks 挂载可选工具包（skill 型包需包总闸生效）
   * + extension（并入 browser 包：只受 browser 包总闸 gate，enabledToolPacks 残留 extension 静默忽略）
   * + 组状态卡组（dogear-group-context，属组且会话组包生效）
   * + 协作三组（dogear-group/delegation/sibling，属组且 agent-collab 包生效）
   * + dogear-notes（工作区且 notes 包生效）
   * + dogear-tasks（工作区且 notes 包生效；任务执行会话派单保底不受开关约束）
   * + dogear-history 跨会话检索组（不在包体系，工作区即注册的常驻基础设施）
   */
  private buildMainAgentToolDefs(skillEntries: SkillEntry[], activeAbilities: Set<string>): ToolDef[] {
    const toolDefs: ToolDef[] = [
      createSkillTool(skillEntries),
      ...createSearchToolDefs([this.config.workspacePath, ...this.config.additionalPaths]),
    ];

    // 无工作区会话现状即注册 memory 工具，而 memory 包触发条件含 hasWorkspace，直接查包会吞掉该场景，需维持现状
    if (!this.config.workspacePath || activeAbilities.has('memory')) {
      toolDefs.push(...this.registerPack('dogear-memory', createMemoryToolDefs(this.config.workspacePath)));
    }

    for (const pack of OPTIONAL_TOOL_PACKS) {
      if (!this.config.enabledToolPacks.includes(pack.name)) continue;
      // skill 型双闸：enabledToolPacks 是细闸，包总闸在注册表，未生效则工具包不挂载（与 skill 索引剔除同性质）
      const abilityKey = TOOL_PACK_TO_ABILITY.get(pack.name);
      if (abilityKey && !activeAbilities.has(abilityKey)) continue;
      switch (pack.name) {
        case 'article':
          if (this.config.workspacePath) {
            toolDefs.push(...this.registerPack(pack.name, createArticleToolDefs(this.config.workspacePath)));
          }
          break;
        case 'browser':
          toolDefs.push(...this.registerPack(pack.name, createBrowserToolDefs({ conversationId: this.config.conversationId, workspacePath: this.config.workspacePath, workspaceId: this.config.workspaceId })));
          break;
        case 'stock-quote':
          toolDefs.push(...this.registerPack(pack.name, createStockToolDefs()));
          break;
        case 'stock-analysis':
          toolDefs.push(...this.registerPack(pack.name, createStockAnalysisToolDefs()));
          break;
        case 'stock-announcement':
          toolDefs.push(...this.registerPack(pack.name, createAnnouncementToolDefs()));
          break;
        case 'stock-picking':
          toolDefs.push(...this.registerPack(pack.name, createStockPickingToolDefs()));
          break;
        default:
          break;
      }
    }

    // extension 并入 browser 包：注册只看 browser 包总闸，enabledToolPacks 残留 extension 静默忽略
    if (activeAbilities.has('browser')) {
      toolDefs.push(...this.registerPack('extension', createExtensionToolDefs({ conversationId: this.config.conversationId })));
    }

    if (this.config.groupId && activeAbilities.has('group-context')) {
      toolDefs.push(...this.registerPack('dogear-group-context', createGroupContextToolDefs({
        workspaceId: this.config.workspaceId,
        groupId: this.config.groupId,
      })));
    }

    if (this.config.groupId && activeAbilities.has('agent-collab')) {
      toolDefs.push(...this.registerPack('dogear-group', createGroupToolDefs(this.config.workspaceId, this.config.groupId)));
      const delegationOpts: DelegationToolsOpts = {
        role: 'main',
        workspaceId: this.config.workspaceId,
        groupId: this.config.groupId,
        conversationId: this.config.conversationId,
      };
      toolDefs.push(...this.registerPack('dogear-delegation', createDelegationToolDefs(delegationOpts)));
      toolDefs.push(...this.registerPack('dogear-sibling', createSiblingToolDefs({
        workspaceId: this.config.workspaceId,
        groupId: this.config.groupId,
        parentConversationId: this.config.parentConversationId,
      })));
    }

    if (this.config.workspacePath && activeAbilities.has('notes')) {
      toolDefs.push(...this.registerPack('dogear-notes', createNotesToolDefs(this.config.workspacePath, {
        workspaceId: this.config.workspaceId,
        conversationId: this.config.conversationId,
      })));
    }

    // dogear-tasks 归 notes 包，任务执行会话的申报工具（ReportTaskResult 所在组）派单保底注册；
    // dogear-history（跨会话检索）不在能力包体系，工作区即注册的常驻基础设施
    if (this.config.workspacePath && (activeAbilities.has('notes') || this.config.executor)) {
      toolDefs.push(...this.registerPack('dogear-tasks', createTaskToolDefs(this.config.workspacePath, {
        workspaceId: this.config.workspaceId,
        conversationId: this.config.conversationId,
      })));
    }
    if (this.config.workspacePath) {
      toolDefs.push(...this.registerPack('dogear-history', createHistorySearchToolDefs(this.config.workspaceId)));
    }

    return toolDefs;
  }

  /**
   * 子会话工具构建（Profile 驱动，能力包开关经 activeAbilities 交集）：
   * - 基础工具（read/write/edit/bash/Glob/Grep）：始终全部创建，activeToolNames 控制可见性
   * - Skill 工具：有 ≥1 skill 勾选时创建
   * - dogear-memory：memory 包生效（含 Profile 的 memory===true 细闸，由 resolveAbilities 并集）
   * - stock/article/browser 工具包：对应能力包生效（Profile 细闸并入包解析）
   * - extension 工具组：browser 包生效且 Profile extension===true 双闸
   * - dogear-history 跨会话检索组：工作区即注册（不查 Profile 细闸——通用检索是基础设施）
   * - dogear-group + dogear-delegation：始终注册（固定，交付基础设施，不受包开关影响）
   * - dogear-group-context（组状态卡）：会话组包生效（属组即有包内语义，无 Profile 细闸）
   * - dogear-sibling（兄弟会话）：协作包生效（子会话对协作包强制生效，无 Profile 细闸）
   */
  private buildSubAgentToolDefs(profile: SubAgentProfile, skillEntries: SkillEntry[], activeAbilities: Set<string>): ToolDef[] {
    const ab = profile.enabledAbilities;
    const toolDefs: ToolDef[] = [];

    // Grep/Glob：始终创建（基础工具，activeToolNames 控制可见性）
    toolDefs.push(...createSearchToolDefs([this.config.workspacePath, ...this.config.additionalPaths]));

    // Skill 工具：有 ≥1 skill 勾选时创建
    if (skillEntries.length > 0) {
      toolDefs.push(createSkillTool(skillEntries));
    }

    // dogear-memory：memory 包生效（Profile 细闸已并入 resolveAbilities）
    if (activeAbilities.has('memory')) {
      toolDefs.push(...this.registerPack('dogear-memory', createMemoryToolDefs(this.config.workspacePath)));
    }

    // stock 工具包：stock 包生效
    if (activeAbilities.has('stock')) {
      toolDefs.push(...this.registerPack('stock-quote', createStockToolDefs()));
      toolDefs.push(...this.registerPack('stock-analysis', createStockAnalysisToolDefs()));
      toolDefs.push(...this.registerPack('stock-announcement', createAnnouncementToolDefs()));
      toolDefs.push(...this.registerPack('stock-picking', createStockPickingToolDefs()));
    }

    // article 工具包：article 包生效
    if (activeAbilities.has('article') && this.config.workspacePath) {
      toolDefs.push(...this.registerPack('article', createArticleToolDefs(this.config.workspacePath)));
    }

    // browser 工具包：browser 包生效（Profile 级独立生效，不受 enabledToolPacks 约束）
    if (activeAbilities.has('browser')) {
      toolDefs.push(...this.registerPack('browser', createBrowserToolDefs({ conversationId: this.config.conversationId, workspacePath: this.config.workspacePath, workspaceId: this.config.workspaceId })));
    }

    // extension：并入 browser 包后是双闸——browser 包生效（Profile 细闸已并入 resolveAbilities）+ extension===true
    if (activeAbilities.has('browser') && ab.extension === true) {
      toolDefs.push(...this.registerPack('extension', createExtensionToolDefs({ conversationId: this.config.conversationId })));
    }

    // dogear-history：工作区即注册，通用检索基础设施，不查 Profile 细闸
    if (this.config.workspacePath) {
      toolDefs.push(...this.registerPack('dogear-history', createHistorySearchToolDefs(this.config.workspaceId)));
    }

    // dogear-group / dogear-delegation / dogear-group-context / dogear-sibling
    if (this.config.groupId) {
      toolDefs.push(...this.registerPack('dogear-group', createGroupToolDefs(this.config.workspaceId, this.config.groupId)));

      // dogear-delegation：始终注册（固定）
      const delegationOpts: DelegationToolsOpts = {
        role: 'sub',
        workspaceId: this.config.workspaceId,
        groupId: this.config.groupId,
        conversationId: this.config.conversationId,
        parentConversationId: this.config.parentConversationId ?? '',
      };
      toolDefs.push(...this.registerPack('dogear-delegation', createDelegationToolDefs(delegationOpts)));

      // dogear-group-context：随会话组包（reference 细闸已退役）
      if (activeAbilities.has('group-context')) {
        toolDefs.push(...this.registerPack('dogear-group-context', createGroupContextToolDefs({
          workspaceId: this.config.workspaceId,
          groupId: this.config.groupId,
          selfConversationId: this.config.conversationId,
        })));
      }

      // dogear-sibling：随协作包（子会话强制生效）
      if (activeAbilities.has('agent-collab')) {
        toolDefs.push(...this.registerPack('dogear-sibling', createSiblingToolDefs({
          workspaceId: this.config.workspaceId,
          groupId: this.config.groupId,
          parentConversationId: this.config.parentConversationId,
          selfConversationId: this.config.conversationId,
        })));
      }
    }


    return toolDefs;
  }

  private handleAgentEvent(event: AgentEvent): void {
    if (event.type === 'message_end' && event.message) {
      const role = (event.message as { role?: string }).role;
      // message_end：单次 LLM call 结束，AssistantMessage.usage 携带本轮 token 用量，累加进 currentRunUsageAccum
      if (role === 'assistant') {
        const assistantMessage = event.message as AssistantMessage;
        if (!this.currentRunUsageAccum) this.currentRunUsageAccum = createPiUsageAccumulator();
        accumulatePiUsage(this.currentRunUsageAccum, assistantMessage);

        const conversationId = this.config.conversationId;
        const snapshot = extractPiContextSnapshot(assistantMessage, this.usageTurnIndex, (id) => this.resolveModelWindow(id));
        if (conversationId && snapshot) {
          this.currentRunContextTokens = snapshot.totalTokens;
          this.emit('usageContext', { conversationId, snapshot });
        }
      }

      // user/assistant 落盘完成后广播 message_id（uuid = SessionTreeEntry.id，与历史 sdkUuid 同源），
      // 同时进 liveTurnMessages 保证 snapshot 重放路径一致；toolResult 的 entry 并入 tool_use 块（toolUseId 键），无需独立 ID
      if (role === 'user' || role === 'assistant') {
        const entryId = this.messageEntryIds.get(event.message);
        if (entryId) {
          const idMessage: ExtendedSessionMessage = {
            type: 'message_id',
            uuid: entryId,
            role,
            ...(role === 'assistant' ? { model: (event.message as AssistantMessage).model } : {}),
            timestamp: event.message.timestamp,
          };
          this.liveTurnMessages.push(idMessage);
          this.turnEntryIds.push(entryId);
          this.emit('message', idMessage);
        } else {
          this.logger.warn('message_end 未命中 entryId 缓存，跳过 message_id 广播');
        }
        if (role === 'user') this.tryFlushPendingInjected(event.message);
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
      } else if (lastMessage?.role === 'assistant' && lastMessage.stopReason === 'length') {
        // 输出 token 上限截断（常见于 thinking 耗尽预算、正文一字未出），pi 按正常回合收流
        const truncMsg = '模型输出被截断（stopReason=length，输出达到上限）';
        if (this.recordTurnFailure('model', truncMsg)) {
          this.logger.error('pi 模型输出被截断');
          this.emitErrorMessage(truncMsg);
        }
      }

      this.lastContextTokens = extractLastContextTokens(event.messages);
      this.emitUsageEntry();
      this.currentTurnMessages = [];
      this.currentRunUsageAccum = null;
      this.currentRunContextTokens = undefined;
    }
  }

  /** 队首文本匹配时出队并广播带 injectedTag 的 user 内容事件（与 message_id 并行；未匹配时静默保留） */
  private tryFlushPendingInjected(message: AgentMessage): void {
    const pending = this.pendingInjected[0];
    if (!pending) return;
    if (userMessageText(message) !== pending.text) return;
    this.pendingInjected.shift();
    const injected: ExtendedSessionMessage = {
      type: 'user',
      content: pending.text,
      injectedTag: pending.tag,
      timestamp: message.timestamp,
      role: 'user',
    };
    this.liveTurnMessages.push(injected);
    this.emit('message', injected);
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

  /** 手填窗口优先于 pi-ai 目录查表，两者皆无时 0（前端显示 0%） */
  private resolveModelWindow(modelId: string): number {
    return this.manualWindows.get(modelId) ?? lookupContextWindow(modelId) ?? 0;
  }

  private handleSteerQueueChanged(count: number): void {
    this.pendingSteerCount = count;
    this.emit('pendingCountChanged', { count });
    this.syncSessionState();
  }

  /**
   * 一次完整 run（含所有工具调用和插话）彻底结束（Harness settled 事件，晚于 agent_end），
   * 驱动 running=false 的最终结算，并通知 Manager 收集 orphan 会话。
   * pauseRequested 为 true 且本轮正常收尾 → 进入 paused（标志保留到 sendMessage 恢复时清除）；
   * 异常收尾（failed/cancelled）不清入 paused，回 idle。
   */
  private handleSettled(): void {
    this.running = false;
    this.liveTurnMessages = [];
    this.turnEntryIds = [];
    if (this.currentTurnResult) {
      this.adapter?.clearPause();
    }
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
        this.currentModelId,
        (id) => this.resolveModelWindow(id),
        this.currentRunContextTokens,
      );
      entry.uuid = uuidv4();
      this.usageTurnIndex += 1;
      this.emit('usage', { conversationId: convId, entry });
    } catch (err) {
      this.logger.warn('用量采集失败（忽略）:', err);
    }
  }

  /**
   * 去重广播当前跑步机状态（running/pendingAction/paused），驱动前端 running/pendingAction 两个 Set。
   * running = !paused && (this.running（onSettled 镜像的 harness phase）|| pendingSteerCount>0)；
   * pendingAction = pendingSteerCount>0；paused 见 isPaused()。
   * close() 不走这里，靠 sessionClosed 让前端清 Set。
   */
  private syncSessionState(): void {
    const conversationId = this.config.conversationId;
    if (!conversationId) return;
    const paused = this.isPaused();
    const running = !paused && (this.running || this.pendingSteerCount > 0);
    const pendingAction = this.pendingSteerCount > 0;
    if (running !== this.lastEmittedRunning || pendingAction !== this.lastEmittedPendingAction || paused !== this.lastEmittedPaused) {
      this.lastEmittedRunning = running;
      this.lastEmittedPendingAction = pendingAction;
      this.lastEmittedPaused = paused;
      this.emit('sessionStateChanged', { conversationId, running, pendingAction, paused });
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

  async sendMessage(content: string | ContentBlockParam[], opts?: { injectionTag?: InjectionTag }): Promise<void> {
    if (this.status === PiSessionStatus.CLOSED) {
      throw new Error('会话已关闭');
    }
    if (!this.adapter) {
      throw new Error('会话尚未启动');
    }
    if (this.snapshotDirty && this.isIdle()) {
      await this.rebuildForSettingsChange();
      if (!this.adapter) {
        throw new Error('会话尚未启动');
      }
    }

    const { text, images } =
      typeof content === 'string' ? { text: content, images: [] as ImageContent[] } : splitContentBlocks(content);
    if (opts?.injectionTag) this.pendingInjected.push({ text, tag: opts.injectionTag });
    const adapter = this.adapter;
    // paused（= pauseRequested 且 run 已收尾）优先于 isRunning：此时 harness 已 idle，必须走 prompt
    // （idle 下 steer 抛 invalid_state），且 pendingSteerCount>0（暂停前插话仍在队列）也不能把分支带进 steer。
    // running 中已点暂停的窗口期发消息仍走 steer 插话：pauseRequested 保留，turn 边界照样收尾进 paused，插话存队列等恢复 run 注入
    const isPaused = this.isPaused();
    const isRunning = !isPaused && (this.running || this.pendingSteerCount > 0);
    if (isPaused) {
      adapter.clearPause();
    }
    if (!isRunning) {
      this.liveTurnMessages = [];
      this.turnEntryIds = [];
    }

    this.logger.info('发送用户消息到 pi 会话:', {
      length: text.length,
      imageCount: images.length,
      isRunning,
      pendingSteer: this.pendingSteerCount,
    });

    if (isRunning) {
      // 插话路径：steer 在当前 assistant turn 结束后注入（one-at-a-time 模式下排在已有队列后面）。
      // pendingSteerCount / pendingCountChanged / syncSessionState 由 onSteerQueueChanged
      // 回调（Harness queue_update 事件）驱动，这里不再手动计数。
      await adapter.steer(text, images);
      return;
    }

    this.currentTurnResult = null;
    this.running = true;
    this.syncSessionState();
    try {
      await this.maybeAutoCompact(adapter);
      await adapter.prompt(text, images);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.recordTurnFailure('runtime', message)) {
        this.logger.error('pi 会话执行失败:', message);
        this.emitErrorMessage(message);
      }
      this.currentTurnMessages = [];
      this.currentRunUsageAccum = null;
      this.currentRunContextTokens = undefined;
      this.running = false;
    } finally {
      const result = this.currentTurnResult ?? { subtype: 'success' };
      this.emit('complete', result);
      this.currentTurnResult = null;
      this.syncSessionState();
    }
  }

  /**
   * 发消息前的自动压缩（仅非 steer 分支）：lastContextTokens 超过 contextWindow×autoCompactPercent% 时
   * 先执行 harness compact。compact 与 prompt 同样要求 harness idle，非 steer 分支到达这里时
   * harness 必然 idle（普通 idle 发送自不待言，paused 恢复时 settled 已把 phase 复位 idle），天然无竞态。
   * 失败（含 Nothing to compact）尽力而为：warn + 短错误提示后继续 prompt，不中断发送。
   */
  private async maybeAutoCompact(adapter: PiHarnessAdapter): Promise<void> {
    if (this.lastContextTokens === undefined) return;
    const threshold = (this.currentContextWindow * this.currentAutoCompactPercent) / 100;
    if (this.lastContextTokens <= threshold) return;

    const preTokens = this.lastContextTokens;
    this.emit('message', { type: 'compacting', timestamp: Date.now() } as ExtendedSessionMessage);
    try {
      await adapter.compact();
      this.lastContextTokens = undefined;
      const compactionEntryId = this.lastCompactionEntryId;
      this.lastCompactionEntryId = null;
      this.emit('message', {
        type: 'compact_boundary',
        timestamp: Date.now(),
        ...(compactionEntryId ? { uuid: compactionEntryId } : {}),
        compactTrigger: 'auto',
        compactPreTokens: preTokens,
      } as ExtendedSessionMessage);
      const conversationId = this.config.conversationId;
      if (conversationId) {
        this.emit('usageCompact', {
          conversationId,
          marker: {
            uuid: uuidv4(),
            timestamp: Date.now(),
            afterTurnIndex: this.usageTurnIndex - 1,
            trigger: 'auto' as const,
            preTokens,
          } satisfies CompactMarker,
        });
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn('自动压缩失败已跳过:', reason);
      this.emitErrorMessage(`自动压缩失败已跳过：${reason}`);
    }
  }

  /**
   * 请求在当前 turn 完成后暂停（不打断正在执行的工具）。仅 running 态受理，重复调用幂等。
   * 返回是否受理；受理后等 settled 时进入 paused 并广播。
   */
  requestPause(): boolean {
    if (this.status === PiSessionStatus.CLOSED || !this.adapter) return false;
    if (!this.isRunning()) return false;
    this.adapter.requestPause();
    return true;
  }

  /**
   * paused 态 = 已请求暂停且 run 已收尾（settled）。
   * running 期间 pauseRequested 已置位但尚未生效，不算 paused；恢复由 sendMessage 清标志后走 prompt。
   */
  isPaused(): boolean {
    return this.adapter?.isPauseRequested() === true && !this.running;
  }

  /**
   * 会话是否仍在运行（有活跃 turn 或 steer 队列）。供 PiSessionManager.release 归零时判断
   * 是否走 orphan 保活路径——running 时保留不销毁，等 settled 后再由 maybeCollectOrphan 收集。
   * paused 时返回 false：暂停会话无 attachment 后允许直接销毁（重连时从历史 resume，暂停态自然消失）。
   */
  isRunning(): boolean {
    return !this.isPaused() && (this.running || this.pendingSteerCount > 0);
  }

  /**
   * 空闲 = 无正在跑的 turn + 无 steer 队列 + 无挂起的权限请求 + 非 paused。
   */
  isIdle(): boolean {
    return !this.running
      && this.pendingSteerCount === 0
      && this.pendingPermissionRequests.size === 0
      && !this.isPaused();
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
    this.pendingInjected = [];
    this.running = false;
    killConversationTerminals(this.config.conversationId);
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
    // 暂停态下中断等价取消暂停：清标志；且此时无 run，不会再有 settled 链驱动广播，需同步 syncSessionState
    this.adapter?.clearPause();
    // 不依赖 tool_call hook 收到 abort 信号（Harness 的 tool_call hook 不带 signal 参数），
    // 主动拒绝所有待处理权限请求兜底，避免中断后仍有请求悬挂等待
    if (this.running || this.pendingSteerCount > 0) this.recordTurnCancelled('用户中断');
    this.pendingSteerCount = 0;
    this.pendingInjected = [];
    this.emit('pendingCountChanged', { count: 0 });
    this.rejectAllPendingPermissionRequests('用户中断');
    await this.adapter?.abort();
    this.syncSessionState();
  }

  private rejectAllPendingPermissionRequests(reason: string): void {
    if (this.pendingPermissionRequests.size === 0) return;
    for (const [, pending] of this.pendingPermissionRequests) {
      pending.resolve({ block: true, reason });
    }
    this.pendingPermissionRequests.clear();
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

  isSessionActive(): boolean {
    return this.status !== PiSessionStatus.CLOSED;
  }
}
