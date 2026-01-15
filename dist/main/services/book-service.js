"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.selectBookFile = selectBookFile;
exports.importBook = importBook;
const electron_1 = require("electron");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const epub2_1 = require("epub2");
const pdf = __importStar(require("pdf-parse"));
const database_1 = require("../database");
async function selectBookFile() {
    const result = await electron_1.dialog.showOpenDialog({
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
async function importBook(filePath) {
    const ext = path_1.default.extname(filePath).toLowerCase();
    const fileName = path_1.default.basename(filePath, ext);
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
        const bookId = database_1.dbBooks.add(bookData);
        return database_1.dbBooks.getById(bookId);
    }
    catch (error) {
        throw new Error(`导入失败: ${error.message}`);
    }
}
async function parseEpub(filePath) {
    return new Promise((resolve, reject) => {
        const epub = new epub2_1.EPub(filePath);
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
    const content = fs_1.default.readFileSync(filePath, 'utf-8');
    const fileName = path_1.default.basename(filePath, '.txt');
    return {
        title: fileName,
        file_type: 'txt',
        total_pages: Math.ceil(content.length / 2000), // 粗略估算
    };
}
async function parsePdf(filePath) {
    const dataBuffer = fs_1.default.readFileSync(filePath);
    const data = await pdf(dataBuffer);
    return {
        title: data.info?.Title || path_1.default.basename(filePath, '.pdf'),
        author: data.info?.Author,
        file_type: 'pdf',
        total_pages: data.numpages,
    };
}
