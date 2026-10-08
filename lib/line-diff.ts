// lib/line-diff.ts - 纯文本行级 diff（LCS + 公共前后缀裁剪），历史面板用
export interface DiffRow {
  type: 'same' | 'add' | 'del';
  text: string;
  oldNo: number | null;
  newNo: number | null;
}

export interface DiffStats {
  added: number;
  removed: number;
}

export interface DiffFold {
  kind: 'fold';
  count: number;
  rows: DiffRow[];
}

export type HunkSection = DiffRow | DiffFold;

export function buildHunks(rows: DiffRow[], contextLines = 3): HunkSection[] {
  const n = rows.length;
  const keep = new Array<boolean>(n).fill(false);
  for (let i = 0; i < n; i++) {
    if (rows[i].type !== 'same') {
      for (let k = Math.max(0, i - contextLines); k <= Math.min(n - 1, i + contextLines); k++) {
        keep[k] = true;
      }
    }
  }
  const sections: HunkSection[] = [];
  let foldStart = -1;
  for (let i = 0; i <= n; i++) {
    if (i < n && rows[i].type === 'same' && !keep[i]) {
      if (foldStart < 0) foldStart = i;
    } else {
      if (foldStart >= 0) {
        sections.push({ kind: 'fold', count: i - foldStart, rows: rows.slice(foldStart, i) });
        foldStart = -1;
      }
      if (i < n) sections.push(rows[i]);
    }
  }
  return sections;
}

const MAX_DIFF_LINES = 20000;

export function diffLines(oldText: string, newText: string): { rows: DiffRow[]; stats: DiffStats } | null {
  const oldAll = oldText.split('\n');
  const newAll = newText.split('\n');
  if (oldAll.length > MAX_DIFF_LINES || newAll.length > MAX_DIFF_LINES) return null;

  let start = 0;
  while (start < oldAll.length && start < newAll.length && oldAll[start] === newAll[start]) start++;
  let endOld = oldAll.length;
  let endNew = newAll.length;
  while (endOld > start && endNew > start && oldAll[endOld - 1] === newAll[endNew - 1]) {
    endOld--;
    endNew--;
  }

  const oldMid = oldAll.slice(start, endOld);
  const newMid = newAll.slice(start, endNew);
  const n = oldMid.length;
  const m = newMid.length;

  const rows: DiffRow[] = [];
  for (let i = 0; i < start; i++) {
    rows.push({ type: 'same', text: oldAll[i], oldNo: i + 1, newNo: i + 1 });
  }

  // dp[i][j] = oldMid[i:] 与 newMid[j:] 的 LCS 长度
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = oldMid[i] === newMid[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  let oldNo = start;
  let newNo = start;
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldMid[i] === newMid[j]) {
      rows.push({ type: 'same', text: oldMid[i], oldNo: ++oldNo, newNo: ++newNo });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ type: 'del', text: oldMid[i], oldNo: ++oldNo, newNo: null });
      i++;
    } else {
      rows.push({ type: 'add', text: newMid[j], oldNo: null, newNo: ++newNo });
      j++;
    }
  }
  while (i < n) {
    rows.push({ type: 'del', text: oldMid[i], oldNo: ++oldNo, newNo: null });
    i++;
  }
  while (j < m) {
    rows.push({ type: 'add', text: newMid[j], oldNo: null, newNo: ++newNo });
    j++;
  }
  for (let s = 0; s < oldAll.length - endOld; s++) {
    rows.push({ type: 'same', text: oldAll[endOld + s], oldNo: endOld + s + 1, newNo: endNew + s + 1 });
  }

  let added = 0;
  let removed = 0;
  for (const row of rows) {
    if (row.type === 'add') added++;
    if (row.type === 'del') removed++;
  }
  return { rows, stats: { added, removed } };
}
