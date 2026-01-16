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
