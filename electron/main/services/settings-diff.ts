import type { AppSettings, ModelSelection, SubAgentProfile } from './settings-types.js';

/**
 * 设置项域映射（ui=渲染层广播热更 | perCall=按次读取天然即时 | snapshot=PiSession 启动快照，标脏后下轮重建）：
 *
 * | 设置键                                                            | 域 |
 * |-------------------------------------------------------------------|-----|
 * | ui.messageDisplayMode / ui.fontSize / ui.sound.*                  | ui |
 * | appearance.theme                                                  | ui |
 * | profiles[id].name                                                 | ui（仅显示名） |
 * | browserProxyServer / browserSearchEngine                          | perCall（browser-tools 每次调用读取） |
 * | taskBrowser                                                       | perCall（扩展断连分流时现读） |
 * | webMcpApiKey                                                       | perCall（web-mcp-tools 每次调用读取） |
 * | failover.enabled / failover.chain                                 | perCall（maybeFailoverMainSession 每轮读取） |
 * | update.serverUrl / migrated.*                                     | perCall |
 * | ai.parseModelSelection / ai.stateModelSelection                   | perCall（agent-worker 每任务 loadSettings） |
 * | snapshot.*                                                        | perCall（shadow takeSnapshot 每次快照现读） |
 * | subAgent.profiles[].timeoutMinutes                                | perCall（delegation-bridge 派时读） |
 * | ai.settingSources                                                 | perCall（暂无消费方） |
 * | ai.effort                                                         | snapshot（全部会话；thinkingLevel 在 start() 定型） |
 * | ai.permissionMode                                                 | snapshot·热 setter（主会话 setPermissionMode） |
 * | basicToolPermissions                                              | snapshot（主会话；子会话 autoExecute 无感） |
 * | profiles[id].apiKey/baseUrl/piWireApi/piModels/apiTimeoutMs/autoCompactPercent | snapshot（生效该 profile 的会话） |
 * | ai.defaultModelSelection                                          | snapshot（回退默认模型选会的会话） |
 * | subAgent.profiles[]（其余字段/增删）                               | snapshot（主会话提示词含全量索引；子会话仅绑定 profile 变化时） |
 */

export interface SettingsSnapshotDiff {
  effortChanged: boolean;
  permissionModeChanged: boolean;
  basicToolPermissionsChanged: boolean;
  /** 发生快照域变化的 profile id（含增删；name-only 变化不计入） */
  changedProfileIds: string[];
  defaultModelSelectionChanged: boolean;
  /** 子会话 Profile 列表发生任何增删改（主会话提示词索引受全量影响） */
  subAgentProfilesChanged: boolean;
  /** 被修改或删除的子会话 Profile id（纯新增不计入，存量会话不受新增影响） */
  subAgentProfileIdsChanged: string[];
}

// 与 app/settings/page.tsx 的 deepEqual 为同源双副本（主/渲染 tsconfig 隔离，不可共享），改动需两侧同步
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  }
  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(objA), ...Object.keys(objB)]);
  return [...keys].every((key) => deepEqual(objA[key], objB[key]));
}

function selectionEquals(a: ModelSelection | null | undefined, b: ModelSelection | null | undefined): boolean {
  if (!a || !b) return a === b;
  return a.profileId === b.profileId && a.tier === b.tier;
}

const PROFILE_SNAPSHOT_FIELDS = ['apiKey', 'baseUrl', 'piWireApi', 'piModels', 'apiTimeoutMs', 'autoCompactPercent'] as const;

function profileSnapshotChanged(prev: AppSettings['profiles'][string], next: AppSettings['profiles'][string]): boolean {
  if ((prev.piWireApi ?? 'anthropic-messages') !== (next.piWireApi ?? 'anthropic-messages')) return true;
  if ((prev.autoCompactPercent ?? 80) !== (next.autoCompactPercent ?? 80)) return true;
  return PROFILE_SNAPSHOT_FIELDS
    .filter((field) => field !== 'piWireApi' && field !== 'autoCompactPercent')
    .some((field) => !deepEqual(prev[field], next[field]));
}

function subAgentProfileEquals(prev: SubAgentProfile, next: SubAgentProfile): boolean {
  return deepEqual({ ...prev, timeoutMinutes: undefined }, { ...next, timeoutMinutes: undefined });
}

export function diffSettings(prev: AppSettings, next: AppSettings): SettingsSnapshotDiff {
  const prevProfiles = prev.profiles ?? {};
  const nextProfiles = next.profiles ?? {};
  const changedProfileIds: string[] = [];
  for (const id of new Set([...Object.keys(prevProfiles), ...Object.keys(nextProfiles)])) {
    const p = prevProfiles[id];
    const n = nextProfiles[id];
    if (!p || !n || profileSnapshotChanged(p, n)) changedProfileIds.push(id);
  }

  const prevSub = prev.subAgent?.profiles ?? [];
  const nextSub = next.subAgent?.profiles ?? [];
  const prevSubById = new Map(prevSub.map((p) => [p.id, p]));
  const nextSubById = new Map(nextSub.map((p) => [p.id, p]));
  const subAgentProfileIdsChanged: string[] = [];
  let subAgentProfilesChanged = false;
  for (const [id, n] of nextSubById) {
    const p = prevSubById.get(id);
    if (!p) {
      subAgentProfilesChanged = true;
    } else if (!subAgentProfileEquals(p, n)) {
      subAgentProfilesChanged = true;
      subAgentProfileIdsChanged.push(id);
    }
  }
  for (const id of prevSubById.keys()) {
    if (!nextSubById.has(id)) {
      subAgentProfilesChanged = true;
      subAgentProfileIdsChanged.push(id);
    }
  }

  return {
    effortChanged: !deepEqual(prev.ai?.effort ?? null, next.ai?.effort ?? null),
    permissionModeChanged: prev.ai?.permissionMode !== next.ai?.permissionMode,
    basicToolPermissionsChanged: !deepEqual(prev.basicToolPermissions, next.basicToolPermissions),
    changedProfileIds,
    defaultModelSelectionChanged: !selectionEquals(prev.ai?.defaultModelSelection ?? null, next.ai?.defaultModelSelection ?? null),
    subAgentProfilesChanged,
    subAgentProfileIdsChanged,
  };
}

/** 会话快照相关判定的最小视图（避免 settings-diff 反向依赖 PiSession） */
export interface SessionSnapshotView {
  role: 'main' | 'sub';
  /** 会话自身携带的模型选择；null = 回退设置页默认模型 */
  configModelSelection: ModelSelection | null;
  /** start() 解析后的实际生效选择 */
  currentModelSelection: ModelSelection | null;
  subAgentProfileId?: string;
}

export function isSessionSnapshotAffected(
  diff: SettingsSnapshotDiff,
  view: SessionSnapshotView,
  next: AppSettings,
): boolean {
  if (diff.effortChanged) return true;
  if (diff.basicToolPermissionsChanged && view.role === 'main') return true;

  const effectiveProfileId = view.currentModelSelection?.profileId;
  if (effectiveProfileId && diff.changedProfileIds.includes(effectiveProfileId)) return true;

  if (
    diff.defaultModelSelectionChanged
    && view.configModelSelection === null
    && !selectionEquals(view.currentModelSelection ?? null, next.ai?.defaultModelSelection ?? null)
  ) {
    return true;
  }

  if (diff.subAgentProfilesChanged) {
    if (view.role === 'main') return true;
    if (view.subAgentProfileId && diff.subAgentProfileIdsChanged.includes(view.subAgentProfileId)) return true;
  }

  return false;
}

export function hasSnapshotChange(diff: SettingsSnapshotDiff): boolean {
  return diff.effortChanged
    || diff.permissionModeChanged
    || diff.basicToolPermissionsChanged
    || diff.changedProfileIds.length > 0
    || diff.defaultModelSelectionChanged
    || diff.subAgentProfilesChanged;
}
