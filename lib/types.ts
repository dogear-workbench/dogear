/**
 * 类型定义模块
 * 定义应用中使用的数据类型和全局接口
 */

/**
 * 书籍数据接口
 * 定义书籍对象的数据结构,与数据库表结构对应
 */
export interface Book {
  id?: number;                // 书籍唯一标识
  title: string;              // 书名
  author?: string;            // 作者
  file_path: string;          // 文件路径
  file_type: string;          // 文件类型(epub/txt/pdf)
  total_pages?: number;       // 总页数
  current_page?: number;      // 当前阅读页码
  cover_image?: string;       // 封面图片路径
  metadata?: string;          // 其他元数据(JSON 格式)
  created_at?: string;        // 创建时间
  updated_at?: string;        // 更新时间
}

/**
 * AI 交互记录接口
 * 定义 AI 交互记录的数据结构,与数据库表结构对应
 */
export interface AIInteraction {
  id?: number;                // 交互记录唯一标识
  book_id?: number;           // 关联的书籍 ID
  type: 'chat' | 'summarize' | 'qna';  // 交互类型:对话/摘要/问答
  user_message?: string;      // 用户的消息
  ai_response: string;        // AI 的回复
  context_text?: string;      // 上下文文本(从书中提取的相关内容)
  model_info?: string;        // 模型信息(使用的 AI 模型名称及参数)
  created_at?: string;        // 交互时间
}

/**
 * 全局 Window 接口扩展
 * 为 window.electronAPI 提供类型定义
 * 这个接口由 Electron 的预加载脚本注入到渲染进程
 */
declare global {
  interface Window {
    /**
     * Electron API 对象
     * 通过 contextBridge 从预加载脚本暴露到渲染进程
     */
    electronAPI: {
      // 数据库操作接口
      db: {
        getBooks: () => Promise<Book[]>;                      // 获取所有书籍列表
        getBookById: (id: number) => Promise<Book>;           // 根据 ID 获取书籍
        addBook: (book: Book) => Promise<number>;             // 添加新书籍
        updateBook: (id: number, data: Partial<Book>) => Promise<void>;  // 更新书籍信息
        deleteBook: (id: number) => Promise<void>;            // 删除书籍
      };
      // AI 服务接口
      ai: {
        chat: (messages: any[]) => Promise<string>;           // AI 对话
        summarize: (text: string) => Promise<string>;         // 文本摘要
      };
      // 文件操作接口
      file: {
        selectFile: () => Promise<string | null>;             // 打开文件选择对话框
        importBook: (path: string) => Promise<Book>;          // 导入书籍文件
      };
      // 书籍内容读取接口
      book: {
        // 读取 TXT 文件指定页的内容
        getTxtPage: (filePath: string, pageIndex: number) => Promise<{
          content: string;      // 页面内容
          totalPages: number;   // 总页数
          currentPage: number;  // 当前页码
        }>;
      };
    };
  }
}
