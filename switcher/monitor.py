"""自動切換判斷（純邏輯，不讀檔）。"""

from __future__ import annotations

from dataclasses import dataclass

_WINDOWS = ("five_hour", "seven_day")


@dataclass
class Action:
    kind: str  # "none" | "pending" | "switch_now"
    reason: str = ""
    exhausted_until: float = 0.0


def _over_windows(record: dict | None, threshold: float) -> list[dict]:
    """回傳用量達門檻的視窗。"""
    if not record:
        return []
    out = []
    for key in _WINDOWS:
        w = record.get(key)
        if not isinstance(w, dict):
            continue
        try:
            if float(w.get("used_percentage")) >= threshold:
                out.append(w)
        except (TypeError, ValueError):
            continue
    return out


def _max_reset(windows: list[dict]) -> float:
    best = 0.0
    for w in windows:
        try:
            best = max(best, float(w.get("resets_at") or 0))
        except (TypeError, ValueError):
            continue
    return best


class Monitor:
    def __init__(self, threshold: float = 95, pending_timeout: float = 600) -> None:
        self.threshold = threshold
        self.pending_timeout = pending_timeout
        self.since = 0.0
        self.pending = False
        self.pending_since = 0.0
        self.exhausted_until = 0.0

    def reset(self, since: float) -> None:
        self.pending = False
        self.pending_since = 0.0
        self.exhausted_until = 0.0
        self.since = since

    def tick(self, now: float, active_slot_id, usage_record, events) -> Action:
        rec = usage_record
        if rec is not None and (
            rec.get("slot_id") != active_slot_id or float(rec.get("ts") or 0) < self.since
        ):
            rec = None
        evs = [
            e for e in (events or [])
            if e.get("slot_id") == active_slot_id and float(e.get("ts") or 0) >= self.since
        ]
        over = _over_windows(rec, self.threshold)

        # 規則 1：rate_limit 事件立即切換
        if any(e.get("kind") == "stopfailure" and e.get("error") == "rate_limit" for e in evs):
            until = _max_reset(over) or (now + 5 * 3600)
            self.pending = False
            return Action("switch_now", "收到 rate_limit 錯誤", until)

        # 規則 2：用量達門檻，進入或維持 pending
        if over:
            if not self.pending:
                self.pending = True
                self.pending_since = now
            self.exhausted_until = _max_reset(over) or self.exhausted_until
        elif self.pending and rec is not None:
            # 規則 3：用量降回門檻以下，取消 pending
            self.pending = False
            self.exhausted_until = 0.0
            return Action("none", "用量已降回門檻以下")

        if not self.pending:
            return Action("none")

        until = self.exhausted_until or (now + 5 * 3600)
        # 規則 4：pending 中回合結束
        if any(e.get("kind") in ("stop", "stopfailure") for e in evs):
            self.pending = False
            return Action("switch_now", "已達門檻，回合已結束", until)
        # 規則 5：pending 逾時
        if now - self.pending_since > self.pending_timeout:
            self.pending = False
            return Action("switch_now", "已達門檻，等待回合結束逾時", until)
        return Action("pending", "已達門檻，等待回合結束後切換", until)
