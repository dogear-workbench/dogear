---
step: 2
title: TS 工具层适配
status: pending
---

## 目标

改造 `electron/main/agents/tools/stock-analysis-tools.ts:ScreenStocks`：
1. 捕获 Step 1 抛出的 `DATA_SOURCE_EXHAUSTED` 结构化 error → 返回 `isError: true` + 明确文案让 agent 中止 SOP
2. 正常路径把 `_source` 元信息传到工具返回的 markdown 顶部，让 agent 一眼看到"走了备源"

做完后 `bun run build:electron` 通过，dogear 里手动调 `ScreenStocks` 能验证两条路径的输出符合预期。

## 依赖上下文（接力棒输入）

从 Step 1 接过来的关键契约：
- `python/main.py` 双源全挂时返回：`{ "error": { "code": "DATA_SOURCE_EXHAUSTED", "message": "...", "data": { "attempts": [[name, msg], ...] } } }`
- 正常返回的 DataFrame 有 `attrs._source = 'eastmoney' | 'sina' | 'ths' | ...`——**需要在 python-bridge 层把 attrs 序列化进 JSON-RPC response**（Step 1 完成时确认怎么传）

**Step 1 完成后回填**：`_source` 字段在 JSON-RPC response 里的具体位置（是 `result._source` 顶层字段？还是 `result.data._source`？还是每个 DataFrame 对象里？）

现有相关文件：
- `electron/main/services/stock/python-bridge.ts` — JSON-RPC 通信封装，看是否需要加 error code 分发
- `electron/main/agents/tools/stock-analysis-tools.ts:ScreenStocks` — 待改造工具

## 计划改动

### `electron/main/services/stock/python-bridge.ts`

- [ ] 如果 JSON-RPC error 有 `code === 'DATA_SOURCE_EXHAUSTED'`，抛一个可辨识的 TS 错误类（比如 `class DataSourceExhaustedError extends Error`，带 `attempts` 字段），供上层工具捕获；其他 error 保持现有兜底
- [ ] 确认 `_source` 字段从 python 层能拿到（Step 1 回填后再定实现细节）

### `electron/main/agents/tools/stock-analysis-tools.ts:ScreenStocks`

- [ ] 用 `try/catch` 包住 python-bridge 调用
- [ ] 捕获 `DataSourceExhaustedError`：
  ```ts
  return {
    isError: true,
    content: [{
      type: 'text',
      text: '候选池数据当前不可用（东财+新浪都不通，通常几小时后恢复）。\n\n尝试记录:\n' + attempts.map(([n, m]) => `- ${n}: ${m}`).join('\n')
    }]
  }
  ```
- [ ] 正常路径：读 `_source`，如果不是主源，在 markdown 输出顶部加：
  ```markdown
  > ⚠️ 数据源：${_source}（东财不可达）
  > 备源字段可能不全（如 PE / 流通市值缺失），本次未按对应条件筛
  ```
  用一个 `formatSourceBanner(_source)` 纯函数封装，方便复用/单测（不写单测，但纯函数便于验证）

### `electron/main/agents/tools/stock-analysis-tools.ts` 其他工具

- [ ] 本 step **只改 `ScreenStocks`**——其他工具（CalcIndicators / DetectSignals / GetFinancials 等）暂不加降级处理，属于三级失败（单只单维度挂了跳过），由 SKILL.md 提示词教 agent 处理

## 验证方式

1. `bun run build:electron` 通过（TypeScript 类型 + lint）
2. `bun run dev` 起来后，在 debug 或 agent-chat 页面手动触发 ScreenStocks：
   - 正常场景：不显式改任何东西，跑一次条件筛选，看 markdown 输出正常
   - 降级场景：临时把 `python/utils/akshare_client.py` 里 `get_all_a_stocks` 的主源 lambda 改成 raise，触发走备源，看输出顶部是否有降级 banner
   - 全挂场景：把主备源都 raise，看工具返回是不是 `isError: true` 且文案清晰
3. 验证完把临时 raise 改回来

## 边界情况

- **JSON-RPC error 兜底**：如果 python 抛的不是 `DATA_SOURCE_EXHAUSTED` 而是别的（比如 rate limit 触发的 Exception），保持现有兜底（返回原始 error message），不要吞掉当 DataSourceExhausted 处理
- **`_source` 缺失时的行为**：如果 `_source` 是 undefined（比如 cache 命中丢了 attrs），假设是主源，不显示 banner（宁可漏报也不误报——误报会误导用户认为主源挂了）
- **markdown 顶部 banner 的位置**：放在 markdown 正文最上方 + 一个空行分隔，agent 引用工具输出到用户回复里时容易带上；不要放在最下方（易被忽略）

## 实施回填（做完后填）

### 实际改动

（与计划差异、改动文件清单、python-bridge 的具体改动方式）

### 给下一步的接力棒

- `DataSourceExhaustedError` 的抛出位置和文案格式（供 Step 3 SKILL.md 提示词描述"agent 遇到这个错误该怎么办"）
- `_source` banner 在工具 markdown 输出里的具体文本模板（供 Step 3 SKILL.md 举例）
- ScreenStocks 工具签名是否有变化（参数名/返回结构）
