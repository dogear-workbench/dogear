/**
 * 章节识别器
 * 负责从TXT文本中识别并提取章节,保留所有内容
 */

/**
 * 章节数据结构(中间表示)
 */
export interface ChapterData {
  index: number;           // 章节序号(0=前言, 1-N=正式章节)
  title: string;           // 章节标题
  content: string;         // 章节内容
  characterCount: number;  // 字符数
  previewText: string;     // 预览文本
}

/**
 * 章节标题匹配模式
 */
interface ChapterPattern {
  pattern: RegExp;
  type: string;
}

export class ChapterRecognizer {
  /**
   * 章节标题模式配置
   * 按优先级排序,从高到低匹配
   */
  private readonly chapterPatterns: ChapterPattern[] = [
    // 中文数字章节: "第一章 开始"、"第一百零八章 终结"
    {
      pattern: /^第[一二三四五六七八九十百千零\d]+章\s*(.*)$/,
      type: 'chinese-chapter'
    },
    // 阿拉伯数字章节: "第1章 开始"、"第108章 终结"
    {
      pattern: /^第\d+章\s*(.*)$/,
      type: 'arabic-chapter'
    },
    // 英文章节: "Chapter 1: Beginning"、"Chapter 108 - The End"
    {
      pattern: /^Chapter\s+\d+\s*[:：\s-]*(.*)$/i,
      type: 'english-chapter'
    },
    // 数字序号: "1. 章节"、"108. 终章"
    {
      pattern: /^\d+\.\s*(.+)$/,
      type: 'numbered'
    },
    // 中文数字序号: "一、章节"、"一百零八、终章"
    {
      pattern: /^[一二三四五六七八九十百千零]+、\s*(.+)$/,
      type: 'chinese-numbered'
    }
  ];

  /**
   * 识别文本中的所有章节
   * @param text - 完整文本内容
   * @returns 返回识别出的章节数组(包含前言)
   */
  recognize(text: string): ChapterData[] {
    const lines = text.split('\n');
    const chapters: ChapterData[] = [];

    // 收集所有章节标题的行号（按匹配顺序自动编号）
    const chapterMarkers: Array<{ lineIndex: number; title: string }> = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const isChapterTitle = this.matchChapterTitle(line);

      if (isChapterTitle) {
        chapterMarkers.push({
          lineIndex: i,
          title: line  // 标题就是整行文本
        });
      }
    }

    // 如果没有识别出任何章节,使用空行分隔
    if (chapterMarkers.length === 0) {
      return this.fallbackToBlankLines(text);
    }

    // 处理第一个章节之前的内容(前言/序言)
    if (chapterMarkers[0].lineIndex > 0) {
      const preContent = lines.slice(0, chapterMarkers[0].lineIndex).join('\n').trim();
      if (preContent.length > 0) {
        chapters.push({
          index: 0,
          title: '前言',
          content: preContent,
          characterCount: preContent.length,
          previewText: preContent.substring(0, 100)
        });
      }
    }

    // 处理所有正式章节
    for (let i = 0; i < chapterMarkers.length; i++) {
      const currentMarker = chapterMarkers[i];
      const nextMarker = chapterMarkers[i + 1];

      // 计算章节内容的行范围(包含章节标题行)
      const startLine = currentMarker.lineIndex; // 包含章节标题行
      const endLine = nextMarker ? nextMarker.lineIndex : lines.length;

      // 提取章节内容(包含章节标题)
      const contentLines = lines.slice(startLine, endLine);
      const content = contentLines.join('\n').trim();

      // 如果内容不为空,创建章节
      if (content.length > 0) {
        chapters.push({
          index: i + 1,  // 章节序号从1开始，按匹配顺序递增
          title: currentMarker.title,
          content,
          characterCount: content.length,
          previewText: content.substring(0, 100)
        });
      }
    }

    // 不再单独处理"后记"，最后一章后面所有内容都归到最后一章

    return chapters;
  }

  /**
   * 尝试匹配章节标题
   * @param line - 文本行
   * @returns 是否是章节标题
   */
  private matchChapterTitle(line: string): boolean {
    for (const { pattern } of this.chapterPatterns) {
      if (pattern.test(line)) {
        return true;
      }
    }
    return false;
  }

  /**
   * 后备方案:使用空行分隔章节
   * 连续2个或以上空行作为分隔符
   * @param text - 完整文本
   * @returns 章节数组
   */
  private fallbackToBlankLines(text: string): ChapterData[] {
    const parts = text.split(/\n\s*\n\s*\n/);
    return parts
      .filter(part => part.trim().length > 0)
      .map((part, index) => {
        const content = part.trim();

        return {
          index: index + 1,
          title: index === 0 ? '开头' : `第${index + 1}节`,
          content,
          characterCount: content.length,
          previewText: content.substring(0, 100)
        };
      });
  }
}
