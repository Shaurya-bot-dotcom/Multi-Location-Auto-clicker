# Tiny helper that moves/clicks the mouse using Windows' own user32.dll.
# It reads one command per line from stdin and answers with one line on stdout.
#   click <x> <y> <left|right> <count>   -> ok
#   pos                          -> pos <x> <y>
#   quit

Add-Type @"
using System;
using System.Runtime.InteropServices;
public struct PT { public int X; public int Y; }
public class MouseApi {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out PT p);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}
"@

[void][MouseApi]::SetProcessDPIAware()

function Say($text) {
  [Console]::Out.WriteLine($text)
  [Console]::Out.Flush()
}

Say "ready"

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $p = $line.Trim().Split(" ")
  try {
    switch ($p[0]) {
      "click" {
        [void][MouseApi]::SetCursorPos([int]$p[1], [int]$p[2])
        Start-Sleep -Milliseconds 15
        if ($p[3] -eq "right") { $down = 0x0008; $up = 0x0010 }
        else                   { $down = 0x0002; $up = 0x0004 }
        $count = 1
        if ($p.Length -gt 4) { $count = [int]$p[4] }
        for ($i = 0; $i -lt $count; $i++) {
          if ($i -gt 0) { Start-Sleep -Milliseconds 40 }
          [MouseApi]::mouse_event($down, 0, 0, 0, [UIntPtr]::Zero)
          Start-Sleep -Milliseconds 15
          [MouseApi]::mouse_event($up, 0, 0, 0, [UIntPtr]::Zero)
        }
        Say "ok"
      }
      "pos" {
        $pt = New-Object PT
        [void][MouseApi]::GetCursorPos([ref]$pt)
        Say ("pos " + $pt.X + " " + $pt.Y)
      }
      "quit" { exit }
      default { Say "err unknown-command" }
    }
  } catch {
    Say ("err " + $_.Exception.Message)
  }
}
