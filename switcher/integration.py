"""安裝／移除 Claude Code settings.json 中的 statusLine 與 hooks。"""

from __future__ import annotations

import copy
import time

from switcher import paths, storage

_MARKERS = ("switcher/statusline.py", "switcher/hook.py")


def _fwd(p) -> str:
    return str(p).replace("\\", "/")


def _is_ours_cmd(cmd) -> bool:
    if not isinstance(cmd, str):
        return False
    c = cmd.replace("\\", "/")
    return any(m in c for m in _MARKERS)


def _is_ours_statusline(sl) -> bool:
    return isinstance(sl, dict) and _is_ours_cmd(sl.get("command"))


def _python_exe(python_exe=None) -> str:
    return _fwd(paths.python_exe(python_exe))


def _load_settings() -> dict:
    path = paths.settings_file()
    if not path.exists():
        return {}
    data = storage.read_json_strict(path)
    if not isinstance(data, dict):
        raise ValueError("settings.json 不是 JSON 物件，不予修改")
    return data


def _backup(settings: dict) -> None:
    if paths.settings_file().exists():
        name = "settings-%d.json" % time.time_ns()
        storage.write_json_atomic(paths.backups_dir() / name, settings)


def _strip_ours_hooks(settings: dict) -> None:
    hooks = settings.get("hooks")
    if not isinstance(hooks, dict):
        return
    for event in list(hooks.keys()):
        groups = hooks[event]
        if not isinstance(groups, list):
            continue
        new_groups = []
        for g in groups:
            if not isinstance(g, dict) or not isinstance(g.get("hooks"), list):
                new_groups.append(g)
                continue
            kept = [h for h in g["hooks"]
                    if not (isinstance(h, dict) and _is_ours_cmd(h.get("command")))]
            if kept:
                g = dict(g)
                g["hooks"] = kept
                new_groups.append(g)
            elif not g["hooks"]:
                new_groups.append(g)  # 原本就是空的，不是我們造成的
        if new_groups:
            hooks[event] = new_groups
        else:
            del hooks[event]
    if not hooks:
        del settings["hooks"]


def install(python_exe=None, project_root=None) -> None:
    settings = _load_settings()
    _backup(settings)
    new = copy.deepcopy(settings)

    root = _fwd(project_root or paths.project_root())
    py = _python_exe(python_exe)
    base = '"%s" "%s/switcher/' % (py, root)

    current = new.get("statusLine")
    if current is not None and not _is_ours_statusline(current):
        storage.write_json_atomic(paths.integration_file(), {"statusLine": current})

    _strip_ours_hooks(new)
    new["statusLine"] = {"type": "command", "command": base + 'statusline.py"'}
    hooks = new.setdefault("hooks", {})
    if not isinstance(hooks, dict):
        raise ValueError("settings.json 的 hooks 格式不是物件，不予修改")
    hooks.setdefault("Stop", []).append(
        {"hooks": [{"type": "command", "command": base + 'hook.py" stop'}]})
    hooks.setdefault("StopFailure", []).append(
        {"matcher": "rate_limit",
         "hooks": [{"type": "command", "command": base + 'hook.py" stopfailure'}]})
    storage.write_json_atomic(paths.settings_file(), new)


def uninstall() -> None:
    path = paths.settings_file()
    if not path.exists():
        return
    settings = _load_settings()
    _backup(settings)
    new = copy.deepcopy(settings)
    _strip_ours_hooks(new)
    if _is_ours_statusline(new.get("statusLine")):
        saved = storage.read_json(paths.integration_file(), None)
        if isinstance(saved, dict) and saved.get("statusLine") is not None:
            new["statusLine"] = saved["statusLine"]
        else:
            del new["statusLine"]
        try:
            paths.integration_file().unlink()
        except OSError:
            pass
    storage.write_json_atomic(path, new)


def is_installed() -> bool:
    data = storage.read_json(paths.settings_file(), None)
    if not isinstance(data, dict):
        return False
    if _is_ours_statusline(data.get("statusLine")):
        return True
    hooks = data.get("hooks")
    if isinstance(hooks, dict):
        for groups in hooks.values():
            for g in groups if isinstance(groups, list) else []:
                for h in (g.get("hooks") or []) if isinstance(g, dict) else []:
                    if isinstance(h, dict) and _is_ours_cmd(h.get("command")):
                        return True
    return False
