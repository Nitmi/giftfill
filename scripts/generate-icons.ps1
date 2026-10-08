Add-Type -AssemblyName System.Drawing
$projectRoot = Split-Path -Parent $PSScriptRoot
$iconRoot = Join-Path $projectRoot 'public\icon'
New-Item -ItemType Directory -Path $iconRoot -Force | Out-Null
foreach ($size in @(16,32,48,128)) {
  $bitmap = New-Object System.Drawing.Bitmap $size,$size
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.Color]::FromArgb(32,44,73))
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White),([single]($size/18))
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $x = [single]($size*.22); $y = [single]($size*.38); $w = [single]($size*.56); $h = [single]($size*.39)
  $graphics.DrawRectangle($pen,$x,$y,$w,$h)
  $graphics.DrawLine($pen,[single]($size*.5),$y,[single]($size*.5),[single]($size*.77))
  $graphics.DrawLine($pen,$x,[single]($size*.5),[single]($size*.78),[single]($size*.5))
  $graphics.DrawEllipse($pen,[single]($size*.32),[single]($size*.22),[single]($size*.18),[single]($size*.16))
  $graphics.DrawEllipse($pen,[single]($size*.5),[single]($size*.22),[single]($size*.18),[single]($size*.16))
  $bitmap.Save((Join-Path $iconRoot "$size.png"),[System.Drawing.Imaging.ImageFormat]::Png)
  $pen.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
}
