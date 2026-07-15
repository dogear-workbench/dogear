---
step: 4
title: 分钟级 K 线
status: pending
---

## 目标
扩展 K 线工具支持 1/5/15/30/60 分钟周期，新增日内分时（含买卖盘性质）。

## 依赖上下文（接力棒输入）
- 现有 `akshare_client.py:353` 的 `get_stock_hist` 只支持 `daily/weekly/monthly`
- 现有 `stock-analysis-tools.ts` 的 GetKLineData 工具 period schema 是 `enum: ["daily", "weekly", "monthly"]`
- TS 层 `stock-service.ts` 已经用东方财富 HTTP API 做分钟 K（前端 KLineChart 已能用），Python 层是补充
- AKShare 限制：`stock_zh_a_hist_min_em` 的 1 分钟数据只返回近 5 个交易日且不复权

## 计划改动
- [ ] `akshare_client.py` 新增 2 个方法：
  - `get_stock_hist_min(symbol: str, period: str, start_date: str, end_date: str, adjust: str) -> pd.DataFrame` → `ak.stock_zh_a_hist_min_em(...)`，period 枚举 `"1"|"5"|"15"|"30"|"60"`
  - `get_intraday_tick(symbol: str) -> pd.DataFrame` → `ak.stock_intraday_em(symbol)`，返回日内逐笔（时间/成交价/手数/买卖盘性质）
- [ ] `core/indicators.py` 检查分钟级语义：
  - MACD/KDJ/RSI/BOLL：分钟级仍有效
  - OBV：分钟级语义变化，加注释说明
  - VWAP：已经是累计近似，分钟级精度更高但仍非盘中真实值
- [ ] `python-bridge.ts` 改 `akshare.getKLine` 协议：period 枚举增加 `"1"|"5"|"15"|"30"|"60"`；新增 `akshare.getIntradayTick`
- [ ] `stock-analysis-tools.ts` 改 GetKLineData 的 period schema 接受 minute 值；新增 GetIntradayTick 工具
- [ ] 缓存策略：分钟 K 30s（盘中变动快），日内分时 60s
- [ ] 注意：1 分钟数据复权参数被 AKShare 忽略（接口强制不复权），描述里写明

## 验证标准
- 调用 GetKLineData `{symbol: "600519", period: "5"}` 返回 5 分钟 K 线
- 调用 GetIntradayTick `{symbol: "600519"}` 返回当日逐笔数据
- 调用 CalcIndicators 配合分钟 K，MACD 不报错

## 实施回填

### 实际改动
（执行后填）

### 给下一步的接力棒
- 分钟 K 缓存 30s，比日 K 短
- 给 Step 5 的提示：财务数据是另一类（按报告期，不是按交易日），新建 statements.py
