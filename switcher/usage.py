"""讀取 statusline 寫入的用量與 hook 寫入的事件。"""

from __future__ import annotations

import os

from switcher import paths, storage


def _json_files(d):
    try:
        return sorted(n for n in os.listdir(d) if n.endswith(".json"))
    except OSError:
        return []


def latest_usage(slot_id, since: float = 0.0):
    best = None
    d = paths.usage_dir()
    for name in _json_files(d):
        rec = storage.read_json(d / name, None)
        if not isinstance(rec, dict) or rec.get("slot_id") != slot_id:
            continue
        ts = rec.get("ts")
        if not isinstance(ts, (int, float)) or ts < since:
            continue
        if best is None or ts > best["ts"]:
            best = rec
    return best


def is_stale(record, now: float, max_age: float = 600) -> bool:
    try:
        return now - float(record["ts"]) > max_age
    except Exception:
        return True


def read_new_events(after_name):
    d = paths.events_dir()
    events = []
    last = after_name
    for name in _json_files(d):
        if after_name is not None and name <= after_name:
            continue
        rec = storage.read_json(d / name, None)
        if last is None or name > last:
            last = name
        if isinstance(rec, dict):
            rec["_name"] = name
            events.append(rec)
    return events, last


def cleanup(now: float, max_age: float = 86400) -> None:
    for d in (paths.usage_dir(), paths.events_dir()):
        for name in _json_files(d):
            p = d / name
            try:
                if now - p.stat().st_mtime > max_age:
                    p.unlink()
            except OSError:
                pass
