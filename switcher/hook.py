"""由 Claude Code 執行的 hook 腳本（stop／stopfailure）：寫事件檔。絕不丟例外。"""

import json
import os
import secrets
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def main() -> None:
    from switcher import paths, storage

    kind = sys.argv[1] if len(sys.argv) > 1 else "stop"
    if kind not in ("stop", "stopfailure"):
        return
    raw = sys.stdin.read()
    data = json.loads(raw) if raw.strip() else {}
    if not isinstance(data, dict):
        data = {}

    slot_id = None
    try:
        from switcher import accounts
        slot_id = accounts.current_slot_id()
    except Exception:
        slot_id = None

    err = data.get("error")
    event = {"kind": kind, "session_id": str(data.get("session_id") or ""),
             "cwd": str(data.get("cwd") or ""),
             "error": str(err) if err is not None else None,
             "slot_id": slot_id, "ts": time.time()}
    name = "%d-%s.json" % (time.time_ns(), secrets.token_hex(2))
    storage.write_json_atomic(paths.events_dir() / name, event)


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    try:
        main()
    except BaseException:
        pass
    sys.exit(0)
