export interface FeishuCardJson {
  header?: { title: { tag: 'plain_text'; content: string } };
  config: { wide_screen_mode: boolean };
  elements: Array<{ tag: 'markdown'; content: string }>;
}

const CARD_TEXT_LIMIT = 4000;

export function markdownToCard(text: string, headerTitle?: string): FeishuCardJson[] {
  const normalized = downgradeTables(text.trim());
  if (!normalized) return [];
  return splitChunks(normalized, CARD_TEXT_LIMIT).map((content) => ({
    ...(headerTitle ? { header: { title: { tag: 'plain_text', content: headerTitle } } } : {}),
    config: { wide_screen_mode: true },
    elements: [{ tag: 'markdown', content }],
  }));
}

function downgradeTables(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (isTableRow(lines[i])) {
      const block: string[] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        block.push(lines[i]);
        i++;
      }
      const mono = renderMonospaceTable(block);
      if (mono) out.push(mono);
    } else {
      out.push(lines[i]);
      i++;
    }
  }
  return out.join('\n');
}

function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith('|') && t.length > 1;
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function renderMonospaceTable(block: string[]): string {
  const rows = block
    .map(splitTableRow)
    .filter((cells) => !cells.every((cell) => /^:?-+:?$/.test(cell)));
  if (rows.length === 0) return '';

  const colCount = Math.max(...rows.map((row) => row.length));
  const widths: number[] = [];
  for (let c = 0; c < colCount; c++) {
    widths.push(Math.max(...rows.map((row) => row[c]?.length ?? 0)));
  }

  const rendered = rows.map((cells) =>
    cells.map((cell, c) => cell.padEnd(widths[c])).join('  ').trimEnd(),
  );
  return ['```', ...rendered, '```'].join('\n');
}

function splitChunks(text: string, limit: number): string[] {
  const chunks: string[] = [];
  let current = '';
  let inCode = false;

  for (const rawLine of text.split('\n')) {
    for (const line of hardWrapLine(rawLine, limit)) {
      if (/^\s*```/.test(line.trim())) inCode = !inCode;
      let candidate = current ? `${current}\n${line}` : line;
      if (candidate.length > limit && current) {
        chunks.push(inCode ? `${current}\n\`\`\`` : current);
        current = inCode ? '```' : '';
        candidate = current ? `${current}\n${line}` : line;
      }
      current = candidate;
    }
  }

  if (current.trim()) {
    chunks.push(inCode ? `${current}\n\`\`\`` : current);
  }
  return chunks;
}

function hardWrapLine(line: string, limit: number): string[] {
  if (line.length <= limit) return [line];
  const parts: string[] = [];
  for (let i = 0; i < line.length; i += limit) {
    parts.push(line.slice(i, i + limit));
  }
  return parts;
}
