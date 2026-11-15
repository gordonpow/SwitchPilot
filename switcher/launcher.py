"""GUI 端：啟動 runner、下重啟指令。"""

from __future__ import annotations

import os
import secrets
import shutil
import subprocess
import sys
from pathlib import Path

from . import paths
from .procutil import kill_tree, pid_alive
from .storage import read_json, write_json_atomic


def _python_exe() -> str:
    exe = sys.executable
    p = Path(exe)
    if p.name.lower() == "pythonw.exe":
        return str(p.with_name("python.exe"))
    return exe


def launch(folder, cont=False, popen=subprocess.Popen, wt_path=None) -> str:
    folder = str(folder)
    if ";" in folder:
        raise ValueError("資料夾路徑不可含分號（;）")
    run_id = secrets.token_hex(4)
    py = _python_exe()
    runner = [py, "-m", "switcher.runner", "--run-id", run_id, "--cwd", folder]
    if cont:
        runner.append("--continue")

    env = dict(os.environ)
    env["PYTHONPATH"] = str(paths.project_root())
    env["PYTHONUTF8"] = "1"

    wt = wt_path or shutil.which("wt.exe")
    if wt:
        cmd = [wt, "-w", "new", "--title", "Claude (switcher)", "-d", folder] + runner
        popen(cmd, env=env)
    else:
        popen(runner, env=env, cwd=folder,
              creationflags=getattr(subprocess, "CREATE_NEW_CONSOLE", 0x10))
    return run_id


def _cmd_path(run_id: str) -> Path:
    return paths.runs_dir() / f"{run_id}.cmd.json"


def active_runs() -> list[dict]:
    runs = []
    d = paths.runs_dir()
    if not d.is_dir():
        return runs
    for f in sorted(d.glob("*.state.json")):
        st = read_json(f, None)
        if isinstance(st, dict) and st.get("state") != "exited" and pid_alive(st.get("runner_pid")):
            runs.append(st)
            continue
        run_id = f.name[: -len(".state.json")]
        for victim in (f, _cmd_path(run_id)):
            try:
                victim.unlink()
            except OSError:
                pass
    return runs


def _write_cmd(run, restart: str) -> None:
    path = _cmd_path(run["run_id"])
    prev = read_json(path, None)
    seq = (prev.get("seq", 0) + 1) if isinstance(prev, dict) else 1
    write_json_atomic(path, {"restart": restart, "seq": seq})


def request_restart(run) -> bool:
    """寫 pending 並結束 claude；回傳 claude 是否已結束。"""
    _write_cmd(run, "pending")
    pid = run.get("claude_pid")
    if pid and pid_alive(pid):
        return kill_tree(pid)
    return True


def release_restart(run) -> None:
    _write_cmd(run, "go")


def abort_restart(run) -> None:
    _write_cmd(run, "abort")
