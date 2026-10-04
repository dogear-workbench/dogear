/**
 * 快照排除目录对照扫描：默认名单 × 磁盘实际目录 → 路径级排除清单。
 * 三消费方：启动迁移（存量工作区补条目）/ 新工作区注册钩子 / 恢复默认重扫（step3 复合 IPC）。
 * 产出的路径恒为归一形式（正斜杠、无 ./ 前缀、无首尾斜杠、去重、排序），与 normalizeSnapshotSettings 清洗规则一致。
 */
import fs from 'fs/promises';
import path from 'path';
import type { Dirent } from 'fs';
import {
  DEFAULT_SNAPSHOT_DIR_NAMES,
  SNAPSHOT_SETTING_DEFAULTS,
  type SnapshotSettings,
} from './settings-types.js';
import { loadSettings, saveSettings } from './settings-service.js';
import * as workspaceJsonService from './workspace-json-service.js';

const EXCLUSION_NAME_SET = new Set<string>(DEFAULT_SNAPSHOT_DIR_NAMES);

// 设置读改写的多处调用共用一条串行队列：迁移与注册钩子并发时后写者基于前写者落盘结果合并，防整落盘互相覆盖丢条目
let writeChain: Promise<void> = Promise.resolve();

function enqueueSettingsWrite(task: () => Promise<void>): Promise<void> {
  const run = writeChain.then(task, task);
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function mergePaths(existing: string[] | undefined, found: string[]): string[] {
  return [...new Set([...(existing ?? []), ...found])].sort((a, b) => a.localeCompare(b));
}

async function readDirSafe(dir: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * 递归扫描工作区，目录名命中默认名单即记相对路径并剪枝（不再深入子树，被外层覆盖的嵌套同名天然不重复列）。
 * 不受文件树 HIDDEN_NAMES 限制（.dogear/.git 本身就是名单项）；目录符号链接不深入防循环
 */
export async function scanWorkspaceExcludedPaths(workspacePath: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (rel: string): Promise<void> => {
    const entries = await readDirSafe(rel ? path.join(workspacePath, rel) : workspacePath);
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (EXCLUSION_NAME_SET.has(entry.name)) {
        found.push(childRel);
        continue;
      }
      if (entry.isDirectory()) await walk(childRel);
    }
  };
  await walk('');
  return found.sort((a, b) => a.localeCompare(b));
}

/**
 * 启动迁移：exclusionScanDone 为真直接返回；否则对全部注册工作区扫描合并进 excludedPaths 并置标记落盘。
 * 已有条目做并集合并（同步/手工预置的条目不丢）；队列内重读 settings 再写，与并发钩子互不覆盖
 */
export async function migrateSnapshotExclusionsIfNeeded(): Promise<void> {
  const first = await loadSettings();
  const snapshot = first.snapshot ?? structuredClone(SNAPSHOT_SETTING_DEFAULTS);
  if (snapshot.exclusionScanDone === true) return;
  await enqueueSettingsWrite(async () => {
    const settings = await loadSettings();
    const snap = settings.snapshot ?? structuredClone(SNAPSHOT_SETTING_DEFAULTS);
    if (snap.exclusionScanDone === true) return;
    const excludedPaths: Record<string, string[]> = { ...snap.excludedPaths };
    for (const ws of await workspaceJsonService.getAll()) {
      if (!ws.path) continue;
      excludedPaths[ws.id] = mergePaths(excludedPaths[ws.id], await scanWorkspaceExcludedPaths(ws.path));
    }
    await saveSettings({ ...settings, snapshot: { ...snap, excludedPaths, exclusionScanDone: true } });
  });
}

/** 新工作区注册钩子：扫描该工作区合并进 excludedPaths（先锁外扫描再入队写，缩短锁持有），不动迁移标记 */
export async function scanAndStoreWorkspaceExclusions(workspaceId: string, workspacePath: string): Promise<void> {
  const found = await scanWorkspaceExcludedPaths(workspacePath);
  await enqueueSettingsWrite(async () => {
    const settings = await loadSettings();
    const snapshot = settings.snapshot ?? structuredClone(SNAPSHOT_SETTING_DEFAULTS);
    snapshot.excludedPaths[workspaceId] = mergePaths(snapshot.excludedPaths[workspaceId], found);
    await saveSettings({ ...settings, snapshot });
  });
}

/** 清空 excludedPaths 按当前磁盘重新生成并保留标记；只覆盖注册工作区，供恢复默认复合 IPC（step3 接） */
export async function rescanAllWorkspaceExclusions(): Promise<void> {
  await enqueueSettingsWrite(async () => {
    const settings = await loadSettings();
    const snapshot = settings.snapshot ?? structuredClone(SNAPSHOT_SETTING_DEFAULTS);
    const excludedPaths: Record<string, string[]> = {};
    for (const ws of await workspaceJsonService.getAll()) {
      if (!ws.path) continue;
      excludedPaths[ws.id] = await scanWorkspaceExcludedPaths(ws.path);
    }
    await saveSettings({ ...settings, snapshot: { ...snapshot, excludedPaths, exclusionScanDone: true } });
  });
}
