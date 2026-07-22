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

from utils.baostock_client import (
    BaostockError,
    get_all_stock_codes,
    get_industry_codes,
    get_industry_map,
    get_stock_k_data,
)
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


def _get_industry_snapshot_dir(date: str) -> Path:
    d = get_dogear_root() / "stocks" / "industry_snapshot" / date
    d.mkdir(parents=True, exist_ok=True)
    return d


_FS_INVALID_CHARS = '<>:"/\\|?*'


def _sanitize_industry(industry: str) -> str:
    r"""把行业名做文件系统安全化：替换 <>:"/\|?* 为下划线。中文和顿号保留。"""
    slug = industry
    for ch in _FS_INVALID_CHARS:
        slug = slug.replace(ch, '_')
    return slug or 'unnamed'


def _industry_snapshot_path(date: str, industry: str) -> Path:
    return _get_industry_snapshot_dir(date) / f"{_sanitize_industry(industry)}.jsonl"


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


def _pull_snapshot_for_codes(
    codes: list[str],
    trade_date: str,
    context: str,
    request_id: str = "",
    progress_interval: int = 500,
) -> pd.DataFrame:
    """
    逐只拉指定 code 列表的当日 K 线，单只失败跳过，不中断整批。
    通用底层：全 A 快照和行业快照都走这里。

    Args:
        codes: 带 sh./sz./bj. 前缀的 code 列表
        trade_date: "YYYY-MM-DD"
        context: 日志/异常上下文描述（如 "全 A" / "C39计算机..."）
        request_id: 进度回调 ID，空则不发进度
        progress_interval: 每处理多少只发一次进度
    """
    total = len(codes)
    _log(f"[{context}] 待拉取 {total} 只 (trade_date={trade_date})")

    rows = []
    failed = 0
    for idx, code in enumerate(codes, start=1):
        try:
            k_df = get_stock_k_data(code, trade_date, trade_date)
            rows.append(k_df.iloc[0])
        except BaostockError as e:
            failed += 1
            _log(f"[{context}] 跳过 {code}: {e.error_type} {e}")
        except Exception as e:
            failed += 1
            _log(f"[{context}] 跳过 {code}: {e}")

        if request_id and idx % progress_interval == 0:
            send_progress(request_id, idx, total, f"[{context}] 已拉取 {idx}/{total}")

    if request_id:
        send_progress(request_id, total, total, f"[{context}] 拉取完成，成功 {len(rows)}/{total}")

    _log(f"[{context}] 拉取完成: 成功 {len(rows)}, 失败 {failed}")

    if not rows:
        raise BaostockError(f"[{context}] {trade_date} 全部拉取失败", error_type="EmptyResult")

    df = pd.DataFrame(rows).reset_index(drop=True)

    for col in _NUMERIC_COLS:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    df = df[(df["tradestatus"] != "0") & (df["volume"].fillna(0) != 0)].reset_index(drop=True)
    df = _add_derived_fields(df)

    return df


def _pull_full_a(trade_date: str, request_id: str = "") -> pd.DataFrame:
    """拉全 A 当日快照——从 baostock 全代码表 filter 沪深主板/创业板，委托 _pull_snapshot_for_codes。"""
    codes_df = get_all_stock_codes(date=trade_date)
    codes = [c for c in codes_df["code"] if c.startswith(("sh.6", "sz.0", "sz.3"))]
    return _pull_snapshot_for_codes(codes, trade_date, context="全 A", request_id=request_id)


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


def get_industry_snapshot(
    industry: str,
    request_id: str = "",
    force_refresh: bool = False,
) -> pd.DataFrame:
    """
    获取指定行业的当日快照——比全 A 快 15-20 倍（按需拉取 300-500 只而非 5000+）。

    命中优先级：
      1. 行业当日缓存 industry_snapshot/{date}/{sanitized_industry}.jsonl → 直接读
      2. 全 A 当日缓存已存在 → 从全 A filter 该行业（毫秒级，不复写行业缓存）
      3. 都没有 → 从 industry_map filter 该行业 codes，逐只拉，落行业缓存

    返回的 DataFrame 自带 industry / code_name 列（已 merge），供 screener 直接使用。
    """
    trade_date = _resolve_trade_date()
    industry_path = _industry_snapshot_path(trade_date, industry)
    full_a_path = _snapshot_path(trade_date)

    industry_df = get_industry_map()[['code', 'code_name', 'industry']]

    # 优先级 1：命中行业当日缓存
    if industry_path.exists() and not force_refresh:
        _log(f"命中行业缓存: {industry_path}")
        df = pd.read_json(industry_path, lines=True)
        return pd.merge(df, industry_df, on='code', how='left')

    # 优先级 2：全 A 当日缓存已存在，直接 filter（不额外落行业缓存，避免磁盘冗余）
    if full_a_path.exists() and not force_refresh:
        _log(f"复用全 A 缓存 filter 行业: {industry}")
        full_df = pd.read_json(full_a_path, lines=True)
        merged = pd.merge(full_df, industry_df, on='code', how='left')
        return merged[merged['industry'] == industry].reset_index(drop=True)

    # 优先级 3：按行业增量拉
    codes = get_industry_codes(industry)
    if not codes:
        raise BaostockError(
            f"行业 '{industry}' 在 industry_map 中无匹配股票——可能是分类名拼错，"
            f"用 list_industries 工具查真实值域",
            error_type="EmptyResult",
        )

    _log(f"按行业增量拉取: {industry} ({len(codes)} 只)")
    df = _pull_snapshot_for_codes(codes, trade_date, context=industry, request_id=request_id)
    _atomic_write_jsonl(df, industry_path)
    _log(f"行业快照已写入: {industry_path} ({len(df)} 行)")

    return pd.merge(df, industry_df, on='code', how='left')


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
