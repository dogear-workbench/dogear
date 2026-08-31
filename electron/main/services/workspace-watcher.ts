/**
 * 工作区文件树监视
 * 每个工作区一个递归 fs.watch，只处理 rename 事件（创建/删除/重命名，忽略内容修改 change），
 * 尾部去抖后广播 workspaceFilesChanged，各窗口按当前工作区匹配重拉文件树。
 * 跟随 workspaces.json 增删起停；监听错误（目录被删/网络盘断开）时关闭该工作区 watcher 静默降级。
 */
import fs from 'node:fs';
import { mainLogger } from '../agents/logger.js';
import { broadcastToWindows } from './renderer-broadcast.js';
import * as workspaceJsonService from './workspace-json-service.js';

const DEBOUNCE_MS = 500;

interface WorkspaceWatch {
  watcher: fs.FSWatcher;
  timer: ReturnType<typeof setTimeout> | null;
}

const watches = new Map<string, WorkspaceWatch>();

/** 事件路径任意段以 . 开头或为 node_modules → 丢弃（对齐 getFiles 扫描范围） */
function isIgnored(relPath: string): boolean {
  const segments = relPath.split(/[\\/]+/).filter(Boolean);
  return segments.some((seg) => seg.startsWith('.') || seg === 'node_modules');
}

async function startWatch(workspaceId: string, workspacePath: string): Promise<void> {
  if (watches.has(workspaceId)) return;
  const state: WorkspaceWatch = { watcher: null as unknown as fs.FSWatcher, timer: null };
  try {
    state.watcher = fs.watch(workspacePath, { recursive: true }, (eventType, filename) => {
      if (eventType !== 'rename' || !filename) return;
      if (isIgnored(String(filename))) return;
      if (!watches.has(workspaceId)) return;
      if (state.timer) clearTimeout(state.timer);
      state.timer = setTimeout(() => {
        state.timer = null;
        broadcastToWindows((h) => h.workspaceFilesChanged.send({ workspaceId }));
      }, DEBOUNCE_MS);
    });
  } catch (err) {
    mainLogger.warn(`[workspace-watcher] wsId=${workspaceId.slice(0, 8)} 启动失败（目录不存在或平台不支持递归监听）:`, err);
    return;
  }
  watches.set(workspaceId, state);
  state.watcher.on('error', (err) => {
    mainLogger.warn(`[workspace-watcher] wsId=${workspaceId.slice(0, 8)} 监听错误，静默降级关闭:`, err);
    stopWatch(workspaceId);
  });
}

export function stopWatch(workspaceId: string): void {
  const state = watches.get(workspaceId);
  if (!state) return;
  watches.delete(workspaceId);
  if (state.timer) clearTimeout(state.timer);
  try { state.watcher.close(); } catch {
    // ignore
  }
}

/** 对齐 workspaces.json：新增工作区起 watcher，已删工作区停 watcher */
export async function syncWorkspaceWatchers(): Promise<void> {
  let workspaces;
  try {
    workspaces = await workspaceJsonService.getAll();
  } catch (err) {
    mainLogger.warn('[workspace-watcher] 读取 workspaces.json 失败:', err);
    return;
  }
  const live = new Set(workspaces.map((w) => w.id));
  for (const id of [...watches.keys()]) {
    if (!live.has(id)) stopWatch(id);
  }
  for (const ws of workspaces) {
    await startWatch(ws.id, ws.path);
  }
}

export function stopAllWorkspaceWatchers(): void {
  for (const id of [...watches.keys()]) stopWatch(id);
}
