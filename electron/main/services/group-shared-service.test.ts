import { describe, expect, mock, test } from 'bun:test';
import fsp from 'node:fs/promises';
import path from 'path';
import { tmpdir } from 'node:os';

process.env.DOGEAR_CONFIG_DIR = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-shared-pointer-'));

mock.module('electron', () => ({
  default: { app: { getPath: () => tmpdir(), on: () => {} }, nativeTheme: {} },
  app: { getPath: () => tmpdir(), on: () => {} },
  nativeTheme: {},
  ipcMain: { handle: () => {}, on: () => {} },
}));

const { prependSourcePointer, parseSourcePointer, writeNativeFile, readNativeFile } = await import('./group-shared-service.js');

const SID = '01a15696-dcd0-778a-a9eb-521127aedf02';
const pointerLine = (sid: string) => `<!-- source-session: ${sid} -->`;

describe('prependSourcePointer', () => {
  test('无指针内容前置指针行', () => {
    const out = prependSourcePointer('# 报告\n正文', SID);
    expect(out).toBe(`${pointerLine(SID)}\n# 报告\n正文`);
  });

  test('已带相同指针不重复加', () => {
    const content = `${pointerLine(SID)}\n# 报告\n正文`;
    expect(prependSourcePointer(content, SID)).toBe(content);
  });

  test('已带他人指针保留原指针不覆盖', () => {
    const content = `${pointerLine('other-session-id')}\n# 报告`;
    expect(prependSourcePointer(content, SID)).toBe(content);
    expect(parseSourcePointer(prependSourcePointer(content, SID))).toBe('other-session-id');
  });

  test('sessionId 为空原样返回', () => {
    expect(prependSourcePointer('# 报告', '')).toBe('# 报告');
  });
});

describe('parseSourcePointer', () => {
  test('首行指针正常解析', () => {
    expect(parseSourcePointer(`${pointerLine(SID)}\n# 报告\n正文`)).toBe(SID);
  });

  test('单行文件（指针后无换行）解析成功', () => {
    expect(parseSourcePointer(pointerLine(SID))).toBe(SID);
  });

  test('CRLF 容错', () => {
    expect(parseSourcePointer(`${pointerLine(SID)}\r\n# 报告`)).toBe(SID);
  });

  test('BOM 容错', () => {
    expect(parseSourcePointer(`\uFEFF${pointerLine(SID)}\n# 报告`)).toBe(SID);
  });

  test('指针不在首行返回 undefined', () => {
    expect(parseSourcePointer(`# 报告\n\n${pointerLine(SID)}\n正文`)).toBeUndefined();
  });

  test('无指针与空内容返回 undefined', () => {
    expect(parseSourcePointer('# 报告\n正文')).toBeUndefined();
    expect(parseSourcePointer('')).toBeUndefined();
  });

  test('注释形式不同（无空格/多余空格）仍解析，非注释格式不解析', () => {
    expect(parseSourcePointer(`<!--source-session:${SID}-->\n内容`)).toBe(SID);
    expect(parseSourcePointer(`<!--source-session: ${SID} -->\n内容`)).toBe(SID);
    expect(parseSourcePointer(`source-session: ${SID}\n内容`)).toBeUndefined();
  });
});

describe('写入/解析往返', () => {
  test('writeNativeFile 落盘带指针内容后 readNativeFile + parseSourcePointer 还原', async () => {
    const WS = 'ws-pointer-test';
    const gid = 'g-pointer';
    await writeNativeFile(WS, gid, 'notes/report.md', '# 报告\n检索预算拍板');
    const raw = await readNativeFile(WS, gid, 'notes/report.md');
    expect(parseSourcePointer(prependSourcePointer(raw, SID))).toBe(SID);
    expect(raw.startsWith('# 报告')).toBe(true);
  });
});
