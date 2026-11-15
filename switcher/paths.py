"""所有檔案路徑。每次呼叫都重新讀取環境變數，方便測試覆寫。"""

from __future__ import annotations

import os
import sys
from pathlib import Path


def _home() -> Path:
    return Path(os.path.expanduser("~"))


def project_root() -> Path:
    """`switcher` 套件的上一層目錄。"""
    return Path(__file__).resolve().parent.parent


def python_exe(python_exe=None) -> Path:
    """背景執行用的 python.exe（若目前是 pythonw.exe 則換成同目錄的 python.exe）。"""
    exe = Path(python_exe or sys.executable)
    if exe.name.lower() == "pythonw.exe":
        exe = exe.with_name("python.exe")
    return exe


# ---- Claude Code 的檔案 ----

def claude_home() -> Path:
    override = os.environ.get("CLAUDE_SWITCHER_CLAUDE_HOME")
    return Path(override) if override else _home() / ".claude"


def cred_file() -> Path:
    return claude_home() / ".credentials.json"


def settings_file() -> Path:
    return claude_home() / "settings.json"


def claude_json() -> Path:
    override = os.environ.get("CLAUDE_SWITCHER_CLAUDE_JSON")
    return Path(override) if override else _home() / ".claude.json"


# ---- 本程式的資料 ----

def app_dir() -> Path:
    override = os.environ.get("CLAUDE_SWITCHER_HOME")
    return Path(override) if override else _home() / ".claude-switcher"


def slots_dir() -> Path:
    return app_dir() / "slots"


def usage_dir() -> Path:
    return app_dir() / "usage"


def events_dir() -> Path:
    return app_dir() / "events"


def runs_dir() -> Path:
    return app_dir() / "runs"


def backups_dir() -> Path:
    return app_dir() / "backups"


def config_file() -> Path:
    return app_dir() / "config.json"


def active_file() -> Path:
    return app_dir() / "active.json"


def integration_file() -> Path:
    return app_dir() / "integration.json"


def login_dir() -> Path:
    """瀏覽器登入的暫存目錄根（內含權杖，用完必須刪除）。"""
    return app_dir() / "login"
