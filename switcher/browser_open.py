"""由 claude 透過 BROWSER 環境變數呼叫：以 Edge InPrivate 開啟登入網址。絕不丟例外。"""

import os
import subprocess
import sys
import webbrowser

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

_APP_PATHS_KEY = r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe"
_DETACHED = getattr(subprocess, "DETACHED_PROCESS", 0x00000008)
_NEW_GROUP = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0x00000200)


def extract_url(argv):
    """合併參數、去掉前後引號與空白；不是 http 開頭回傳 None。"""
    url = " ".join(argv).strip().strip('"').strip("'").strip()
    return url if url.lower().startswith("http") else None


def find_edge():
    """先讀登錄檔 App Paths，再試預設安裝路徑；找不到回傳 None。"""
    try:
        import winreg
        for hive in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
            try:
                with winreg.OpenKey(hive, _APP_PATHS_KEY) as k:
                    value, _ = winreg.QueryValueEx(k, "")
                if value and os.path.isfile(value):
                    return value
            except OSError:
                continue
    except Exception:
        pass
    for env in ("ProgramFiles(x86)", "ProgramFiles"):
        base = os.environ.get(env)
        if base:
            p = os.path.join(base, "Microsoft", "Edge", "Application", "msedge.exe")
            if os.path.isfile(p):
                return p
    return None


def open_url(url, popen=subprocess.Popen, web_open=webbrowser.open, edge=None):
    """開啟網址；回傳 "edge"（InPrivate）或 "default"（預設瀏覽器）。"""
    edge = edge or find_edge()
    if edge:
        popen([edge, "--inprivate", url], creationflags=_DETACHED | _NEW_GROUP,
              stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
              stderr=subprocess.DEVNULL, close_fds=True)
        return "edge"
    web_open(url)
    return "default"


def main(argv=None):
    url = extract_url(sys.argv[1:] if argv is None else argv)
    if not url:
        return 1
    login_dir = os.environ.get("CLAUDE_SWITCHER_LOGIN_DIR")
    if login_dir:
        try:
            with open(os.path.join(login_dir, "browser_url.txt"), "w", encoding="utf-8") as f:
                f.write(url)
        except OSError:
            pass
    try:
        open_url(url)
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    try:
        code = main()
    except BaseException:
        code = 0
    sys.exit(code)
