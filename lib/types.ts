export interface Book {
  id?: number;
  title: string;
  author?: string;
  file_path: string;
  file_type: string;
  total_pages?: number;
  current_page?: number;
  cover_image?: string;
  metadata?: string;
  created_at?: string;
  updated_at?: string;
}

export interface AIInteraction {
  id?: number;
  book_id?: number;
  type: 'chat' | 'summarize' | 'qna';
  user_message?: string;
  ai_response: string;
  context_text?: string;
  model_info?: string;
  created_at?: string;
}

declare global {
  interface Window {
    electronAPI: {
      db: {
        getBooks: () => Promise<Book[]>;
        getBookById: (id: number) => Promise<Book>;
        addBook: (book: Book) => Promise<number>;
        updateBook: (id: number, data: Partial<Book>) => Promise<void>;
        deleteBook: (id: number) => Promise<void>;
      };
      ai: {
        chat: (messages: any[]) => Promise<string>;
        summarize: (text: string) => Promise<string>;
      };
      file: {
        selectFile: () => Promise<string | null>;
        importBook: (path: string) => Promise<Book>;
      };
    };
  }
}
