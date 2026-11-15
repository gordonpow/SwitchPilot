"""python -m switcher：啟動 GUI。"""

import sys


def _run() -> None:
    if sys.platform == "win32":
        try:
            import ctypes
            ctypes.windll.shcore.SetProcessDpiAwareness(1)
        except Exception:  # noqa: BLE001
            pass
    from .gui import main
    main()


if __name__ == "__main__":
    _run()
