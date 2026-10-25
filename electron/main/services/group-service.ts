import path from 'path';
import electron from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { safeJsonRead, safeJsonWrite } from './safe-json.js';
import { broadcastConversationListChanged } from './renderer-broadcast-lazy.js';
import type { Group } from '../types.js';

const { app } = electron;
const GROUPS_SCHEMA_VERSION = 2;

function getConfigDir(): string {
  if (process.env.DOGEAR_CONFIG_DIR) return process.env.DOGEAR_CONFIG_DIR;
  if (app?.isPackaged) return path.join(app.getPath('userData'), '.dogear');
  return path.join(process.cwd(), '.dogear');
}

function getGroupsPath(workspaceId: string): string {
  return path.join(getConfigDir(), 'workspaces', workspaceId, 'groups.json');
}

/** 工作区所有组共用的父目录：<wsData>/groups/ */
export function getGroupsRootDir(workspaceId: string): string {
  return path.join(getConfigDir(), 'workspaces', workspaceId, 'groups');
}

/** 单个组的目录：<wsData>/groups/<groupId>/ */
export function getGroupDir(workspaceId: string, groupId: string): string {
  return path.join(getGroupsRootDir(workspaceId), groupId);
}

interface GroupsFile {
  version: number;
  groups: Group[];
}

function normalizeGroup(value: unknown): Group | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<Group>;
  if (typeof raw.id !== 'string' || !raw.id) return null;
  if (typeof raw.createdAt !== 'number' || !Number.isFinite(raw.createdAt)) return null;
  if (typeof raw.updatedAt !== 'number' || !Number.isFinite(raw.updatedAt)) return null;
  const group: Group = {
    id: raw.id,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
  if (typeof raw.title === 'string') group.title = raw.title;
  if (typeof raw.lastBackgroundActivityAt === 'number' && Number.isFinite(raw.lastBackgroundActivityAt)) {
    group.lastBackgroundActivityAt = raw.lastBackgroundActivityAt;
  }
  if (typeof raw.archivedAt === 'number' && Number.isFinite(raw.archivedAt)) {
    group.archivedAt = raw.archivedAt;
  }
  if (raw.hidden === true) group.hidden = true;
  return group;
}

function normalizeGroupsFile(value: unknown): GroupsFile {
  const raw = Array.isArray(value)
    ? { groups: value }
    : value && typeof value === 'object'
      ? value as { groups?: unknown }
      : {};
  const groups = Array.isArray(raw.groups)
    ? raw.groups.map(normalizeGroup).filter((group): group is Group => group !== null)
    : [];
  return { version: GROUPS_SCHEMA_VERSION, groups };
}

async function loadGroups(workspaceId: string): Promise<GroupsFile> {
  const raw = await safeJsonRead<unknown>(getGroupsPath(workspaceId), { version: GROUPS_SCHEMA_VERSION, groups: [] });
  return normalizeGroupsFile(raw);
}

async function saveGroups(workspaceId: string, data: GroupsFile): Promise<void> {
  await safeJsonWrite(getGroupsPath(workspaceId), {
    version: GROUPS_SCHEMA_VERSION,
    groups: data.groups,
  } satisfies GroupsFile);
}

export async function listGroups(workspaceId: string): Promise<Group[]> {
  return (await loadGroups(workspaceId)).groups;
}

export async function listActiveGroups(workspaceId: string): Promise<Group[]> {
  return (await listGroups(workspaceId)).filter((group) => group.archivedAt === undefined);
}

export async function listArchivedGroups(workspaceId: string): Promise<Group[]> {
  // hidden 承载组不参与归档生命周期：不显示也不被批量清理；豁免自动归档只防未来，这里兼顾存量（旧版无豁免）
  return (await listGroups(workspaceId))
    .filter((group) => group.archivedAt !== undefined && group.hidden !== true)
    .sort((a, b) => b.archivedAt! - a.archivedAt!);
}

export async function getGroup(workspaceId: string, groupId: string): Promise<Group | null> {
  const file = await loadGroups(workspaceId);
  return file.groups.find((group) => group.id === groupId) ?? null;
}

export async function getGroupByTitle(workspaceId: string, title: string): Promise<Group | null> {
  const file = await loadGroups(workspaceId);
  // 只复用未归档同名话题：conversationService.create 走 requireActiveGroup，归档话题挂新对话会抛错；hidden 承载话题不对用户分流开放
  return file.groups.find((group) => group.title === title && group.archivedAt === undefined && group.hidden !== true) ?? null;
}

export async function requireActiveGroup(workspaceId: string, groupId: string): Promise<Group> {
  const group = await getGroup(workspaceId, groupId);
  if (!group) throw new Error('话题不存在');
  if (group.archivedAt !== undefined) throw new Error('话题已归档，请先恢复后再继续操作');
  return group;
}

function localMinuteTitle(now: number): string {
  const d = new Date(now);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export async function createGroup(workspaceId: string, init?: { title?: string }): Promise<Group> {
  const file = await loadGroups(workspaceId);
  const now = Date.now();
  const group: Group = {
    id: `group_${uuidv4()}`,
    title: init?.title?.trim() || localMinuteTitle(now),
    createdAt: now,
    updatedAt: now,
  };
  file.groups.push(group);
  await saveGroups(workspaceId, file);
  broadcastConversationListChanged(workspaceId);
  return group;
}

/** 按标题取或建承载话题（hidden=true，活跃态）：任务执行/定时运行会话的落点，已存在则复用 */
export async function getOrCreateHiddenGroup(workspaceId: string, title: string): Promise<Group> {
  const file = await loadGroups(workspaceId);
  const existing = file.groups.find(
    (group) => group.hidden === true && group.title === title && group.archivedAt === undefined,
  );
  if (existing) return existing;
  const now = Date.now();
  const group: Group = {
    id: `group_${uuidv4()}`,
    title,
    hidden: true,
    createdAt: now,
    updatedAt: now,
  };
  file.groups.push(group);
  await saveGroups(workspaceId, file);
  broadcastConversationListChanged(workspaceId);
  return group;
}

export async function updateGroup(
  workspaceId: string,
  groupId: string,
  patch: Partial<Pick<Group, 'title'>>,
): Promise<Group> {
  const file = await loadGroups(workspaceId);
  const group = file.groups.find((item) => item.id === groupId);
  if (!group) throw new Error(`Group not found: ${groupId}`);

  if (patch.title !== undefined) group.title = patch.title;

  await saveGroups(workspaceId, file);
  broadcastConversationListChanged(workspaceId);
  return group;
}

export async function archiveGroup(workspaceId: string, groupId: string): Promise<Group> {
  const file = await loadGroups(workspaceId);
  const group = file.groups.find((item) => item.id === groupId);
  if (!group) throw new Error(`Group not found: ${groupId}`);
  if (group.archivedAt === undefined) {
    const now = Date.now();
    group.archivedAt = now;
    group.updatedAt = now;
    await saveGroups(workspaceId, file);
    // 动态导入规避与 topic-digest-service 的循环依赖；手动/自动归档都经此路径
    const { precacheTopicDigest } = await import('./topic-digest-service.js');
    await precacheTopicDigest(workspaceId, groupId);
  }
  broadcastConversationListChanged(workspaceId);
  return group;
}

export async function restoreGroup(workspaceId: string, groupId: string): Promise<Group> {
  const file = await loadGroups(workspaceId);
  const group = file.groups.find((item) => item.id === groupId);
  if (!group) throw new Error(`Group not found: ${groupId}`);
  if (group.archivedAt !== undefined) {
    delete group.archivedAt;
    group.updatedAt = Date.now();
    await saveGroups(workspaceId, file);
  }
  broadcastConversationListChanged(workspaceId);
  return group;
}

export async function touchGroup(workspaceId: string, groupId: string): Promise<void> {
  const file = await loadGroups(workspaceId);
  const group = file.groups.find((item) => item.id === groupId);
  if (!group || group.archivedAt !== undefined) return;
  group.updatedAt = Date.now();
  await saveGroups(workspaceId, file);
  broadcastConversationListChanged(workspaceId, 'debounced');
}

/** 后台活动刷新归档保鲜时钟：只写盘不广播、不触碰 updatedAt（不参与列表排序） */
export async function touchGroupBackgroundActivity(workspaceId: string, groupId: string): Promise<void> {
  const file = await loadGroups(workspaceId);
  const group = file.groups.find((item) => item.id === groupId);
  if (!group || group.archivedAt !== undefined) return;
  group.lastBackgroundActivityAt = Date.now();
  await saveGroups(workspaceId, file);
}

export async function deleteGroup(workspaceId: string, groupId: string): Promise<void> {
  const file = await loadGroups(workspaceId);
  const index = file.groups.findIndex((group) => group.id === groupId);
  if (index === -1) return;
  file.groups.splice(index, 1);
  await saveGroups(workspaceId, file);
  broadcastConversationListChanged(workspaceId);
}
