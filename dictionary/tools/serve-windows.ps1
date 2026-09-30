# Лексикон: локальный сервер для Windows 7/8/10/11 без установки чего-либо и без прав администратора.
# Совместим с PowerShell 2.0 и .NET 2.0 (Windows 7 «из коробки»). Запускается файлом Start-Lexikon.bat.
$ErrorActionPreference = 'Stop'
$sep = [IO.Path]::DirectorySeparatorChar
$here = Split-Path -Parent $MyInvocation.MyCommand.Definition
$root = [IO.Path]::GetFullPath((Join-Path $here '..')).TrimEnd($sep) + $sep
$types = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'; '.webmanifest' = 'application/manifest+json'; '.svg' = 'image/svg+xml'
  '.gz' = 'application/gzip'; '.txt' = 'text/plain; charset=utf-8'; '.woff2' = 'font/woff2'; '.png' = 'image/png'; '.ico' = 'image/x-icon'
}

# Постоянный порт, чтобы избранное и история сохранялись между запусками; если занят — следующий свободный.
$listener = $null
foreach ($p in 8765..8785) {
  try {
    $l = New-Object System.Net.Sockets.TcpListener ([Net.IPAddress]::Loopback, $p)
    $l.Start()
    $listener = $l
    $port = $p
    break
  } catch { }
}
if ($listener -eq $null) {
  Write-Host 'Не удалось запустить словарь: все порты 8765-8785 заняты.' -ForegroundColor Red
  Read-Host 'Нажмите Enter, чтобы закрыть'
  exit 1
}

$url = "http://127.0.0.1:$port/"
try { $Host.UI.RawUI.WindowTitle = 'Лексикон — словарь работает' } catch { }
Write-Host ''
Write-Host '  ЛЕКСИКОН — англо-русский словарь' -ForegroundColor Yellow
Write-Host ''
Write-Host "  Адрес словаря: $url"
Write-Host '  Интернет не нужен.'
Write-Host ''
Write-Host '  Не закрывайте это окно, пока пользуетесь словарём.' -ForegroundColor Cyan
Write-Host '  Чтобы выключить словарь — просто закройте окно.'
Write-Host ''

# Открываем в современном браузере, если он есть: Internet Explorer словарь не поддерживает.
$browsers = @()
foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA)) {
  if ($base) {
    $browsers += (Join-Path $base 'Google\Chrome\Application\chrome.exe')
    $browsers += (Join-Path $base 'Microsoft\Edge\Application\msedge.exe')
    $browsers += (Join-Path $base 'Yandex\YandexBrowser\Application\browser.exe')
    $browsers += (Join-Path $base 'Mozilla Firefox\firefox.exe')
  }
}
$opened = $false
foreach ($b in $browsers) {
  if (-not $opened -and [IO.File]::Exists($b)) {
    try { Start-Process $b $url; $opened = $true } catch { }
  }
}
if (-not $opened) {
  try { Start-Process $url } catch { }
  Write-Host '  Если словарь не открылся или пишет «Браузер устарел», установите' -ForegroundColor Yellow
  Write-Host '  Google Chrome, Microsoft Edge или Mozilla Firefox и откройте адрес выше.' -ForegroundColor Yellow
  Write-Host ''
}

$ascii = [Text.Encoding]::ASCII
function Send($stream, [int]$code, [string]$status, [string]$type, [byte[]]$body, [string]$extra) {
  $head = "HTTP/1.1 $code $status`r`nContent-Type: $type`r`nContent-Length: $($body.Length)`r`n$extra" + "Connection: close`r`n`r`n"
  $h = $ascii.GetBytes($head)
  $stream.Write($h, 0, $h.Length)
  if ($body.Length -gt 0) { $stream.Write($body, 0, $body.Length) }
}

function Serve($client) {
  try {
    $client.SendTimeout = 10000
    $client.ReceiveTimeout = 3000
    $stream = $client.GetStream()
    $reader = New-Object IO.StreamReader($stream, $ascii, $false, 4096)
    $first = $reader.ReadLine()
    while ($true) {
      $line = $reader.ReadLine()
      if ($line -eq $null -or $line -eq '') { break }
    }
    $parts = ("" + $first).Split(' ')
    if ($parts.Length -lt 2 -or $parts[0] -ne 'GET') {
      Send $stream 405 'Method Not Allowed' 'text/plain' ([byte[]]@()) ''
      return
    }
    $path = [Uri]::UnescapeDataString(($parts[1] -split '[?#]')[0])
    if ($path.EndsWith('/')) { $path = $path + 'index.html' }
    $file = [IO.Path]::GetFullPath((Join-Path $root $path.TrimStart('/').Replace('/', $sep)))
    if ($file.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -and [IO.File]::Exists($file)) {
      $ext = [IO.Path]::GetExtension($file).ToLower()
      $type = 'application/octet-stream'
      if ($types.ContainsKey($ext)) { $type = $types[$ext] }
      $cache = "Cache-Control: no-cache`r`n"
      if ($ext -eq '.gz' -or $ext -eq '.woff2') { $cache = "Cache-Control: max-age=31536000`r`n" }
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
    $ready = $false
    try { $ready = $c.Connected -and $c.Available -gt 0 } catch { }
    if ($ready) {
      $open.Remove($item)
      Serve $c
      $busy = $true
    } elseif (-not $c.Connected -or ([DateTime]::UtcNow - $item.t).TotalSeconds -gt 30) {
      $open.Remove($item)
      try { $c.Close() } catch { }
    }
  }
  if (-not $busy) { Start-Sleep -Milliseconds 5 }
}
