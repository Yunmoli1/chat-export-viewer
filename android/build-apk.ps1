param(
  # 本地调试用：构建出来的包里打开 WebView 远程调试（默认关闭）
  [switch]$Debug
)

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
# 这个目录会被整个递归删除，所以只允许删「本脚本自己建的」：
# 带标记文件的中转目录，或者系统临时目录下名字对得上的（老版本脚本建的）。
$stage = [System.IO.Path]::GetFullPath($stage)
$stageTop = $stage.TrimEnd('')
$tmpRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$userHome = if ($env:USERPROFILE) { [System.IO.Path]::GetFullPath($env:USERPROFILE).TrimEnd('') } else { '' }
$marker = Join-Path $stage '.cv-build-stage'
if ($stageTop -eq ([System.IO.Path]::GetPathRoot($stage)).TrimEnd('')) {
  throw "CV_STAGE 指向磁盘根目录（$stage），拒绝删除"
}
if ($userHome -and $stageTop -eq $userHome) {
  throw "CV_STAGE 指向用户主目录（$stage），拒绝删除"
}
if ($root.StartsWith($stageTop + '', [StringComparison]::OrdinalIgnoreCase) -or
    $proj.StartsWith($stageTop + '', [StringComparison]::OrdinalIgnoreCase)) {
  throw "CV_STAGE=$stage 是项目自己的上级目录，递归删除会连项目一起删掉，拒绝执行"
}
if (Test-Path $stage) {
  $underTmp = $stageTop.StartsWith($tmpRoot.TrimEnd('') + '', [StringComparison]::OrdinalIgnoreCase)
  $ours = (Test-Path $marker) -or ($underTmp -and (Split-Path $stageTop -Leaf) -like 'chat-viewer-build*')
  if (-not $ours) {
    throw "CV_STAGE=$stage 看起来不是本脚本创建的中转目录（没有 .cv-build-stage 标记），拒绝递归删除。换一个空目录，或手动清空后重试。"
  }
  Remove-Item $stage -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $stage,(Join-Path $stage 'assets'),(Join-Path $stage 'src'),(Join-Path $stage 'out') | Out-Null
Set-Content -Path $marker -Value 'created by android/build-apk.ps1' -Encoding ASCII
Copy-Item (Join-Path $proj 'AndroidManifest.xml') $stage -Force
CopyTree (Join-Path $proj 'src') (Join-Path $stage 'src')
# 调试开关只在这次构建的副本里改，仓库里的 BuildCfg.java 永远是 false
if ($Debug -or $env:CV_DEBUG -eq '1') {
  $cfg = Join-Path $stage 'src\com\dsh\chatviewer\BuildCfg.java'
  $text = [System.IO.File]::ReadAllText($cfg).Replace('DEBUG = false;', 'DEBUG = true;')
  [System.IO.File]::WriteAllText($cfg, $text, (New-Object System.Text.UTF8Encoding($false)))
  Write-Host '  调试构建：WebView 远程调试已打开'
}
CopyTree (Join-Path $proj 'res') (Join-Path $stage 'res')
$files = 'index.html','core.js','textblocks.js','app.js','samples.js','recents.js','scrubber.js','zip.js'
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
  '--version-code','6','--version-name','1.1.1',
  '--auto-add-overlay'
)

Step 'javac 编译 Java 源'
$srcJava = Get-ChildItem (Join-Path $stage 'src') -Recurse -Filter *.java | ForEach-Object { $_.FullName }
$classes = Join-Path $stage 'out\classes'
New-Item -ItemType Directory -Force -Path $classes | Out-Null
RunExe 'javac' (@('--release','11','-encoding','UTF-8','-classpath',$jar,'-d',$classes) + $srcJava)

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

Step '准备签名密钥（keystore/ 不进仓库；没有就自动生成一把）'
# 签名必须稳定：同一个包名换一把密钥，手机就装不上更新（只能卸载重装，数据全没）。
# 优先级：环境变量 CV_KEYSTORE（配 CV_KEYSTORE_PASS / CV_KEY_ALIAS）> android/keystore/ > 现场生成。
$ksDir   = Join-Path $proj 'keystore'
$ksProps = Join-Path $ksDir 'keystore.properties'
if ($env:CV_KEYSTORE) {
  $ks = $env:CV_KEYSTORE
  if (-not (Test-Path $ks)) { throw "CV_KEYSTORE 指向的文件不存在：$ks" }
  if (-not $env:CV_KEYSTORE_PASS) { throw '设置了 CV_KEYSTORE，就要一起设置 CV_KEYSTORE_PASS' }
  $ksPass  = $env:CV_KEYSTORE_PASS
  $keyPass = if ($env:CV_KEY_PASS) { $env:CV_KEY_PASS } else { $ksPass }
  $ksAlias = if ($env:CV_KEY_ALIAS) { $env:CV_KEY_ALIAS } else { 'chatviewer' }
} elseif (Test-Path $ksProps) {
  $cfg = @{}
  Get-Content $ksProps | ForEach-Object {
    if ($_ -match '^\s*([^#=]+?)\s*=\s*(.*)$') { $cfg[$matches[1]] = $matches[2] }
  }
  $ks = Join-Path $ksDir $cfg['storeFile']
  $ksPass  = $cfg['storePassword']
  $keyPass = if ($cfg['keyPassword']) { $cfg['keyPassword'] } else { $ksPass }
  $ksAlias = $cfg['keyAlias']
} else {
  New-Item -ItemType Directory -Force -Path $ksDir | Out-Null
  $ks = Join-Path $ksDir 'chat-viewer.jks'
  $ksAlias = 'chatviewer'
  $alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  $ksPass = -join (1..24 | ForEach-Object { $alphabet[(Get-Random -Maximum $alphabet.Length)] })
  $keyPass = $ksPass
  RunExe 'keytool' @('-genkeypair','-keystore',$ks,'-storetype','PKCS12','-alias',$ksAlias,
    '-storepass',$ksPass,'-keypass',$ksPass,'-keyalg','RSA','-keysize','2048',
    '-validity','10000','-dname','CN=Chat Export Viewer,O=Chat Export Viewer,C=CN')
  Set-Content -Path $ksProps -Encoding ASCII -Value @(
    'storeFile=chat-viewer.jks', "storePassword=$ksPass", "keyAlias=$ksAlias", "keyPassword=$keyPass")
}
if (-not (Test-Path $ks)) { throw "找不到密钥文件：$ks" }
'  keystore: {0}' -f $ks
'  alias:    {0}' -f $ksAlias

Step 'apksigner 签名'
# 默认用 SDK 里的 apksigner；设了 CV_APKSIGNER 就用别的（比如单独装的签名工具）
$apksigner = if ($env:CV_APKSIGNER) { $env:CV_APKSIGNER } else { Join-Path $bt 'apksigner.bat' }
$signedApk = Join-Path $stage 'out\chat-viewer-debug.apk'
RunExe $apksigner @('sign','--ks',$ks,'--ks-key-alias',$ksAlias,
  '--ks-pass',"pass:$ksPass",'--key-pass',"pass:$keyPass",
  '--v1-signing-enabled','true','--v2-signing-enabled','true','--out',$signedApk,$aligned)
Write-Host '  (minSdk 26 靠 v2/v3 就够，Android 7 到 15 都能装)'

Step '自检 + 拷回工程目录'
$outDir = Join-Path $proj 'build'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$final = Join-Path $outDir 'chat-viewer-debug.apk'
Copy-Item $signedApk $final -Force
# 再放一份到仓库根的 dist/，方便直接从仓库下载安装
$distDir = Join-Path $root 'dist'
New-Item -ItemType Directory -Force -Path $distDir | Out-Null
$dist = Join-Path $distDir 'chat-viewer-1.1.1-debug.apk'
Copy-Item $signedApk $dist -Force
& $apksigner 'verify' '--verbose' '--print-certs' $final
& (Join-Path $bt 'aapt2.exe') 'dump' 'badging' $final
Write-Host ''
'APK: {0}' -f $final
'     {0:n0} B  ({1:n2} MB)' -f (Get-Item $final).Length, ((Get-Item $final).Length/1MB)
'DIST: {0}' -f $dist