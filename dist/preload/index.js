"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const electronAPI = {
    db: {
        getBooks: () => electron_1.ipcRenderer.invoke('db:getBooks'),
        getBookById: (id) => electron_1.ipcRenderer.invoke('db:getBookById', id),
        addBook: (book) => electron_1.ipcRenderer.invoke('db:addBook', book),
        updateBook: (id, data) => electron_1.ipcRenderer.invoke('db:updateBook', id, data),
        deleteBook: (id) => electron_1.ipcRenderer.invoke('db:deleteBook', id),
    },
    ai: {
        chat: (messages) => electron_1.ipcRenderer.invoke('ai:chat', messages),
        summarize: (text) => electron_1.ipcRenderer.invoke('ai:summarize', text),
    },
    file: {
        selectFile: () => electron_1.ipcRenderer.invoke('file:select'),
        importBook: (path) => electron_1.ipcRenderer.invoke('file:importBook', path),
    },
};
electron_1.contextBridge.exposeInMainWorld('electronAPI', electronAPI);
