param([int]$TargetPid, [string]$TextB64, [string]$CtrlKey)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ConInject {
  [StructLayout(LayoutKind.Explicit, CharSet = CharSet.Unicode)]
  public struct KEY_EVENT_RECORD {
    [FieldOffset(0)] public int bKeyDown;
    [FieldOffset(4)] public ushort wRepeatCount;
    [FieldOffset(6)] public ushort wVirtualKeyCode;
    [FieldOffset(8)] public ushort wVirtualScanCode;
    [FieldOffset(10)] public char UnicodeChar;
    [FieldOffset(12)] public uint dwControlKeyState;
  }
  [StructLayout(LayoutKind.Explicit)]
  public struct INPUT_RECORD {
    [FieldOffset(0)] public ushort EventType;
    [FieldOffset(4)] public KEY_EVENT_RECORD KeyEvent;
  }
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool FreeConsole();
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool AttachConsole(uint pid);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr sa, uint disp, uint flags, IntPtr tmpl);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool WriteConsoleInputW(IntPtr h, INPUT_RECORD[] recs, uint n, out uint written);
  public static int Send(uint pid, string text) {
    FreeConsole();
    if (!AttachConsole(pid)) return 10 + Marshal.GetLastWin32Error() * 0;
    IntPtr h = CreateFileW("CONIN$", 0xC0000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
    if (h == new IntPtr(-1)) { FreeConsole(); return 11; }
    var recs = new INPUT_RECORD[text.Length * 2];
    int i = 0;
    foreach (char c in text) {
      ushort vk = (ushort)(c == '\r' ? 0x0D : 0);
      for (int d = 1; d >= 0; d--) {
        recs[i].EventType = 1;
        recs[i].KeyEvent.bKeyDown = d;
        recs[i].KeyEvent.wRepeatCount = 1;
        recs[i].KeyEvent.wVirtualKeyCode = vk;
        recs[i].KeyEvent.UnicodeChar = c;
        i++;
      }
    }
    uint w;
    bool ok = WriteConsoleInputW(h, recs, (uint)recs.Length, out w);
    CloseHandle(h);
    FreeConsole();
    return ok && w == recs.Length ? 0 : 12;
  }
  // Send Ctrl+<letter> as one key-down and one key-up record.
  public static int SendCtrl(uint pid, char letter) {
    FreeConsole();
    if (!AttachConsole(pid)) return 10;
    IntPtr h = CreateFileW("CONIN$", 0xC0000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
    if (h == new IntPtr(-1)) { FreeConsole(); return 11; }
    var recs = new INPUT_RECORD[2];
    for (int d = 0; d < 2; d++) {
      recs[d].EventType = 1;
      recs[d].KeyEvent.bKeyDown = d == 0 ? 1 : 0;
      recs[d].KeyEvent.wRepeatCount = 1;
      recs[d].KeyEvent.wVirtualKeyCode = (ushort)letter;
      recs[d].KeyEvent.UnicodeChar = (char)(letter - 'A' + 1);
      recs[d].KeyEvent.dwControlKeyState = 0x0008;
    }
    uint w;
    bool ok = WriteConsoleInputW(h, recs, 2, out w);
    CloseHandle(h);
    FreeConsole();
    return ok && w == 2 ? 0 : 12;
  }
}
'@
# -CtrlKey and -TextB64 are mutually exclusive; the letter must be A-Z.
if ($CtrlKey) {
  if ($TextB64) { exit 2 }
  if ($CtrlKey -cnotmatch '^[A-Za-z]$') { exit 2 }
  exit [ConInject]::SendCtrl([uint32]$TargetPid, [char]$CtrlKey.ToUpperInvariant())
}
$text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($TextB64))
exit [ConInject]::Send([uint32]$TargetPid, $text)
