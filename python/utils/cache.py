"""简单的 TTL 内存缓存（Phase 1 暂不使用，为 Phase 2 AKShare 准备）"""

import time


class TTLCache:
    def __init__(self):
        self._store: dict[str, tuple[float, any]] = {}

    def get(self, key: str):
        if key in self._store:
            expires_at, value = self._store[key]
            if time.time() < expires_at:
                return value
            del self._store[key]
        return None

    def set(self, key: str, value, ttl_seconds: float):
        self._store[key] = (time.time() + ttl_seconds, value)

    def clear(self):
        self._store.clear()

    def cleanup(self):
        """清理过期条目"""
        now = time.time()
        expired = [k for k, (exp, _) in self._store.items() if now >= exp]
        for k in expired:
            del self._store[k]
