const { contextBridge, ipcRenderer } = require('electron');

interface ElectronAPI {
  db: {
    getBooks: () => Promise<any[]>;
    getBookById: (id: number) => Promise<any>;
    addBook: (book: any) => Promise<number>;
    updateBook: (id: number, data: any) => Promise<void>;
    deleteBook: (id: number) => Promise<void>;
  };
  ai: {
    chat: (messages: any[]) => Promise<string>;
    summarize: (text: string) => Promise<string>;
  };
  file: {
    selectFile: () => Promise<string | null>;
    importBook: (path: string) => Promise<any>;
  };
}

const electronAPI: ElectronAPI = {
  db: {
    getBooks: () => ipcRenderer.invoke('db:getBooks'),
    getBookById: (id: number) => ipcRenderer.invoke('db:getBookById', id),
    addBook: (book: any) => ipcRenderer.invoke('db:addBook', book),
    updateBook: (id: number, data: any) => ipcRenderer.invoke('db:updateBook', id, data),
    deleteBook: (id: number) => ipcRenderer.invoke('db:deleteBook', id),
  },
  ai: {
    chat: (messages: any[]) => ipcRenderer.invoke('ai:chat', messages),
    summarize: (text: string) => ipcRenderer.invoke('ai:summarize', text),
  },
  file: {
    selectFile: () => ipcRenderer.invoke('file:select'),
    importBook: (path: string) => ipcRenderer.invoke('file:importBook', path),
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
