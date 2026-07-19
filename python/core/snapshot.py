"""
全 A 日快照懒预拉与本地缓存

首次调用触发全市场拉取，产出 `.dogear/stocks/daily_snapshot/{date}.jsonl`，
包含 baostock 原始字段 + 派生字段（总市值/流通市值/振幅/量比）。
日期取 baostock 返回的实际交易日，非本地今天。

MVP 范围：总市值/流通市值/量比暂无可靠数据源，固定填 NaN，
只有振幅（amplitude）由 K 线数据算出。
"""

import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

from utils.baostock_client import BaostockError, get_all_stock_codes, get_stock_k_data
from .protocol import send_progress


def _log(msg: str):
    print(f"[snapshot] {msg}", file=sys.stderr, flush=True)


# ============================================================
# 路径
# ============================================================

def get_dogear_root() -> Path:
    """获取 .dogear 配置目录，与 TS 侧 getConfigDir() 行为对齐（优先读注入的环境变量）。"""
    env_dir = os.environ.get("DOGEAR_CONFIG_DIR")
    if env_dir:
        return Path(env_dir)
    return Path.home() / ".dogear"


def _get_snapshot_dir() -> Path:
    d = get_dogear_root() / "stocks" / "daily_snapshot"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _snapshot_path(date: str) -> Path:
    return _get_snapshot_dir() / f"{date}.jsonl"


# ============================================================
# 交易日解析
# ============================================================

def _resolve_trade_date(max_lookback: int = 10) -> str:
    """
    从今天起逐日倒推，找到最近一个有数据的交易日。

    get_all_stock_codes(date=...) 在非交易日返回空 DataFrame（不抛异常），
    据此判断即可，无需额外调 is_trade_date。
    """
    day = datetime.now()
    for _ in range(max_lookback):
        date_str = day.strftime("%Y-%m-%d")
        df = get_all_stock_codes(date=date_str)
        if not df.empty:
            return date_str
        day -= timedelta(days=1)
    raise BaostockError(f"最近 {max_lookback} 天内未找到交易日", error_type="EmptyResult")


# ============================================================
# 拉取与派生字段
# ============================================================

_NUMERIC_COLS = (
    "open", "high", "low", "close", "preclose", "volume", "amount",
    "turn", "pctChg", "peTTM", "pbMRQ", "psTTM", "pcfNcfTTM",
)


def _pull_full_a(trade_date: str, request_id: str = "") -> pd.DataFrame:
    """逐只拉取当日 K 线数据，单只失败跳过，不中断整批。"""
    codes_df = get_all_stock_codes(date=trade_date)
    codes = [c for c in codes_df["code"] if c.startswith(("sh.6", "sz.0", "sz.3"))]
    total = len(codes)
    _log(f"待拉取 {total} 只股票 (trade_date={trade_date})")

    rows = []
    failed = 0
    for idx, code in enumerate(codes, start=1):
        try:
            k_df = get_stock_k_data(code, trade_date, trade_date)
            rows.append(k_df.iloc[0])
        except BaostockError as e:
            failed += 1
            _log(f"跳过 {code}: {e.error_type} {e}")
        except Exception as e:
            failed += 1
            _log(f"跳过 {code}: {e}")

        if request_id and idx % 500 == 0:
            send_progress(request_id, idx, total, f"已拉取 {idx}/{total} 只")

    if request_id:
        send_progress(request_id, total, total, f"拉取完成，成功 {len(rows)}/{total}")

    _log(f"拉取完成: 成功 {len(rows)}, 失败 {failed}")

    if not rows:
        raise BaostockError(f"{trade_date} 全部股票拉取失败", error_type="EmptyResult")

    df = pd.DataFrame(rows).reset_index(drop=True)

    for col in _NUMERIC_COLS:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    # 停牌过滤：tradestatus=0 或 volume=0 的行丢弃，不落到 JSONL
    df = df[(df["tradestatus"] != "0") & (df["volume"].fillna(0) != 0)].reset_index(drop=True)

    df = _add_derived_fields(df)

    return df


def _add_derived_fields(df: pd.DataFrame) -> pd.DataFrame:
    """
    派生字段：
      - total_market_cap / float_market_cap：无可靠股本数据源，MVP 固定 NaN
      - amplitude = (high - low) / preclose
      - volume_ratio：需近 5 日均量，MVP 不做，固定 NaN
    """
    df = df.copy()
    df["total_market_cap"] = np.nan
    df["float_market_cap"] = np.nan
    df["amplitude"] = (df["high"] - df["low"]) / df["preclose"]
    df["volume_ratio"] = np.nan
    return df


def _atomic_write_jsonl(df: pd.DataFrame, path: Path):
    """先写 .tmp 后 rename，避免中断进程留下损坏的半成品文件。"""
    tmp_path = path.with_name(path.name + ".tmp")
    df.to_json(tmp_path, orient="records", lines=True, force_ascii=False)
    os.replace(tmp_path, path)


# ============================================================
# 公开 API
# ============================================================

def get_snapshot(request_id: str = "", force_refresh: bool = False) -> pd.DataFrame:
    """
    获取全 A 日快照（对外主入口）。

    命中当日缓存文件直接读盘返回；未命中则全量拉取后落盘。
    """
    trade_date = _resolve_trade_date()
    path = _snapshot_path(trade_date)

    if path.exists() and not force_refresh:
        _log(f"命中缓存: {path}")
        return pd.read_json(path, lines=True)

    _log(f"未命中缓存，开始拉取全 A 快照: trade_date={trade_date}")
    df = _pull_full_a(trade_date, request_id=request_id)
    _atomic_write_jsonl(df, path)
    _log(f"快照已写入: {path} ({len(df)} 行)")
    return df


# ============================================================
# 手工验证
# ============================================================

if __name__ == "__main__":
    import time

    print("=== snapshot 手工验证：首次拉取 ===")
    start = time.time()
    result = get_snapshot()
    elapsed = time.time() - start
    print(f"耗时 {elapsed:.1f}s, shape={result.shape}")
    print(result.columns.tolist())
    print(result.head(3))

    print("\n=== snapshot 手工验证：二次调用（应命中缓存） ===")
    start = time.time()
    result2 = get_snapshot()
    elapsed = time.time() - start
    print(f"耗时 {elapsed:.3f}s, shape={result2.shape}")
