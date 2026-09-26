/**
 * 文章排序索引读写（.dogear/articles/.order.json）
 */
import fs from 'fs/promises';
import path from 'path';
import { safeJsonWrite } from '../safe-json.js';
import { ARTICLES_DIR, ORDER_FILE } from './types.js';

/** 排序索引文件结构 */
export interface ArticleOrderFile {
  version: number;
  children: Record<string, string[]>; // 目录相对路径 → 子项 basename 数组
}

function emptyOrder(): ArticleOrderFile {
  return { version: 1, children: {} };
}

export async function loadArticleOrder(workspacePath: string): Promise<ArticleOrderFile> {
  try {
    const orderPath = path.join(workspacePath, ARTICLES_DIR, ORDER_FILE);
    const raw = await fs.readFile(orderPath, 'utf-8');
    return JSON.parse(raw) as ArticleOrderFile;
  } catch {
    return emptyOrder();
  }
}

export async function saveArticleOrder(workspacePath: string, data: ArticleOrderFile): Promise<void> {
  const orderPath = path.join(workspacePath, ARTICLES_DIR, ORDER_FILE);
  await safeJsonWrite(orderPath, data);
}

/**
 * 将项目添加到排序索引
 * @param parentRelPath - 父目录的相对路径（如 ".dogear/articles"）
 * @param itemBasename - 新项目的 basename
 * @param isFolder - 是否为文件夹（文件夹插入到文件夹区末尾，文章插入到文章区开头）
 */
export async function addToOrder(
  workspacePath: string,
  parentRelPath: string,
  itemBasename: string,
  isFolder: boolean,
): Promise<void> {
  const order = await loadArticleOrder(workspacePath);
  if (!order.children[parentRelPath]) {
    order.children[parentRelPath] = [];
  }
  const children = order.children[parentRelPath];
  // 避免重复
  if (children.includes(itemBasename)) return;

  if (isFolder) {
    // 文件夹插入到最后一个文件夹之后
    let insertIndex = 0;
    // 需要判断哪些是文件夹 — 简化处理：直接 push 到前面
    // 因为 scanArticleDirectory 会强制文件夹优先，这里追加到开头
    children.unshift(itemBasename);
  } else {
    // 文章插入到文件夹之后的第一个位置（即文章区开头）
    // 由于我们不知道哪些是文件夹，追加到末尾（unshift 可能打乱文件夹排序）
    // 排序会由 scanArticleDirectory 的文件夹优先逻辑保证
    children.push(itemBasename);
  }
  await saveArticleOrder(workspacePath, order);
}

/**
 * 从排序索引中移除项目
 */
export async function removeFromOrder(
  workspacePath: string,
  parentRelPath: string,
  itemBasename: string,
): Promise<void> {
  const order = await loadArticleOrder(workspacePath);
  const children = order.children[parentRelPath];
  if (!children) return;
  const index = children.indexOf(itemBasename);
  if (index !== -1) {
    children.splice(index, 1);
  }
  await saveArticleOrder(workspacePath, order);
}

/**
 * 移动项目在排序索引中的位置
 * 同时更新源目录和目标目录的排序
 */
export async function moveInOrder(
  workspacePath: string,
  sourceParentRelPath: string,
  targetParentRelPath: string,
  itemBasename: string,
  targetIndex?: number,
  isFolder?: boolean,
): Promise<void> {
  const order = await loadArticleOrder(workspacePath);

  // 从源目录移除
  if (order.children[sourceParentRelPath]) {
    const idx = order.children[sourceParentRelPath].indexOf(itemBasename);
    if (idx !== -1) {
      order.children[sourceParentRelPath].splice(idx, 1);
    }
  }

  // 插入目标目录
  if (!order.children[targetParentRelPath]) {
    order.children[targetParentRelPath] = [];
  }
  const targetChildren = order.children[targetParentRelPath];
  if (targetIndex !== undefined && targetIndex >= 0) {
    targetChildren.splice(targetIndex, 0, itemBasename);
  } else {
    targetChildren.push(itemBasename);
  }

  // 强制维护文件夹优先分区
  if (isFolder !== undefined) {
    // 如果有明确的类型信息就用它来分区
    // 但通常我们不知道，由 scanArticleDirectory 保证
  }

  await saveArticleOrder(workspacePath, order);
}

/**
 * 重命名排序索引中的项目
 */
export async function renameInOrder(
  workspacePath: string,
  parentRelPath: string,
  oldBasename: string,
  newBasename: string,
): Promise<void> {
  const order = await loadArticleOrder(workspacePath);

  // 更新父目录中的引用
  const children = order.children[parentRelPath];
  if (children) {
    const idx = children.indexOf(oldBasename);
    if (idx !== -1) {
      children[idx] = newBasename;
    }
  }

  // 如果是文件夹，还需要更新其自身的 children key
  const oldKey = parentRelPath + '/' + oldBasename;
  const newKey = parentRelPath + '/' + newBasename;
  if (order.children[oldKey]) {
    order.children[newKey] = order.children[oldKey];
    delete order.children[oldKey];
  }

  await saveArticleOrder(workspacePath, order);
}
