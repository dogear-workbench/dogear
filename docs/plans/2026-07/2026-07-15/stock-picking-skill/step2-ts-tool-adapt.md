---
step: 2
title: TS 工具层适配
status: done
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

## 实施回填

### 实际改动

- `python/core/screener.py` — `screen_stocks()` return dict 顶层加 `"_source": df.attrs.get("_source")`（1 行）
- `electron/main/services/stock/python-bridge.ts`
  - 新增 `DataSourceExhaustedError extends Error`，带 `attempts: [string, string][]` 字段
  - `PythonResponse.error.code` 类型扩为 `number | string`，`error.data` 扩为 `{ attempts?: [string, string][] }`
  - `handleResponse()` 在有 error 时先判 `code === 'DATA_SOURCE_EXHAUSTED'`，命中就 reject `DataSourceExhaustedError`（带 attempts），否则走原有 `new Error(message)` 兜底
- `electron/main/agents/tools/stock-analysis-tools.ts`
  - 新增 `formatSourceBanner(source): string` 纯函数，放文件顶部辅助区
  - `ScreenStocks` 工具：正常路径读 `result._source` 拼 banner 到输出最前面（"无匹配"和"有结果"两个分支都拼）；catch 块新增 `error instanceof DataSourceExhaustedError` 分支，返回 `isError: true` + 明确文案

### 与计划的差异 / 现场决策

- 无实质差异，完全按计划实施
- `formatSourceBanner` 末尾自带 `\n\n`（含空行分隔），调用处直接 `output = banner + 正文` 即可，无需额外空行处理

### 验证

- `bun run lint` 通过（0 errors，83 个 pre-existing `no-explicit-any` warning 与本次无关）
- `bun run build:electron` 通过（tsc 无输出即成功）
- 端到端场景验证（临时改 raise 触发降级）**未做**——留给 Step 3 端到端 SOP 验证一次性覆盖

### 给下一步的接力棒（供 Step 3 SKILL.md）

- **异常抛出位置**：`python-bridge.ts:handleResponse` → 传播到 `ScreenStocks` 工具 → 返回 `isError: true` + 文案：
  ```
  候选池数据当前不可用（东财+新浪都不通，通常几小时后恢复）。

  尝试记录:
  - eastmoney: <错误摘要>
  - sina: <错误摘要>
  ```
  agent 看到这个 `isError` 时应**明确中止 SOP** 并如实告诉用户"数据源全挂了"，不要瞎编数据继续。

- **_source banner 文本模板**（Step 3 SKILL.md 举例用）：
  ```
  > ⚠️ 数据源：sina（东财不可达）
  > 备源字段可能不全（如 PE / 流通市值缺失），本次未按对应条件筛
  ```
  banner 出现在工具输出的**最上方**（前 3 行）；`_source` 为空或 `'eastmoney'` 时不显示。

- **ScreenStocks 工具签名未变**（`conditions` + `limit`），只是返回内容顶部可能多一个 banner 段，SOP 提示词不需要为参数变化调整。

- **其他工具未动**：CalcIndicators / DetectSignals / GetFinancials 等仍是「单只单维度挂了直接返回原始 error」，Step 3 提示词需要告诉 agent "深挖细节挂了要留白 + 统一列【数据缺口】表"（对应 plan 的三级错误处理约定）。
