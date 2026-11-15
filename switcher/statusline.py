"""由 Claude Code 執行的 statusline 腳本：記錄用量並輸出一行狀態。絕不丟例外。"""

import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _window(rl, key):
    try:
        w = rl.get(key)
        if not isinstance(w, dict) or w.get("used_percentage") is None:
            return None
        return {"used_percentage": float(w["used_percentage"]),
                "resets_at": float(w.get("resets_at") or 0)}
    except Exception:
        return None


def _fmt(w):
    return "--" if w is None else "%d%%" % round(w["used_percentage"])


def main() -> None:
    from switcher import paths, storage

    raw = sys.stdin.read()
    data = json.loads(raw) if raw.strip() else {}
    if not isinstance(data, dict):
        data = {}

    slot_id = None
    name = "未儲存"
    try:
        from switcher import accounts
        slot_id = accounts.current_slot_id()
        if slot_id:
            slot = accounts.get_slot(slot_id)
            if slot and slot.get("name"):
                name = str(slot["name"])
    except Exception:
        slot_id = None

    rl = data.get("rate_limits")
    if not isinstance(rl, dict):
        rl = {}
    five = _window(rl, "five_hour")
    seven = _window(rl, "seven_day")

    session_id = str(data.get("session_id") or "unknown")
    safe = "".join(c if (c.isalnum() or c in "-_") else "_" for c in session_id)
    record = {"session_id": session_id, "cwd": str(data.get("cwd") or ""),
              "slot_id": slot_id, "ts": time.time(),
              "five_hour": five, "seven_day": seven}
    try:
        storage.write_json_atomic(paths.usage_dir() / (safe + ".json"), record)
    except Exception:
        pass

    print("[%s] 5h %s · 7d %s" % (name, _fmt(five), _fmt(seven)))


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    try:
        main()
    except BaseException:
        try:
            print("[switcher]")
        except Exception:
            pass
    sys.exit(0)
