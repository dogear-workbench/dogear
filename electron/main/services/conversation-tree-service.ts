/**
 * 对话树服务
 * 管理 .dogear/workspaces/{workspaceId}/conversation-tree.json
 * 负责文件夹定义和对话/文件夹的父子关系与排序
 */
import path from 'path';
import electron from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { safeJsonWrite, safeJsonRead } from './safe-json.js';

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
  folders: Record<string, ConversationFolder>;
  children: Record<string, string[]>; // parentId -> 有序子节点ID列表
  /** 创建此 tree 时的工作区信息（用于丢失后识别来源） */
  sourceWorkspace?: SourceWorkspaceInfo;
}

const ROOT_ID = '__root__';

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
  if (cleaned.length === rootChildren.length) return { next: tree, mutated: false };
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
// 迁移辅助
// ============================================================

/** 初始化工作区树（迁移时调用：将所有对话放到根级别） */
export async function initializeTree(workspaceId: string, conversationIds: string[]): Promise<void> {
  const tree = emptyTree();
  tree.children[ROOT_ID] = [...conversationIds];
  await saveTree(workspaceId, tree);
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
  let folderInsertIndex = 0;
  for (let i = 0; i < siblings.length; i++) {
    if (tree.folders[siblings[i]]) {
      folderInsertIndex = i + 1;
    } else {
      break;
    }
  }
  siblings.splice(folderInsertIndex, 0, id);

  // 初始化自身的 children
  tree.children[id] = [];

  await saveTree(workspaceId, tree);
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
}

// ============================================================
// 对话在树中的操作
// ============================================================

/** 将新对话添加到树（插入到文件夹之后、其他对话之前） */
export async function addConversationToTree(
  workspaceId: string,
  conversationId: string,
  parentId: string = ROOT_ID,
): Promise<void> {
  const tree = await loadTree(workspaceId);
  if (!tree.children[parentId]) {
    tree.children[parentId] = [];
  }
  // 找到第一个非文件夹项的位置，在该位置插入新对话
  // 这样文件夹始终在对话前面
  const children = tree.children[parentId];
  let insertIndex = 0;
  for (let i = 0; i < children.length; i++) {
    if (tree.folders[children[i]]) {
      insertIndex = i + 1;
    } else {
      break;
    }
  }
  children.splice(insertIndex, 0, conversationId);
  await saveTree(workspaceId, tree);
}

/**
 * 按 updatedAt 倒序重排树中所有 children 数组的对话部分（文件夹顺序保持不变）。
 * 写入后调用一次即可让"同层时间倒序 + 文件夹置顶"成为持久状态。
 *
 * @param updatedAtMap conversationId -> ISO 时间字符串
 */
export async function sortConversationsByUpdatedAt(
  workspaceId: string,
  updatedAtMap: Record<string, string>,
): Promise<void> {
  const tree = await loadTree(workspaceId);
  let mutated = false;

  for (const [parentId, childIds] of Object.entries(tree.children)) {
    const folders: string[] = [];
    const conversations: string[] = [];
    for (const id of childIds) {
      if (tree.folders[id]) folders.push(id);
      else conversations.push(id);
    }

    conversations.sort((a, b) => {
      const ta = new Date(updatedAtMap[a] ?? 0).getTime();
      const tb = new Date(updatedAtMap[b] ?? 0).getTime();
      return tb - ta;
    });

    const next = [...folders, ...conversations];
    if (next.some((id, i) => id !== childIds[i]) || next.length !== childIds.length) {
      tree.children[parentId] = next;
      mutated = true;
    }
  }

  if (mutated) {
    await saveTree(workspaceId, tree);
  }
}

/** 从树中移除对话（扫全部 children，支持多引用） */
export async function removeConversationFromTree(
  workspaceId: string,
  conversationId: string,
): Promise<void> {
  const tree = await loadTree(workspaceId);
  let mutated = false;
  for (const childIds of Object.values(tree.children)) {
    let index;
    while ((index = childIds.indexOf(conversationId)) !== -1) {
      childIds.splice(index, 1);
      mutated = true;
    }
  }
  if (mutated) await saveTree(workspaceId, tree);
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
}

/**
 * 把 conversationId 加到指定文件夹的 children（去重）。
 * 不动其他文件夹，支持多引用语义。
 */
export async function addConversationToFolder(
  workspaceId: string,
  conversationId: string,
  folderId: string,
): Promise<void> {
  const tree = await loadTree(workspaceId);
  if (!tree.folders[folderId]) return; // 文件夹不存在静默
  if (!tree.children[folderId]) tree.children[folderId] = [];
  if (tree.children[folderId].includes(conversationId)) return; // 已在该文件夹
  // 插到文件夹之后、其他对话之前（保持"文件夹在前、对话在后"不变量）
  const children = tree.children[folderId];
  let insertIndex = 0;
  for (let i = 0; i < children.length; i++) {
    if (tree.folders[children[i]]) insertIndex = i + 1;
    else break;
  }
  children.splice(insertIndex, 0, conversationId);
  await saveTree(workspaceId, tree);
}

/** 从指定文件夹移除对话（不动其他文件夹的引用） */
export async function removeConversationFromFolder(
  workspaceId: string,
  conversationId: string,
  folderId: string,
): Promise<void> {
  const tree = await loadTree(workspaceId);
  const children = tree.children[folderId];
  if (!children) return;
  const idx = children.indexOf(conversationId);
  if (idx === -1) return;
  children.splice(idx, 1);
  await saveTree(workspaceId, tree);
}

/** 从一个文件夹移到另一个（remove + add 合并一次写入） */
export async function moveConversationBetweenFolders(
  workspaceId: string,
  conversationId: string,
  fromFolderId: string,
  toFolderId: string,
): Promise<void> {
  if (fromFolderId === toFolderId) return;
  const tree = await loadTree(workspaceId);
  // 从源移除
  const fromChildren = tree.children[fromFolderId];
  if (fromChildren) {
    const idx = fromChildren.indexOf(conversationId);
    if (idx !== -1) fromChildren.splice(idx, 1);
  }
  // 目标文件夹不存在时，源已 remove，写回防数据不一致
  if (!tree.folders[toFolderId]) {
    await saveTree(workspaceId, tree);
    return;
  }
  if (!tree.children[toFolderId]) tree.children[toFolderId] = [];
  if (!tree.children[toFolderId].includes(conversationId)) {
    const toChildren = tree.children[toFolderId];
    let insertIndex = 0;
    for (let i = 0; i < toChildren.length; i++) {
      if (tree.folders[toChildren[i]]) insertIndex = i + 1;
      else break;
    }
    toChildren.splice(insertIndex, 0, conversationId);
  }
  await saveTree(workspaceId, tree);
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
}
