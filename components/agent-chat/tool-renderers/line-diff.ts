export type DiffLineType = 'context' | 'add' | 'remove';

export interface DiffLine {
  type: DiffLineType;
  text: string;
}

export interface InlineDiff {
  head: string;
  oldMid: string;
  newMid: string;
  tail: string;
}

export interface DiffSegment {
  text: string;
  highlight: boolean;
}

export interface DiffRow {
  type: DiffLineType;
  segments: DiffSegment[];
}

const MAX_DIFF_LINES = 500;
const MAX_INLINE_CHARS = 10_000;

export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function diffLines(oldText: string, newText: string): DiffLine[] | null {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const m = a.length;
  const n = b.length;
  if (m + n > MAX_DIFF_LINES) return null;
  if (m === 0) return b.map((text) => ({ type: 'add' as const, text }));
  if (n === 0) return a.map((text) => ({ type: 'remove' as const, text }));

  const dp: Uint32Array[] = [];
  for (let i = 0; i <= m; i++) dp.push(new Uint32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    const row = dp[i];
    const next = dp[i + 1];
    for (let j = n - 1; j >= 0; j--) {
      row[j] = a[i] === b[j] ? next[j + 1] + 1 : Math.max(next[j], row[j + 1]);
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      result.push({ type: 'context', text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      result.push({ type: 'remove', text: a[i] });
      i++;
    } else {
      result.push({ type: 'add', text: b[j] });
      j++;
    }
  }
  while (i < m) result.push({ type: 'remove', text: a[i++] });
  while (j < n) result.push({ type: 'add', text: b[j++] });
  return result;
}

export function inlineDiff(oldLine: string, newLine: string): InlineDiff {
  const minLen = Math.min(oldLine.length, newLine.length);
  let start = 0;
  while (start < minLen && oldLine[start] === newLine[start]) start++;
  let endOld = oldLine.length;
  let endNew = newLine.length;
  while (endOld > start && endNew > start && oldLine[endOld - 1] === newLine[endNew - 1]) {
    endOld--;
    endNew--;
  }
  return {
    head: oldLine.slice(0, start),
    oldMid: oldLine.slice(start, endOld),
    newMid: newLine.slice(start, endNew),
    tail: oldLine.slice(endOld),
  };
}

export function buildDiffRows(oldText: string, newText: string): DiffRow[] | null {
  const lines = diffLines(oldText, newText);
  if (!lines) return null;

  const rows: DiffRow[] = [];
  let idx = 0;
  while (idx < lines.length) {
    const line = lines[idx];
    if (line.type !== 'remove') {
      rows.push(toRow(line));
      idx++;
      continue;
    }
    const removes: DiffLine[] = [];
    while (idx < lines.length && lines[idx].type === 'remove') removes.push(lines[idx++]);
    const adds: DiffLine[] = [];
    while (idx < lines.length && lines[idx].type === 'add') adds.push(lines[idx++]);
    const pairCount = Math.min(removes.length, adds.length);
    for (let k = 0; k < pairCount; k++) {
      const inline =
        removes[k].text.length <= MAX_INLINE_CHARS && adds[k].text.length <= MAX_INLINE_CHARS
          ? inlineDiff(removes[k].text, adds[k].text)
          : null;
      rows.push(toInlineRow('remove', removes[k].text, inline?.head, inline?.oldMid, inline?.tail));
      rows.push(toInlineRow('add', adds[k].text, inline?.head, inline?.newMid, inline?.tail));
    }
    for (let k = pairCount; k < removes.length; k++) rows.push(toRow(removes[k]));
    for (let k = pairCount; k < adds.length; k++) rows.push(toRow(adds[k]));
  }
  return rows;
}

function toRow(line: DiffLine): DiffRow {
  return { type: line.type, segments: [{ text: line.text, highlight: false }] };
}

function toInlineRow(
  type: DiffLineType,
  text: string,
  head?: string,
  mid?: string,
  tail?: string,
): DiffRow {
  if (!mid) return { type, segments: [{ text, highlight: false }] };
  const segments: DiffSegment[] = [];
  if (head) segments.push({ text: head, highlight: false });
  segments.push({ text: mid, highlight: true });
  if (tail) segments.push({ text: tail, highlight: false });
  return { type, segments };
}
