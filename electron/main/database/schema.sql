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

  -- 工作区相关 (v2 新增)
  workspace_id TEXT NOT NULL DEFAULT 'default', -- 工作区ID
  file_path TEXT,                               -- 工作区内的文件路径(相对于工作区)

  -- AI 分析状态 (v2 新增)
  analysis_status TEXT DEFAULT 'none',          -- 分析状态: none/analyzing/analyzed/failed
  analyzed_at INTEGER,                          -- 最后分析时间

  cover_image TEXT,                             -- 封面图片路径
  metadata TEXT,                                -- 其他元数据(JSON 格式)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP, -- 创建时间
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, -- 更新时间

  FOREIGN KEY (current_chapter_id) REFERENCES chapters(id)
);

-- 工作区表 (v2 新增)
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,                          -- 工作区ID
  name TEXT NOT NULL,                           -- 工作区名称
  path TEXT NOT NULL UNIQUE,                    -- 工作区路径
  is_default INTEGER DEFAULT 0,                 -- 是否为默认工作区
  created_at INTEGER NOT NULL                   -- 创建时间
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
CREATE INDEX IF NOT EXISTS idx_books_workspace ON books(workspace_id);          -- v2: 按工作区索引
CREATE INDEX IF NOT EXISTS idx_books_analysis_status ON books(analysis_status); -- v2: 按分析状态索引
CREATE INDEX IF NOT EXISTS idx_chapters_book_id ON chapters(book_id);          -- 按书籍ID索引章节
CREATE INDEX IF NOT EXISTS idx_chapters_chapter_index ON chapters(book_id, chapter_index); -- 按书籍和章节序号索引
CREATE INDEX IF NOT EXISTS idx_ai_book_id ON ai_interactions(book_id);         -- 按图书 ID 索引交互记录
CREATE INDEX IF NOT EXISTS idx_ai_created ON ai_interactions(created_at);      -- 按创建时间索引交互记录

-- ==================== 对话和消息表 (v3 新增) ====================

-- 对话表:存储对话会话（v5: 对话直接属于工作区，书籍关联可选）
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,                          -- 对话唯一标识(UUID)
  book_id TEXT,                                 -- 关联的书籍ID(UUID)，可选
  workspace_id TEXT,                            -- 关联的工作区ID
  title TEXT NOT NULL,                          -- 对话标题（自动生成或用户自定义）
  model TEXT NOT NULL DEFAULT 'claude-sonnet-4-5-20250929', -- 使用的模型
  sdk_session_id TEXT,                          -- SDK 返回的 session_id（用于 resume 功能）
  created_at INTEGER NOT NULL,                  -- 创建时间戳
  updated_at INTEGER NOT NULL,                  -- 最后更新时间戳

  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE SET NULL
);

-- 对话消息表:存储对话中的每条消息
CREATE TABLE IF NOT EXISTS conversation_messages (
  id TEXT PRIMARY KEY,                          -- 消息唯一标识(UUID)
  conversation_id TEXT NOT NULL,                -- 关联的对话ID(UUID)
  role TEXT NOT NULL,                           -- 角色: user/assistant/system
  content TEXT NOT NULL,                        -- 消息内容
  content_blocks TEXT,                          -- 扩展内容块（JSON格式，存储工具调用等信息）
  timestamp INTEGER NOT NULL,                   -- 消息时间戳

  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

-- 索引:对话和消息表
CREATE INDEX IF NOT EXISTS idx_conversations_book_id ON conversations(book_id);      -- 按书籍ID索引对话
CREATE INDEX IF NOT EXISTS idx_conversations_workspace_id ON conversations(workspace_id); -- 按工作区ID索引对话
CREATE INDEX IF NOT EXISTS idx_conversations_created ON conversations(created_at);  -- 按创建时间索引对话
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON conversation_messages(conversation_id); -- 按对话ID索引消息
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON conversation_messages(timestamp); -- 按时间戳索引消息
