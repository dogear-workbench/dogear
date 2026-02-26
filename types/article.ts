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
