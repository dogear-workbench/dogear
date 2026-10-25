/**
 * 股票分析 MCP Server 工具
 *
 * 依赖 Python Bridge 进行计算，与基础股票工具（dogear-stock）分离。
 * Python 不可用时不影响基础行情查询功能。
 *
 * Phase 1 工具清单：
 *   - dogear__CalcIndicators — 计算技术指标（MACD/KDJ/RSI/BOLL/MA 等）
 *
 * 后续 Phase 追加：
 *   - dogear__ScreenStocks / dogear__GetFinancials / dogear__CompareIndustry / dogear__DetectSignals / dogear__EvalFormula / dogear__SimpleBacktest
 */
import { registerToolGroup } from './tool-registry.js';
import type { ToolDef } from '../pi/tool-adapter.js';
import { createIndicatorToolDefs } from './stock-indicator-tools.js';
import { createQuantToolDefs } from './stock-quant-tools.js';
import { createCapitalFlowToolDefs } from './stock-capital-flow-tools.js';

// ============================================================
// 聚合工厂（保持单工厂入口，注册与引用方无感）
// ============================================================

export function createStockAnalysisToolDefs(): ToolDef[] {
  return [
    ...createIndicatorToolDefs(),
    ...createQuantToolDefs(),
    ...createCapitalFlowToolDefs(),
  ];
}

registerToolGroup({
  server: 'dogear-stock-analysis',
  label: '股票分析',
  create: createStockAnalysisToolDefs,
});
