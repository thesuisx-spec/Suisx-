# Лексикон: локальный сервер для Windows без установки чего-либо (встроенный PowerShell, без прав администратора).
# Запускается файлом Start-Lexikon.bat из корня папки.
$ErrorActionPreference = 'Stop'
$sep = [IO.Path]::DirectorySeparatorChar
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd($sep) + $sep
$types = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'; '.webmanifest' = 'application/manifest+json'; '.svg' = 'image/svg+xml'
  '.gz' = 'application/gzip'; '.txt' = 'text/plain; charset=utf-8'; '.woff2' = 'font/woff2'; '.png' = 'image/png'; '.ico' = 'image/x-icon'
}

# Постоянный порт, чтобы избранное и история сохранялись между запусками; если занят — следующий свободный.
$listener = $null
foreach ($port in 8765..8785) {
  try {
    $l = New-Object System.Net.Sockets.TcpListener ([Net.IPAddress]::Loopback, $port)
    $l.Start()
    $listener = $l
    break
  } catch { }
}
if (-not $listener) {
  Write-Host 'Не удалось запустить словарь: все порты 8765-8785 заняты.' -ForegroundColor Red
  Read-Host 'Нажмите Enter, чтобы закрыть'
  exit 1
}

$url = "http://127.0.0.1:$port/"
$Host.UI.RawUI.WindowTitle = 'Лексикон — словарь работает'
Write-Host ''
Write-Host '  ЛЕКСИКОН — англо-русский словарь' -ForegroundColor Yellow
Write-Host ''
Write-Host "  Словарь открыт в браузере: $url"
Write-Host '  Интернет не нужен.'
Write-Host ''
Write-Host '  Не закрывайте это окно, пока пользуетесь словарём.' -ForegroundColor Cyan
Write-Host '  Чтобы выключить словарь — просто закройте окно.'
Write-Host ''
try { Start-Process $url } catch { Write-Host "  Откройте в браузере: $url" }

$ascii = [Text.Encoding]::ASCII
function Send($stream, [int]$code, [string]$status, [string]$type, [byte[]]$body, [string]$extra) {
  $head = "HTTP/1.1 $code $status`r`nContent-Type: $type`r`nContent-Length: $($body.Length)`r`n$extra" + "Connection: close`r`n`r`n"
  $h = $ascii.GetBytes($head)
  $stream.Write($h, 0, $h.Length)
  if ($body.Length) { $stream.Write($body, 0, $body.Length) }
}

function Serve($client) {
  try {
    $client.SendTimeout = 10000
    $stream = $client.GetStream()
    $reader = New-Object IO.StreamReader($stream, $ascii, $false, 4096, $true)
    $first = $reader.ReadLine()
    while ($true) { $line = $reader.ReadLine(); if ($line -eq $null -or $line -eq '') { break } }
    $parts = "$first".Split(' ')
    if ($parts.Length -lt 2 -or $parts[0] -ne 'GET') {
      Send $stream 405 'Method Not Allowed' 'text/plain' ([byte[]]@()) ''
      return
    }
    $path = [Uri]::UnescapeDataString(($parts[1] -split '[?#]')[0])
    if ($path.EndsWith('/')) { $path += 'index.html' }
    $file = [IO.Path]::GetFullPath((Join-Path $root $path.TrimStart('/').Replace('/', $sep)))
    if ($file.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -and [IO.File]::Exists($file)) {
      $ext = [IO.Path]::GetExtension($file).ToLower()
      $type = if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' }
      $cache = if ($ext -eq '.gz' -or $ext -eq '.woff2') { "Cache-Control: max-age=31536000`r`n" } else { "Cache-Control: no-cache`r`n" }
      Send $stream 200 'OK' $type ([IO.File]::ReadAllBytes($file)) $cache
    } else {
      Send $stream 404 'Not Found' 'text/plain' ($ascii.GetBytes('Not found')) ''
    }
  } catch {
  } finally {
    try { $client.Close() } catch { }
  }
}

# Browsers open spare connections in advance and may send nothing on them for a while, so the loop
# serves whichever connection has a request and drops idle ones, instead of waiting on each in turn.
$open = New-Object System.Collections.ArrayList
while ($true) {
  $busy = $false
  while ($listener.Pending()) {
    [void]$open.Add(@{ c = $listener.AcceptTcpClient(); t = [DateTime]::UtcNow })
    $busy = $true
  }
  foreach ($item in @($open)) {
    $c = $item.c
    try { $ready = $c.Connected -and $c.Available -gt 0 } catch { $ready = $false }
    if ($ready) {
      $open.Remove($item); Serve $c; $busy = $true
    } elseif (-not $c.Connected -or ([DateTime]::UtcNow - $item.t).TotalSeconds -gt 30) {
      $open.Remove($item); try { $c.Close() } catch { }
    }
  }
  if (-not $busy) { Start-Sleep -Milliseconds 5 }
}
