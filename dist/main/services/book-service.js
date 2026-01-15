import { dialog } from 'electron';
import fs from 'fs';
import path from 'path';
import { EPub } from 'epub2';
import * as pdf from 'pdf-parse';
import { dbBooks } from '../database/index.js';
export async function selectBookFile() {
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
export async function importBook(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const fileName = path.basename(filePath, ext);
    let bookData = {
        title: fileName,
        file_path: filePath,
        file_type: ext.slice(1),
    };
    try {
        if (ext === '.epub') {
            bookData = await parseEpub(filePath);
        }
        else if (ext === '.txt') {
            bookData = await parseTxt(filePath);
        }
        else if (ext === '.pdf') {
            bookData = await parsePdf(filePath);
        }
        const bookId = dbBooks.add(bookData);
        return dbBooks.getById(bookId);
    }
    catch (error) {
        throw new Error(`导入失败: ${error.message}`);
    }
}
async function parseEpub(filePath) {
    return new Promise((resolve, reject) => {
        const epub = new EPub(filePath);
        epub.on('error', reject);
        epub.on('end', () => {
            const metadata = epub.metadata;
            const book = {
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
async function parseTxt(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const fileName = path.basename(filePath, '.txt');
    return {
        title: fileName,
        file_type: 'txt',
        total_pages: Math.ceil(content.length / 2000), // 粗略估算
    };
}
async function parsePdf(filePath) {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdf(dataBuffer);
    return {
        title: data.info?.Title || path.basename(filePath, '.pdf'),
        author: data.info?.Author,
        file_type: 'pdf',
        total_pages: data.numpages,
    };
}
