"""以瀏覽器登入新增帳號：在暫存的 CLAUDE_CONFIG_DIR 下執行 `claude auth login`。"""

from __future__ import annotations

import os
import re
import secrets
import shutil
import subprocess
import threading
import time
from pathlib import Path

from . import paths, procutil, storage

_URL_RE = re.compile(r"https://\S+")


class LoginError(Exception):
    pass


class LoginSession:
    def __init__(self, claude_cmd: list[str] | None = None, popen=subprocess.Popen) -> None:
        self._claude_cmd = claude_cmd
        self._popen = popen
        self.dir: Path | None = None
        self.proc = None
        self._lines: list[str] = []
        self._fallback_url: str | None = None
        self._lock = threading.Lock()
        self.started_at = 0.0

    def start(self) -> None:
        cmd = self._claude_cmd
        if cmd is None:
            exe = shutil.which("claude")
            if not exe:
                raise LoginError("找不到 claude 指令")
            cmd = [exe, "auth", "login"]
        d = paths.login_dir() / secrets.token_hex(4)
        d.mkdir(parents=True, exist_ok=True)
        self.dir = d
        try:
            script = paths.project_root() / "switcher" / "browser_open.py"
            bat = d / "open_browser.cmd"
            bat.write_text(
                '@chcp 65001 >nul\r\n@"%s" "%s" %%*\r\n' % (paths.python_exe(), script),
                encoding="utf-8", newline="")
            env = dict(os.environ)
            env["CLAUDE_CONFIG_DIR"] = str(d)
            env["BROWSER"] = str(bat)
            env["CLAUDE_SWITCHER_LOGIN_DIR"] = str(d)
            env["PYTHONUTF8"] = "1"
            self.proc = self._popen(
                cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT, creationflags=procutil.NO_WINDOW,
                env=env, cwd=str(d))
        except Exception as e:
            self.cleanup()
            if isinstance(e, LoginError):
                raise
            raise LoginError(f"無法啟動登入程序：{e}") from e
        self.started_at = time.time()
        threading.Thread(target=self._read_stdout, daemon=True).start()

    def _read_stdout(self) -> None:
        try:
            stream = self.proc.stdout
            for raw in iter(stream.readline, b""):
                line = raw.decode("utf-8", "replace").rstrip("\r\n")
                with self._lock:
                    self._lines.append(line)
                    if self._fallback_url is None:
                        m = _URL_RE.search(line)
                        if m:
                            self._fallback_url = m.group(0)
        except Exception:
            pass

    def poll(self) -> str:
        if self.proc is None:
            return "failed"
        code = self.proc.poll()
        if code is None:
            return "running"
        return "done" if code == 0 else "failed"

    def login_url(self) -> str | None:
        if self.dir is not None:
            try:
                text = (self.dir / "browser_url.txt").read_text(encoding="utf-8").strip()
                if text:
                    return text
            except OSError:
                pass
        with self._lock:
            return self._fallback_url

    def last_lines(self, n: int = 5) -> list[str]:
        with self._lock:
            return [ln for ln in self._lines if ln.strip()][-n:]

    def result(self) -> tuple[dict, dict]:
        d = self.dir
        names = ", ".join(sorted(p.name for p in d.iterdir())) if d and d.is_dir() else ""
        creds = storage.read_json(d / ".credentials.json", None) if d else None
        cj = storage.read_json(d / ".claude.json", None) if d else None
        acct = cj.get("oauthAccount") if isinstance(cj, dict) else None
        if (not isinstance(creds, dict) or "claudeAiOauth" not in creds
                or not isinstance(acct, dict) or not acct):
            raise LoginError("登入完成但讀不到憑證或帳號資訊。暫存目錄內的檔案：" + (names or "（空）"))
        return creds, acct

    def cancel(self) -> None:
        if self.proc is not None and self.proc.poll() is None:
            procutil.kill_tree(self.proc.pid)
        self.cleanup()

    def cleanup(self) -> None:
        proc = self.proc
        if proc is not None:
            try:  # 只關 stdin；stdout 由讀取執行緒在程序結束時自然收尾
                if proc.stdin:
                    proc.stdin.close()
            except Exception:
                pass
        d = self.dir
        if d is None:
            return
        for i in range(3):
            shutil.rmtree(d, ignore_errors=True)
            if not d.exists():
                return
            time.sleep(0.3)


def cleanup_stale() -> None:
    """刪除 login/ 下殘留的目錄（上次異常結束）。"""
    root = paths.login_dir()
    if root.is_dir():
        shutil.rmtree(root, ignore_errors=True)
