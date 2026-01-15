-- 图书表:存储书籍的基本信息和阅读状态
CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,                          -- 图书唯一标识(UUID)
  title TEXT NOT NULL,                           -- 书名
  author TEXT,                                   -- 作者
  file_type TEXT NOT NULL,                       -- 文件类型(txt/epub/pdf)

  -- 预处理状态
  processing_status TEXT NOT NULL DEFAULT 'pending', -- 处理状态: pending/processing/completed/failed
  processing_progress INTEGER DEFAULT 0,            -- 处理进度 0-100

  -- 阅读进度(基于章节)
  current_chapter_id TEXT,                      -- 当前阅读的章节ID(UUID)

  -- 统计信息
  total_chapters INTEGER DEFAULT 0,             -- 总章节数
  total_characters INTEGER DEFAULT 0,           -- 总字符数

  -- 原始文件信息(仅用于记录)
  original_file_path TEXT,                      -- 原始文件路径
  file_size INTEGER,                            -- 文件大小(字节)

  cover_image TEXT,                             -- 封面图片路径
  metadata TEXT,                                -- 其他元数据(JSON 格式)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP, -- 创建时间
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, -- 更新时间

  FOREIGN KEY (current_chapter_id) REFERENCES chapters(id)
);

-- 章节表:存储书籍的章节内容
CREATE TABLE IF NOT EXISTS chapters (
  id TEXT PRIMARY KEY,                        -- 章节唯一标识(UUID)
  book_id TEXT NOT NULL,                      -- 关联的书籍ID(UUID)

  -- 章节信息
  chapter_index INTEGER NOT NULL,             -- 章节序号(从1开始,0=前言,999=后记)
  title TEXT NOT NULL,                        -- 章节标题

  -- 章节内容
  content TEXT NOT NULL,                      -- 章节的完整文本内容

  -- 元信息
  character_count INTEGER NOT NULL,           -- 字符数
  preview_text TEXT NOT NULL,                 -- 预览文本(前100字)

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP, -- 创建时间

  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

-- AI 交互记录表:存储用户与 AI 的交互历史
CREATE TABLE IF NOT EXISTS ai_interactions (
  id TEXT PRIMARY KEY,                          -- 交互记录唯一标识(UUID)
  book_id TEXT,                                 -- 关联的图书 ID(UUID)
  type TEXT NOT NULL,                           -- 交互类型(如摘要、问答、分析等)
  user_message TEXT,                            -- 用户的消息
  ai_response TEXT,                             -- AI 的回复
  context_text TEXT,                            -- 上下文文本(从书中提取的相关内容)
  model_info TEXT,                              -- 模型信息(使用的 AI 模型名称及参数)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP, -- 交互时间
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE  -- 外键约束,关联到图书表,删除图书时级联删除相关交互记录
);

-- 索引:用于优化查询性能
CREATE INDEX IF NOT EXISTS idx_books_created ON books(created_at);              -- 按创建时间索引图书
CREATE INDEX IF NOT EXISTS idx_books_processing_status ON books(processing_status); -- 按处理状态索引
CREATE INDEX IF NOT EXISTS idx_chapters_book_id ON chapters(book_id);          -- 按书籍ID索引章节
CREATE INDEX IF NOT EXISTS idx_chapters_chapter_index ON chapters(book_id, chapter_index); -- 按书籍和章节序号索引
CREATE INDEX IF NOT EXISTS idx_ai_book_id ON ai_interactions(book_id);         -- 按图书 ID 索引交互记录
CREATE INDEX IF NOT EXISTS idx_ai_created ON ai_interactions(created_at);      -- 按创建时间索引交互记录
