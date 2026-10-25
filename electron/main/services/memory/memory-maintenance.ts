/**
 * 记忆库维护：孤儿索引对账修复 + 垃圾文件清理
 *
 * - 触发点：sync 完成（orchestrator 拉取/删除后）、push 接收端落盘后（防抖）、应用启动兜底
 * - 修复策略：checkConsistency 发现孤儿（任一方向）才 rebuild，无错不动（避免 index.json 无谓写盘引发同步扰动）
 * - 垃圾判定：.bak / .tmp（safe-write 残留）与 .conflict-* 后缀（sync 冲突副本），扫描 memory 目录与 topics 子目录
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { getConfigDir } from '../settings-service.js';
import type { MemoryScope } from './memory-types.js';
import { checkConsistency, rebuildIndex } from './memory-indexer.js';
import { getGlobalMemoryDir, getMemoryDir, getTopicsDir } from './memory-fs.js';

export interface MemoryRepairTarget {
  scope: MemoryScope;
  workspaceId: string;
}

export interface MemoryRepairOutcome {
  target: MemoryRepairTarget;
  rebuiltIndex: boolean;
  garbageRemoved: string[];
}

export interface MemoryRepairSummary {
  outcomes: MemoryRepairOutcome[];
}

const WORKSPACE_MEMORY_RE = /^workspaces\/([^/]+)\/memory(?:\/|$)/;

export function isMemorySyncRelPath(relPath: string): boolean {
  return relPath === 'memory' || relPath.startsWith('memory/') || WORKSPACE_MEMORY_RE.test(relPath);
}

export function parseMemoryRepairTarget(relPath: string): MemoryRepairTarget | null {
  if (relPath === 'memory' || relPath.startsWith('memory/')) return { scope: 'global', workspaceId: '' };
  const m = WORKSPACE_MEMORY_RE.exec(relPath);
  return m ? { scope: 'workspace', workspaceId: m[1] } : null;
}

function isGarbageBasename(base: string): boolean {
  if (base.endsWith('.bak') || base.endsWith('.tmp')) return true;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return false;
  const ext = base.slice(dot);
  return ext.startsWith('.conflict-') && ext.length > '.conflict-'.length;
}

async function cleanGarbageInDir(dir: string, label: string, removed: string[]): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (!isGarbageBasename(name)) continue;
    try {
      await fs.unlink(path.join(dir, name));
      removed.push(`${label}/${name}`);
    } catch {
      // 竞态删除失败不阻塞，下次维护再清
    }
  }
}

function targetDirs(target: MemoryRepairTarget): { memoryDir: string; topicsDir: string } {
  return target.scope === 'global'
    ? { memoryDir: getGlobalMemoryDir(), topicsDir: path.join(getGlobalMemoryDir(), 'topics') }
    : { memoryDir: getMemoryDir(target.workspaceId), topicsDir: getTopicsDir(target.workspaceId) };
}

export async function repairMemoryTargets(targets: MemoryRepairTarget[]): Promise<MemoryRepairSummary> {
  const seen = new Set<string>();
  const outcomes: MemoryRepairOutcome[] = [];
  for (const target of targets) {
    const key = `${target.scope}:${target.workspaceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const { memoryDir, topicsDir } = targetDirs(target);
    const garbageRemoved: string[] = [];
    await cleanGarbageInDir(memoryDir, key, garbageRemoved);
    await cleanGarbageInDir(topicsDir, `${key}/topics`, garbageRemoved);

    let rebuiltIndex = false;
    try {
      const consistency = await checkConsistency(target.workspaceId, target.scope);
      if (consistency.orphansInIndex.length > 0 || consistency.orphansOnDisk.length > 0) {
        await rebuildIndex(target.workspaceId, target.scope);
        rebuiltIndex = true;
      }
    } catch (err) {
      console.warn(`[memory-maintenance] 对账修复失败 (${key}):`, err);
    }
    if (rebuiltIndex || garbageRemoved.length > 0) {
      outcomes.push({ target, rebuiltIndex, garbageRemoved });
    }
  }
  return { outcomes };
}

export async function repairMemoryPathsNow(relPaths: string[]): Promise<MemoryRepairSummary> {
  const targets = relPaths
    .map((rel) => parseMemoryRepairTarget(rel))
    .filter((t): t is MemoryRepairTarget => t !== null);
  if (targets.length === 0) return { outcomes: [] };
  return repairMemoryTargets(targets);
}

export async function listAllMemoryTargets(): Promise<MemoryRepairTarget[]> {
  const configDir = getConfigDir();
  const targets: MemoryRepairTarget[] = [];
  try {
    await fs.access(getGlobalMemoryDir());
    targets.push({ scope: 'global', workspaceId: '' });
  } catch {
    // 全局记忆目录不存在
  }
  const workspacesDir = path.join(configDir, 'workspaces');
  let wsIds: string[] = [];
  try {
    const dirents = await fs.readdir(workspacesDir, { withFileTypes: true });
    const checked = await Promise.all(
      dirents.map(async (d) => {
        if (!d.isDirectory()) return null;
        try {
          await fs.access(path.join(workspacesDir, d.name, 'memory'));
          return d.name;
        } catch {
          return null;
        }
      }),
    );
    wsIds = checked.filter((n): n is string => n !== null);
  } catch {
    // workspaces 目录不存在
  }
  for (const wsId of wsIds) targets.push({ scope: 'workspace', workspaceId: wsId });
  return targets;
}

export async function repairAllMemoryDirs(): Promise<MemoryRepairSummary> {
  return repairMemoryTargets(await listAllMemoryTargets());
}

// ── push 接收端防抖修复：突发连续推送（整目录同步）只触发一次合并修复 ──

const REPAIR_DEBOUNCE_MS = 3000;
let pendingRepairPaths = new Set<string>();
let repairTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleMemoryRepair(relPath: string): void {
  pendingRepairPaths.add(relPath);
  if (repairTimer) clearTimeout(repairTimer);
  repairTimer = setTimeout(() => {
    const paths = [...pendingRepairPaths];
    pendingRepairPaths = new Set();
    repairTimer = null;
    repairMemoryPathsNow(paths)
      .then((summary) => {
        for (const o of summary.outcomes) {
          console.log(
            `[memory-maintenance] sync 后修复 ${o.target.scope}:${o.target.workspaceId}: rebuiltIndex=${o.rebuiltIndex} garbageRemoved=${o.garbageRemoved.length}`,
          );
        }
      })
      .catch((err) => console.warn('[memory-maintenance] sync 后修复失败:', err));
  }, REPAIR_DEBOUNCE_MS);
  repairTimer.unref?.();
}
