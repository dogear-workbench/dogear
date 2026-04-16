# Phase 1 实施文档：Python Bridge + 技术指标计算

> 依赖设计文档：`2026-04-15-stock-analysis-system-design.md`

## 目标

建立 Python 计算层基础设施，让 AI Agent 能够调用技术指标计算工具。完成后 AI 可以执行：
```
"帮我算一下贵州茅台的 MACD 和 RSI" → CalcIndicators 工具 → 精确数值
```

## 交付物

| 文件 | 类型 | 说明 |
|------|------|------|
| `python/main.py` | 新建 | Python JSON-RPC 守护进程入口 |
| `python/requirements.txt` | 新建 | Python 依赖声明 |
| `python/core/__init__.py` | 新建 | 包初始化 |
| `python/core/protocol.py` | 新建 | JSON-RPC 协议处理 |
| `python/core/indicators.py` | 新建 | 10 个技术指标计算实现 |
| `python/utils/__init__.py` | 新建 | 包初始化 |
| `python/utils/cache.py` | 新建 | TTL 内存缓存 |
| `electron/main/services/stock/python-bridge.ts` | 新建 | Python 进程管理服务 |
| `electron/main/agents/tools/stock-analysis-tools.ts` | 新建 | CalcIndicators Agent 工具 |
| `electron/main/tipc/stock.ts` | 修改 | 新增指标计算 IPC 路由 |
| `electron/main/tipc/index.ts` | 无需修改 | stock 路由已注册，新路由加在 stockRouter 内 |
| `electron/main/services/stock/index.ts` | 修改 | 导出 pythonBridge |
| `electron/main/services/conversation-runtime-service.ts` | 修改 | 注册新 MCP Server |
| `electron/main/agents/tools/tool-registry.ts` | 修改 | 新增 category |

---

## 步骤 1：Python 层 — 项目结构 + 依赖

### 1.1 创建目录结构

```
python/
├── main.py
├── requirements.txt
├── core/
│   ├── __init__.py
│   ├── protocol.py
│   └── indicators.py
└── utils/
    ├── __init__.py
    └── cache.py
```

### 1.2 `python/requirements.txt`

```
pandas>=2.0
numpy>=1.24
```

> 注意：Phase 1 不需要 akshare 和 lark，这两个在 Phase 2 和 Phase 3 才引入。只装最小依赖。

---

## 步骤 2：Python 层 — JSON-RPC 协议

### 2.1 `python/core/protocol.py`

职责：封装 stdin/stdout 的 NDJSON 通信协议。

```python
"""
JSON-RPC-like protocol over stdin/stdout (NDJSON).

Request format:  {"id": "xxx", "method": "method_name", "params": {...}}
Response format: {"id": "xxx", "result": {...}}
Error format:    {"id": "xxx", "error": {"code": -1, "message": "..."}}
Progress format: {"id": "xxx", "progress": {"current": N, "total": M, "message": "..."}}
"""

import sys
import json

def read_request() -> dict | None:
    """从 stdin 读取一行 JSON 请求。EOF 时返回 None。"""
    line = sys.stdin.readline()
    if not line:
        return None
    return json.loads(line.strip())

def send_response(request_id: str, result: any):
    """发送成功响应到 stdout。"""
    msg = json.dumps({"id": request_id, "result": result}, ensure_ascii=False)
    sys.stdout.write(msg + "\n")
    sys.stdout.flush()

def send_error(request_id: str, code: int, message: str):
    """发送错误响应到 stdout。"""
    msg = json.dumps({"id": request_id, "error": {"code": code, "message": message}}, ensure_ascii=False)
    sys.stdout.write(msg + "\n")
    sys.stdout.flush()

def send_progress(request_id: str, current: int, total: int, message: str = ""):
    """发送进度更新到 stdout。"""
    msg = json.dumps({
        "id": request_id,
        "progress": {"current": current, "total": total, "message": message}
    }, ensure_ascii=False)
    sys.stdout.write(msg + "\n")
    sys.stdout.flush()
```

---

## 步骤 3：Python 层 — 技术指标计算

### 3.1 `python/core/indicators.py`

职责：10 个技术指标的纯计算函数，输入 K 线数据（list of dict），输出指标值。

所有函数签名统一：
```python
def calc_xxx(kline: list[dict], **params) -> dict
```

**内置指标实现清单：**

```python
"""
技术指标计算引擎

所有函数接收 K 线数据（list of dict，每个 dict 包含 date/open/close/high/low/volume/turnover），
返回计算结果 dict。

使用 pandas DataFrame 进行向量化计算，性能优于逐行遍历。
"""

import pandas as pd
import numpy as np


def _to_df(kline: list[dict]) -> pd.DataFrame:
    """将 K 线数据列表转为 DataFrame，确保数值类型正确。"""
    df = pd.DataFrame(kline)
    for col in ['open', 'close', 'high', 'low', 'volume', 'turnover']:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')
    return df


def calc_ma(kline: list[dict], periods: list[int] = None) -> dict:
    """
    简单移动均线 (SMA)
    
    params:
        periods: 均线周期列表，默认 [5, 10, 20, 60]
    
    returns:
        {"MA5": [...], "MA10": [...], ...}
        每个数组长度与 kline 相同，前 N-1 个值为 None
    """
    if periods is None:
        periods = [5, 10, 20, 60]
    df = _to_df(kline)
    result = {}
    for p in periods:
        ma = df['close'].rolling(window=p).mean()
        result[f"MA{p}"] = [None if pd.isna(v) else round(v, 4) for v in ma]
    return result


def calc_ema(kline: list[dict], periods: list[int] = None) -> dict:
    """
    指数移动均线 (EMA)
    
    params:
        periods: 均线周期列表，默认 [12, 26]
    
    returns:
        {"EMA12": [...], "EMA26": [...]}
    """
    if periods is None:
        periods = [12, 26]
    df = _to_df(kline)
    result = {}
    for p in periods:
        ema = df['close'].ewm(span=p, adjust=False).mean()
        result[f"EMA{p}"] = [None if pd.isna(v) else round(v, 4) for v in ema]
    return result


def calc_macd(kline: list[dict], fast: int = 12, slow: int = 26, signal: int = 9) -> dict:
    """
    MACD (Moving Average Convergence Divergence)
    
    params:
        fast: 快线周期，默认 12
        slow: 慢线周期，默认 26
        signal: 信号线周期，默认 9
    
    returns:
        {
            "DIF": [...],   # 快线 - 慢线
            "DEA": [...],   # DIF 的 EMA
            "MACD": [...]   # (DIF - DEA) * 2，即柱状图
        }
    """
    df = _to_df(kline)
    ema_fast = df['close'].ewm(span=fast, adjust=False).mean()
    ema_slow = df['close'].ewm(span=slow, adjust=False).mean()
    dif = ema_fast - ema_slow
    dea = dif.ewm(span=signal, adjust=False).mean()
    macd_hist = (dif - dea) * 2

    def to_list(s):
        return [None if pd.isna(v) else round(v, 4) for v in s]

    return {
        "DIF": to_list(dif),
        "DEA": to_list(dea),
        "MACD": to_list(macd_hist),
    }


def calc_kdj(kline: list[dict], n: int = 9, m1: int = 3, m2: int = 3) -> dict:
    """
    KDJ 随机指标
    
    params:
        n: RSV 周期，默认 9
        m1: K 值平滑因子，默认 3
        m2: D 值平滑因子，默认 3
    
    returns:
        {"K": [...], "D": [...], "J": [...]}
    """
    df = _to_df(kline)
    low_n = df['low'].rolling(window=n).min()
    high_n = df['high'].rolling(window=n).max()
    
    rsv = (df['close'] - low_n) / (high_n - low_n) * 100
    rsv = rsv.fillna(50)  # 初始值设为 50

    k = pd.Series(index=df.index, dtype=float)
    d = pd.Series(index=df.index, dtype=float)
    k.iloc[0] = 50
    d.iloc[0] = 50

    for i in range(1, len(df)):
        k.iloc[i] = (2 / m1) * rsv.iloc[i] + (1 - 2 / m1) * k.iloc[i - 1]
        d.iloc[i] = (2 / m2) * k.iloc[i] + (1 - 2 / m2) * d.iloc[i - 1]

    j = 3 * k - 2 * d

    def to_list(s):
        return [None if pd.isna(v) else round(v, 2) for v in s]

    return {"K": to_list(k), "D": to_list(d), "J": to_list(j)}


def calc_rsi(kline: list[dict], period: int = 14) -> dict:
    """
    RSI (Relative Strength Index)
    
    params:
        period: 计算周期，默认 14
    
    returns:
        {"RSI": [...]}
    """
    df = _to_df(kline)
    delta = df['close'].diff()
    gain = delta.where(delta > 0, 0.0)
    loss = (-delta).where(delta < 0, 0.0)

    avg_gain = gain.ewm(alpha=1/period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1/period, min_periods=period, adjust=False).mean()

    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))

    return {"RSI": [None if pd.isna(v) else round(v, 2) for v in rsi]}


def calc_boll(kline: list[dict], period: int = 20, width: float = 2.0) -> dict:
    """
    布林带 (Bollinger Bands)
    
    params:
        period: 中轨周期，默认 20
        width: 带宽倍数，默认 2.0
    
    returns:
        {"UPPER": [...], "MID": [...], "LOWER": [...]}
    """
    df = _to_df(kline)
    mid = df['close'].rolling(window=period).mean()
    std = df['close'].rolling(window=period).std()
    upper = mid + width * std
    lower = mid - width * std

    def to_list(s):
        return [None if pd.isna(v) else round(v, 4) for v in s]

    return {"UPPER": to_list(upper), "MID": to_list(mid), "LOWER": to_list(lower)}


def calc_wr(kline: list[dict], period: int = 14) -> dict:
    """
    威廉指标 (Williams %R)
    
    params:
        period: 计算周期，默认 14
    
    returns:
        {"WR": [...]}  # 值域 -100 ~ 0
    """
    df = _to_df(kline)
    high_n = df['high'].rolling(window=period).max()
    low_n = df['low'].rolling(window=period).min()
    wr = (high_n - df['close']) / (high_n - low_n) * (-100)

    return {"WR": [None if pd.isna(v) else round(v, 2) for v in wr]}


def calc_obv(kline: list[dict]) -> dict:
    """
    能量潮 (On-Balance Volume)
    
    returns:
        {"OBV": [...]}
    """
    df = _to_df(kline)
    direction = np.sign(df['close'].diff())
    direction.iloc[0] = 0
    obv = (direction * df['volume']).cumsum()

    return {"OBV": [round(v, 0) for v in obv]}


def calc_atr(kline: list[dict], period: int = 14) -> dict:
    """
    真实波幅 (Average True Range)
    
    params:
        period: 计算周期，默认 14
    
    returns:
        {"ATR": [...]}
    """
    df = _to_df(kline)
    high_low = df['high'] - df['low']
    high_close_prev = (df['high'] - df['close'].shift(1)).abs()
    low_close_prev = (df['low'] - df['close'].shift(1)).abs()
    
    tr = pd.concat([high_low, high_close_prev, low_close_prev], axis=1).max(axis=1)
    atr = tr.ewm(alpha=1/period, min_periods=period, adjust=False).mean()

    return {"ATR": [None if pd.isna(v) else round(v, 4) for v in atr]}


def calc_vwap(kline: list[dict]) -> dict:
    """
    成交量加权平均价 (VWAP)
    
    注意：标准 VWAP 是盘中指标，这里对日K线做累计 VWAP 近似。
    
    returns:
        {"VWAP": [...]}
    """
    df = _to_df(kline)
    typical_price = (df['high'] + df['low'] + df['close']) / 3
    cum_vol = df['volume'].cumsum()
    cum_tp_vol = (typical_price * df['volume']).cumsum()
    vwap = cum_tp_vol / cum_vol

    return {"VWAP": [None if pd.isna(v) else round(v, 4) for v in vwap]}


# ============================================================
# 指标注册表
# ============================================================

INDICATOR_REGISTRY = {
    "MA": calc_ma,
    "EMA": calc_ema,
    "MACD": calc_macd,
    "KDJ": calc_kdj,
    "RSI": calc_rsi,
    "BOLL": calc_boll,
    "WR": calc_wr,
    "OBV": calc_obv,
    "ATR": calc_atr,
    "VWAP": calc_vwap,
}


def calculate(kline: list[dict], indicators: list[str], params: dict = None) -> dict:
    """
    批量计算指标。
    
    Args:
        kline: K 线数据列表
        indicators: 要计算的指标名称列表，如 ["MACD", "RSI", "BOLL"]
        params: 各指标的可选参数，如 {"RSI": {"period": 6}, "BOLL": {"width": 3}}
    
    Returns:
        {
            "MACD": {"DIF": [...], "DEA": [...], "MACD": [...]},
            "RSI": {"RSI": [...]},
            ...
        }
    
    Raises:
        ValueError: 未知的指标名称
    """
    if params is None:
        params = {}
    
    results = {}
    for name in indicators:
        upper_name = name.upper()
        if upper_name not in INDICATOR_REGISTRY:
            raise ValueError(f"未知指标: {name}，可用指标: {', '.join(INDICATOR_REGISTRY.keys())}")
        
        indicator_params = params.get(name, params.get(upper_name, {}))
        results[upper_name] = INDICATOR_REGISTRY[upper_name](kline, **indicator_params)
    
    return results
```

---

## 步骤 4：Python 层 — 守护进程入口

### 4.1 `python/main.py`

```python
"""
Dogear Python 计算层 — JSON-RPC 守护进程

通过 stdin/stdout 与 Electron 主进程通信。
启动后等待请求，直到收到 shutdown 命令或 stdin 关闭。

支持的 methods:
  - ping              → {"result": "pong"}
  - calc_indicators   → 技术指标批量计算
  - shutdown          → 优雅退出
"""

import sys
import traceback

# 将 stderr 用于日志（不干扰 stdout 的 JSON 通信）
def log(msg: str):
    print(f"[dogear-python] {msg}", file=sys.stderr, flush=True)

log("Python 计算层启动中...")

from core.protocol import read_request, send_response, send_error
from core.indicators import calculate

log("模块加载完成，等待请求...")

# ============================================================
# Method 路由
# ============================================================

def handle_ping(request_id: str, params: dict):
    send_response(request_id, "pong")

def handle_calc_indicators(request_id: str, params: dict):
    """计算技术指标"""
    kline = params.get("kline")
    indicators = params.get("indicators")
    indicator_params = params.get("params", {})
    
    if not kline or not indicators:
        send_error(request_id, -1, "缺少必要参数: kline 和 indicators")
        return
    
    result = calculate(kline, indicators, indicator_params)
    send_response(request_id, result)

METHOD_HANDLERS = {
    "ping": handle_ping,
    "calc_indicators": handle_calc_indicators,
}

# ============================================================
# 主循环
# ============================================================

def main():
    while True:
        try:
            request = read_request()
            if request is None:
                log("stdin 已关闭，退出")
                break
            
            request_id = request.get("id", "unknown")
            method = request.get("method")
            params = request.get("params", {})
            
            if method == "shutdown":
                log("收到 shutdown 命令，退出")
                send_response(request_id, "ok")
                break
            
            handler = METHOD_HANDLERS.get(method)
            if handler is None:
                send_error(request_id, -2, f"未知方法: {method}")
                continue
            
            handler(request_id, params)
            
        except json.JSONDecodeError as e:
            log(f"JSON 解析失败: {e}")
            # 无法获取 request_id，跳过
        except Exception as e:
            log(f"处理请求异常: {traceback.format_exc()}")
            try:
                send_error(request_id, -3, str(e))
            except:
                pass

if __name__ == "__main__":
    import json  # 确保 main 中使用的 json 模块
    main()
```

> 注意 `main.py` 中 `import json` 放在 `if __name__` 块中是因为 protocol.py 已经导入了它，但 main 的 except 块直接引用了 `json.JSONDecodeError`，需要在作用域内可用。更好的写法是在文件顶部导入。实施时统一放顶部。

### 4.2 `python/utils/cache.py`

```python
"""简单的 TTL 内存缓存（Phase 1 暂不使用，为 Phase 2 AKShare 准备）"""

import time

class TTLCache:
    def __init__(self):
        self._store: dict[str, tuple[float, any]] = {}
    
    def get(self, key: str) -> any | None:
        if key in self._store:
            expires_at, value = self._store[key]
            if time.time() < expires_at:
                return value
            del self._store[key]
        return None
    
    def set(self, key: str, value: any, ttl_seconds: float):
        self._store[key] = (time.time() + ttl_seconds, value)
    
    def clear(self):
        self._store.clear()
    
    def cleanup(self):
        """清理过期条目"""
        now = time.time()
        expired = [k for k, (exp, _) in self._store.items() if now >= exp]
        for k in expired:
            del self._store[k]
```

### 4.3 `python/core/__init__.py` 和 `python/utils/__init__.py`

```python
# 空文件，标记为 Python 包
```

---

## 步骤 5：TypeScript 层 — Python Bridge 服务

### 5.1 `electron/main/services/stock/python-bridge.ts`

```typescript
/**
 * Python Bridge — Electron ↔ Python 进程通信桥
 *
 * 通过 child_process.spawn 启动持久化的 Python 守护进程，
 * 使用 NDJSON (Newline-Delimited JSON) 通过 stdin/stdout 通信。
 *
 * 特性：
 *   - 懒启动（首次调用时 spawn）
 *   - 自动环境检测（python3 → python → py）
 *   - 健康检查（ping/pong）
 *   - 请求超时管理
 *   - 崩溃自动恢复
 *   - 断路器保护（连续 3 次崩溃触发冷却）
 *   - 优雅关闭
 */

import { spawn, execSync, type ChildProcess } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import electron from 'electron';

const { app } = electron;

// ============================================================
// 类型定义
// ============================================================

/** JSON-RPC 请求 */
interface PythonRequest {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

/** JSON-RPC 响应 */
interface PythonResponse {
  id: string;
  result?: unknown;
  error?: { code: number; message: string };
  progress?: { current: number; total: number; message: string };
}

/** 挂起的请求 */
interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  onProgress?: (progress: { current: number; total: number; message: string }) => void;
}

/** Bridge 状态 */
export interface PythonBridgeStatus {
  available: boolean;
  pythonPath: string | null;
  processRunning: boolean;
  consecutiveCrashes: number;
  pendingRequests: number;
}

// ============================================================
// 常量
// ============================================================

/** 默认请求超时 */
const DEFAULT_TIMEOUT_MS = 30_000;
/** 健康检查超时 */
const HEALTH_CHECK_TIMEOUT_MS = 10_000;
/** 崩溃冷却时间 */
const CRASH_COOLDOWN_MS = 30_000;
/** 崩溃阈值 */
const CRASH_THRESHOLD = 3;
/** 关闭等待时间 */
const SHUTDOWN_WAIT_MS = 2_000;

// ============================================================
// PythonBridge 类
// ============================================================

class PythonBridge {
  private process: ChildProcess | null = null;
  private pythonPath: string | null = null;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private buffer = '';
  private consecutiveCrashes = 0;
  private cooldownUntil: number | null = null;
  private initializing = false;
  private initPromise: Promise<void> | null = null;

  constructor() {
    // 注册应用退出时的清理
    app.on('will-quit', () => {
      this.shutdown();
    });
  }

  // ----------------------------------------------------------
  // 公开 API
  // ----------------------------------------------------------

  /**
   * 调用 Python 方法
   * 
   * @param method 方法名
   * @param params 参数对象
   * @param timeoutMs 超时毫秒数（默认 30s）
   * @param onProgress 进度回调（可选）
   */
  async call<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
    onProgress?: (progress: { current: number; total: number; message: string }) => void,
  ): Promise<T> {
    await this.ensureRunning();

    const id = uuidv4();
    const request: PythonRequest = { id, method, params };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Python 请求超时（${timeoutMs}ms）: method=${method}`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
        onProgress,
      });

      const line = JSON.stringify(request) + '\n';
      this.process!.stdin!.write(line);
    });
  }

  /** 获取 Bridge 状态 */
  getStatus(): PythonBridgeStatus {
    return {
      available: this.pythonPath !== null,
      pythonPath: this.pythonPath,
      processRunning: this.process !== null && this.process.exitCode === null,
      consecutiveCrashes: this.consecutiveCrashes,
      pendingRequests: this.pendingRequests.size,
    };
  }

  /** 优雅关闭 */
  shutdown(): void {
    if (!this.process) return;

    try {
      const shutdownReq = JSON.stringify({ id: 'shutdown', method: 'shutdown', params: {} }) + '\n';
      this.process.stdin!.write(shutdownReq);
    } catch {
      // stdin 可能已关闭
    }

    const proc = this.process;
    setTimeout(() => {
      if (proc && proc.exitCode === null) {
        proc.kill('SIGTERM');
      }
    }, SHUTDOWN_WAIT_MS);

    this.process = null;
    this.rejectAllPending(new Error('Python Bridge 正在关闭'));
  }

  // ----------------------------------------------------------
  // 内部方法
  // ----------------------------------------------------------

  /** 确保 Python 进程在运行 */
  private async ensureRunning(): Promise<void> {
    if (this.process && this.process.exitCode === null) {
      return; // 进程正在运行
    }

    // 断路器检查
    if (this.cooldownUntil && Date.now() < this.cooldownUntil) {
      throw new Error(
        `Python Bridge 断路器已打开（连续崩溃 ${this.consecutiveCrashes} 次），` +
        `冷却至 ${new Date(this.cooldownUntil).toLocaleTimeString()}`
      );
    }

    // 防止并发初始化
    if (this.initializing && this.initPromise) {
      return this.initPromise;
    }

    this.initializing = true;
    this.initPromise = this.startProcess();

    try {
      await this.initPromise;
    } finally {
      this.initializing = false;
      this.initPromise = null;
    }
  }

  /** 检测 Python 解释器路径 */
  private detectPython(): string {
    // 如果已缓存，直接返回
    if (this.pythonPath) return this.pythonPath;

    const candidates = process.platform === 'win32'
      ? ['python', 'python3', 'py']
      : ['python3', 'python'];

    for (const cmd of candidates) {
      try {
        const version = execSync(`${cmd} --version`, {
          timeout: 5000,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
        
        // 确保是 Python 3
        if (version.startsWith('Python 3')) {
          this.pythonPath = cmd;
          console.log(`[PythonBridge] 检测到 Python: ${cmd} (${version})`);
          return cmd;
        }
      } catch {
        // 该命令不可用，继续尝试
      }
    }

    throw new Error(
      'Python 3 未找到。请安装 Python 3.10+ 并确保在 PATH 中。\n' +
      '下载地址: https://www.python.org/downloads/'
    );
  }

  /** 获取 Python 脚本路径 */
  private getScriptPath(): string {
    // 开发模式：项目根目录/python/main.py
    // 打包模式：app.asar 同级/python/main.py
    const isDev = !app.isPackaged;
    if (isDev) {
      return path.join(process.cwd(), 'python', 'main.py');
    }
    return path.join(path.dirname(app.getAppPath()), 'python', 'main.py');
  }

  /** 启动 Python 进程 */
  private async startProcess(): Promise<void> {
    const pythonCmd = this.detectPython();
    const scriptPath = this.getScriptPath();

    console.log(`[PythonBridge] 启动 Python 进程: ${pythonCmd} ${scriptPath}`);

    this.process = spawn(pythonCmd, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',       // 禁用 Python 输出缓冲
        PYTHONIOENCODING: 'utf-8',   // 确保 UTF-8 编码
      },
    });

    // 监听 stdout（JSON 响应）
    this.process.stdout!.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf-8');
      this.processBuffer();
    });

    // 监听 stderr（日志）
    this.process.stderr!.on('data', (chunk: Buffer) => {
      const msg = chunk.toString('utf-8').trim();
      if (msg) {
        console.log(`[PythonBridge:stderr] ${msg}`);
      }
    });

    // 监听进程退出
    this.process.on('exit', (code, signal) => {
      console.warn(`[PythonBridge] Python 进程退出: code=${code}, signal=${signal}`);
      this.process = null;
      this.consecutiveCrashes++;

      if (this.consecutiveCrashes >= CRASH_THRESHOLD) {
        this.cooldownUntil = Date.now() + CRASH_COOLDOWN_MS;
        console.error(
          `[PythonBridge] 连续崩溃 ${this.consecutiveCrashes} 次，` +
          `断路器开启，冷却 ${CRASH_COOLDOWN_MS / 1000}s`
        );
      }

      this.rejectAllPending(new Error(`Python 进程异常退出 (code=${code})`));
    });

    this.process.on('error', (err) => {
      console.error(`[PythonBridge] 进程启动失败:`, err);
      this.process = null;
      this.rejectAllPending(new Error(`Python 进程启动失败: ${err.message}`));
    });

    // 健康检查
    try {
      const pong = await this.call<string>('ping', {}, HEALTH_CHECK_TIMEOUT_MS);
      if (pong !== 'pong') {
        throw new Error(`健康检查失败: 期望 "pong"，收到 "${pong}"`);
      }
      // 健康检查成功，重置崩溃计数
      this.consecutiveCrashes = 0;
      this.cooldownUntil = null;
      console.log('[PythonBridge] 健康检查通过');
    } catch (err) {
      // 健康检查失败，杀掉进程
      this.process?.kill();
      this.process = null;
      throw new Error(`Python Bridge 健康检查失败: ${err}`);
    }
  }

  /** 处理 stdout 缓冲区中的完整 JSON 行 */
  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    // 最后一个元素可能是不完整的行，保留在 buffer 中
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const response: PythonResponse = JSON.parse(trimmed);
        this.handleResponse(response);
      } catch (err) {
        console.warn(`[PythonBridge] 无法解析响应: ${trimmed}`);
      }
    }
  }

  /** 处理单条响应 */
  private handleResponse(response: PythonResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      // 可能是超时后收到的响应，忽略
      return;
    }

    // 进度更新（不完成请求）
    if (response.progress) {
      pending.onProgress?.(response.progress);
      return;
    }

    // 完成请求
    this.pendingRequests.delete(response.id);
    clearTimeout(pending.timer);

    if (response.error) {
      pending.reject(new Error(response.error.message));
    } else {
      pending.resolve(response.result);
    }
  }

  /** 拒绝所有挂起的请求 */
  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }
}

// ============================================================
// 导出单例
// ============================================================

/** 全局 PythonBridge 单例 */
export const pythonBridge = new PythonBridge();
```

### 5.2 修改 `electron/main/services/stock/index.ts`

新增一行导出：

```typescript
export { pythonBridge } from './python-bridge.js';
```

---

## 步骤 6：Agent 工具 — CalcIndicators

### 6.1 `electron/main/agents/tools/stock-analysis-tools.ts`

```typescript
/**
 * 股票分析 MCP Server 工具
 *
 * 依赖 Python Bridge 进行计算，与基础股票工具（dogear-stock）分离。
 * Python 不可用时不影响基础行情查询功能。
 *
 * Phase 1 工具清单：
 *   - CalcIndicators — 计算技术指标（MACD/KDJ/RSI/BOLL/MA 等）
 *
 * 后续 Phase 追加：
 *   - ScreenStocks / GetFinancials / CompareIndustry / DetectSignals / EvalFormula / SimpleBacktest
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { stockService } from '../../services/stock/stock-service.js';
import { stockDataService } from '../../services/stock/stock-data-service.js';
import { pythonBridge } from '../../services/stock/python-bridge.js';
import { registerTools } from './tool-registry.js';

// 注册工具元数据到 registry
registerTools([
  {
    name: 'CalcIndicators',
    description: '计算股票技术指标（MACD/KDJ/RSI/BOLL/MA 等）',
    server: 'dogear-stock-analysis',
    category: 'stock',
  },
]);

// ============================================================
// 常量
// ============================================================

/** 指标计算超时 */
const CALC_TIMEOUT_MS = 30_000;
/** 支持的指标列表 */
const AVAILABLE_INDICATORS = ['MA', 'EMA', 'MACD', 'KDJ', 'RSI', 'BOLL', 'WR', 'OBV', 'ATR', 'VWAP'] as const;
/** K线数据默认条数（指标计算需要足够数据） */
const DEFAULT_KLINE_LIMIT = 250;
/** K线最大条数 */
const MAX_KLINE_LIMIT = 500;

// ============================================================
// 辅助函数
// ============================================================

/** 安全数字格式化 */
function safe(val: number | undefined | null, digits = 2): string {
  if (val == null || isNaN(val)) return '-';
  return val.toFixed(digits);
}

/** 获取数组最后 N 个非 null 值 */
function lastN(arr: (number | null)[], n: number): (number | null)[] {
  return arr.slice(-n);
}

/** 获取数组最后一个非 null 值 */
function lastValue(arr: (number | null)[]): number | null {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] !== null && arr[i] !== undefined) return arr[i];
  }
  return null;
}

/** 格式化单个指标结果为可读文本 */
function formatIndicatorResult(name: string, data: Record<string, (number | null)[]>): string {
  switch (name) {
    case 'MACD': {
      const dif = lastValue(data.DIF);
      const dea = lastValue(data.DEA);
      const macd = lastValue(data.MACD);
      const trend = dif !== null && dea !== null
        ? (dif > dea ? 'DIF 在 DEA 上方（多头）' : 'DIF 在 DEA 下方（空头）')
        : '';
      const zeroAxis = dif !== null
        ? (dif > 0 ? '，DIF 在零轴上方' : '，DIF 在零轴下方')
        : '';
      return `MACD(12,26,9): DIF=${safe(dif, 4)}, DEA=${safe(dea, 4)}, 柱=${safe(macd, 4)} | ${trend}${zeroAxis}`;
    }
    case 'KDJ': {
      const k = lastValue(data.K);
      const d = lastValue(data.D);
      const j = lastValue(data.J);
      let zone = '';
      if (k !== null) {
        if (k > 80) zone = '超买区(>80)';
        else if (k < 20) zone = '超卖区(<20)';
        else zone = '中性区间';
      }
      return `KDJ(9,3,3): K=${safe(k)}, D=${safe(d)}, J=${safe(j)} | ${zone}`;
    }
    case 'RSI': {
      const rsi = lastValue(data.RSI);
      let zone = '';
      if (rsi !== null) {
        if (rsi > 70) zone = '超买区(>70)';
        else if (rsi < 30) zone = '超卖区(<30)';
        else if (rsi >= 40 && rsi <= 60) zone = '中性区间(40-60)';
        else if (rsi > 60) zone = '偏强(60-70)';
        else zone = '偏弱(30-40)';
      }
      return `RSI(14): ${safe(rsi)} | ${zone}`;
    }
    case 'BOLL': {
      const upper = lastValue(data.UPPER);
      const mid = lastValue(data.MID);
      const lower = lastValue(data.LOWER);
      return `BOLL(20,2): 上轨=${safe(upper, 2)}, 中轨=${safe(mid, 2)}, 下轨=${safe(lower, 2)}`;
    }
    case 'MA': {
      const parts: string[] = [];
      for (const key of Object.keys(data).sort()) {
        const val = lastValue(data[key]);
        parts.push(`${key}=${safe(val, 2)}`);
      }
      return `均线: ${parts.join(', ')}`;
    }
    case 'EMA': {
      const parts: string[] = [];
      for (const key of Object.keys(data).sort()) {
        const val = lastValue(data[key]);
        parts.push(`${key}=${safe(val, 2)}`);
      }
      return `指数均线: ${parts.join(', ')}`;
    }
    case 'WR': {
      const wr = lastValue(data.WR);
      let zone = '';
      if (wr !== null) {
        if (wr > -20) zone = '超买区(>-20)';
        else if (wr < -80) zone = '超卖区(<-80)';
        else zone = '中性区间';
      }
      return `WR(14): ${safe(wr)} | ${zone}`;
    }
    case 'OBV': {
      const obv = lastValue(data.OBV);
      return `OBV: ${obv !== null ? obv.toLocaleString() : '-'}`;
    }
    case 'ATR': {
      const atr = lastValue(data.ATR);
      return `ATR(14): ${safe(atr, 4)}`;
    }
    case 'VWAP': {
      const vwap = lastValue(data.VWAP);
      return `VWAP: ${safe(vwap, 2)}`;
    }
    default:
      return `${name}: ${JSON.stringify(data)}`;
  }
}

// ============================================================
// 工具创建函数
// ============================================================

export function createStockAnalysisTools() {
  return createSdkMcpServer({
    name: 'dogear-stock-analysis',
    version: '1.0.0',
    tools: [
      // ========================================
      // 工具: 计算技术指标
      // ========================================
      tool(
        'CalcIndicators',
        '计算股票技术指标。返回精确的指标数值，用于技术分析。\n' +
        '支持指标: MA(均线), EMA(指数均线), MACD, KDJ, RSI, BOLL(布林带), WR(威廉), OBV(能量潮), ATR(真实波幅), VWAP\n' +
        '数据来源: 从已有 K 线数据获取，由 Python 计算引擎精确计算。\n' +
        '使用场景: 用户想了解某只股票的技术面状态、超买超卖、趋势方向等。\n' +
        '建议: 分析个股时通常组合使用 MACD+KDJ+RSI+BOLL，不要只看单一指标。',
        {
          market: z.number().describe('市场代码（1=沪市 0=深市）'),
          code: z.string().describe('股票代码（如"600519"）'),
          indicators: z.array(
            z.enum(AVAILABLE_INDICATORS)
          ).min(1).describe('要计算的指标列表'),
          params: z.record(z.record(z.number())).optional()
            .describe('可选参数覆盖，如 {"RSI": {"period": 6}, "BOLL": {"width": 3}}'),
          period: z.enum(['daily', 'weekly', 'monthly']).default('daily')
            .describe('K线周期（默认日K）'),
          limit: z.number().min(30).max(MAX_KLINE_LIMIT).default(DEFAULT_KLINE_LIMIT)
            .describe('K线数据条数（默认250，指标需要足够数据才准确）'),
        },
        async (args) => {
          try {
            // 1. 获取 K 线数据（复用现有 stockService，享受缓存+限流+备用源）
            const periodMap: Record<string, 101 | 102 | 103> = {
              daily: 101, weekly: 102, monthly: 103,
            };
            const secid = `${args.market}.${args.code}`;
            const klineData = await stockService.getKLine({
              secid,
              period: periodMap[args.period],
              adjust: 1, // 前复权
              limit: args.limit,
            });

            if (klineData.length === 0) {
              return {
                content: [{ type: 'text' as const, text: '未获取到 K 线数据，无法计算指标。请检查股票代码。' }],
              };
            }

            if (klineData.length < 30) {
              return {
                content: [{
                  type: 'text' as const,
                  text: `K 线数据不足（仅 ${klineData.length} 条），部分指标可能不准确。建议至少需要 60 条以上数据。`,
                }],
              };
            }

            // 日K增量存储到本地
            if (periodMap[args.period] === 101) {
              stockDataService.appendKLine(args.market, args.code, klineData)
                .catch((err) => console.warn('[CalcIndicators] K线存储失败:', err));
            }

            // 2. 调用 Python 计算
            const result = await pythonBridge.call<Record<string, Record<string, (number | null)[]>>>(
              'calc_indicators',
              {
                kline: klineData,
                indicators: args.indicators,
                params: args.params || {},
              },
              CALC_TIMEOUT_MS,
            );

            // 3. 格式化输出
            const periodLabel = args.period === 'weekly' ? '周K' : args.period === 'monthly' ? '月K' : '日K';
            const lastDate = klineData[klineData.length - 1].date;
            const lastClose = klineData[klineData.length - 1].close;

            const header = `=== ${args.code} 技术指标（${periodLabel}，截至 ${lastDate}，收盘 ${safe(lastClose)}） ===`;
            const lines = args.indicators.map((name) => {
              const data = result[name.toUpperCase()];
              if (!data) return `${name}: 计算失败`;
              return formatIndicatorResult(name.toUpperCase(), data);
            });

            return {
              content: [{
                type: 'text' as const,
                text: `${header}\n${lines.join('\n')}`,
              }],
            };
          } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            
            // Python 不可用时给出友好提示
            if (errMsg.includes('Python 3 未找到') || errMsg.includes('断路器')) {
              return {
                content: [{
                  type: 'text' as const,
                  text: `技术指标计算不可用: ${errMsg}\n\n` +
                    '需要安装 Python 3 和依赖:\n' +
                    '1. 安装 Python 3.10+: https://www.python.org/downloads/\n' +
                    '2. 安装依赖: pip install pandas numpy',
                }],
                isError: true,
              };
            }

            return {
              content: [{ type: 'text' as const, text: `计算技术指标失败: ${errMsg}` }],
              isError: true,
            };
          }
        }
      ),
    ],
  });
}
```

---

## 步骤 7：注册与接线

### 7.1 修改 `electron/main/agents/tools/tool-registry.ts`

在 `ToolMeta` 接口的 `category` 联合类型中，`'stock'` 已存在，无需修改。新工具使用 `category: 'stock'` 即可。

### 7.2 修改 `electron/main/services/conversation-runtime-service.ts`

在文件顶部添加导入：

```typescript
import { createStockAnalysisTools } from '../agents/tools/stock-analysis-tools.js';
```

在 `buildConversationSessionConfig` 函数中，紧接着 `stockTools` 注册之后添加：

```typescript
// 现有代码:
const stockTools = createStockTools();
mcpServers['dogear-stock'] = stockTools;

// 新增:
const stockAnalysisTools = createStockAnalysisTools();
mcpServers['dogear-stock-analysis'] = stockAnalysisTools;
```

### 7.3 新增 IPC 路由（可选，供前端直接调用）

在 `electron/main/tipc/stock.ts` 中添加新路由：

```typescript
// 在文件顶部添加导入
import { pythonBridge } from '../services/stock/python-bridge.js';

// 在 stockRouter 对象中添加：

/** 计算技术指标（供前端直接调用） */
'stock:calcIndicators': t.procedure
  .input<{
    market: number;
    code: string;
    indicators: string[];
    params?: Record<string, Record<string, number>>;
    period?: 101 | 102 | 103;
    limit?: number;
  }>()
  .action(async ({ input }) => {
    try {
      const secid = `${input.market}.${input.code}`;
      const klineData = await stockService.getKLine({
        secid,
        period: input.period ?? 101,
        adjust: 1,
        limit: input.limit ?? 250,
      });

      if (klineData.length === 0) {
        return { error: '未获取到 K 线数据' };
      }

      const result = await pythonBridge.call('calc_indicators', {
        kline: klineData,
        indicators: input.indicators,
        params: input.params || {},
      }, 30_000);

      return { data: result };
    } catch (error) {
      return { error: String(error) };
    }
  }),

/** 获取 Python Bridge 状态 */
'stock:getPythonBridgeStatus': t.procedure.action(async () => {
  return { data: pythonBridge.getStatus() };
}),
```

---

## 步骤 8：构建与验证

### 8.1 安装 Python 依赖

```bash
cd python
pip install -r requirements.txt
```

### 8.2 单独测试 Python 层

在终端中直接运行 Python 守护进程，手动输入 JSON 测试：

```bash
cd c:/dogear
python python/main.py
```

输入：
```json
{"id":"test-1","method":"ping","params":{}}
```

期望输出：
```json
{"id":"test-1","result":"pong"}
```

输入（模拟指标计算）：
```json
{"id":"test-2","method":"calc_indicators","params":{"kline":[{"date":"2026-04-01","open":100,"close":102,"high":105,"low":99,"volume":10000,"turnover":1020000},{"date":"2026-04-02","open":102,"close":101,"high":103,"low":100,"volume":8000,"turnover":816000}],"indicators":["RSI","MA"],"params":{}}}
```

### 8.3 编译主进程

```bash
bun run build:electron
```

### 8.4 启动开发环境测试

```bash
bun run dev
```

在 AI 聊天中输入：
> "帮我计算贵州茅台的 MACD、KDJ、RSI 和布林带"

AI 应该：
1. 先 `SearchStock` 搜索"贵州茅台" → 获取 market=1, code=600519
2. 调用 `CalcIndicators({market: 1, code: "600519", indicators: ["MACD", "KDJ", "RSI", "BOLL"]})`
3. 返回精确数值 + 分析

### 8.5 错误场景测试

- 不安装 Python → 应提示安装 Python 3
- 不安装 pandas/numpy → 应提示安装依赖
- Python 进程崩溃 → 应自动重启，连续 3 次崩溃触发断路器
- 请求超时 → 应返回超时错误

---

## 文件修改清单（实施 checklist）

| 序号 | 操作 | 文件 | 说明 |
|------|------|------|------|
| 1 | 新建 | `python/requirements.txt` | pandas, numpy |
| 2 | 新建 | `python/core/__init__.py` | 空文件 |
| 3 | 新建 | `python/utils/__init__.py` | 空文件 |
| 4 | 新建 | `python/core/protocol.py` | JSON-RPC 协议 |
| 5 | 新建 | `python/core/indicators.py` | 10 个技术指标 |
| 6 | 新建 | `python/utils/cache.py` | TTL 缓存（预备） |
| 7 | 新建 | `python/main.py` | 守护进程入口 |
| 8 | 新建 | `electron/main/services/stock/python-bridge.ts` | Python 进程管理 |
| 9 | 修改 | `electron/main/services/stock/index.ts` | 导出 pythonBridge |
| 10 | 新建 | `electron/main/agents/tools/stock-analysis-tools.ts` | CalcIndicators 工具 |
| 11 | 修改 | `electron/main/services/conversation-runtime-service.ts` | 注册 MCP Server |
| 12 | 修改 | `electron/main/tipc/stock.ts` | 新增 IPC 路由 |
| 13 | 验证 | — | Python 单独测试 + 编译 + 集成测试 |

---

## 关键风险与应对

| 风险 | 应对 |
|------|------|
| 用户没有 Python | 前端 toast 提示安装，给出下载链接 |
| Python 依赖安装失败 | 健康检查时明确报错，区分 Python 不存在 vs 依赖缺失 |
| Windows 下 Python 命令不在 PATH | 依次尝试 python / python3 / py |
| Python 进程 stdout 非 JSON | processBuffer 中 try/catch，日志记录异常行 |
| K 线数据不足导致指标不准 | 默认拉 250 条，工具返回时提示数据量 |
