/**
 * 对话树服务
 * 管理 .dogear/workspaces/{workspaceId}/conversation-tree.json
 * 负责文件夹定义和对话/文件夹的父子关系与排序
 */
import fs from 'fs/promises';
import path from 'path';
import electron from 'electron';
import { v4 as uuidv4 } from 'uuid';

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

/** conversation-tree.json 的文件结构 */
export interface ConversationTreeFile {
  version: number;
  folders: Record<string, ConversationFolder>;
  children: Record<string, string[]>; // parentId -> 有序子节点ID列表
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

async function loadTree(workspaceId: string): Promise<ConversationTreeFile> {
  try {
    const raw = await fs.readFile(getTreePath(workspaceId), 'utf-8');
    return JSON.parse(raw) as ConversationTreeFile;
  } catch {
    return emptyTree();
  }
}

async function saveTree(workspaceId: string, data: ConversationTreeFile): Promise<void> {
  const dir = path.dirname(getTreePath(workspaceId));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(getTreePath(workspaceId), JSON.stringify(data, null, 2), 'utf-8');
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

/** 从树中移除对话 */
export async function removeConversationFromTree(
  workspaceId: string,
  conversationId: string,
): Promise<void> {
  const tree = await loadTree(workspaceId);
  for (const childIds of Object.values(tree.children)) {
    const index = childIds.indexOf(conversationId);
    if (index !== -1) {
      childIds.splice(index, 1);
      break;
    }
  }
  await saveTree(workspaceId, tree);
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
