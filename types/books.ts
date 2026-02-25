/**
 * 书籍相关类型定义
 * 包含书籍、章节等核心数据结构
 */

/**
 * 书籍数据接口
 * 定义书籍对象的数据结构,与数据库表结构对应
 */
export interface Book {
  id?: string;                            // 书籍唯一标识(UUID)
  title: string;                          // 书名
  author: string | null;                  // 作者
  file_type: string;                      // 文件类型(txt/epub/pdf)

  // 处理状态
  processing_status: 'pending' | 'processing' | 'completed' | 'failed';  // 处理状态
  processing_progress: number;            // 处理进度 0-100 (默认值: 0)

  // 阅读进度(基于章节)
  current_chapter_id: string | null;      // 当前阅读的章节ID(UUID)

  // 统计信息
  total_chapters: number;                 // 总章节数 (默认值: 0)
  total_characters: number;               // 总字符数 (默认值: 0)

  // 原始文件信息
  original_file_path: string | null;      // 原始文件路径
  file_size: number | null;               // 文件大小(字节)

  // v2: 工作区相关
  workspace_id?: string;                  // 工作区ID (v2 新增)
  file_path?: string;                     // 工作区内的文件路径 (v2 新增)

  // v2: AI 分析状态
  analysis_status?: 'none' | 'analyzing' | 'analyzed' | 'failed'; // 分析状态
  analyzed_at?: number | null;            // 最后分析时间戳

  cover_image: string | null;             // 封面图片路径
  metadata: string | null;                // 其他元数据(JSON 格式)
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
 * v2: 书籍分析结果接口（AI 生成的灵活结构）
 */
export interface BookAnalysis {
  analyzedAt: number;                     // 分析时间戳
  model: string;                          // 使用的模型
  contentType: 'fiction' | 'non-fiction' | 'article' | 'reference' | 'other';  // 内容类型

  // 以下是 AI 根据内容自由添加的字段
  // 没有固定结构，完全由 AI 决定
  [key: string]: any;
}

/**
 * v2: 章节分析结果接口
 */
export interface ChapterAnalysis {
  chapterId: string;                      // 章节 ID
  chapterNumber: number;                  // 章节序号
  title: string;                          // 章节标题
  summary: string;                        // 章节摘要
  analyzedAt: number;                     // 分析时间戳

  // AI 可以根据内容添加其他字段
  [key: string]: any;
}
