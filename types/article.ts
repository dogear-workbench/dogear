/**
 * 网络文章相关类型定义
 */

/** 文章元数据（存储在 meta.json） */
export interface ArticleMeta {
  id: string;                    // 文章唯一标识(UUID)
  url: string;                   // 原始 URL
  title: string;                 // 文章标题
  author: string | null;         // 作者
  siteName: string | null;       // 站点名称
  excerpt: string | null;        // 摘要（Readability 自动提取）
  wordCount: number;             // 字数
  fetchedAt: number;             // 抓取时间戳
  language: string | null;       // 语言
}

/** 文章完整数据（meta + 正文内容） */
export interface Article extends ArticleMeta {
  content: string;               // Markdown 正文
}

/** 引用片段（用户从文章预览中选中的文字） */
export interface QuoteSnippet {
  id: string;                    // 唯一标识（用于列表 key 和移除）
  articleId: string;             // 来源文章 ID
  articleTitle: string;          // 来源文章标题
  text: string;                  // 选中的文字内容
}
