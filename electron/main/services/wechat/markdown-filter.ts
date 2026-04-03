/**
 * 过滤 Agent 回复中微信不支持的 Markdown 语法
 * 微信纯文本模式不渲染 Markdown，保留内容但去掉标记符号
 */
export function stripMarkdownForWechat(text: string): string {
  let result = text;

  // 移除代码块标记（保留代码内容）
  result = result.replace(/```[\w]*\n?/g, '');

  // 移除行内代码标记（保留内容）
  result = result.replace(/`([^`]+)`/g, '$1');

  // 移除粗体/斜体标记（保留内容）
  result = result.replace(/\*\*([^*]+)\*\*/g, '$1');
  result = result.replace(/\*([^*]+)\*/g, '$1');
  result = result.replace(/__([^_]+)__/g, '$1');
  result = result.replace(/_([^_]+)_/g, '$1');

  // 简化链接为 "文字 (URL)"
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');

  // 移除图片语法（只保留 alt 文字）
  result = result.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');

  // 移除标题标记（保留内容）
  result = result.replace(/^#{1,6}\s+/gm, '');

  // 移除表格分隔线行
  result = result.replace(/^\|?[\s\-:|]+\|[\s\-:|]+\|?$/gm, '');

  // 移除水平线
  result = result.replace(/^[-*_]{3,}$/gm, '');

  // 清理多余空行（超过两个连续空行的压缩为两个）
  result = result.replace(/\n{3,}/g, '\n\n');

  return result.trim();
}
