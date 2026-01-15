import { contextBridge, ipcRenderer } from 'electron';
const electronAPI = {
    db: {
        getBooks: () => ipcRenderer.invoke('db:getBooks'),
        getBookById: (id) => ipcRenderer.invoke('db:getBookById', id),
        addBook: (book) => ipcRenderer.invoke('db:addBook', book),
        updateBook: (id, data) => ipcRenderer.invoke('db:updateBook', id, data),
        deleteBook: (id) => ipcRenderer.invoke('db:deleteBook', id),
    },
    ai: {
        chat: (messages) => ipcRenderer.invoke('ai:chat', messages),
        summarize: (text) => ipcRenderer.invoke('ai:summarize', text),
    },
    file: {
        selectFile: () => ipcRenderer.invoke('file:select'),
        importBook: (path) => ipcRenderer.invoke('file:importBook', path),
    },
};
contextBridge.exposeInMainWorld('electronAPI', electronAPI);
