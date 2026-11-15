"""程序工具：存活判斷與結束程序樹（無黑窗）。"""

from __future__ import annotations

import ctypes
import subprocess
import time
from ctypes import wintypes

NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)

_PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
_STILL_ACTIVE = 259


def pid_alive(pid) -> bool:
    if not pid or int(pid) <= 0:
        return False
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    k32.OpenProcess.restype = wintypes.HANDLE
    k32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    k32.GetExitCodeProcess.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
    k32.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = k32.OpenProcess(_PROCESS_QUERY_LIMITED_INFORMATION, False, int(pid))
    if not handle:
        return False
    try:
        code = wintypes.DWORD()
        if not k32.GetExitCodeProcess(handle, ctypes.byref(code)):
            return False
        return code.value == _STILL_ACTIVE
    finally:
        k32.CloseHandle(handle)


def kill_tree(pid) -> bool:
    """結束程序與其子程序；回傳之後該 pid 是否已不存在。"""
    try:
        subprocess.run(
            ["taskkill", "/PID", str(int(pid)), "/T", "/F"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
            creationflags=NO_WINDOW,
            timeout=15,
        )
    except (OSError, subprocess.SubprocessError):
        pass
    deadline = time.monotonic() + 3
    while pid_alive(pid):
        if time.monotonic() >= deadline:
            return False
        time.sleep(0.1)
    return True
