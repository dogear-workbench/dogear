import { Book, AIInteraction } from './types';

export const electronDB = {
  getBooks: async (): Promise<Book[]> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return window.electronAPI.db.getBooks();
    }
    return [];
  },

  getBookById: async (id: number): Promise<Book> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return window.electronAPI.db.getBookById(id);
    }
    throw new Error('Electron API not available');
  },

  addBook: async (book: Book): Promise<number> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return window.electronAPI.db.addBook(book);
    }
    throw new Error('Electron API not available');
  },

  updateBook: async (id: number, data: Partial<Book>): Promise<void> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return window.electronAPI.db.updateBook(id, data);
    }
    throw new Error('Electron API not available');
  },

  deleteBook: async (id: number): Promise<void> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return window.electronAPI.db.deleteBook(id);
    }
    throw new Error('Electron API not available');
  },
};

export const electronAI = {
  chat: async (messages: any[]): Promise<string> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return window.electronAPI.ai.chat(messages);
    }
    throw new Error('Electron API not available');
  },

  summarize: async (text: string): Promise<string> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return window.electronAPI.ai.summarize(text);
    }
    throw new Error('Electron API not available');
  },
};

export const electronFile = {
  selectFile: async (): Promise<string | null> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return window.electronAPI.file.selectFile();
    }
    return null;
  },

  importBook: async (path: string): Promise<Book> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return window.electronAPI.file.importBook(path);
    }
    throw new Error('Electron API not available');
  },
};
