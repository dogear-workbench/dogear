// 复盘回溯：从原始会话 JSONL 按 uuid 定位对话原文（纯解析层，无 IO / 无 SDK 依赖，可单测）
// uuid 来源与 transcript-cleaner 一致（原始 JSONL 行的 o.uuid，消息级）

const SYS_TAG_RE = /<(system-reminder|command-name|command-message|command-args|local-command-stdout|user-prompt-submit-hook)>[\s\S]*?<\/\1>/g;

export interface TracedMessage {
  uuid: string;
  role: 'user' | 'assistant';
  text: string;
}

function extractAssistantText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter(
      (b): b is { type: 'text'; text: string } =>
        !!b && typeof b === 'object' && (b as any).type === 'text' && typeof (b as any).text === 'string',
    )
    .map((b) => b.text.trim())
    .filter(Boolean)
    .join('\n');
}

/** 从 JSONL 行提取真实对话消息（与 transcript-cleaner 同口径过滤） */
export function extractDialogue(lines: string[]): TracedMessage[] {
  const out: TracedMessage[] = [];
  for (const raw of lines) {
    if (!raw.trim()) continue;
    let o: any;
    try { o = JSON.parse(raw); } catch { continue; }
    const t = o?.type;
    if (t !== 'user' && t !== 'assistant') continue;
    if (o.isSidechain === true || o.isMeta === true) continue;
    const uuid = o.uuid;
    if (!uuid) continue;
    const content = o.message?.content;
    if (t === 'user') {
      if (typeof content !== 'string') continue; // 工具结果数组 → 跳过
      const text = content.replace(SYS_TAG_RE, '').trim();
      if (!text) continue;
      out.push({ uuid, role: 'user', text });
    } else {
      const text = extractAssistantText(content);
      if (!text) continue;
      out.push({ uuid, role: 'assistant', text });
    }
  }
  return out;
}

/** 按 uuid 在对话流中定位，返回前后 contextWindow 条对话 */
export function traceSourceFromLines(
  lines: string[], targetUuid: string, contextWindow = 2,
): { found: boolean; messages: TracedMessage[] } {
  const dialogue = extractDialogue(lines);
  const idx = dialogue.findIndex((m) => m.uuid === targetUuid);
  if (idx < 0) return { found: false, messages: [] };
  const start = Math.max(0, idx - contextWindow);
  const end = Math.min(dialogue.length, idx + contextWindow + 1);
  return { found: true, messages: dialogue.slice(start, end) };
}
