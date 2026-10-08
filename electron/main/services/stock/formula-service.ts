/**
 * 用户自定义公式存储服务
 * 存储路径：.dogear/stocks/formulas.json
 *
 * 公式类型:
 *   - screener: 筛选条件（布尔表达式）
 *   - signal:   信号判断（布尔表达式）
 *   - score:    评分公式（数值表达式）
 */
import path from 'path';
import { randomUUID } from 'crypto';
import electron from 'electron';
import { safeJsonWrite, safeJsonRead } from '../safe-json.js';

const { app } = electron;

// ============================================================
// 类型定义
// ============================================================

export type FormulaType = 'screener' | 'signal' | 'score';

export interface StockFormula {
  /** 唯一 ID */
  id: string;
  /** 公式名称 */
  name: string;
  /** 公式类型 */
  type: FormulaType;
  /** 公式表达式 */
  expression: string;
  /** 描述（可选） */
  description?: string;
  /** 是否内置（内置公式不可删除） */
  builtin?: boolean;
  /** 创建时间 ISO 8601 */
  createdAt: string;
  /** 更新时间 ISO 8601 */
  updatedAt: string;
}

interface FormulasFile {
  version: number;
  formulas: StockFormula[];
}

// ============================================================
// 内置模板
// ============================================================

const BUILTIN_TEMPLATES: StockFormula[] = [
  {
    id: 'builtin-value-pick',
    name: '价值精选',
    type: 'screener',
    expression: 'PE > 0 AND PE < 20 AND PB < 2 AND MARKET_CAP > 50',
    description: 'PE < 20，PB < 2，市值 > 50 亿，排除亏损股',
    builtin: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'builtin-macd-golden',
    name: 'MACD金叉信号',
    type: 'signal',
    expression: 'CROSS(MACD.DIF, MACD.DEA)',
    description: 'DIF 上穿 DEA（看多信号）',
    builtin: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'builtin-rsi-oversold',
    name: 'RSI超卖反弹',
    type: 'signal',
    expression: 'RSI(14) < 30 AND CLOSE > MA(CLOSE, 20)',
    description: 'RSI 低于 30 且价格高于 20 日均线',
    builtin: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'builtin-growth-score',
    name: '成长评分',
    type: 'score',
    expression: '(RSI(14) + KDJ.K) / 2',
    description: '基于 RSI 和 KDJ K 值的动量评分（0-100）',
    builtin: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

// ============================================================
// 服务实现
// ============================================================

function getConfigDir(): string {
  if (process.env.DOGEAR_CONFIG_DIR) return process.env.DOGEAR_CONFIG_DIR;
  if (app?.isPackaged) {
    return path.join(path.dirname(app.getPath('exe')), '.dogear');
  }
  return path.join(process.cwd(), '.dogear');
}

function getFormulasPath(): string {
  return path.join(getConfigDir(), 'stocks', 'formulas.json');
}

async function readFile(): Promise<FormulasFile> {
  const defaultFile: FormulasFile = { version: 1, formulas: [...BUILTIN_TEMPLATES] };
  const data = await safeJsonRead<FormulasFile>(getFormulasPath(), defaultFile);
  // 确保内置模板存在（idempotent 补丁）
  const existing = new Set(data.formulas.map((f) => f.id));
  for (const tmpl of BUILTIN_TEMPLATES) {
    if (!existing.has(tmpl.id)) {
      data.formulas.unshift(tmpl);
    }
  }
  return data;
}

async function writeFile(file: FormulasFile): Promise<void> {
  await safeJsonWrite(getFormulasPath(), file);
}

class FormulaService {
  async getAll(): Promise<StockFormula[]> {
    const file = await readFile();
    return file.formulas;
  }

  async getById(id: string): Promise<StockFormula | null> {
    const file = await readFile();
    return file.formulas.find((f) => f.id === id) ?? null;
  }

  async add(
    name: string,
    type: FormulaType,
    expression: string,
    description?: string,
  ): Promise<StockFormula> {
    const file = await readFile();
    const now = new Date().toISOString();
    const formula: StockFormula = {
      id: randomUUID(),
      name,
      type,
      expression,
      description,
      createdAt: now,
      updatedAt: now,
    };
    file.formulas.push(formula);
    await writeFile(file);
    return formula;
  }

  async update(
    id: string,
    patch: Partial<Pick<StockFormula, 'name' | 'expression' | 'description'>>,
  ): Promise<StockFormula | null> {
    const file = await readFile();
    const idx = file.formulas.findIndex((f) => f.id === id);
    if (idx === -1) return null;
    const formula = file.formulas[idx];
    if (formula.builtin) throw new Error('内置公式不可修改');
    file.formulas[idx] = { ...formula, ...patch, updatedAt: new Date().toISOString() };
    await writeFile(file);
    return file.formulas[idx];
  }

  async remove(id: string): Promise<boolean> {
    const file = await readFile();
    const idx = file.formulas.findIndex((f) => f.id === id);
    if (idx === -1) return false;
    if (file.formulas[idx].builtin) throw new Error('内置公式不可删除');
    file.formulas.splice(idx, 1);
    await writeFile(file);
    return true;
  }
}

export const formulaService = new FormulaService();
