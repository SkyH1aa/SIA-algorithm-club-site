Add-Type -AssemblyName System.Drawing

$root = Join-Path $PSScriptRoot '..\public\GamePictures'
$out = Join-Path $root 'optimized'
New-Item -ItemType Directory -Force -Path $out | Out-Null

$jpgs = Get-ChildItem $root -File -Filter '*.jpg' | Where-Object { $_.Name -notmatch '^(Coin|Enemy|Energy|Life|Main|Skill)' }
$dimensions = @{}
foreach($file in $jpgs){
  $probe=[System.Drawing.Image]::FromFile($file.FullName)
  $dimensions[$file.FullName] = @{ Width=$probe.Width; Height=$probe.Height; Length=$file.Length }
  $probe.Dispose()
}
$items = @(
  @{ Source='匕首.jpg'; Target='weaponDagger.png'; MaxWidth=220 },
  @{ Source='长刀.jpg'; Target='weaponBlade.png'; MaxWidth=300 },
  @{ Source=($jpgs | Where-Object { $dimensions[$_.FullName].Height -eq 341 } | Select-Object -First 1).FullName; Target='weaponPistol.png'; MaxWidth=220 },
  @{ Source=($jpgs | Where-Object { $dimensions[$_.FullName].Height -eq 192 } | Sort-Object Length | Select-Object -Last 1).FullName; Target='weaponShotgun.png'; MaxWidth=280 },
  @{ Source=($jpgs | Where-Object { $dimensions[$_.FullName].Height -eq 192 } | Sort-Object Length | Select-Object -First 1).FullName; Target='weaponSniper.png'; MaxWidth=300 },
  @{ Source=($jpgs | Where-Object { $dimensions[$_.FullName].Height -eq 307 } | Select-Object -First 1).FullName; Target='weaponSmg.png'; MaxWidth=260 },
  @{ Source=($jpgs | Where-Object { $dimensions[$_.FullName].Height -eq 288 } | Select-Object -First 1).FullName; Target='weaponLaser.png'; MaxWidth=300 }
)

foreach($item in $items){
  $targetPath=Join-Path $out $item.Target
  if(Test-Path $targetPath){Remove-Item -LiteralPath $targetPath -Force}
  $source = if([System.IO.Path]::IsPathRooted($item.Source)){ $item.Source }else{ Join-Path $root $item.Source }
  if(-not $item.Source){ throw "Weapon source file was not detected for $($item.Target)" }
  $image = [System.Drawing.Bitmap]::new($source)
  $transparent = [System.Drawing.Bitmap]::new($image.Width,$image.Height,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)

  # Remove only black pixels connected to the image border, preserving dark weapon details.
  $background = New-Object 'bool[,]' $image.Width,$image.Height
  $queue = [System.Collections.Generic.Queue[System.Drawing.Point]]::new()
  for($x=0;$x -lt $image.Width;$x++){
    $queue.Enqueue([System.Drawing.Point]::new($x,0)); $queue.Enqueue([System.Drawing.Point]::new($x,$image.Height-1))
  }
  for($y=0;$y -lt $image.Height;$y++){
    $queue.Enqueue([System.Drawing.Point]::new(0,$y)); $queue.Enqueue([System.Drawing.Point]::new($image.Width-1,$y))
  }
  while($queue.Count -gt 0){
    $point=$queue.Dequeue();$x=$point.X;$y=$point.Y
    if($x -lt 0 -or $y -lt 0 -or $x -ge $image.Width -or $y -ge $image.Height -or $background[$x,$y]){continue}
    $pixel=$image.GetPixel($x,$y)
    if($pixel.R -gt 42 -or $pixel.G -gt 42 -or $pixel.B -gt 42){continue}
    $background[$x,$y]=$true
    $queue.Enqueue([System.Drawing.Point]::new($x+1,$y));$queue.Enqueue([System.Drawing.Point]::new($x-1,$y));$queue.Enqueue([System.Drawing.Point]::new($x,$y+1));$queue.Enqueue([System.Drawing.Point]::new($x,$y-1))
  }
  for($x=0;$x -lt $image.Width;$x++){
    for($y=0;$y -lt $image.Height;$y++){
      $pixel=$image.GetPixel($x,$y)
      if($background[$x,$y]){$pixel=[System.Drawing.Color]::FromArgb(0,$pixel.R,$pixel.G,$pixel.B)}
      $transparent.SetPixel($x,$y,$pixel)
    }
  }
  $scale=[Math]::Min(1.0,$item.MaxWidth/$transparent.Width)
  $width=[Math]::Max(1,[int]($transparent.Width*$scale));$height=[Math]::Max(1,[int]($transparent.Height*$scale))
  $result=[System.Drawing.Bitmap]::new($width,$height,[System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics=[System.Drawing.Graphics]::FromImage($result)
  $graphics.Clear([System.Drawing.Color]::Transparent)
  $graphics.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode=[System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.DrawImage($transparent,0,0,$width,$height)
  $graphics.Dispose();$transparent.Dispose();$image.Dispose()
  $result.Save($targetPath,[System.Drawing.Imaging.ImageFormat]::Png);$result.Dispose()
  Write-Output "$($item.Source) -> $($item.Target) ${width}x${height}"
}
