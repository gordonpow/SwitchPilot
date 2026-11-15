# Read, write or delete the Windows Credential Manager entry used by agy.
# Usage: agycred.ps1 -Action read|write|delete [-Target gemini:antigravity]
# read   : prints one JSON line {"user":"...","blob_b64":"..."}; exit 3 if the entry does not exist.
# write  : reads one JSON line {"user":"...","blob_b64":"..."} from stdin.
# delete : removes the entry; a missing entry is treated as success.
# This script never writes files or logs and never prints anything on failure.
param(
  [Parameter(Mandatory = $true)][ValidateSet('read', 'write', 'delete')][string]$Action,
  [string]$Target = 'gemini:antigravity'
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class AgyCred {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public uint Flags;
    public uint Type;
    public string TargetName;
    public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public uint CredentialBlobSize;
    public IntPtr CredentialBlob;
    public uint Persist;
    public uint AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool CredReadW(string target, uint type, uint flags, out IntPtr cred);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool CredWriteW(ref CREDENTIAL cred, uint flags);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool CredDeleteW(string target, uint type, uint flags);
  [DllImport("advapi32.dll")]
  public static extern void CredFree(IntPtr buf);

  // Returns 0 on success, 3 if not found, 4 on other errors.
  public static int Read(string target, out string user, out string blobB64) {
    user = null; blobB64 = null;
    IntPtr p;
    if (!CredReadW(target, 1, 0, out p)) {
      return Marshal.GetLastWin32Error() == 1168 ? 3 : 4;
    }
    try {
      CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
      byte[] b = new byte[c.CredentialBlobSize];
      if (c.CredentialBlobSize > 0) Marshal.Copy(c.CredentialBlob, b, 0, (int)c.CredentialBlobSize);
      user = c.UserName == null ? "" : c.UserName;
      blobB64 = Convert.ToBase64String(b);
      return 0;
    } finally {
      CredFree(p);
    }
  }

  public static int Write(string target, string user, string blobB64) {
    byte[] b = Convert.FromBase64String(blobB64);
    IntPtr mem = Marshal.AllocHGlobal(b.Length == 0 ? 1 : b.Length);
    try {
      if (b.Length > 0) Marshal.Copy(b, 0, mem, b.Length);
      CREDENTIAL c = new CREDENTIAL();
      c.Type = 1;
      c.TargetName = target;
      c.UserName = user;
      c.CredentialBlobSize = (uint)b.Length;
      c.CredentialBlob = mem;
      c.Persist = 2;
      return CredWriteW(ref c, 0) ? 0 : 4;
    } finally {
      Marshal.FreeHGlobal(mem);
    }
  }

  public static int Delete(string target) {
    if (CredDeleteW(target, 1, 0)) return 0;
    return Marshal.GetLastWin32Error() == 1168 ? 0 : 4;
  }
}
'@
try {
  if ($Action -eq 'read') {
    $user = $null; $blob = $null
    $rc = [AgyCred]::Read($Target, [ref]$user, [ref]$blob)
    if ($rc -ne 0) { exit $rc }
    $o = [ordered]@{ user = $user; blob_b64 = $blob }
    [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress))
    exit 0
  } elseif ($Action -eq 'write') {
    $line = [Console]::In.ReadLine()
    $j = $line | ConvertFrom-Json
    exit ([AgyCred]::Write($Target, [string]$j.user, [string]$j.blob_b64))
  } else {
    exit ([AgyCred]::Delete($Target))
  }
} catch {
  exit 4
}
