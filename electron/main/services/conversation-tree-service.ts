/**
 * 对话树服务（Phase 3 组化后）
 * 管理 .dogear/workspaces/{workspaceId}/conversation-tree.json
 * - __root__ 只装 folderId
 * - children[folderId] 装 groupId（多引用语义：同 groupId 可在多个 folder）
 * - schemaVersion = 2 表示已 Phase 3 升级
 */
import path from 'path';
import electron from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { safeJsonWrite, safeJsonRead } from './safe-json.js';
import { broadcastConversationListChanged } from './renderer-broadcast.js';

const { app } = electron;

// ============================================================
// 类型定义
// ============================================================

/** 对话文件夹 */
export interface ConversationFolder {
  id: string;
  name: string;
  createdAt: string;
}

/** 来源工作区信息（创建时写入，用于恢复时识别） */
export interface SourceWorkspaceInfo {
  name: string;   // 工作区名称
  path: string;   // 工作区文件系统路径
}

/** conversation-tree.json 的文件结构 */
export interface ConversationTreeFile {
  version: number;
  /** Phase 3 升级标记：schemaVersion=2 表示 children 装 groupId */
  schemaVersion?: number;
  folders: Record<string, ConversationFolder>;
  /** parentId → 有序子节点ID。__root__ 装 folderId；folderId 装 groupId */
  children: Record<string, string[]>;
  /** 创建此 tree 时的工作区信息（用于丢失后识别来源） */
  sourceWorkspace?: SourceWorkspaceInfo;
}

const ROOT_ID = '__root__';

/** 在 children 数组中找到"最后一个文件夹之后"的插入位置，维护"文件夹在前、对话在后"不变量 */
function folderFirstInsertIndex(children: string[], folders: Record<string, ConversationFolder>): number {
  let idx = 0;
  for (let i = 0; i < children.length; i++) {
    if (folders[children[i]]) idx = i + 1;
    else break;
  }
  return idx;
}

// ============================================================
// 路径函数
// ============================================================

function getConfigDir(): string {
  if (app.isPackaged) {
    return path.join(app.getPath('userData'), '.dogear');
  }
  return path.join(process.cwd(), '.dogear');
}

function getTreePath(workspaceId: string): string {
  return path.join(getConfigDir(), 'workspaces', workspaceId, 'conversation-tree.json');
}

// ============================================================
// 读写函数
// ============================================================

function emptyTree(): ConversationTreeFile {
  return { version: 1, folders: {}, children: { [ROOT_ID]: [] } };
}

/**
 * 仅保留 __root__ 下的 folderId；散落的 conversationId 一律丢弃。
 * 幂等：多次调用在无散落时直接返回 mutated=false。
 */
export function migrateRootScatter(tree: ConversationTreeFile): { next: ConversationTreeFile; mutated: boolean } {
  const rootChildren = tree.children[ROOT_ID] ?? [];
  const folderIds = new Set(Object.keys(tree.folders));
  const cleaned = rootChildren.filter((id) => folderIds.has(id));
  if (cleaned.length === rootChildren.length) return { next: { ...tree }, mutated: false };
  return {
    next: { ...tree, children: { ...tree.children, [ROOT_ID]: cleaned } },
    mutated: true,
  };
}

async function loadTree(workspaceId: string): Promise<ConversationTreeFile> {
  const raw = await safeJsonRead<ConversationTreeFile>(getTreePath(workspaceId), emptyTree());
  const { next, mutated } = migrateRootScatter(raw);
  if (mutated) await saveTree(workspaceId, next);
  return next;
}

async function saveTree(workspaceId: string, data: ConversationTreeFile): Promise<void> {
  await safeJsonWrite(getTreePath(workspaceId), data);
}

// ============================================================
// 查询
// ============================================================

/** 获取完整的树数据 */
export async function getTree(workspaceId: string): Promise<ConversationTreeFile> {
  return loadTree(workspaceId);
}

// ============================================================
// 迁移辅助（旧 API 已废弃；保留 initializeTree 供首次安装兜底使用）
// ============================================================

/** 初始化工作区树（首次安装兜底，普通使用走 migration-p3 已 schemaVersion=2 的树） */
export async function initializeTree(workspaceId: string): Promise<void> {
  await saveTree(workspaceId, emptyTree());
}

// ============================================================
// 文件夹 CRUD
// ============================================================

/** 创建文件夹 */
export async function createFolder(
  workspaceId: string,
  name: string,
  parentId: string = ROOT_ID,
): Promise<string> {
  const tree = await loadTree(workspaceId);
  const id = 'folder-' + uuidv4();

  tree.folders[id] = {
    id,
    name,
    createdAt: new Date().toISOString(),
  };

  // 添加到父节点的 children 中（插入到最后一个文件夹之后，保证在对话之前）
  if (!tree.children[parentId]) {
    tree.children[parentId] = [];
  }
  const siblings = tree.children[parentId];
  const insertIndex = folderFirstInsertIndex(siblings, tree.folders);
  siblings.splice(insertIndex, 0, id);

  // 初始化自身的 children
  tree.children[id] = [];

  await saveTree(workspaceId, tree);
  broadcastConversationListChanged(workspaceId);
  return id;
}

/** 重命名文件夹 */
export async function renameFolder(
  workspaceId: string,
  folderId: string,
  newName: string,
): Promise<void> {
  const tree = await loadTree(workspaceId);
  if (!tree.folders[folderId]) return;
  tree.folders[folderId].name = newName;
  await saveTree(workspaceId, tree);
  broadcastConversationListChanged(workspaceId);
}

/**
 * 删除文件夹（子内容移到上级）
 * 被删文件夹的子项插入到它在父节点中原来的位置
 */
export async function deleteFolder(
  workspaceId: string,
  folderId: string,
): Promise<void> {
  const tree = await loadTree(workspaceId);
  if (!tree.folders[folderId]) return;

  // 找到父节点，将子内容插入到被删文件夹的位置
  for (const [, childIds] of Object.entries(tree.children)) {
    const index = childIds.indexOf(folderId);
    if (index !== -1) {
      const folderChildren = tree.children[folderId] || [];
      childIds.splice(index, 1, ...folderChildren);
      break;
    }
  }

  // 清理文件夹数据
  delete tree.folders[folderId];
  delete tree.children[folderId];

  await saveTree(workspaceId, tree);
  broadcastConversationListChanged(workspaceId);
}

// ============================================================
// 组在树中的操作（Phase 3 组化后）
// ============================================================

/**
 * 按 updatedAt 倒序重排所有文件夹下 children 中的 group 部分（文件夹顺序保持不变）。
 * @param updatedAtMap groupId -> ms timestamp 或 ISO 时间字符串
 */
export async function sortGroupsByUpdatedAt(
  workspaceId: string,
  updatedAtMap: Record<string, number | string>,
): Promise<void> {
  const tree = await loadTree(workspaceId);
  let mutated = false;

  for (const [parentId, childIds] of Object.entries(tree.children)) {
    const folders: string[] = [];
    const groups: string[] = [];
    for (const id of childIds) {
      if (tree.folders[id]) folders.push(id);
      else groups.push(id);
    }

    groups.sort((a, b) => {
      const va = updatedAtMap[a] ?? 0;
      const vb = updatedAtMap[b] ?? 0;
      const ta = typeof va === 'number' ? va : new Date(va).getTime();
      const tb = typeof vb === 'number' ? vb : new Date(vb).getTime();
      return tb - ta;
    });

    const next = [...folders, ...groups];
    if (next.some((id, i) => id !== childIds[i]) || next.length !== childIds.length) {
      tree.children[parentId] = next;
      mutated = true;
    }
  }

  if (mutated) {
    await saveTree(workspaceId, tree);
  }
}

/** 从树中移除组（扫全部 children，支持多引用） */
export async function removeGroupFromTree(
  workspaceId: string,
  groupId: string,
): Promise<void> {
  const tree = await loadTree(workspaceId);
  let mutated = false;
  for (const childIds of Object.values(tree.children)) {
    let index;
    while ((index = childIds.indexOf(groupId)) !== -1) {
      childIds.splice(index, 1);
      mutated = true;
    }
  }
  if (mutated) {
    await saveTree(workspaceId, tree);
    broadcastConversationListChanged(workspaceId);
  }
}

/**
 * 移动项目（对话或文件夹）到新父节点的指定位置
 * @param targetIndex 插入位置索引，不指定则追加到末尾
 */
export async function moveItem(
  workspaceId: string,
  itemId: string,
  targetParentId: string,
  targetIndex?: number,
): Promise<void> {
  const tree = await loadTree(workspaceId);

  // 从旧位置移除
  for (const childIds of Object.values(tree.children)) {
    const index = childIds.indexOf(itemId);
    if (index !== -1) {
      childIds.splice(index, 1);
      break;
    }
  }

  // 插入新位置
  if (!tree.children[targetParentId]) {
    tree.children[targetParentId] = [];
  }
  if (targetIndex !== undefined && targetIndex >= 0) {
    tree.children[targetParentId].splice(targetIndex, 0, itemId);
  } else {
    tree.children[targetParentId].push(itemId);
  }

  // 强制维护分区不变量：文件夹在前、对话在后
  const children = tree.children[targetParentId];
  const folderIds: string[] = [];
  const convIds: string[] = [];
  for (const id of children) {
    if (tree.folders[id]) {
      folderIds.push(id);
    } else {
      convIds.push(id);
    }
  }
  tree.children[targetParentId] = [...folderIds, ...convIds];

  await saveTree(workspaceId, tree);
  broadcastConversationListChanged(workspaceId);
}

/**
 * 把 groupId 加到指定文件夹的 children（去重）。
 * 不动其他文件夹，支持多引用语义。
 */
export async function addGroupToFolder(
  workspaceId: string,
  groupId: string,
  folderId: string,
): Promise<void> {
  const tree = await loadTree(workspaceId);
  if (!tree.folders[folderId]) return;
  if (!tree.children[folderId]) tree.children[folderId] = [];
  if (tree.children[folderId].includes(groupId)) return;
  const children = tree.children[folderId];
  const insertIndex = folderFirstInsertIndex(children, tree.folders);
  children.splice(insertIndex, 0, groupId);
  await saveTree(workspaceId, tree);
  broadcastConversationListChanged(workspaceId);
}

/** 从指定文件夹移除组（不动其他文件夹的引用） */
export async function removeGroupFromFolder(
  workspaceId: string,
  groupId: string,
  folderId: string,
): Promise<void> {
  const tree = await loadTree(workspaceId);
  const children = tree.children[folderId];
  if (!children) return;
  const idx = children.indexOf(groupId);
  if (idx === -1) return;
  children.splice(idx, 1);
  await saveTree(workspaceId, tree);
  broadcastConversationListChanged(workspaceId);
}

/** 从一个文件夹移到另一个（remove + add 合并一次写入） */
export async function moveGroupBetweenFolders(
  workspaceId: string,
  groupId: string,
  fromFolderId: string,
  toFolderId: string,
): Promise<void> {
  if (fromFolderId === toFolderId) return;
  const tree = await loadTree(workspaceId);
  if (!tree.folders[toFolderId]) {
    throw new Error(`目标文件夹不存在: ${toFolderId}`);
  }
  const fromChildren = tree.children[fromFolderId];
  if (fromChildren) {
    const idx = fromChildren.indexOf(groupId);
    if (idx !== -1) fromChildren.splice(idx, 1);
  }
  if (!tree.children[toFolderId]) tree.children[toFolderId] = [];
  if (!tree.children[toFolderId].includes(groupId)) {
    const toChildren = tree.children[toFolderId];
    const insertIndex = folderFirstInsertIndex(toChildren, tree.folders);
    toChildren.splice(insertIndex, 0, groupId);
  }
  await saveTree(workspaceId, tree);
  broadcastConversationListChanged(workspaceId);
}

/**
 * 设置来源工作区信息（创建工作区时调用一次）
 * 用于丢失后的恢复识别
 */
export async function setSourceWorkspace(workspaceId: string, info: SourceWorkspaceInfo): Promise<void> {
  const tree = await loadTree(workspaceId);
  tree.sourceWorkspace = info;
  await saveTree(workspaceId, tree);
}

/**
 * 将另一个 tree 的内容合并到当前工作区的 tree。
 * - 旧 folders 全部拷入（UUID 天然不冲突）
 * - 旧 __root__ 下的 children 追加到当前 __root__ 末尾（去重）
 * - 旧非根 parent-children 关系照搬（当前 tree 没有该 parent 时）
 * - 维护分区不变量：文件夹在前、对话在后
 */
export async function mergeTree(workspaceId: string, sourceTree: ConversationTreeFile): Promise<void> {
  const tree = await loadTree(workspaceId);

  // 合并 folders
  for (const [id, folder] of Object.entries(sourceTree.folders || {})) {
    if (!tree.folders[id]) {
      tree.folders[id] = folder;
    }
  }

  // 合并 children
  for (const [parentId, childIds] of Object.entries(sourceTree.children || {})) {
    if (parentId === ROOT_ID) {
      // 旧根节点 children 追加到当前根末尾（去重）
      const existing = new Set(tree.children[ROOT_ID] || []);
      const newIds = childIds.filter(id => !existing.has(id));
      tree.children[ROOT_ID] = [...(tree.children[ROOT_ID] || []), ...newIds];
    } else {
      // 非根 parent-children 照搬（当前 tree 没有这个 parent 时）
      if (!tree.children[parentId]) {
        tree.children[parentId] = [...childIds];
      }
    }
  }

  // 维护根节点分区不变量：文件夹在前、对话在后
  const rootChildren = tree.children[ROOT_ID] || [];
  const folderIds = rootChildren.filter(id => tree.folders[id]);
  const convIds = rootChildren.filter(id => !tree.folders[id]);
  tree.children[ROOT_ID] = [...folderIds, ...convIds];

  await saveTree(workspaceId, tree);
  broadcastConversationListChanged(workspaceId);
}
