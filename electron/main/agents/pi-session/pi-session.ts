/**
 * 基于 pi-ai + pi-agent-core（AgentHarness）的主会话运行时实现
 *
 * 主会话与派遣子会话唯一使用的会话类，旧 SDK 主会话实现已随迁移整体移除。
 * 方法面（getSessionId/start/sendMessage/close/interrupt/setPermissionMode/
 * respondPermissionRequest 等）覆盖完整的会话生命周期、权限确认、插话队列、
 * usage 采集等能力。
 */

import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { SessionFailed, type EntryRecord, type ToolRegistration } from '@earendil-works/pi-durable';
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs';
import type { PiPermissionMode } from './permission-mode.js';
import type { AssistantMessage, ImageContent } from '@earendil-works/pi-ai';
import { splitContentBlocks } from './content-blocks.js';
import { mainLogger } from '../logger.js';
import { resolvePiModel, buildPiModels } from '../pi/provider.js';
import { lookupContextWindow } from '../pi/model-catalog.js';
import { toHarnessTools, type ToolDef } from '../pi/tool-adapter.js';
import { createMessageConverter } from './message-converter.js';
import { loadSkillIndex, formatSkillIndexForPrompt, type SkillEntry } from './skill-loader.js';
import { WorkspaceExecutionEnv } from './workspace-execution-env.js';
import { buildWriteExcludedPaths, computeBasePaths } from './workspace-paths.js';
import { createBuiltinFileTools } from './builtin-tools.js';
import { killConversationTerminals } from '../../services/pty-service.js';
import { PiHarnessAdapter, type CompactionFailureSignal, type HarnessToolCallEvent, type HarnessToolCallResult, type PiHarnessAgentEvent } from './pi-harness-adapter.js';
import { MEMORY_GUIDANCE_APPEND, subAgentContractFor, MAIN_AGENT_DELEGATION_APPEND, buildSubAgentProfileIndex, NOTES_DISCIPLINE_APPEND, GIT_HISTORY_GUIDANCE_APPEND, SNAPSHOT_SAFETY_GUIDANCE_APPEND, SHUNT_GUIDANCE_APPEND, WEB_RESEARCH_GUIDANCE_MAIN_APPEND, WEB_RESEARCH_GUIDANCE_SUB_APPEND, EXTENSION_BROWSER_DISCIPLINE_APPEND, buildAppDataGuidance, buildLowFreqToolGuide, UNATTENDED_MODE_APPEND } from '../session-append-templates.js';
import { resolveAbilities, ABILITY_PACKS, SUB_AUTONOMOUS_SKILLS } from '../ability-registry.js';
import { isBasicToolName, decideToolPermission } from './permission-rules.js';
import { loadSettings, getConfigDir } from '../../services/settings-service.js';
import { getTemplatesDir } from '../../services/skill-template-service.js';
import { getWorkspaceConfig } from '../../services/workspace-config-service.js';
import {
  createPiUsageAccumulator,
  accumulatePiUsage,
  contextTotalTokens,
  estimateMessageBuckets,
  estimateTokens,
  extractPiContextSnapshot,
  extractPiUsageEntry,
  type ContextCategoryDraft,
  type PiUsageAccumulator,
} from './usage-extractor.js';
import type { ModelSelection, BasicToolPermissions, SubAgentProfile } from '../../services/settings-types.js';
import type { ExtendedSessionMessage, InjectionTag } from '../task-types.js';
import { INJECTED_ENTRY_KIND } from '../task-types.js';
import type { CompactMarker } from '../../types.js';
import { recordToolUsage } from '../../services/tool-usage/tool-usage-service.js';
import { classifyToolPack, resolveToolUsageSessionType } from './tool-usage-classify.js';
import { getPiSessionRepository } from './pi-session-repository.js';
import type { PiSessionConfig } from './pi-session-config.js';
import {
  filterSkillsForSubAgent,
  computeSubAgentActiveTools,
  registerPack as registerToolPack,
  buildMainAgentToolDefs as assembleMainAgentToolDefs,
  buildSubAgentToolDefs as assembleSubAgentToolDefs,
} from './tool-assembly.js';

const ABORT_TIMEOUT_MS = 30_000;

export type { PiSessionConfig } from './pi-session-config.js';

export interface PiSessionLiveSnapshot {
  messages: ExtendedSessionMessage[];
  /** 本 run 已落盘 entry 的 id 序列（与 messages 同生命周期），供前端历史去重/ID 对齐 */
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

/** 把 SDK 风格的 ContentBlockParam[] 拆成 text + pi-ai ImageContent[] 的实现与单测见 content-blocks.ts */

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
  // 最近一次 turn_end 更新的可用 contextTokens（无可用 usage 时为 undefined），驱动 sendMessage 前的自动压缩
  private lastContextTokens: number | undefined;
  private currentPermissionMode: PiPermissionMode = 'default';
  // 无人值守接管时记录的原权限模式（null=未被接管）；restore 时用户已手动切过模式则丢弃记录不恢复
  private unattendedSavedMode: PiPermissionMode | null = null;
  private basicToolPermissions: BasicToolPermissions;
  // requestId -> 挂起的权限确认请求，等待前端 respondPermissionRequest 调用来 resolve
  private pendingPermissionRequests: Map<string, PendingPermissionRequest> = new Map();
  // 本会话进程内免确认的工具名集合（allow_session 语义，不落盘，关闭会话即失效）
  private sessionAllowedTools: Set<string> = new Set();
  // steer 队列长度，由 adapter 的 onSteerQueueChanged 回调（Harness inbox_update 事件）镜像，
  // 不再手动 +1/-1：inbox_update 在 steer() 入队和 one-at-a-time drain 时都会触发，是权威数据源。
  private pendingSteerCount = 0;
  // sessionStateChanged 去重：记录上次广播的 running/pendingAction/paused
  private lastEmittedRunning = false;
  private lastEmittedPendingAction = false;
  private lastEmittedPaused = false;
  // 本轮 emit 出去的 ExtendedSessionMessage 快照，run_end 时喂给 extractPiUsageEntry 聚合 toolActivity
  private currentTurnMessages: ExtendedSessionMessage[] = [];
  private liveTurnMessages: ExtendedSessionMessage[] = [];
  // durable 事件→前端消息转换器（有状态：各流式块已发送长度记账）
  private messageConverter = createMessageConverter();
  // 本 run 最后一次 LLM call 的 assistant 消息（turn_end 捕获），run_end 时取 stopReason/errorMessage 做三分支结算；
  // 0.99.2 run_end 不携带消息载荷，上下文从 turn_end 取
  private lastTurnAssistant: AssistantMessage | null = null;
  // 本 run 已落盘 entry 的 id 累积，生命周期与 liveTurnMessages 完全一致，snapshot 携带给前端
  private turnEntryIds: string[] = [];
  // 最近一次 harness compact 的 compaction entry id（compaction_end 事件捕获，maybeAutoCompact 消费后置空）
  private lastCompactionEntryId: string | null = null;
  // usage 提取粒度对齐 SDK result：每次 sendMessage（run_end）产一条 entry，自增；
  // 起始值由 manager 从会话 usage JSONL 续号注入，重启/failover 不归零
  private usageTurnIndex = 0;
  // 本轮累加器：message_end 时累加 AssistantMessage.usage，run_end 时取出转 entry 后置 null
  private currentRunUsageAccum: PiUsageAccumulator | null = null;
  // 本轮最后一条 CTX 快照的 totalTokens（message_end 时更新），run_end 时附到 entry.lastContextTokens 后置空
  private currentRunContextTokens: number | undefined;
  // start() 时算一次的静态上下文构成（提示词三段 + 工具定义，未校准估算值），CTX 快照时与消息桶合并后校准
  private staticContextComposition: ContextCategoryDraft[] = [];
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
  private pendingInjected: Array<{ tag: InjectionTag }> = [];
  // 设置快照域变更标记（updateSettings diff 命中本会话时由 manager 置位）；
  // 下一轮 sendMessage 且 isIdle 时按新设置重建，正在跑的轮不打断
  private snapshotDirty = false;
  // SessionFailed 自动恢复一次性防抖：storage 持续故障时不再循环重开，会话保持报错终态
  private reopenAttempted = false;
  // 压缩失败持续态镜像（onCompactionFailure 回调驱动），翻转才广播 compactionFailure 事件
  private compactionFailureActive = false;

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

  /** 热更新附加路径：重算含 configDir 的 basePaths 全量覆盖 env.allowedPaths（禁写清单只依赖 configDir，无需重算） */
  updateWorkspacePaths(additionalPaths: string[]): void {
    this.config.additionalPaths = additionalPaths;
    this.env?.updateAllowedPaths(computeBasePaths(this.config.workspacePath, additionalPaths));
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

  /** 会话级模型选择变更：更新 config 快照并标脏，idle 后下轮 sendMessage 前重建生效（不打断 running turn） */
  updateModelSelection(selection: ModelSelection | null): void {
    this.config.modelSelection = selection ? { ...selection } : null;
    this.markSnapshotDirty();
  }

  /**
   * 按新设置原位重建：先刷新 config 中的设置快照（basicToolPermissions / 子会话 Profile），
   * 再关旧 adapter 重走 start()。start() 内 repository.open(config.harnessSessionId)
   * 重开同一 JSONL（failover 同款路径），历史不丢。
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

    try {
      await this.reopenAdapter();
      this.snapshotDirty = false;
      this.logger.info('已按新设置重建会话（同 harnessSessionId 重开，历史不丢）');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn('按新设置重建失败，回退旧配置重开:', message);
      this.toolPackMap = new Map();
      await this.start();
    }
  }

  /**
   * 关旧 adapter 并按 config 原状重走 start()（settings 重建与 SessionFailed 恢复共用的重开骨架）。
   * storage 归 adapter（Harness）所有：旧 adapter 必须先 abort+close（close 内含 storage close），
   * 否则重开同一会话目录会双实例写同一 JSONL。close 的收尾错误只 warn 不上抛：
   * SessionFailed 恢复场景旧 harness 已死，storage 二次关闭可能抛错，不能掩盖重开本身的结果。
   */
  private async reopenAdapter(): Promise<void> {
    const oldAdapter = this.adapter;
    this.adapter = null;
    this.env = null;
    if (oldAdapter) {
      await oldAdapter.abort();
      await oldAdapter.close().catch((error) => {
        this.logger.warn('旧 adapter 关闭出错（已忽略）:', error);
      });
    }
    this.toolPackMap = new Map();
    await this.start();
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
    // start() 入口时点判断：有 harnessSessionId = 恢复已有会话；create 分支会在下面同步回填
    const isRestore = Boolean(this.config.harnessSessionId);
    const opened = this.config.harnessSessionId
      ? await repository.open(this.config.workspaceId, this.config.harnessSessionId)
      : await (async () => {
          const created = await repository.create(this.config.workspaceId);
          this.config.harnessSessionId = created.info.id;
          return created;
        })();

    const appSettings = await loadSettings();
    // 恢复场景的 modelSelection 可能引用本机不存在的 profile/tier（同步/迁移带入），回退默认模型；新建会话维持抛错
    let modelResult: ReturnType<typeof resolvePiModel>;
    let effectiveSelection: ModelSelection | null = this.config.modelSelection ?? appSettings.ai.defaultModelSelection;
    try {
      modelResult = resolvePiModel(
        appSettings,
        this.config.modelSelection,
        null,
        appSettings.ai.defaultModelSelection,
      );
    } catch (error) {
      if (!isRestore || !this.config.modelSelection) throw error;
      this.logger.warn(
        `恢复会话：记录内模型配置失效（${JSON.stringify(this.config.modelSelection)}），回退默认模型:`,
        error instanceof Error ? error.message : String(error),
      );
      modelResult = resolvePiModel(appSettings, null, null, appSettings.ai.defaultModelSelection);
      effectiveSelection = appSettings.ai.defaultModelSelection;
    }
    const { model, profile, tier, thinkingLevel } = modelResult;

    this.currentModelSelection = effectiveSelection;
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
    // .git 为目录或文件（worktree/submodule）均算有仓库；探测仅会话创建时一次，git init 后重启会话生效
    const hasUserGitRepo = this.config.workspacePath
      ? existsSync(path.join(this.config.workspacePath, '.git'))
      : false;
    const activeAbilities = resolveAbilities(wsConfig, {
      role: this.config.role,
      isExecutor: this.config.executor,
      groupId: this.config.groupId ?? null,
      hasWorkspace: !!this.config.workspacePath,
      hasUserGitRepo,
      profile: subAgentProfile ?? null,
      sceneOverride: this.config.role === 'sub'
        ? 'sub'
        : this.config.schedulerTask
          ? 'scheduler'
          : this.config.executor
            ? 'executor'
            : undefined,
    });

    // ---- agent.md + 偏好层（preferences.md，全局规则同级常驻）----
    const projectClaudeMd = activeAbilities.has('workspace-rules')
      ? await readTextFileSafe(path.join(getConfigDir(), 'workspaces', this.config.workspaceId, 'agent.md'))
      : '';
    const userClaudeMd = activeAbilities.has('global-rules')
      ? await readTextFileSafe(path.join(getConfigDir(), 'agent.md'))
      : '';
    const preferencesMd = activeAbilities.has('global-rules')
      ? await readTextFileSafe(path.join(getConfigDir(), 'preferences.md'))
      : '';

    // ---- 挂载边界 + 禁写清单（读开写禁，保住 notes/memory 工具唯一写通道） ----
    const basePaths = computeBasePaths(this.config.workspacePath, this.config.additionalPaths);
    const env = new WorkspaceExecutionEnv(basePaths);
    env.updateWriteExcludedPaths(buildWriteExcludedPaths());
    this.env = env;
    const builtinSkillsDir = getTemplatesDir();
    const customSkillsDir = path.join(getConfigDir(), 'custom', 'skills');
    const allSkillEntries = await loadSkillIndex([
      builtinSkillsDir,
      customSkillsDir,
    ]);

    const enabledSkillsSet = new Set(wsConfig.enabledSkills);
    // skill 型包未生效 → 包内 skill 整体剔除（enabledSkills 子开关之前先过包总开关）
    const disabledPackSkills = new Set<string>();
    for (const pack of ABILITY_PACKS) {
      if (pack.type !== 'skill-packs' || activeAbilities.has(pack.key)) continue;
      for (const name of pack.skills ?? []) disabledPackSkills.add(name);
    }
    const passWorkspaceFilter = (e: SkillEntry): boolean =>
      enabledSkillsSet.has(e.name) && !disabledPackSkills.has(e.name);
    // custom 源 skill 勾选即注入（enabledSkills 唯一闸，管理包闸已撤）；子会话 Profile 白名单与 skillsOverride 权威清单是独立体系不走此过滤

    // skillsOverride 是权威清单，绕过工作区 enabledSkills 与包总开关两层闸：执行会话按任务类型恒传查表清单（default 空清单=基础版）；undefined=跟随工作区，保留给非执行场景
    const skillsOverrideSet = this.config.skillsOverride && !isSubAgent
      ? new Set(this.config.skillsOverride)
      : null;

    let skillEntries: SkillEntry[];
    let skillIndexText: string;
    if (isSubAgent && subAgentProfile) {
      // 自治包 skill 绕过工作区 enabledSkills/disabledPackSkills 两层闸，由 Profile 子开关独裁（对齐 resolveAbilities 自治分支）
      skillEntries = filterSkillsForSubAgent(
        allSkillEntries.filter((e) => SUB_AUTONOMOUS_SKILLS.has(e.name) || passWorkspaceFilter(e)),
        subAgentProfile,
        {
          builtin: builtinSkillsDir,
          custom: customSkillsDir,
        },
      );
      skillIndexText = formatSkillIndexForPrompt(skillEntries);
    } else if (skillsOverrideSet) {
      skillEntries = allSkillEntries.filter((e) => skillsOverrideSet.has(e.name));
      skillIndexText = formatSkillIndexForPrompt(skillEntries);
    } else {
      skillEntries = allSkillEntries.filter((e) => passWorkspaceFilter(e));
      skillIndexText = formatSkillIndexForPrompt(skillEntries);
    }

    // ---- 提示词拼装（三分桶供上下文构成估算：agent.md+偏好 / skill 索引 / 人格纪律） ----
    const agentMdText = [projectClaudeMd, userClaudeMd, preferencesMd].filter(Boolean).join('\n\n');
    const personaParts: string[] = [];
    personaParts.push(buildAppDataGuidance(getConfigDir(), this.config.workspaceId));
    // 无人值守段系统级注入（不归能力包）；开关切换不在快照影响域内（不标脏不重建），仅新会话/重建时生效，
    // 运行中会话靠权限放行 + 介入跳过已达成行为，提示词缺失可接受
    if (appSettings.ai.unattended) personaParts.push(UNATTENDED_MODE_APPEND);

    if (isSubAgent) {
      if (activeAbilities.has('memory')) personaParts.push(MEMORY_GUIDANCE_APPEND);
      if (activeAbilities.has('workspace-snapshot')) personaParts.push(SNAPSHOT_SAFETY_GUIDANCE_APPEND);
      if (activeAbilities.has('workspace-git')) personaParts.push(GIT_HISTORY_GUIDANCE_APPEND);
      if (activeAbilities.has('web-mcp') || activeAbilities.has('browser-extension')) personaParts.push(WEB_RESEARCH_GUIDANCE_SUB_APPEND);
      if (activeAbilities.has('browser-extension')) personaParts.push(EXTENSION_BROWSER_DISCIPLINE_APPEND);
      if (this.config.subAgent) personaParts.push(subAgentContractFor(this.config.subAgent));
    } else {
      if (activeAbilities.has('memory')) personaParts.push(MEMORY_GUIDANCE_APPEND);
      // executor 跳过存卡纪律是段级裁剪，不受包开关约束（工具组仍注册），保留现状
      if (activeAbilities.has('notes') && !this.config.executor) personaParts.push(NOTES_DISCIPLINE_APPEND);
      // 低频能力导览：executor 不注入（tasks 保底常驻无需导览，无人值守系统提示精简）
      if (!this.config.executor) {
        personaParts.push(buildLowFreqToolGuide({ tasks: activeAbilities.has('notes'), skillAdmin: activeAbilities.has('skill-admin'), scheduler: activeAbilities.has('scheduler') }));
      }
      if (activeAbilities.has('workspace-snapshot')) personaParts.push(SNAPSHOT_SAFETY_GUIDANCE_APPEND);
      if (activeAbilities.has('workspace-git')) personaParts.push(GIT_HISTORY_GUIDANCE_APPEND);
      if (activeAbilities.has('shunt') && !this.config.executor) personaParts.push(SHUNT_GUIDANCE_APPEND);
      if (activeAbilities.has('web-mcp') || activeAbilities.has('browser-extension')) personaParts.push(WEB_RESEARCH_GUIDANCE_MAIN_APPEND);
      if (activeAbilities.has('agent-collab')) {
        personaParts.push(MAIN_AGENT_DELEGATION_APPEND);
        personaParts.push(buildSubAgentProfileIndex(appSettings.subAgent?.profiles ?? []));
      }
    }
    const systemPrompt = [agentMdText, skillIndexText, ...personaParts].filter(Boolean).join('\n\n');

    let toolDefs: ToolDef[];

    if (isSubAgent && subAgentProfile) {
      toolDefs = this.buildSubAgentToolDefs(subAgentProfile, skillEntries, activeAbilities, basePaths, env);
    } else {
      toolDefs = this.buildMainAgentToolDefs(skillEntries, activeAbilities, basePaths, env);
    }

    const activeToolNames = isSubAgent && subAgentProfile
      ? computeSubAgentActiveTools(subAgentProfile, toolDefs)
      : undefined;

    const tools: ToolRegistration[] = [
      ...createBuiltinFileTools({
        conversationId: this.config.conversationId,
        workspaceRoots: basePaths,
        workspaceId: this.config.workspaceId,
      }),
      ...toHarnessTools(toolDefs),
    ];

    this.adapter = await PiHarnessAdapter.create({
      storage: opened.storage,
      conversationId: opened.info.conversationId,
      models: piModels,
      tools,
      env,
      systemPrompt,
      model,
      thinkingLevel,
      timeoutMs: profile.apiTimeoutMs,
      activeToolNames,
      onAgentEvent: (event) => this.handleAgentEvent(event),
      onSessionCompact: (compactionEntryId) => { this.lastCompactionEntryId = compactionEntryId; },
      onSteerQueueChanged: (count) => this.handleSteerQueueChanged(count),
      onCompactionFailure: (signal) => this.handleCompactionFailure(signal),
      onSettled: () => this.handleSettled(),
      onToolCall: (event) => this.handleToolCall(event),
      onToolUsage: ({ toolName, ok, durationMs }) => {
        recordToolUsage({
          ts: new Date().toISOString(),
          tool: toolName,
          pack: classifyToolPack(toolName, this.toolPackMap),
          conv: this.config.conversationId,
          sessionType: resolveToolUsageSessionType(this.config),
          ...(this.config.role === 'sub' && this.config.subAgentProfile
            ? { profile: this.config.subAgentProfile.name }
            : {}),
          ws: this.config.workspaceId,
          ok,
          ms: durationMs,
        });
      },
    });
    // 同步 attach 时的初始持续态（重启恢复可能带着未恢复的压缩失败）：镜像翻转才广播，与事件路径同一收敛点
    this.handleCompactionFailure(this.adapter.getCompactionFailure());

    // 工具定义与发送口径近似：只累计常驻下发工具的 name/description/parameters（deferred 按需工具不在请求体，
    // tool_search 本体定义体积小不计入；后续被拉起的增量由真实 usage 快照覆盖）
    const toolsText = tools
      .filter((t) => !t.deferred)
      .map((t) => `${t.name}\n${t.description}\n${JSON.stringify(t.parameters)}`)
      .join('\n');
    this.staticContextComposition = [
      { name: '固定·系统提示词', tokens: estimateTokens(agentMdText) + estimateTokens(personaParts.join('\n\n')) },
      { name: '固定·扩展', tokens: estimateTokens(skillIndexText) },
      { name: '固定·工具定义', tokens: estimateTokens(toolsText) },
    ];

    this.logger.info('✅ pi 会话已创建', {
      profile: profile.name,
      tier,
      skills: skillEntries.map((e) => e.name),
      claudeMd: { project: !!projectClaudeMd, user: !!userClaudeMd },
    });
  }

  /** 工具包注册辅助：实现见 tool-assembly.registerPack，toolPackMap 由实例持有（权限判定与冒烟测试断言用） */
  private registerPack(packName: string, defs: ToolDef[]): ToolDef[] {
    return registerToolPack(this.toolPackMap, packName, defs);
  }

  /** 主会话工具构建（实现见 tool-assembly） */
  private buildMainAgentToolDefs(skillEntries: SkillEntry[], activeAbilities: Set<string>, basePaths: string[], env: WorkspaceExecutionEnv): ToolDef[] {
    return assembleMainAgentToolDefs(this.config, this.toolPackMap, skillEntries, activeAbilities, basePaths, env);
  }

  /** 子会话工具构建（实现见 tool-assembly） */
  private buildSubAgentToolDefs(profile: SubAgentProfile, skillEntries: SkillEntry[], activeAbilities: Set<string>, basePaths: string[], env: WorkspaceExecutionEnv): ToolDef[] {
    return assembleSubAgentToolDefs(this.config, this.toolPackMap, profile, skillEntries, activeAbilities, basePaths, env);
  }

  private handleAgentEvent(event: PiHarnessAgentEvent): void {
    if (event.type === 'message_end') {
      const entry = event.entry;
      const message = entry.model?.[0];
      const entryId = String(entry.id);

      // assistant 落盘：usage 累加 + CTX 快照 + run_end 三分支结算依据；durable 的 turn_end 无载荷，
      // lastTurnAssistant/lastContextTokens 改在 message_end 捕获（按 0.83 口径跳过 error/aborted 更新 tokens）
      if (message?.role === 'assistant') {
        const assistantMessage = message;
        if (!this.currentRunUsageAccum) this.currentRunUsageAccum = createPiUsageAccumulator();
        accumulatePiUsage(this.currentRunUsageAccum, assistantMessage);
        this.lastTurnAssistant = assistantMessage;
        if (assistantMessage.stopReason !== 'error' && assistantMessage.stopReason !== 'aborted') {
          const usage = assistantMessage.usage;
          if (usage && usage.totalTokens > 0) this.lastContextTokens = usage.totalTokens;
        }
        this.emitContextSnapshot(assistantMessage);
      }

      // user/assistant 落盘完成后广播 message_id（uuid = durable entry id 转字符串，与历史读取端同源），
      // 同时进 liveTurnMessages 保证 snapshot 重放路径一致；toolResult 的 entry 并入 tool_use 块（toolUseId 键），无需独立 ID
      // injected 实体必须先于 message_id 落 live：快照重放时 message_id(user) 才能把注入实体从 local id 升级为磁盘 id，
      // reinsertCutUsers 按磁盘 id 去重命中；若顺序颠倒，local id 未升级、去重失配，会插入第二条（双显）
      if (entry.kind === 'pi.user' || entry.kind === 'pi.assistant' || entry.kind === INJECTED_ENTRY_KIND) {
        const role = entry.kind === 'pi.assistant' ? 'assistant' as const : 'user' as const;
        if (role === 'user' && message) this.tryFlushPendingInjected(entry, message);
        const idMessage: ExtendedSessionMessage = {
          type: 'message_id',
          uuid: entryId,
          role,
          ...(role === 'assistant' && message?.role === 'assistant' ? { model: message.model } : {}),
          timestamp: message?.timestamp ?? Date.now(),
        };
        this.liveTurnMessages.push(idMessage);
        this.turnEntryIds.push(entryId);
        this.emit('message', idMessage);
      }
    }

    const messages = this.messageConverter.convert(event);
    for (const message of messages) {
      // 缓存本轮 emit 出去的消息快照，run_end 时喂给 extractPiUsageEntry 聚合 toolActivity
      this.currentTurnMessages.push(message);
      this.liveTurnMessages.push(message);
      this.emit('message', message);
    }

    if (event.type === 'run_end') {
      const last = this.lastTurnAssistant;
      if (last?.stopReason === 'error') {
        const errorMessage = last.errorMessage || '模型请求失败';
        if (this.recordTurnFailure('model', errorMessage)) {
          this.logger.error('pi 模型返回错误:', errorMessage);
          this.emitErrorMessage(errorMessage);
        }
      } else if (last?.stopReason === 'aborted') {
        // durable 中断时流式 partial 以 stopReason=aborted 落盘；用户主动中断的 cancelled 已在 interrupt() 记录（幂等）
        this.recordTurnCancelled('会话已中断');
      } else if (last?.stopReason === 'length') {
        // 输出 token 上限截断（常见于 thinking 耗尽预算、正文一字未出），pi 按正常回合收流
        const truncMsg = '模型输出被截断（stopReason=length，输出达到上限）';
        if (this.recordTurnFailure('model', truncMsg)) {
          this.logger.error('pi 模型输出被截断');
          this.emitErrorMessage(truncMsg);
        }
      }

      this.emitUsageEntry();
      this.currentTurnMessages = [];
      this.currentRunUsageAccum = null;
      this.currentRunContextTokens = undefined;
      this.lastTurnAssistant = null;
    }
  }

  /**
   * CTX 快照：同步部分记账 currentRunContextTokens（run_end 的 emitUsageEntry 同步读它，不能等异步估算），
   * 构成估算（buildContext 是异步读）fire-and-forget；相邻快照间隔整轮 LLM call，微任务级延迟无乱序风险。
   * buildContext 失败时该次快照 categories 留空，快照本身照常落盘，不影响 totalTokens。
   */
  private emitContextSnapshot(message: AssistantMessage): void {
    const conversationId = this.config.conversationId;
    if (!conversationId) return;
    if (message.errorMessage) return;
    const usage = message.usage;
    if (!usage) return;
    const totalTokens = contextTotalTokens(usage);
    this.currentRunContextTokens = totalTokens;
    void this.emitContextSnapshotAsync(message, conversationId, totalTokens);
  }

  private async emitContextSnapshotAsync(
    message: AssistantMessage,
    conversationId: string,
    totalTokens: number,
  ): Promise<void> {
    let composition: ContextCategoryDraft[] | undefined;
    try {
      const messages = await this.adapter?.getContextMessages();
      composition = messages && messages.length > 0
        ? [...this.staticContextComposition, ...estimateMessageBuckets(messages)]
        : [...this.staticContextComposition];
    } catch (err) {
      this.logger.warn('上下文构成估算失败（本次快照 categories 留空）:', err);
    }
    const snapshot = extractPiContextSnapshot(
      message,
      this.usageTurnIndex,
      (id) => this.resolveModelWindow(id),
      composition,
    );
    if (snapshot) this.emit('usageContext', { conversationId, snapshot });
  }

  /** 按 entry.data 精确匹配出队并广播带 injectedTag 的 user 内容事件（失配时 warn，标记保留） */
  private tryFlushPendingInjected(entry: EntryRecord, message: AgentMessage): void {
    const pending = this.pendingInjected[0];
    if (!pending) return;
    if (entry.data !== pending.tag) {
      this.logger.warn('注入标记与落盘 entry 失配，标记保留:', { expected: pending.tag, actual: entry.data, entryKind: entry.kind });
      return;
    }
    this.pendingInjected.shift();
    const injected: ExtendedSessionMessage = {
      type: 'user',
      content: userMessageText(message),
      injectedTag: pending.tag,
      timestamp: message.timestamp,
      role: 'user',
    };
    this.liveTurnMessages.push(injected);
    this.emit('message', injected);
  }

  /**
   * 压缩失败持续态翻转（adapter CompactionFailureTracker 推导，仅翻转时触发；创建后主动对账一次）。
   * 与 maybeAutoCompact 的单次失败提示同源不同层：错误消息是一次性告知，本事件驱动前端持续态横幅，
   * 恢复（下次压缩成功落 summary）时由 entry_appended 路径自动解除。
   */
  private handleCompactionFailure(signal: CompactionFailureSignal): void {
    const conversationId = this.config.conversationId;
    if (!conversationId || signal.failed === this.compactionFailureActive) return;
    this.compactionFailureActive = signal.failed;
    if (signal.failed) this.logger.warn('对话压缩失败，恢复前持续提示:', signal.error ?? '未知原因');
    else this.logger.info('对话压缩已恢复');
    this.emit('compactionFailure', { conversationId, failed: signal.failed });
  }

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

  /**
   * steer 队列变化（Harness inbox_update 事件），入队与 one-at-a-time drain 都会触发，count 为权威全量快照。
   */
  private handleSteerQueueChanged(count: number): void {
    this.pendingSteerCount = count;
    this.emit('pendingCountChanged', { count });
    this.syncSessionState();
  }

  /**
   * 一次完整 run（含所有工具调用和插话）彻底结束（settled 双信号：run_end 事件 + prompt/compact promise resolve），
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
   * run_end 时把本轮累加器 + turn 消息快照转成 ConversationUsageEntry 并 emit 'usage'。
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
   * 工具调用权限拦截点（pi.tool 的 beforeTool hook）。
   *
   * 策略：
   * - 子会话或 autoExecute 模式：无条件放行。
   * - 默认主会话：
   *   - 已归类工具包的工具 → 自动放行。
   *   - 基础工具 → 按快照映射（allow=放行，ask=挂起请求）。
   *   - 本会话已允许的基础工具 → 放行。
   *   - 未分类工具 → 保守请求确认。
   *
   * 与裸 Agent 的 beforeToolCall 不同，beforeTool hook 不带 AbortSignal 参数，
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
    const injectionTag = opts?.injectionTag;
    const inputEntry = injectionTag === undefined ? undefined : { kind: INJECTED_ENTRY_KIND, data: injectionTag };
    const injectedMark = this.pendingInjected.length;
    if (injectionTag !== undefined) this.pendingInjected.push({ tag: injectionTag });
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
      try {
        await adapter.steer(text, images, inputEntry);
        return;
      } catch (error) {
        // steer 同步抛错说明 message_end 未发生，刚 push 的标记必在队尾，截断即精确回滚
        this.pendingInjected.length = injectedMark;
        if (!(error instanceof SessionFailed)) throw error;
        const recovered = await this.recoverFromSessionFailure(error);
        if (!recovered) {
          const message = error instanceof Error ? error.message : String(error);
          if (this.recordTurnFailure('runtime', message)) this.emitErrorMessage(message);
        }
        this.settleDeadRun();
        return;
      }
    }

    this.currentTurnResult = null;
    this.running = true;
    this.syncSessionState();
    try {
      await this.maybeAutoCompact(adapter);
      await adapter.prompt(text, images, inputEntry);
    } catch (error) {
      // prompt 抛错（含 SessionFailed 恢复成功/失败两种结局）输入均未落盘，回滚标记
      this.pendingInjected.length = injectedMark;
      const recovered = error instanceof SessionFailed && await this.recoverFromSessionFailure(error);
      if (!recovered) {
        const message = error instanceof Error ? error.message : String(error);
        if (this.recordTurnFailure('runtime', message)) {
          this.logger.error('pi 会话执行失败:', message);
          this.emitErrorMessage(message);
        }
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
   * SessionFailed 后的一次性恢复：同目录重开（历史不丢），用户消息不自动重投（避免重复消费）。
   * 恢复成功返回 true，以 status 系统提示替代红色错误让用户重发；turn 仍按 failed 结算，
   * 上层消费方（派遣等待、failover）能感知消息未送达。reopenAttempted 已在入口置位，
   * 重开本身再遇 storage 故障时不会循环重开，后续发送维持 runtime 报错路径。
   */
  private async recoverFromSessionFailure(originalError: unknown): Promise<boolean> {
    if (this.reopenAttempted) return false;
    this.reopenAttempted = true;
    this.logger.error('检测到会话存储故障，尝试同目录重开:', originalError);
    try {
      await this.reopenAdapter();
    } catch (error) {
      this.logger.error('会话重开失败:', error);
      return false;
    }
    const notice = '存储故障已恢复，刚才的消息未发出，请重新发送';
    this.logger.info(notice);
    this.emit('message', { type: 'status', status: notice, timestamp: Date.now() } as ExtendedSessionMessage);
    this.recordTurnFailure('runtime', notice);
    return true;
  }

  /**
   * SessionFailed 后原 run 已死、settled 永远不来，手动归位死 run 状态：
   * prompt catch 的清理 + interrupt 的 steer 队列清零 + handleSettled 的字段归位 + finally 的
   * complete 广播。重开后的 harness steer 队列为空，pendingSteerCount 归零只能在此手动完成
   * （queue_update 事件不会再来）。不 emit 'settled'（该事件通知 Manager 收集 orphan，恢复场景
   * harness 已重开不适用）；usage 不 emit（半截 run 的累加器丢弃，与 prompt catch 一致）。
   */
  private settleDeadRun(): void {
    this.currentTurnMessages = [];
    this.currentRunUsageAccum = null;
    this.currentRunContextTokens = undefined;
    this.liveTurnMessages = [];
    this.turnEntryIds = [];
    this.running = false;
    this.pendingSteerCount = 0;
    this.emit('pendingCountChanged', { count: 0 });
    this.adapter?.clearPause();
    this.emit('complete', this.currentTurnResult ?? { subtype: 'success' });
    this.currentTurnResult = null;
    this.syncSessionState();
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

    // 顺序不可换：先拒绝挂起的权限确认请求，让卡在 beforeTool hook 里的 Promise 立刻 resolve，
    // 工具调用才能收到 blocked 结果继续走完当前这一轮；否则 adapter.abort() 内部
    // 等待 conversation idle 时会一直等这一轮结束，永久死锁（见 pi-harness-adapter.ts abort() 注释）。
    this.rejectAllPendingPermissionRequests('会话已关闭');
    // 正常路径 resolve 代表当前 run 已完全结束、settled 已触发；超时路径遗弃后台 run 强制收尾，
    // 等下去只会让 sessionClosed 永远发不出去（遗弃 run 的后续事件打到已摘 listeners 的对象上是 no-op）。
    if (await this.awaitAdapterOrAbandon((a) => a.abort(), 'doClose: abort')) {
      this.logger.warn('doClose: abort 超时，遗弃后台 run 强制收尾:', this.sessionId);
    }
    // close 释放 adapter 持有的 storage（Harness.close 内含）：不 close 会让该
    // 会话目录后续重开/fork 双实例写同一 JSONL；abort 已超时遗弃时也照常 close（Session.close 会 settle 已受理的提交）
    await this.awaitAdapterOrAbandon((a) => a.close(), 'doClose: close');

    this.status = PiSessionStatus.CLOSED;
    this.pendingSteerCount = 0;
    this.pendingInjected = [];
    this.running = false;
    killConversationTerminals(this.config.conversationId);
    this.emit('sessionClosed', { conversationId: this.config.conversationId });
    // 必须在 abort() 完成之后才摘监听器：abort 过程中 harness 仍可能 emit 最后的
    // run_end/settled/usage 等事件，提前摘掉会让这些事件被静默丢弃。
    this.removeAllListeners();
  }

  /**
   * 中断当前 run，会话继续可用（后续 sendMessage 正常 prompt）——故这里不能调 adapter.close()
   * （close 会关 storage，后续 prompt 报 SessionFailed 类错误）；storage 的释放只在 doClose 做。
   * conversation.abort() 对并发调用安全（无 live task 时为 no-op），
   * 本方法自身的 rejectAllPendingPermissionRequests / pendingSteerCount 清零也都是幂等操作，
   * 因此用户连点两次"中断"不会死锁或产生不一致状态。
   */
  async interrupt(): Promise<void> {
    // 暂停态下中断等价取消暂停：清标志；且此时无 run，不会再有 settled 链驱动广播，需同步 syncSessionState
    this.adapter?.clearPause();
    // 不依赖 beforeTool hook 收到 abort 信号（hook 不带 signal 参数），
    // 主动拒绝所有待处理权限请求兜底，避免中断后仍有请求悬挂等待
    if (this.running || this.pendingSteerCount > 0) this.recordTurnCancelled('用户中断');
    this.pendingSteerCount = 0;
    this.pendingInjected = [];
    this.emit('pendingCountChanged', { count: 0 });
    this.rejectAllPendingPermissionRequests('用户中断');
    // 超时遗弃后台 run：run 实际还卡着，但会话即将被上层强杀，快照不能继续谎报 running。
    if (await this.awaitAdapterOrAbandon((a) => a.abort(), 'interrupt: abort')) {
      this.logger.warn('interrupt: abort 超时，遗弃后台 run 强制 running=false:', this.sessionId);
      this.running = false;
    }
    this.syncSessionState();
  }

  /** adapter.abort/close 无界等待会卡死收尾链；超时即遗弃（harness 自吞异常，后台 promise 无 unhandled rejection），返回是否遗弃 */
  private async awaitAdapterOrAbandon(action: (adapter: PiHarnessAdapter) => Promise<void>, label: string): Promise<boolean> {
    const adapter = this.adapter;
    if (!adapter) return false;
    let abandoned = false;
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      action(adapter),
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          abandoned = true;
          resolve();
        }, ABORT_TIMEOUT_MS);
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (abandoned) this.logger.warn(`${label} 超时，遗弃后台操作强制收尾:`, this.sessionId);
    return abandoned;
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

  /** 无人值守接管：记录当前模式并切 autoExecute（同 task-queue 临时接管先例）；已接管时幂等不覆盖记录 */
  takeOverForUnattended(): void {
    if (this.unattendedSavedMode !== null) return;
    this.unattendedSavedMode = this.currentPermissionMode;
    void this.setPermissionMode('autoExecute');
  }

  /** 无人值守退出：当前仍为 autoExecute（用户未手动切过）才恢复记录值；无论如何清记录 */
  restoreFromUnattended(): void {
    const saved = this.unattendedSavedMode;
    if (saved === null) return;
    this.unattendedSavedMode = null;
    if (this.currentPermissionMode === 'autoExecute' && saved !== 'autoExecute') {
      void this.setPermissionMode(saved);
    }
  }

  /** 无人值守接管时批量放行/拒绝全部挂起权限请求，返回处理数；复用 respondPermissionRequest 单条语义 */
  resolveAllPendingPermissions(allow: boolean): number {
    const requestIds = Array.from(this.pendingPermissionRequests.keys());
    for (const requestId of requestIds) {
      this.respondPermissionRequest(requestId, allow ? 'allow' : 'deny');
    }
    return requestIds.length;
  }

  /**
   * 响应权限确认请求：
   * - allow：本次放行
   * - allow_session：本次放行 + 本会话进程内记住该工具（仅基础工具有效；非基础工具降级为 allow）
   * - deny：beforeTool hook 返回 block，工具收到一条 error 结果
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
