import path from 'path';
import electron from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { safeJsonRead, safeJsonWrite } from './safe-json.js';
import type { Group } from '../types.js';

const { app } = electron;

function getConfigDir(): string {
  if (process.env.DOGEAR_CONFIG_DIR) return process.env.DOGEAR_CONFIG_DIR;
  if (app?.isPackaged) return path.join(app.getPath('userData'), '.dogear');
  return path.join(process.cwd(), '.dogear');
}

function getGroupsPath(workspaceId: string): string {
  return path.join(getConfigDir(), 'workspaces', workspaceId, 'groups.json');
}

interface GroupsFile {
  version: number;
  groups: Group[];
}

async function loadGroups(workspaceId: string): Promise<GroupsFile> {
  return safeJsonRead<GroupsFile>(getGroupsPath(workspaceId), { version: 1, groups: [] });
}

async function saveGroups(workspaceId: string, data: GroupsFile): Promise<void> {
  await safeJsonWrite(getGroupsPath(workspaceId), data);
}

export async function listGroups(workspaceId: string): Promise<Group[]> {
  const file = await loadGroups(workspaceId);
  return file.groups;
}

export async function getGroup(workspaceId: string, groupId: string): Promise<Group | null> {
  const file = await loadGroups(workspaceId);
  return file.groups.find((g) => g.id === groupId) ?? null;
}

export async function createGroup(workspaceId: string, init?: { title?: string }): Promise<Group> {
  const file = await loadGroups(workspaceId);
  const now = Date.now();
  const group: Group = {
    id: `group_${uuidv4()}`,
    title: init?.title,
    createdAt: now,
    updatedAt: now,
  };
  file.groups.push(group);
  await saveGroups(workspaceId, file);
  return group;
}

export async function updateGroup(
  workspaceId: string,
  groupId: string,
  patch: Partial<Pick<Group, 'title'>>,
): Promise<Group> {
  const file = await loadGroups(workspaceId);
  const idx = file.groups.findIndex((g) => g.id === groupId);
  if (idx === -1) throw new Error(`Group not found: ${groupId}`);

  const group = file.groups[idx];
  if (patch.title !== undefined) group.title = patch.title;
  group.updatedAt = Date.now();

  await saveGroups(workspaceId, file);
  return group;
}

export async function deleteGroup(workspaceId: string, groupId: string): Promise<void> {
  const file = await loadGroups(workspaceId);
  const idx = file.groups.findIndex((g) => g.id === groupId);
  if (idx === -1) throw new Error(`Group not found: ${groupId}`);
  file.groups.splice(idx, 1);
  await saveGroups(workspaceId, file);
}
