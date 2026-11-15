"""使用者設定（config.json）。"""

from __future__ import annotations

from . import paths, storage

DEFAULTS = {"threshold": 95, "auto_switch": True, "last_folder": ""}


def load() -> dict:
    """讀取設定，並與預設值合併；檔案不存在或壞掉時回傳預設值。"""
    cfg = dict(DEFAULTS)
    data = storage.read_json(paths.config_file(), None)
    if isinstance(data, dict):
        cfg.update(data)
    return cfg


def save(cfg: dict) -> None:
    storage.write_json_atomic(paths.config_file(), cfg)
