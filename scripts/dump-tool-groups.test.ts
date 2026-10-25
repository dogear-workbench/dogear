import { describe, expect, mock, test } from 'bun:test';
import fsp from 'node:fs/promises';
import path from 'path';
import { tmpdir } from 'node:os';

process.env.DOGEAR_CONFIG_DIR = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-dump-tool-groups-'));

mock.module('electron', () => ({
  default: { app: { getPath: () => tmpdir(), on: () => {} }, nativeTheme: {} },
  app: { getPath: () => tmpdir(), on: () => {}, once: () => {} },
  nativeTheme: {},
  shell: { openExternal: () => {} },
  session: {},
  BrowserWindow: class {},
  Tray: class {},
  nativeImage: {},
  Notification: class {},
  ipcMain: { handle: () => {}, on: () => {} },
  ipcRenderer: { send: () => {}, on: () => {} },
}));

const TOOLS_DIR = '../electron/main/agents/tools';

const TOOL_MODULES = [
  'memory-tools',
  'skill-tools',
  'article-tools',
  'extension-tools',
  'stock-tools',
  'stock-analysis-tools',
  'stock-announcement-tools',
  'stock-picking-tools',
  'web-mcp-tools',
  'group-tools',
  'delegation-tools',
  'reference-tools',
];

const STOCK_ANALYSIS_ORDER = [
  'dogear__CalcIndicators',
  'dogear__DetectSignals',
  'dogear__ScreenStocks',
  'dogear__GetFinancials',
  'dogear__EvalFormula',
  'dogear__SimpleBacktest',
  'dogear__ListIndustries',
  'dogear__CompareIndustry',
  'dogear__GetFundFlow',
  'dogear__GetNorthboundHolding',
];

describe('getAllToolGroups dump', () => {
  test('dump 全部工具组 JSON 到指定文件', async () => {
    for (const m of TOOL_MODULES) {
      await import(`${TOOLS_DIR}/${m}.js`);
    }
    const { getAllToolGroups } = await import(`${TOOLS_DIR}/tool-registry.js`);
    const groups = getAllToolGroups();

    console.log('[dump] 工具组:', groups.map((g) => `${g.server}(${g.label}): ${g.tools.length}`).join(', '));

    expect(groups.length).toBeGreaterThan(0);
    const stock = groups.find((g) => g.server === 'dogear-stock-analysis');
    expect(stock).toBeDefined();
    expect(stock!.tools.map((t) => t.name)).toEqual(STOCK_ANALYSIS_ORDER);
    for (const g of groups) {
      expect(g.tools.length, `工具组 ${g.server} tools 为空（工厂异常被吞）`).toBeGreaterThan(0);
    }

    const outName = process.env.DOGEAR_DUMP_OUT
      ?? path.join(await fsp.mkdtemp(path.join(tmpdir(), 'dogear-dump-')), 'tool-groups.json');
    const out = path.isAbsolute(outName) ? outName : path.join(import.meta.dir, outName);
    await fsp.writeFile(out, JSON.stringify(groups, null, 2) + '\n', 'utf8');
    console.log('[dump] 已写入', out);
  });
});
