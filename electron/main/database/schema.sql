CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  author TEXT,
  file_path TEXT UNIQUE,
  file_type TEXT,
  total_pages INTEGER,
  current_page INTEGER DEFAULT 0,
  cover_image TEXT,
  metadata TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_interactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER,
  type TEXT NOT NULL,
  user_message TEXT,
  ai_response TEXT,
  context_text TEXT,
  model_info TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_books_created ON books(created_at);
CREATE INDEX IF NOT EXISTS idx_ai_book_id ON ai_interactions(book_id);
CREATE INDEX IF NOT EXISTS idx_ai_created ON ai_interactions(created_at);
