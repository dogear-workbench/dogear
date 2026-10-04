/**
 * 工作区 JSON 存储服务
 * 管理 .dogear/workspaces/workspaces.json
 */
import fs from 'fs/promises';
import path from 'path';
import electron from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { safeJsonWrite, safeJsonRead } from './safe-json.js';
import { PERSONAL_WORKSPACE_ID } from '../types.js';

const { app } = electron;

// ============================================================
// 类型定义
// ============================================================

/** 附加路径 */
export interface AdditionalPath {
  path: string;
  enabled: boolean;
}

/** 单条工作区（JSON 文件存储格式，同时作为 tipc / 前端的传输格式） */
export interface Workspace {
  id: string;
  name: string;
  path: string;
  additionalPaths: AdditionalPath[];
  isDefault: boolean;
  createdAt: string; // ISO 8601 字符串
}

/** workspaces.json 的文件结构 */
export interface WorkspacesFile {
  version: number;
  workspaces: Workspace[];
}

// ============================================================
// 路径函数
// ============================================================

/**
 * 获取 .dogear 配置目录
 * 开发阶段：项目根目录/.dogear
 * 打包后：AppData/Roaming/Dogear/.dogear
 */
function getConfigDir(): string {
  // Worker 线程无 electron app，优先读注入的 DOGEAR_CONFIG_DIR（与其余 service 同语义）
  if (process.env.DOGEAR_CONFIG_DIR) return process.env.DOGEAR_CONFIG_DIR;
  if (app?.isPackaged) {
    return path.join(app.getPath('userData'), '.dogear');
  }
  return path.join(process.cwd(), '.dogear');
}

/** 获取 workspaces.json 的完整路径（新路径） */
function getWorkspacesPath(): string {
  return path.join(getConfigDir(), 'workspaces', 'workspaces.json');
}

// ============================================================
// 转换函数
// ============================================================

/**
 * 主根 + enabled 附加根，与 agent 侧 allowedPaths（conversation-runtime-service）同语义，
 * 供读盘校验 / 存在性检查等多根解析场景共用
 */
export function getEnabledRoots(workspace: Workspace): string[] {
  return [
    workspace.path,
    ...(workspace.additionalPaths ?? []).filter((p) => p.enabled && p.path).map((p) => p.path),
  ];
}

// ============================================================
// 读写函数
// ============================================================

/** 空的默认文件结构 */
function emptyFile(): WorkspacesFile {
  return { version: 1, workspaces: [] };
}

/**
 * 读取并解析 workspaces.json
 * 文件不存在或解析失败时返回空结构
 */
async function loadWorkspacesFile(): Promise<WorkspacesFile> {
  return safeJsonRead<WorkspacesFile>(getWorkspacesPath(), emptyFile());
}

/**
 * 将数据写入 workspaces.json
 * 自动创建 .dogear/workspaces/ 目录
 */
async function saveWorkspacesFile(data: WorkspacesFile): Promise<void> {
  await safeJsonWrite(getWorkspacesPath(), data);
}

// ============================================================
// CRUD 操作
// ============================================================

/**
 * personal 的内存合成条目：不注册进 workspaces.json，仅在 includePersonal 时拼入列表。
 * path 留空：设计约定 personal 无 workspacePath，文件边界为空（无文件能力）。
 */
function personalWorkspaceData(): Workspace {
  return {
    id: PERSONAL_WORKSPACE_ID,
    name: '临时会话',
    path: '',
    additionalPaths: [],
    isDefault: false,
    createdAt: new Date(0).toISOString(),
  };
}

/**
 * 获取所有工作区
 * 默认过滤保留字 personal（即使被误注册也返回给 UI）；归档 timer 等后端场景传 includePersonal: true 拼入合成条目
 * 排序：默认工作区优先，然后按 createdAt 倒序
 */
export async function getAll(options?: { includePersonal?: boolean }): Promise<Workspace[]> {
  const file = await loadWorkspacesFile();
  let list = file.workspaces.filter((w) => w.id !== PERSONAL_WORKSPACE_ID);
  if (options?.includePersonal) list = [...list, personalWorkspaceData()];
  return list.sort((a, b) => {
    // 默认工作区优先
    if (a.isDefault !== b.isDefault) {
      return a.isDefault ? -1 : 1;
    }
    // 同级别按 createdAt 倒序
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

/**
 * 获取默认工作区
 * @returns 默认工作区，不存在则返回 undefined
 */
export async function getDefault(): Promise<Workspace | undefined> {
  const file = await loadWorkspacesFile();
  return file.workspaces.find((w) => w.isDefault);
}

/**
 * 根据 ID 获取工作区
 * @param id - 工作区 ID
 * @returns 工作区对象，不存在则返回 undefined
 */
export async function getById(id: string): Promise<Workspace | undefined> {
  const file = await loadWorkspacesFile();
  return file.workspaces.find((w) => w.id === id);
}

/**
 * 添加新工作区
 * 如果传入的对象中没有 id 则自动生成
 * @param workspace - 工作区数据（可选带 id）
 * @returns 新工作区的 ID
 */
export async function add(workspace: Omit<Workspace, 'id'> & { id?: string }): Promise<string> {
  const file = await loadWorkspacesFile();
  const id = workspace.id || uuidv4();

  const newData: Workspace = { ...workspace, id };

  file.workspaces.push(newData);
  await saveWorkspacesFile(file);
  void import('./workspace-watcher.js').then((m) => m.syncWorkspaceWatchers()).catch(() => {});
  // 新工作区注册钩子：对照扫描默认名单目录写入 excludedPaths 条目（同步搬入工作区走同一入口，一并覆盖）
  void import('./snapshot-exclusion-scan.js')
    .then((m) => m.scanAndStoreWorkspaceExclusions(id, newData.path))
    .catch((err) => console.error('[snapshot-exclusion-scan] 新工作区对照扫描失败:', err));
  return id;
}

/**
 * 设置默认工作区
 * 将指定工作区设为默认，同时取消其他工作区的默认状态
 * @param id - 要设为默认的工作区 ID
 */
export async function setDefault(id: string): Promise<void> {
  const file = await loadWorkspacesFile();

  for (const ws of file.workspaces) {
    ws.isDefault = ws.id === id;
  }

  await saveWorkspacesFile(file);
}

/**
 * 删除工作区（仅从索引中移除，不删除文件夹）
 * @param id - 要删除的工作区 ID
 */
export async function remove(id: string): Promise<void> {
  const file = await loadWorkspacesFile();
  const idx = file.workspaces.findIndex((w) => w.id === id);
  if (idx === -1) return;

  const wasDefault = file.workspaces[idx].isDefault;
  file.workspaces.splice(idx, 1);

  // 如果删除的是默认工作区，将第一个设为默认
  if (wasDefault && file.workspaces.length > 0) {
    file.workspaces[0].isDefault = true;
  }

  await saveWorkspacesFile(file);
  void import('./workspace-watcher.js').then((m) => m.syncWorkspaceWatchers()).catch(() => {});
}

/**
 * 更新工作区（全量覆盖写入）
 * @param id - 要更新的工作区 ID
 * @param ws - 新的工作区数据
 */
export async function update(id: string, ws: Workspace): Promise<void> {
  const file = await loadWorkspacesFile();
  const idx = file.workspaces.findIndex((w) => w.id === id);
  if (idx === -1) return;
  file.workspaces[idx] = ws;
  await saveWorkspacesFile(file);
}
