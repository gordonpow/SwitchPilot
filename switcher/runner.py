"""在 Windows Terminal 中執行，託管 claude；GUI 透過 cmd 檔要求重啟。"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import time

from . import paths
from .storage import read_json, write_json_atomic


def _state_path(run_id: str):
    return paths.runs_dir() / f"{run_id}.state.json"


def _cmd_path(run_id: str):
    return paths.runs_dir() / f"{run_id}.cmd.json"


def _write_state(run_id, cwd, state, claude_pid=None) -> None:
    write_json_atomic(_state_path(run_id), {
        "run_id": run_id,
        "cwd": cwd,
        "runner_pid": os.getpid(),
        "claude_pid": claude_pid,
        "state": state,
        "updated": time.time(),
    })


def _read_cmd(run_id) -> str | None:
    data = read_json(_cmd_path(run_id), None)
    if isinstance(data, dict):
        return data.get("restart")
    return None


def _claude_argv(claude: str) -> list[str]:
    if claude.lower().endswith(".py"):
        return [sys.executable, claude]
    return [claude]


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="switcher.runner")
    p.add_argument("--run-id", required=True)
    p.add_argument("--cwd", required=True)
    p.add_argument("--continue", dest="cont", action="store_true")
    p.add_argument("--claude", default=None)
    p.add_argument("--no-pause", action="store_true")
    p.add_argument("--wait-timeout", type=float, default=120)
    a = p.parse_args(argv)

    claude = a.claude or shutil.which("claude")
    if not claude:
        print("[switcher] 找不到 claude，請確認已安裝並在 PATH 中。")
        if not a.no_pause:
            try:
                input("按 Enter 結束…")
            except EOFError:
                pass
        return 1

    cont = a.cont
    while True:
        args = _claude_argv(claude) + (["--continue"] if cont else [])
        proc = subprocess.Popen(args, cwd=a.cwd)
        _write_state(a.run_id, a.cwd, "running", proc.pid)
        proc.wait()

        cmd = _read_cmd(a.run_id)
        if cmd == "pending":
            _write_state(a.run_id, a.cwd, "waiting")
            deadline = time.monotonic() + a.wait_timeout
            while cmd == "pending" and time.monotonic() < deadline:
                time.sleep(0.5)
                cmd = _read_cmd(a.run_id)
            if cmd != "go":
                print("[switcher] 切換已中止或逾時，結束。")
                _write_state(a.run_id, a.cwd, "exited")
                return 0
        elif cmd != "go":
            _write_state(a.run_id, a.cwd, "exited")
            return 0

        try:
            os.remove(_cmd_path(a.run_id))
        except OSError:
            pass
        print("[switcher] 已切換帳號，以 claude --continue 重新啟動…")
        cont = True


if __name__ == "__main__":
    sys.exit(main())
