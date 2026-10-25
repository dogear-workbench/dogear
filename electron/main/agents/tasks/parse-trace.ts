import path from 'node:path';
import type { RunOnceTranscriptLine } from '../pi/run-once.js';

export interface ParseTraceMeta {
  articleId: string;
  /** 工作区磁盘绝对路径（留痕落 {ws}/dogear/articles/.history/） */
  workspacePath: string;
  url: string;
  platform: string | null;
  trigger: string;
  durationMs: number;
  articleSaved: boolean;
  scriptUpdated: string | null;
  statusLabel: string;
  error?: string;
  model?: string;
}

const TRIGGER_LABELS: Record<string, string> = {
  script_failed: '脚本失败兜底',
  parse_failed: '解析失败兜底',
  user_requested: '手动解析',
};

const pad = (n: number) => String(n).padStart(2, '0');

function fileStamp(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function wallTime(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function formatParseTraceMd(meta: ParseTraceMeta, transcript: RunOnceTranscriptLine[] | undefined): string {
  const lines: string[] = [
    `# 文章解析留痕 · ${TRIGGER_LABELS[meta.trigger] ?? meta.trigger} · ${meta.statusLabel}`,
    '',
    `- 时间：${wallTime(new Date())}`,
    `- 文章：${meta.articleId}`,
    `- URL：${meta.url}`,
    `- 平台：${meta.platform ?? '通用'}`,
    ...(meta.model ? [`- 模型：${meta.model}`] : []),
    `- 耗时：${Math.round(meta.durationMs / 1000)} 秒`,
    `- 文章已保存：${meta.articleSaved ? '是' : '否'}`,
    `- 平台脚本更新：${meta.scriptUpdated ?? '无'}`,
    ...(meta.error ? [`- 错误：${meta.error}`] : []),
    '',
    '## 消息流水',
    '',
  ];
  if (!transcript?.length) {
    lines.push('（无消息记录）');
    return lines.join('\n');
  }
  for (const t of transcript) {
    if (t.role === 'user' || t.role === 'assistant') {
      lines.push(`### ${t.role}`, '', t.text, '');
    } else if (t.role === 'toolCall') {
      lines.push(`### 工具调用 ${t.text}`, '', '```json', t.detail ?? '{}', '```', '');
    } else {
      lines.push(`### 工具结果 ${t.text}${t.isError ? '（出错）' : ''}`, '', '```', t.detail ?? '', '```', '');
    }
  }
  return lines.join('\n');
}

/**
 * 解析留痕落盘 {workspacePath}/dogear/articles/.history/run-<stamp>-<articleId8>.md（.history 为隐藏段，树/watcher/搜索均天然跳过）。
 * 返回工作区相对路径；写失败返回 null（不影响任务）。
 */
export async function writeParseTrace(meta: ParseTraceMeta, transcript: RunOnceTranscriptLine[] | undefined): Promise<string | null> {
  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    const historyDir = path.join(meta.workspacePath, 'dogear', 'articles', '.history');
    await fs.mkdir(historyDir, { recursive: true });
    const fileName = `run-${fileStamp(new Date())}-${meta.articleId.slice(0, 8)}.md`;
    await fs.writeFile(path.join(historyDir, fileName), formatParseTraceMd(meta, transcript), 'utf-8');
    return `dogear/articles/.history/${fileName}`;
  } catch {
    return null;
  }
}
