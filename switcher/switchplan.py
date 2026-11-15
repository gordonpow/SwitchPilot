"""選下一個帳號、判斷全部用完（純函式）。"""

from __future__ import annotations


def pick_next(slots: list[dict], current_id: str | None, now: float) -> dict | None:
    """從 current_id 之後依序循環，回傳第一個可用（非目前、未用完）的 slot。"""
    n = len(slots)
    if n == 0:
        return None
    start = 0
    for i, s in enumerate(slots):
        if s.get("id") == current_id:
            start = i + 1
            break
    for k in range(n):
        s = slots[(start + k) % n]
        if s.get("id") != current_id and (s.get("exhausted_until") or 0) <= now:
            return s
    return None


def earliest_reset(slots: list[dict], now: float) -> float | None:
    """所有尚未重置的 exhausted_until 中最小值；沒有則 None。"""
    vals = [s["exhausted_until"] for s in slots if (s.get("exhausted_until") or 0) > now]
    return min(vals) if vals else None
