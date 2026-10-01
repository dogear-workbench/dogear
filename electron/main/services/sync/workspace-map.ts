/**
 * 工作区映射与路径折算（step3 / D5）
 *
 * 两端各自 add() 时 uuidv4 独立生成 wsid → 同一项目两个身份；映射表把「本端 wsid ↔ 对端 wsid」
 * 显式关联（remoteWsid 缺省 = 同 id 直通，但仅在建了映射条目后生效），同步引擎按映射折算
 * workspaces/<wsid>/ 前缀路径。未映射的对端工作区目录不自动同步（进待映射清单），映射必须显式建立。
 *
 * sessions jsonl 定位（实施确认项结论）：读取侧按 flat-cwd 目录定位而非 sessionId 全量扫描——
 * JsonlSessionRepo.list({ cwd }) 只扫 sessions/<encodeCwd(cwd)>/，cwd = <dataDir>/workspaces/<wsid>，
 * encodeCwd 把路径分隔符/冒号替换为 '-'（机器相关）。两端 dataDir 不同 → flat-cwd 目录名不同，
 * 折算必须同时重写 sessions 子目录名，否则拉下来的会话文件本机 repo.list 扫不到。
 * 对端 flat-cwd 编码依赖对端 dataDir：经握手 hello.dataDirPath（仅 /manifest 授权端点携带）获得；
 * 旧版对端无此字段时 push 方向保持对端目录原名（退化为旧行为），pull 方向本端编码本地可算不受影响。
 */
import path from 'node:path';
import fsp from 'node:fs/promises';
import { safeJsonRead } from '../safe-json.js';
import type { SyncState } from './sync-state.js';
import type { FileEntry } from './protocol.js';

/** per-peer 映射条目：remoteWsid 缺省 = 同 id 直通；enabled = 按工作区同步开关（建映射时默认 on） */
export interface WorkspaceMapEntry {
  remoteWsid?: string;
  enabled: boolean;
}

/** 对端工作区概要（待映射区展示 / 已映射区对端名） */
export interface WorkspaceMetaItem {
  wsid: string;
  name?: string;
  conversationCount?: number;
  lastUpdated?: number;
}

export interface WorkspaceMapContext {
  /** enabled 映射：对端 wsid → 本端 wsid（重复目标取首个，UI 不产生该状态） */
  remoteToLocal: Map<string, string>;
  /** enabled 映射：本端 wsid → 对端 wsid */
  localToRemote: Map<string, string>;
  /** 待映射区选过「不同步」的对端 wsid */
  ignoredRemote: Set<string>;
  /** 本端数据目录（sessions flat-cwd 折算用） */
  dataDir: string;
  /** 对端数据目录（hello.dataDirPath）；未知时 push 折算不重写 sessions 目录名 */
  peerDataDir?: string;
}

/** 映射表中 enabled=true 的本端 wsid 列表（buildManifest 的 workspaces/ 过滤参数） */
export function enabledWorkspaceIdsOf(
  workspaceMap: Record<string, WorkspaceMapEntry> | undefined,
): string[] {
  if (!workspaceMap) return [];
  return Object.entries(workspaceMap)
    .filter(([, entry]) => entry?.enabled === true)
    .map(([localWsid]) => localWsid);
}

export function buildWorkspaceMapContext(
  workspaceMap: Record<string, WorkspaceMapEntry> | undefined,
  ignoredRemoteWorkspaces: string[] | undefined,
  dataDir: string,
  peerDataDir?: string,
): WorkspaceMapContext {
  const remoteToLocal = new Map<string, string>();
  const localToRemote = new Map<string, string>();
  for (const [localWsid, entry] of Object.entries(workspaceMap ?? {})) {
    if (!entry || entry.enabled !== true) continue;
    const remoteWsid = entry.remoteWsid ?? localWsid;
    if (!localToRemote.has(localWsid)) localToRemote.set(localWsid, remoteWsid);
    if (!remoteToLocal.has(remoteWsid)) remoteToLocal.set(remoteWsid, localWsid);
  }
  return {
    remoteToLocal,
    localToRemote,
    ignoredRemote: new Set(ignoredRemoteWorkspaces ?? []),
    dataDir,
    peerDataDir,
  };
}

// ─── sessions flat-cwd 目录名编码（镜像 pi-agent-core jsonl-repo 的 encodeCwd）───

/** 镜像 JsonlSessionRepo.encodeCwd：`--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--` */
export function encodeFlatCwd(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
}

/** 本端某工作区 sessions 的 flat-cwd 目录名：<dataDir>/workspaces/<wsid> 的编码 */
export function localSessionsFlatDir(dataDir: string, wsid: string): string {
  const base = dataDir.replace(/[/\\]+$/, '');
  return encodeFlatCwd(`${base}/workspaces/${wsid}`);
}

/** 目录段是否形如 flat-cwd 编码（--...--）；仅对此类段做折算重写，其余原样保留 */
function looksLikeFlatCwdDir(seg: string): boolean {
  return seg.startsWith('--') && seg.endsWith('--') && seg.length > 4;
}

export type LocalViewResult =
  | { kind: 'pass'; localRelPath: string }
  | { kind: 'map'; localRelPath: string }
  | { kind: 'unmapped'; remoteWsid: string }
  | { kind: 'ignored'; remoteWsid: string };

/**
 * 对端 relPath → 本端视角 relPath。
 * - 非 workspaces/ 前缀（全局数据）或 workspaces/ 下直接落文件（如 workspaces.json、其冲突副本，
 *   路径仅两段）→ pass 原样：全局数据恒同步，不走映射过滤。
 * - workspaces/<remote>/...：命中 enabled 映射 → 折算 <local> 并重写 sessions flat-cwd 目录名；
 *   未命中 → unmapped（进待映射清单）；在忽略列表 → ignored（静默跳过，映射优先于忽略）。
 */
export function toLocalView(ctx: WorkspaceMapContext, relPath: string): LocalViewResult {
  const segs = relPath.split('/');
  if (segs[0] !== 'workspaces' || segs.length < 3) {
    return { kind: 'pass', localRelPath: relPath };
  }
  const remoteWsid = segs[1];
  const localWsid = ctx.remoteToLocal.get(remoteWsid);
  if (localWsid === undefined) {
    return ctx.ignoredRemote.has(remoteWsid)
      ? { kind: 'ignored', remoteWsid }
      : { kind: 'unmapped', remoteWsid };
  }
  const rest = segs.slice(2);
  if (rest[0] === 'sessions' && rest.length >= 2 && looksLikeFlatCwdDir(rest[1])) {
    const flatDir = localSessionsFlatDir(ctx.dataDir, localWsid);
    return { kind: 'map', localRelPath: ['workspaces', localWsid, 'sessions', flatDir, ...rest.slice(2)].join('/') };
  }
  return { kind: 'map', localRelPath: ['workspaces', localWsid, ...rest].join('/') };
}

/**
 * 本端 relPath → 对端视角 relPath（推送方向反向折算）。
 * 未映射（理论上 manifest 已过滤不会出现）→ null，调用方跳过；
 * 对端 dataDir 未知（旧版对端）→ sessions 目录名保持原样（退化为旧行为）。
 */
export function toRemoteRelPath(ctx: WorkspaceMapContext, relPath: string): string | null {
  const segs = relPath.split('/');
  if (segs[0] !== 'workspaces' || segs.length < 3) return relPath;
  const localWsid = segs[1];
  const remoteWsid = ctx.localToRemote.get(localWsid);
  if (remoteWsid === undefined) return null;
  const rest = segs.slice(2);
  let remoteRest = rest;
  if (rest[0] === 'sessions' && rest.length >= 2 && looksLikeFlatCwdDir(rest[1]) && ctx.peerDataDir) {
    const peerFlatDir = localSessionsFlatDir(ctx.peerDataDir, remoteWsid);
    remoteRest = ['sessions', peerFlatDir, ...rest.slice(2)];
  }
  return ['workspaces', remoteWsid, ...remoteRest].join('/');
}

/**
 * 反向映射自动学习：对端 manifest 请求/响应携带其 workspaceMap（对端 local→remote 视角）。
 * 对端条目 [X → Y]（X=对端本地 wsid，Y=本端侧 wsid）→ 本端补 workspaceMap[Y] = { remoteWsid: X, enabled: true }。
 * 已存在则不动（不覆盖 enabled）；Y 不是本端已注册工作区时跳过（等 workspaces.json 合并后下轮学习）。
 * @returns 本次新学到的映射条数（调用方据此写盘与提示）
 */
export function learnReverseWorkspaceMap(
  state: SyncState,
  peerDeviceId: string,
  theirMap: Record<string, WorkspaceMapEntry> | undefined,
  localWorkspaceIds: ReadonlySet<string>,
): number {
  if (!theirMap || typeof theirMap !== 'object') return 0;
  let learned = 0;
  for (const [theirLocal, entry] of Object.entries(theirMap)) {
    if (!entry || entry.enabled !== true) continue;
    const ourWsid = entry.remoteWsid ?? theirLocal;
    // 语义约定：条目 id 必须是本端数据目录内的合法段，防对端伪造垃圾键
    if (!localWorkspaceIds.has(ourWsid)) continue;
    const peer = state.peers[peerDeviceId];
    const map: Record<string, WorkspaceMapEntry> = peer.workspaceMap ?? (peer.workspaceMap = {});
    if (map[ourWsid]) continue; // 已存在不覆盖 enabled
    map[ourWsid] = { remoteWsid: theirLocal, enabled: true };
    learned += 1;
  }
  return learned;
}

/**
 * push 接收端校验（D1）：发送端推来的路径已按它的 localToRemote 折算成接收端视角，
 * workspaces/<wsid>/ 前缀中 wsid 即接收端本端 wsid，只需查该键在本端 per-peer 映射中 enabled
 * （未建映射/已暂停都拒绝）；非 workspaces/ 前缀或两段形态（workspaces/workspaces.json 等）
 * 为全局数据，不走映射（与 toLocalView 的 pass 语义一致）。
 */
export function isWorkspacePathSyncEnabled(
  workspaceMap: Record<string, WorkspaceMapEntry> | undefined,
  relPath: string,
): boolean {
  const segs = relPath.split('/');
  if (segs[0] !== 'workspaces' || segs.length < 3) return true;
  return workspaceMap?.[segs[1]]?.enabled === true;
}

/**
 * 本端工作区概要汇总（server 端 manifest 响应的 workspaceMeta）：轻量只读 workspaces.json
 * 与各 conversations.json 索引（条目数 + max updatedAt），不触碰 sessions 正文。
 */
export async function collectWorkspaceMeta(dataDir: string): Promise<WorkspaceMetaItem[]> {
  const workspacesFile = await safeJsonRead<{ workspaces?: Array<{ id?: string; name?: string }> } | null>(
    path.join(dataDir, 'workspaces', 'workspaces.json'),
    null,
  );
  const items: WorkspaceMetaItem[] = [];
  const seen = new Set<string>();
  const registered = Array.isArray(workspacesFile?.workspaces) ? workspacesFile!.workspaces : [];
  for (const ws of registered) {
    if (!ws || typeof ws.id !== 'string' || ws.id === '' || seen.has(ws.id)) continue;
    seen.add(ws.id);
    items.push({ wsid: ws.id, ...(typeof ws.name === 'string' && ws.name ? { name: ws.name } : {}) });
  }
  // personal 为内存合成条目不注册进 workspaces.json，但 workspaces/personal/ 目录真实存在，
  // 可能出现在对端待映射清单——补一条概要便于展示
  if (!seen.has('personal')) {
    items.push({ wsid: 'personal', name: '临时会话' });
    seen.add('personal');
  }
  await Promise.all(items.map(async (item) => {
    const file = await safeJsonRead<{ conversations?: Record<string, { updatedAt?: string; createdAt?: string }> } | null>(
      path.join(dataDir, 'workspaces', item.wsid, 'conversations.json'),
      null,
    );
    if (!file || typeof file.conversations !== 'object' || file.conversations === null) return;
    const entries = Object.values(file.conversations);
    item.conversationCount = entries.length;
    let latest = -Infinity;
    for (const entry of entries) {
      if (!entry) continue;
      const t = Date.parse(entry.updatedAt ?? entry.createdAt ?? '');
      if (Number.isFinite(t) && t > latest) latest = t;
    }
    if (Number.isFinite(latest)) item.lastUpdated = latest;
  }));
  return items;
}

/**
 * 对端清单整体折算为本端视角条目，同时汇总待映射 wsid。
 * candidateHashes 以对端原 relPath 为键，折算后需按对端原路径回查。
 */
export interface RemoteEntryView {
  /** 本端视角条目（relPath 已折算；pass 条目原样） */
  entry: FileEntry;
  /** 对端原始 relPath（拉取文件时请求对端用） */
  remoteRelPath: string;
}

export interface RemoteManifestView {
  views: RemoteEntryView[];
  /** 待映射清单：unmapped wsid → 对端元信息（有则带） */
  unmappedWorkspaces: WorkspaceMetaItem[];
}

export function buildRemoteManifestView(
  ctx: WorkspaceMapContext,
  remoteEntries: FileEntry[],
  workspaceMeta: WorkspaceMetaItem[] | undefined,
): RemoteManifestView {
  const metaByWsid = new Map((workspaceMeta ?? []).map((m) => [m.wsid, m]));
  const views: RemoteEntryView[] = [];
  const unmapped = new Map<string, WorkspaceMetaItem>();
  for (const entry of remoteEntries) {
    const view = toLocalView(ctx, entry.relPath);
    if (view.kind === 'ignored') continue;
    if (view.kind === 'unmapped') {
      if (!unmapped.has(view.remoteWsid)) {
        unmapped.set(view.remoteWsid, metaByWsid.get(view.remoteWsid) ?? { wsid: view.remoteWsid });
      }
      continue;
    }
    views.push({
      entry: view.kind === 'map' ? { ...entry, relPath: view.localRelPath } : entry,
      remoteRelPath: entry.relPath,
    });
  }
  return { views, unmappedWorkspaces: [...unmapped.values()].sort((a, b) => a.wsid < b.wsid ? -1 : 1) };
}

/** 列出数据目录下真实存在的工作区 id（workspaces/ 一级子目录），供反向学习校验 */
export async function listLocalWorkspaceIds(dataDir: string): Promise<Set<string>> {
  try {
    const dirents = await fsp.readdir(path.join(dataDir, 'workspaces'), { withFileTypes: true });
    return new Set(dirents.filter((d) => d.isDirectory()).map((d) => d.name));
  } catch {
    return new Set();
  }
}
