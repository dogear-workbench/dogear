import { dialog } from 'electron';
import fs from 'fs';
import path from 'path';
import { EPub } from 'epub2';
import * as pdf from 'pdf-parse';
import { dbBooks, Book } from '../database';

export async function selectBookFile(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: '电子书', extensions: ['epub', 'txt', 'pdf'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
}

export async function importBook(filePath: string): Promise<Book> {
  const ext = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath, ext);

  let bookData: Partial<Book> = {
    title: fileName,
    file_path: filePath,
    file_type: ext.slice(1),
  };

  try {
    if (ext === '.epub') {
      bookData = await parseEpub(filePath);
    } else if (ext === '.txt') {
      bookData = await parseTxt(filePath);
    } else if (ext === '.pdf') {
      bookData = await parsePdf(filePath);
    }

    const bookId = dbBooks.add(bookData as Book);
    return dbBooks.getById(bookId)!;
  } catch (error) {
    throw new Error(`导入失败: ${(error as Error).message}`);
  }
}

async function parseEpub(filePath: string): Promise<Partial<Book>> {
  return new Promise((resolve, reject) => {
    const epub = new EPub(filePath);

    epub.on('error', reject);

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

    epub.parse();
  });
}

async function parseTxt(filePath: string): Promise<Partial<Book>> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const fileName = path.basename(filePath, '.txt');

  return {
    title: fileName,
    file_type: 'txt',
    total_pages: Math.ceil(content.length / 2000), // 粗略估算
  };
}

async function parsePdf(filePath: string): Promise<Partial<Book>> {
  const dataBuffer = fs.readFileSync(filePath);
  const data = await (pdf as any)(dataBuffer);

  return {
    title: data.info?.Title || path.basename(filePath, '.pdf'),
    author: data.info?.Author,
    file_type: 'pdf',
    total_pages: data.numpages,
  };
}
