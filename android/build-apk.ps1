$ErrorActionPreference = 'Stop'
# aapt2 在中文路径下会报 "系统找不到指定的文件 (2)"（-A 目录遍历失败），
# 所以所有构建动作都在纯 ASCII 的中转目录里做，最后只把 APK 拷回工程目录。
# 仓库根目录 = 本脚本所在目录的上一级，跟工程放在哪、叫什么都无关
$proj   = $PSScriptRoot
$root   = Split-Path -Parent $proj
$proto  = Join-Path $root 'prototype'

# aapt2 在非 ASCII 路径下会挂，中转目录默认放系统临时目录，可用 CV_STAGE 覆盖
$stage  = if ($env:CV_STAGE) { $env:CV_STAGE } else { Join-Path ([System.IO.Path]::GetTempPath()) 'chat-viewer-build' }

# SDK 位置：ANDROID_HOME / ANDROID_SDK_ROOT 优先，然后试几个常见安装位置
$candidates = @(
  $env:ANDROID_HOME,
  $env:ANDROID_SDK_ROOT,
  (Join-Path $env:LOCALAPPDATA 'Android\Sdk'),
  'C:\Android\Sdk',
  'D:\Android\Sdk'
) | Where-Object { $_ }
$sdk = $null
foreach ($c in $candidates) { if (Test-Path $c) { $sdk = $c; break } }
if (-not $sdk) { throw "找不到 Android SDK。装一个 Android SDK（只要 build-tools + platforms 即可），或设置环境变量 ANDROID_HOME 指向它。试过：$($candidates -join '; ')" }

# 自动挑最新的 build-tools 和 platforms，避免写死 35.0.0 / android-34
$bt = (Get-ChildItem (Join-Path $sdk 'build-tools') -Directory -ErrorAction Stop | Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1).FullName
$plat = (Get-ChildItem (Join-Path $sdk 'platforms') -Directory -Filter 'android-*' -ErrorAction Stop | Sort-Object { [int]($_.Name -replace '[^0-9]','') } -Descending | Select-Object -First 1).FullName
$jar = Join-Path $plat 'android.jar'
Write-Host "SDK: $sdk"
Write-Host "build-tools: $bt"

function Step($m) { Write-Host "== $m" -ForegroundColor Cyan }
function RunExe($exe, [string[]]$argv) {
  & $exe @argv
  if ($LASTEXITCODE -ne 0) { throw "FAILED ($LASTEXITCODE): $exe $($argv -join ' ')" }
}
function CopyTree($from, $to) {
  New-Item -ItemType Directory -Force -Path $to | Out-Null
  Copy-Item (Join-Path $from '*') $to -Recurse -Force
}

Step '准备 ASCII 中转目录'
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage,(Join-Path $stage 'assets'),(Join-Path $stage 'src'),(Join-Path $stage 'out') | Out-Null
Copy-Item (Join-Path $proj 'AndroidManifest.xml') $stage -Force
CopyTree (Join-Path $proj 'src') (Join-Path $stage 'src')
CopyTree (Join-Path $proj 'res') (Join-Path $stage 'res')
$files = 'index.html','core.js','textblocks.js','app.js','samples.js','recents.js','scrubber.js'
foreach ($f in $files) {
  $src = Join-Path $proto $f
  if (-not (Test-Path $src)) { throw "缺少 $src" }
  Copy-Item $src (Join-Path $stage "assets\$f") -Force
}
Get-ChildItem (Join-Path $stage 'assets') | ForEach-Object { '  {0}  {1:n0} B' -f $_.Name, $_.Length }

Step 'aapt2 compile 资源'
$resZip = Join-Path $stage 'out\res.zip'
RunExe (Join-Path $bt 'aapt2.exe') @('compile','--dir',(Join-Path $stage 'res'),'-o',$resZip)

Step 'aapt2 link（清单 + 资源 + assets）'
$baseApk = Join-Path $stage 'out\base.apk'
RunExe (Join-Path $bt 'aapt2.exe') @(
  'link','-o',$baseApk,
  '-I',$jar,
  '-R',$resZip,
  '--manifest',(Join-Path $stage 'AndroidManifest.xml'),
  '-A',(Join-Path $stage 'assets'),
  '--min-sdk-version','26','--target-sdk-version','34',
  '--version-code','4','--version-name','1.0',
  '--auto-add-overlay'
)

Step 'javac 编译 Java 源'
$srcJava = Join-Path $stage 'src\com\dsh\chatviewer\MainActivity.java'
$classes = Join-Path $stage 'out\classes'
New-Item -ItemType Directory -Force -Path $classes | Out-Null
RunExe 'javac' @('--release','11','-encoding','UTF-8','-classpath',$jar,'-d',$classes,$srcJava)

Step 'd8 生成 classes.dex'
$dexDir = Join-Path $stage 'out\dex'
New-Item -ItemType Directory -Force -Path $dexDir | Out-Null
$classFiles = Get-ChildItem $classes -Recurse -Filter *.class | ForEach-Object { $_.FullName }
RunExe (Join-Path $bt 'd8.bat') (@('--min-api','26','--lib',$jar,'--output',$dexDir) + $classFiles)

Step '把 classes.dex 塞进 APK'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$dex = Join-Path $dexDir 'classes.dex'
if (-not (Test-Path $dex)) { throw "d8 没产出 classes.dex" }
$zip = [System.IO.Compression.ZipFile]::Open($baseApk, 'Update')
try {
  $existing = $zip.GetEntry('classes.dex')
  if ($existing) { $existing.Delete() }
  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $zip, $dex, 'classes.dex', [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
} finally { $zip.Dispose() }
'  classes.dex {0:n0} B' -f (Get-Item $dex).Length

Step 'zipalign 4 字节对齐'
$aligned = Join-Path $stage 'out\aligned.apk'
RunExe (Join-Path $bt 'zipalign.exe') @('-f','4',$baseApk,$aligned)

Step '生成 debug keystore（仅首次）'
$ks = Join-Path $stage 'debug.keystore'
if (-not (Test-Path $ks)) {
  RunExe 'keytool' @('-genkeypair','-keystore',$ks,'-alias','androiddebugkey',
    '-storepass','android','-keypass','android','-keyalg','RSA','-keysize','2048',
    '-validity','10000','-dname','CN=DSH Debug,O=DSH,C=CN')
}

Step 'apksigner 签名'
$signedApk = Join-Path $stage 'out\chat-viewer-debug.apk'
RunExe (Join-Path $bt 'apksigner.bat') @('sign','--ks',$ks,'--ks-key-alias','androiddebugkey',
  '--ks-pass','pass:android','--key-pass','pass:android',
  '--v1-signing-enabled','true','--v2-signing-enabled','true','--out',$signedApk,$aligned)
Write-Host '  (v1+v2 这样 Android 7 到 14 都能装)'

Step '自检 + 拷回工程目录'
$outDir = Join-Path $proj 'build'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$final = Join-Path $outDir 'chat-viewer-debug.apk'
Copy-Item $signedApk $final -Force
# 再放一份到仓库根的 dist/，方便直接从仓库下载安装
$distDir = Join-Path $root 'dist'
New-Item -ItemType Directory -Force -Path $distDir | Out-Null
$dist = Join-Path $distDir 'chat-viewer-1.0-debug.apk'
Copy-Item $signedApk $dist -Force
& (Join-Path $bt 'apksigner.bat') 'verify' '--verbose' '--print-certs' $final
& (Join-Path $bt 'aapt2.exe') 'dump' 'badging' $final
Write-Host ''
'APK: {0}' -f $final
'     {0:n0} B  ({1:n2} MB)' -f (Get-Item $final).Length, ((Get-Item $final).Length/1MB)
'DIST: {0}' -f $dist