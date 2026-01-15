import { dialog } from 'electron';
import fs from 'fs';
import path from 'path';
import { EPub } from 'epub2';
import * as pdf from 'pdf-parse';
import { dbBooks, Book } from '../database/index.js';

/**
 * 打开文件选择对话框,让用户选择电子书文件
 * @returns 返回选中的文件路径,如果取消则返回 null
 */
export async function selectBookFile(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: '电子书', extensions: ['epub', 'txt', 'pdf'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  // 用户取消选择或没有选择文件
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
}

/**
 * 导入电子书文件到数据库
 * 根据文件类型调用不同的解析器提取元数据
 * @param filePath - 电子书文件路径
 * @returns 返回导入的书籍信息
 */
export async function importBook(filePath: string): Promise<Book> {
  // 获取文件扩展名和文件名
  const ext = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath, ext);

  // 初始化基础书籍数据
  let bookData: Partial<Book> = {
    title: fileName,
    file_path: filePath,
    file_type: ext.slice(1), // 去掉扩展名的点号
  };

  try {
    // 根据文件类型调用相应的解析器
    if (ext === '.epub') {
      bookData = await parseEpub(filePath);
    } else if (ext === '.txt') {
      bookData = await parseTxt(filePath);
    } else if (ext === '.pdf') {
      bookData = await parsePdf(filePath);
    }

    // 将书籍信息保存到数据库
    const bookId = dbBooks.add(bookData as Book);
    return dbBooks.getById(bookId)!;
  } catch (error) {
    throw new Error(`导入失败: ${(error as Error).message}`);
  }
}

/**
 * 解析 EPUB 文件
 * 提取书籍元数据(标题、作者等)
 * @param filePath - EPUB 文件路径
 * @returns 返回提取的书籍信息
 */
async function parseEpub(filePath: string): Promise<Partial<Book>> {
  return new Promise((resolve, reject) => {
    const epub = new EPub(filePath);

    // 错误处理
    epub.on('error', reject);

    // 解析完成时提取元数据
    epub.on('end', () => {
      const metadata = epub.metadata;
      const book: Partial<Book> = {
        title: metadata.title || 'Unknown',
        author: metadata.creator,
        file_type: 'epub',
      };

      // TODO: 提取封面图片
      // TODO: 提取章节内容

      resolve(book);
    });

    // 开始解析
    epub.parse();
  });
}

/**
 * 解析 TXT 文件
 * 简单计算文本长度来估算页数
 * @param filePath - TXT 文件路径
 * @returns 返回提取的书籍信息
 */
async function parseTxt(filePath: string): Promise<Partial<Book>> {
  // 读取文件内容
  const content = fs.readFileSync(filePath, 'utf-8');
  const fileName = path.basename(filePath, '.txt');

  return {
    title: fileName,
    file_type: 'txt',
    // 粗略估算页数:每页 2000 字符
    total_pages: Math.ceil(content.length / 2000),
  };
}

/**
 * 解析 PDF 文件
 * 提取元数据和页数信息
 * @param filePath - PDF 文件路径
 * @returns 返回提取的书籍信息
 */
async function parsePdf(filePath: string): Promise<Partial<Book>> {
  // 读取 PDF 文件
  const dataBuffer = fs.readFileSync(filePath);
  const data = await (pdf as any)(dataBuffer);

  return {
    title: data.info?.Title || path.basename(filePath, '.pdf'),
    author: data.info?.Author,
    file_type: 'pdf',
    total_pages: data.numpages,
  };
}

/**
 * 读取 TXT 文件指定页的内容
 * 将文本按固定大小分页
 * @param filePath - TXT 文件路径
 * @param pageIndex - 页码索引(从 0 开始)
 * @param pageSize - 每页字符数,默认 2000
 * @returns 返回页面内容和分页信息
 */
export function getTxtPageContent(
  filePath: string,
  pageIndex: number,
  pageSize: number = 2000
): {
  content: string;
  totalPages: number;
  currentPage: number;
} {
  // 读取整个文件内容
  const content = fs.readFileSync(filePath, 'utf-8');
  const totalPages = Math.ceil(content.length / pageSize);

  // 确保页码在有效范围内
  const validPage = Math.max(0, Math.min(pageIndex, totalPages - 1));

  // 计算当前页的起始和结束位置
  const startIndex = validPage * pageSize;
  const endIndex = Math.min(startIndex + pageSize, content.length);
  const pageContent = content.substring(startIndex, endIndex);

  return {
    content: pageContent,
    totalPages,
    currentPage: validPage,
  };
}