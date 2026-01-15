-- 图书表:存储书籍的基本信息和阅读状态
CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,          -- 图书唯一标识
  title TEXT NOT NULL,                           -- 书名
  author TEXT,                                   -- 作者
  file_path TEXT UNIQUE,                         -- 文件路径(唯一)
  file_type TEXT,                                -- 文件类型(如 pdf、epub 等)
  total_pages INTEGER,                           -- 总页数
  current_page INTEGER DEFAULT 0,                -- 当前阅读页码
  cover_image TEXT,                              -- 封面图片路径
  metadata TEXT,                                 -- 其他元数据(JSON 格式)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP, -- 创建时间
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP  -- 更新时间
);

-- AI 交互记录表:存储用户与 AI 的交互历史
CREATE TABLE IF NOT EXISTS ai_interactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,          -- 交互记录唯一标识
  book_id INTEGER,                              -- 关联的图书 ID
  type TEXT NOT NULL,                           -- 交互类型(如摘要、问答、分析等)
  user_message TEXT,                            -- 用户的消息
  ai_response TEXT,                             -- AI 的回复
  context_text TEXT,                            -- 上下文文本(从书中提取的相关内容)
  model_info TEXT,                              -- 模型信息(使用的 AI 模型名称及参数)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP, -- 交互时间
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE  -- 外键约束,关联到图书表,删除图书时级联删除相关交互记录
);

-- 索引:用于优化查询性能
CREATE INDEX IF NOT EXISTS idx_books_created ON books(created_at);           -- 按创建时间索引图书,用于按时间排序
CREATE INDEX IF NOT EXISTS idx_ai_book_id ON ai_interactions(book_id);       -- 按图书 ID 索引交互记录,用于快速查询某本书的所有交互
CREATE INDEX IF NOT EXISTS idx_ai_created ON ai_interactions(created_at);     -- 按创建时间索引交互记录,用于按时间排序
