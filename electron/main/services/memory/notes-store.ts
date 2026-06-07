// 工作区速记板存储（里程碑 2 Phase C），落 <configDir>/workspaces/<wsId>/notes.md
import fs from 'node:fs/promises';
import path from 'node:path';
import { getWorkspaceDataDir } from '../conversation-service.js';

export async function readNotesFrom(dir: string): Promise<string> {
  try {
    return await fs.readFile(path.join(dir, 'notes.md'), 'utf-8');
  } catch (err: any) {
    if (err?.code === 'ENOENT') return '';
    throw err;
  }
}

export async function saveNotesTo(dir: string, content: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'notes.md'), content, 'utf-8');
}

export const readNotes = (wsId: string) => readNotesFrom(getWorkspaceDataDir(wsId));
export const saveNotes = (wsId: string, content: string) => saveNotesTo(getWorkspaceDataDir(wsId), content);
