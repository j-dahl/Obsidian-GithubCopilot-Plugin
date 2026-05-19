import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

export interface WindowsCredential {
  target: string;
  user: string;
  password: string;
}

const WINDOWS_CREDENTIAL_SCRIPT = `
$ErrorActionPreference = "Stop"
$filter = $env:COPILOT_CREDENTIAL_FILTER
Add-Type -Namespace Win32 -Name CredUtil -MemberDefinition @"
[StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
public struct CREDENTIAL {
  public uint Flags; public uint Type; public string TargetName; public string Comment;
  public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
  public uint CredentialBlobSize; public IntPtr CredentialBlob;
  public uint Persist; public uint AttributeCount; public IntPtr Attributes;
  public string TargetAlias; public string UserName;
}
[DllImport("Advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
public static extern bool CredEnumerate(string Filter, uint Flags, out uint Count, out IntPtr Credentials);
[DllImport("Advapi32.dll", SetLastError=true)]
public static extern void CredFree(IntPtr cred);
"@
$count = 0; $ptr = [IntPtr]::Zero
$items = New-Object System.Collections.Generic.List[object]
if ([Win32.CredUtil]::CredEnumerate($filter, 0, [ref]$count, [ref]$ptr)) {
  try {
    for ($i = 0; $i -lt $count; $i++) {
      $credPtr = [Runtime.InteropServices.Marshal]::ReadIntPtr($ptr, $i * [IntPtr]::Size)
      $cred = [Runtime.InteropServices.Marshal]::PtrToStructure($credPtr, [type][Win32.CredUtil+CREDENTIAL])
      $password = ""
      if ($cred.CredentialBlob -ne [IntPtr]::Zero -and $cred.CredentialBlobSize -gt 0) {
        $bytes = New-Object byte[] $cred.CredentialBlobSize
        [Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $bytes, 0, [int]$cred.CredentialBlobSize)
        $utf8 = [Text.Encoding]::UTF8.GetString($bytes).TrimEnd([char]0)
        $utf16 = [Text.Encoding]::Unicode.GetString($bytes).TrimEnd([char]0)
        if ($utf8 -match '^(gho_|ghu_|github_pat_|[{])') { $password = $utf8 } else { $password = $utf16 }
      }
      $items.Add([pscustomobject]@{ target = $cred.TargetName; user = $cred.UserName; password = $password }) | Out-Null
    }
  } finally {
    [Win32.CredUtil]::CredFree($ptr)
  }
}
$items | ConvertTo-Json -Compress
`;

export async function readWindowsCredentialManager(service: string): Promise<WindowsCredential[]> {
  const { stdout } = await execFile(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", WINDOWS_CREDENTIAL_SCRIPT],
    { timeout: 5000, env: { ...process.env, COPILOT_CREDENTIAL_FILTER: service } }
  );
  const raw = stdout.trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw) as WindowsCredential | WindowsCredential[] | null;
  return Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
}
