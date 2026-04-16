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


def send_response(request_id: str, result):
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
