/**
 * 类型定义模块
 * 定义应用中使用的数据类型和全局接口
 */

/**
 * 书籍数据接口
 * 定义书籍对象的数据结构,与数据库表结构对应
 */
export interface Book {
  id?: string;                            // 书籍唯一标识(UUID)
  title: string;                          // 书名
  author?: string;                        // 作者
  file_type: string;                      // 文件类型(txt/epub/pdf)

  // 预处理状态
  processing_status: 'pending' | 'processing' | 'completed' | 'failed';  // 处理状态
  processing_progress?: number;           // 处理进度 0-100

  // 阅读进度(基于章节)
  current_chapter_id?: string;            // 当前阅读的章节ID(UUID)

  // 统计信息
  total_chapters?: number;                // 总章节数
  total_characters?: number;              // 总字符数

  // 原始文件信息
  original_file_path?: string;            // 原始文件路径
  file_size?: number;                     // 文件大小

  cover_image?: string;                   // 封面图片路径
  metadata?: string;                      // 其他元数据(JSON 格式)
  created_at?: string;                    // 创建时间
  updated_at?: string;                    // 更新时间
}

/**
 * 章节数据接口
 */
export interface Chapter {
  id?: string;                            // 章节唯一标识(UUID)
  book_id: string;                        // 关联的书籍ID(UUID)
  chapter_index: number;                  // 章节序号
  title: string;                          // 章节标题
  content: string;                        // 章节完整内容
  character_count: number;                // 字符数
  preview_text: string;                   // 预览文本
  created_at?: string;                    // 创建时间
}

/**
 * 章节元数据接口(不含 content,用于列表展示)
 */
export interface ChapterMetadata {
  id: string;                             // 章节唯一标识(UUID)
  book_id: string;                        // 关联的书籍ID(UUID)
  chapter_index: number;                  // 章节序号
  title: string;                          // 章节标题
  character_count: number;                // 字符数
  preview_text: string;                   // 预览文本
}

/**
 * AI 交互记录接口
 * 定义 AI 交互记录的数据结构,与数据库表结构对应
 */
export interface AIInteraction {
  id?: string;                // 交互记录唯一标识(UUID)
  book_id?: string;           // 关联的书籍 ID(UUID)
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
        getBookById: (id: string) => Promise<Book>;           // 根据 ID 获取书籍(UUID)
        addBook: (book: Book) => Promise<string>;             // 添加新书籍,返回 UUID
        updateBook: (id: string, data: Partial<Book>) => Promise<void>;  // 更新书籍信息(UUID)
        deleteBook: (id: string) => Promise<void>;            // 删除书籍(UUID)
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
        // 获取书籍的章节元数据列表(不含 content,用于目录导航)
        getChapterMetadata: (bookId: string) => Promise<ChapterMetadata[]>;
        // 获取指定章节的完整内容(包含 content)
        getChapter: (chapterId: string) => Promise<Chapter>;
        // 保存阅读进度
        saveProgress: (bookId: string, chapterId: string) => Promise<void>;
      };
    };
  }
}
