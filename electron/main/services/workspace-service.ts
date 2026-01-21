/**
 * 工作区管理服务
 * 负责管理工作区目录和书籍文件的存储
 *
 * 设计原则 (v2):
 * - 以书籍为中心，每本书在 workspaces/{workspace-id}/{book-id}/ 下有自己的目录
 * - 分析数据存储在 .dogear/ 子目录中，与书籍文件在同一位置
 */

import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { dbWorkspaces, Workspace } from '../database/index.js';

/**
 * 获取默认工作区路径
 */
export async function getDefaultWorkspacePath(): Promise<string> {
  const { app } = await import('electron');
  return path.join(app.getPath('userData'), 'books');
}

/**
 * 确保工作区目录存在
 */
async function ensureWorkspaceExists(workspacePath: string): Promise<void> {
  await fs.mkdir(workspacePath, { recursive: true });
}

/**
 * 获取或创建默认工作区
 */
export async function getOrCreateDefaultWorkspace(): Promise<Workspace> {
  // 先尝试从数据库获取
  let workspace = dbWorkspaces.getDefault();

  if (!workspace) {
    // 创建默认工作区
    const workspacePath = await getDefaultWorkspacePath();
    await ensureWorkspaceExists(workspacePath);

    const newId = uuidv4();
    workspace = {
      id: newId,
      name: '默认书架',
      path: workspacePath,
      is_default: 1,
      created_at: Date.now()
    };

    dbWorkspaces.add(workspace);
  }

  // 确保目录存在
  await ensureWorkspaceExists(workspace.path);

  return workspace;
}

/**
 * 获取书籍目录路径
 * @param bookId - 书籍 ID
 * @returns 返回书籍目录的绝对路径
 */
export async function getOrCreateBookDir(bookId: string): Promise<string> {
  const workspace = await getOrCreateDefaultWorkspace();
  const bookDir = path.join(workspace.path, bookId);

  // 创建书籍目录
  await fs.mkdir(bookDir, { recursive: true });

  // 创建 .dogear 隐藏目录（用于存放分析数据）
  const dogearDir = path.join(bookDir, '.dogear');
  await fs.mkdir(dogearDir, { recursive: true });

  // 创建 chapters 子目录
  const chaptersDir = path.join(dogearDir, 'chapters');
  await fs.mkdir(chaptersDir, { recursive: true });

  // 创建 session 子目录
  const sessionDir = path.join(dogearDir, 'session');
  await fs.mkdir(sessionDir, { recursive: true });

  return bookDir;
}

/**
 * 复制书籍文件到工作区
 * @param bookId - 书籍 ID
 * @param sourcePath - 源文件路径
 * @returns 返回相对于工作区的文件路径
 */
export async function copyBookToWorkspace(bookId: string, sourcePath: string): Promise<string> {
  const bookDir = await getOrCreateBookDir(bookId);

  // 获取原始文件名
  const fileName = path.basename(sourcePath);
  const targetPath = path.join(bookDir, fileName);

  // 复制文件
  await fs.copyFile(sourcePath, targetPath);

  // 返回相对于工作区的路径
  const workspace = await getOrCreateDefaultWorkspace();
  return path.join(bookId, fileName);
}

/**
 * 获取书籍文件路径
 * @param bookId - 书籍 ID
 * @param fileName - 文件名（可选）
 * @returns 返回文件的绝对路径
 */
export async function getBookFilePath(bookId: string, fileName?: string): Promise<string> {
  const workspace = await getOrCreateDefaultWorkspace();
  const bookDir = path.join(workspace.path, bookId);

  if (fileName) {
    return path.join(bookDir, fileName);
  }

  // 如果没有指定文件名，查找目录中的第一个文件
  const files = await fs.readdir(bookDir);
  const bookFile = files.find(f => !f.startsWith('.'));

  if (!bookFile) {
    throw new Error(`书籍目录中没有找到文件: ${bookDir}`);
  }

  return path.join(bookDir, bookFile);
}

/**
 * 获取 .dogear 目录路径
 * @param bookId - 书籍 ID
 * @returns 返回 .dogear 目录的绝对路径
 */
export async function getDogearDir(bookId: string): Promise<string> {
  const workspace = await getOrCreateDefaultWorkspace();
  return path.join(workspace.path, bookId, '.dogear');
}

/**
 * 保存书籍元数据到 meta.json
 * @param bookId - 书籍 ID
 * @param metadata - 元数据对象
 */
export async function saveBookMeta(bookId: string, metadata: Record<string, any>): Promise<void> {
  const dogearDir = await getDogearDir(bookId);
  const metaPath = path.join(dogearDir, 'meta.json');

  await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');
}

/**
 * 读取书籍元数据
 * @param bookId - 书籍 ID
 * @returns 返回元数据对象，如果不存在则返回 null
 */
export async function loadBookMeta(bookId: string): Promise<Record<string, any> | null> {
  try {
    const dogearDir = await getDogearDir(bookId);
    const metaPath = path.join(dogearDir, 'meta.json');

    const content = await fs.readFile(metaPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * 保存分析状态到 status.json
 * @param bookId - 书籍 ID
 * @param status - 状态对象
 */
export async function saveAnalysisStatus(bookId: string, status: {
  analysisStatus: 'none' | 'analyzing' | 'analyzed' | 'failed';
  analyzedAt?: number;
  lastError?: string;
}): Promise<void> {
  const dogearDir = await getDogearDir(bookId);
  const statusPath = path.join(dogearDir, 'status.json');

  await fs.writeFile(statusPath, JSON.stringify(status, null, 2), 'utf-8');
}

/**
 * 读取分析状态
 * @param bookId - 书籍 ID
 * @returns 返回状态对象
 */
export async function loadAnalysisStatus(bookId: string): Promise<{
  analysisStatus: 'none' | 'analyzing' | 'analyzed' | 'failed';
  analyzedAt?: number;
  lastError?: string;
}> {
  try {
    const dogearDir = await getDogearDir(bookId);
    const statusPath = path.join(dogearDir, 'status.json');

    const content = await fs.readFile(statusPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return { analysisStatus: 'none' };
  }
}

/**
 * 保存分析结果到 analysis.json
 * @param bookId - 书籍 ID
 * @param analysis - 分析结果对象（任意结构，由 AI 生成）
 */
export async function saveAnalysisResult(bookId: string, analysis: Record<string, any>): Promise<void> {
  const dogearDir = await getDogearDir(bookId);
  const analysisPath = path.join(dogearDir, 'analysis.json');

  // 添加时间戳和模型信息
  const data = {
    analyzedAt: Date.now(),
    model: 'claude-sonnet-4-5',
    ...analysis
  };

  await fs.writeFile(analysisPath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * 读取分析结果
 * @param bookId - 书籍 ID
 * @returns 返回分析结果对象，如果不存在则返回 null
 */
export async function loadAnalysisResult(bookId: string): Promise<Record<string, any> | null> {
  try {
    const dogearDir = await getDogearDir(bookId);
    const analysisPath = path.join(dogearDir, 'analysis.json');

    const content = await fs.readFile(analysisPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * 保存章节分析结果
 * @param bookId - 书籍 ID
 * @param chapterNumber - 章节序号
 * @param analysis - 章节分析结果
 */
export async function saveChapterAnalysis(
  bookId: string,
  chapterNumber: number,
  analysis: Record<string, any>
): Promise<void> {
  const dogearDir = await getDogearDir(bookId);
  const chaptersDir = path.join(dogearDir, 'chapters');

  // 文件名格式: chapter-001.json
  const filename = `chapter-${String(chapterNumber).padStart(3, '0')}.json`;
  const chapterPath = path.join(chaptersDir, filename);

  const data = {
    chapterNumber,
    analyzedAt: Date.now(),
    ...analysis
  };

  await fs.writeFile(chapterPath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * 读取章节分析结果
 * @param bookId - 书籍 ID
 * @returns 返回章节分析结果数组
 */
export async function loadChapterAnalyses(bookId: string): Promise<Record<string, any>[]> {
  try {
    const dogearDir = await getDogearDir(bookId);
    const chaptersDir = path.join(dogearDir, 'chapters');

    const files = await fs.readdir(chaptersDir);
    const jsonFiles = files.filter(f => f.endsWith('.json')).sort();

    const results: Record<string, any>[] = [];
    for (const file of jsonFiles) {
      const filePath = path.join(chaptersDir, file);
      const content = await fs.readFile(filePath, 'utf-8');
      results.push(JSON.parse(content));
    }

    return results;
  } catch {
    return [];
  }
}

/**
 * 删除书籍目录及其所有内容
 * @param bookId - 书籍 ID
 */
export async function deleteBookDir(bookId: string): Promise<void> {
  const workspace = await getOrCreateDefaultWorkspace();
  const bookDir = path.join(workspace.path, bookId);

  try {
    await fs.rm(bookDir, { recursive: true, force: true });
  } catch {
    // 忽略错误
  }
}
