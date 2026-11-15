"""JSON 讀寫。寫入一律原子化（暫存檔 + os.replace），避免其他程序讀到寫一半的檔案。"""

from __future__ import annotations

import json
import os
import tempfile
import time
from pathlib import Path
from typing import Any


def read_json_strict(path: Path | str) -> Any:
    """讀取 JSON；任何錯誤都丟例外（給不得覆寫壞檔的情境使用）。"""
    last_err: Exception | None = None
    for _ in range(5):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except PermissionError as e:  # Windows 檔案正被取代時可能暫時被鎖
            last_err = e
            time.sleep(0.1)
    assert last_err is not None
    raise last_err


def read_json(path: Path | str, default: Any = None) -> Any:
    """讀取 JSON；檔案不存在、被鎖住或內容壞掉時回傳 default。"""
    try:
        return read_json_strict(path)
    except (OSError, ValueError):
        return default


def write_json_atomic(path: Path | str, data: Any) -> None:
    """原子寫入 JSON：寫到同目錄暫存檔，再以 os.replace 取代。"""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        for attempt in range(10):
            try:
                os.replace(tmp, path)
                return
            except PermissionError:
                if attempt == 9:
                    raise
                time.sleep(0.2)
    finally:
        if os.path.exists(tmp):
            try:
                os.remove(tmp)
            except OSError:
                pass
