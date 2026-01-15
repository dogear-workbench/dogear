import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// 读取 schema
const schemaPath = path.join(__dirname, 'schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf-8');
// 初始化数据库
const userDataPath = app.getPath('userData');
const dbPath = path.join(userDataPath, 'dogear.db');
const db = new Database(dbPath);
db.exec(schema);
// 书籍操作
export const dbBooks = {
    getAll: () => {
        const stmt = db.prepare('SELECT * FROM books ORDER BY created_at DESC');
        return stmt.all();
    },
    getById: (id) => {
        const stmt = db.prepare('SELECT * FROM books WHERE id = ?');
        return stmt.get(id);
    },
    add: (book) => {
        const stmt = db.prepare(`
      INSERT INTO books (title, author, file_path, file_type, total_pages, current_page, cover_image, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
        const result = stmt.run(book.title, book.author || null, book.file_path, book.file_type, book.total_pages || null, book.current_page || 0, book.cover_image || null, book.metadata || null);
        return result.lastInsertRowid;
    },
    update: (id, book) => {
        const fields = Object.keys(book)
            .filter(k => k !== 'id' && k !== 'created_at')
            .map(k => `${k} = ?`)
            .join(', ');
        const values = Object.entries(book)
            .filter(([k]) => k !== 'id' && k !== 'created_at')
            .map(([, v]) => v);
        const stmt = db.prepare(`UPDATE books SET ${fields}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`);
        stmt.run(...values, id);
    },
    delete: (id) => {
        const stmt = db.prepare('DELETE FROM books WHERE id = ?');
        stmt.run(id);
    }
};
// AI 交互操作
export const dbAI = {
    getByBookId: (bookId) => {
        const stmt = db.prepare('SELECT * FROM ai_interactions WHERE book_id = ? ORDER BY created_at DESC');
        return stmt.all(bookId);
    },
    add: (interaction) => {
        const stmt = db.prepare(`
      INSERT INTO ai_interactions (book_id, type, user_message, ai_response, context_text, model_info)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
        const result = stmt.run(interaction.book_id || null, interaction.type, interaction.user_message || null, interaction.ai_response, interaction.context_text || null, interaction.model_info || null);
        return result.lastInsertRowid;
    }
};
export default db;
