import { test, expect } from 'bun:test';
import path from 'node:path';
import { cleanTranscriptFromLines } from './transcript-cleaner.ts';

const FIX = path.join(import.meta.dir, '__fixtures__', 'sample-session.jsonl');

test('丢弃 envelope / tool_result / thinking / isMeta / sidechain', async () => {
  const lines = (await Bun.file(FIX).text()).split('\n').filter(Boolean);
  const t = cleanTranscriptFromLines('sess-1', lines, 30452, 1000);
  expect(t.transcript).not.toContain('tool_result');
  expect(t.transcript).not.toContain('custom-title');
  expect(t.transcript).not.toContain('"thinking"');
  expect(t.transcript).not.toContain('ISMETA_MARKER_SHOULD_BE_DROPPED');
  // 工具骨架保留为一行 [工具名 ...]
  expect(t.transcript).toMatch(/\[(Read|Edit|Bash|Grep|Skill)\b/);
  // 保留完整 uuid（36 位含连字符）
  expect(t.transcript).toMatch(/· [0-9a-f]{8}-[0-9a-f]{4}-/);
  expect(t.turnCount).toBeGreaterThan(0);
  expect(t.stats.ratio).toBeGreaterThan(3); // 至少 3x 压缩
});

test('user 字符串里的系统标签被剥离', () => {
  const line = JSON.stringify({
    type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:00Z',
    message: { role: 'user', content: '<command-name>/foo</command-name>真问题' },
  });
  const t = cleanTranscriptFromLines('s', [line], 10, 1);
  expect(t.transcript).toContain('真问题');
  expect(t.transcript).not.toContain('command-name');
});

test('纯系统行剥完为空则整条丢弃', () => {
  const line = JSON.stringify({
    type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:00Z',
    message: { role: 'user', content: '<system-reminder>x</system-reminder>' },
  });
  const t = cleanTranscriptFromLines('s', [line], 10, 1);
  expect(t.turnCount).toBe(0);
});
