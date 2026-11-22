# 聊天导出查看器 · Android 壳（APK）

把 `prototype/` 那套已经验证过的网页原封不动装进 WebView，加三件网页做不到的事：

1. **真的能记住文件路径** —— SAF 的 `content://` URI + 持久化读权限，冷启动直接打开上次的导出文件。
2. **能读手机上下载目录里的任意文件** —— 不依赖扩展名，`*/*` 全放行（导出文件经常是无后缀的）。
3. **零联网** —— 清单里没有 `INTERNET` 权限，解析与展示全在本地；`allowBackup="false"`，最近文件记录也不会被云备份带走。

> 这是给「先在手机上真机试一遍」用的版本，不是商店版本：包名 `com.dsh.chatviewer`，版本 1.1（versionCode 5），minSdk 26（Android 8.0），targetSdk 34，自签名（密钥在 `android/keystore/`，见下方[签名](#签名)）。

## 构建

没有 Gradle，直接用 SDK 里的 aapt2 / javac / d8 / zipalign / apksigner 串起来：

```powershell
# 在仓库任意位置都行，脚本按自身位置找工程
npm run apk
# 等价于
powershell -NoProfile -ExecutionPolicy Bypass -File android/build-apk.ps1
```

产物：`android/build/chat-viewer-debug.apk`（约 69KB），同时拷贝一份到 `dist/chat-viewer-1.1-debug.apk` 方便直接下载。

需要 JDK 11+ 和 Android SDK（`build-tools` + `platforms/android-34` 以上）。SDK 位置按
`ANDROID_HOME` → `ANDROID_SDK_ROOT` → `%LOCALAPPDATA%\Android\Sdk` → `C:\Android\Sdk` → `D:\Android\Sdk`
依次查找；`build-tools` 和 `platforms` 自动挑版本号最大的那个，不用改脚本。

脚本末尾会自动跑 `apksigner verify` + `aapt2 dump badging` 自检。

## 签名

密钥在 `android/keystore/`（`chat-viewer.jks` + `keystore.properties`），**不进仓库**（`.gitignore` 挡住）。
第一次构建时脚本自动生成一把（PKCS12 / RSA 2048 / 10000 天），以后每次都用同一把 ——
签名稳定，同包名覆盖安装才不会被系统拒绝。

换成自己的正式密钥：

```powershell
$env:CV_KEYSTORE      = 'D:\keys\my-release.jks'
$env:CV_KEYSTORE_PASS = '...'
$env:CV_KEY_ALIAS     = 'myalias'
$env:CV_KEY_PASS      = '...'   # 和 store 密码一样就不用填
npm run apk
```

默认用 SDK 自带的 `apksigner`；想换成单独装的签名工具，指向它的可执行文件即可：

```powershell
$env:CV_APKSIGNER = 'D:\tools\apksigner\apksigner.bat'
npm run apk
```

> 1.1 这个包就是用外部签名工具（APKSignBox 里带的 `apksigner`）签的，证书和 SDK 版一字不差（SHA-256 `674d5cc7…`），
> 所以之前装过 1.1 测试包的手机可以直接覆盖升级。

**密钥丢了 = 以后装不上更新**（只能卸载重装，最近文件记录会丢）。备份 `android/keystore/`。

**两个踩过的坑，脚本里已经绕开：**

- `aapt2` 在**非 ASCII 路径**下会报 `error: 系统找不到指定的文件 (2)`（`-A` 目录枚举失败，与文件是否存在无关）。所以脚本先把工程拷到系统临时目录里的 ASCII 路径（`$env:CV_STAGE` 可覆盖）构建，最后只把 APK 拷回来。
- PowerShell 5 读**无 BOM 的 UTF-8 脚本**会按 ANSI 解码，中文注释把语法搞崩。`build-apk.ps1` 必须存成 UTF-8 **带 BOM**。

## 安装到手机

三条路，任选：

```powershell
# 1) 数据线，开发者选项里打开 USB 调试
adb install -r dist/chat-viewer-1.1-debug.apk

# 2) 手机和电脑同一局域网时，先在手机上开「无线调试」，配对后
adb connect <手机IP>:<端口>

# 3) 直接把 apk 发到手机（微信/QQ/网盘/数据线拷进 Download），
#    用文件管理器点它安装；第一次会要求「允许安装未知来源应用」。
```

装好后桌面图标是深色对话气泡（`res/drawable/icon.png`），名字「聊天导出查看器」。

## 装好之后怎么用

1. 把导出文件放到手机任意位置（`Download` 最方便）。
2. 打开 App → 右上「打开文件」→ 系统文件选择器里挑那个 json / txt / 无后缀文件。
3. 自动模式会直接给候选；识别不准就切到「手动」自己绑路径，右侧底部能导出配方 JSON。
4. 下次冷启动会**自动打开上次那个文件**；想换就点左上「文件 N ▾」，列表里点另一条。
5. 列表里 ✎ 可以改显示名（比如「小林的 chatgpt 导出」），只改显示，不动真实文件。
6. 右侧那条竖线是**能拖的阅读滑轨**：拖滑块、点轨道、或者聚焦后按 ↑↓ / PgUp PgDn / Home End，悬停看「42% · 第 17/86 条」。手机上整页滚时它会贴住视口右侧。
7. 顶栏「位置 ▾」里可以改**谁在左、谁在右**：我 / AI / 系统 / 其他人，以及状态栏、内心、场景这些小块的左右；自动和手动模式共用这一套，选完自动记住。
8. 顶栏的「位置 ▾」「文件 N ▾」展开后浮在正文之上，不会被下面的会话内容盖住（顶栏原本只有 `backdrop-filter` 自成的层叠上下文，下拉的定位基准和层级都没保障）。
9. 导出是 **zip** 的话直接选那个 zip：会自己找里面像聊天记录的文件，分片自动合并；认不出来就列出包里的文件让你点。
10. 顶栏搜索框能搜所有会话，点命中直接跳到那条消息并高亮；手机上单列长页，点顶栏「搜索」会直接滚到搜索框。

## 原生 ↔ 网页的接口契约

网页侧只需要三个全局函数，都在 `prototype/app.js` 末尾：

| 方向 | 名字 | 说明 |
| --- | --- | --- |
| 网页 → 原生 | `Native.pickFile(reqId)` | 拉起 SAF 选择器，`reqId` 原样回传（`pick`） |
| 网页 → 原生 | `Native.readUri(uri, reqId)` | 按记住的 URI 重新读文件（`reqId='reopen'`） |
| 网页 → 原生 | `Native.version()` / `Native.caps()` | 版本与能力探测 |
| 原生 → 网页 | `window.__nativeFile(p)` | 小文件一次性回调：`{reqId, ok, name, size, uri, base64, error}` |
| 原生 → 网页 | `window.__nativeBegin(p)` / `__nativeChunk(id, b64)` / `__nativeEnd(id)` | 大文件分片，每片 256KB 的 base64 文本 |

为什么要分片：一次 `evaluateJavascript` 塞几十 MB 的字符串，在低端机上会直接 ANR / OOM。分片后每次只过 256KB，WebView 端攒齐再解码。

失败路径都有人管：

- 用户取消 → `error='cancelled'`，网页侧静默返回，**不会**再弹一次选择器（否则取消就死循环）。
- 权限被回收 / 文件被删 → 网页侧先用 IndexedDB 里的字节缓存顶上，并提示「原文件读不到了，已用本地缓存打开」；没缓存才请用户重选。

## 一个不太显眼但重要的决定：不用 file://

页面不是从 `file:///android_asset/` 加载的，而是 `https://app.local/index.html` —— 这个域名不存在，
所有请求都被 `MainActivity.shouldInterceptRequest` 从 assets 里直接返回（`WebResourceResponse`）。

原因：`file://` 来源在 WebView 里是个「不透明来源」，localStorage 通常能用，IndexedDB 却经常打不开。
而「记住最近文件、缓存字节」全靠 IndexedDB。换成 https 拦截后：

- 两套存储都可用，也不需要 `setAllowFileAccessFromFileURLs` 那堆宽松开关；
- 依然零联网：域名是假的，请求根本不出 WebView，清单里也没有 `INTERNET` 权限；
- 顺带把外链导航拦掉（`shouldOverrideUrlLoading` 只放行 `app.local`）。

## 已知限制

- **单文件上限 16MB**（`MAX_BYTES`）。base64 传输 + 一次性解析，内存吃不下更大的。桌面端原型测试过 136MB 的 json，那是流式方案的活，属于 Kotlin 重写阶段。
- 解析仍是**全量入内存**，不是文档里设计的两遍流式扫描。
- zip 能直接读，但加密条目需要密码（暂不支持）、套娃压缩包只提示不解开、包内 >48MB 的条目不自动读。
- HTML 导出、CSV、导出/分享图片、会话收藏仍未做。
- 全文搜索是逐条子串扫描（没有 FTS 索引），16MB 上限内够快，再大就要等流式方案。
- 自签名（密钥在本地 `android/keystore/`）。换机器或丢了密钥，新版就装不到旧版上面，得先卸载；要发正式版建议换成自己的 release key 并备份。

## 文件

```
android/
├─ AndroidManifest.xml          # 无 INTERNET；allowBackup=false；minSdk 26 / targetSdk 34
├─ build-apk.ps1                # 一条命令构建（aapt2 → javac → d8 → zipalign → apksigner）
├─ keystore/                    # 签名密钥（.gitignore 挡住，不进仓库）
├─ make-icon.py                 # 用 Pillow 画 icon.png（192×192）
├─ res/drawable/icon.png        # 桌面图标
├─ res/values/styles.xml        # AppTheme：窗口背景 #14161a，冷启动不闪白
├─ src/com/dsh/chatviewer/MainActivity.java
└─ build/chat-viewer-debug.apk  # 产物
```

`assets/` 是构建时从 `../prototype/` 拷进去的八个文件（`index.html`、`core.js`、`textblocks.js`、`app.js`、`samples.js`、`recents.js`、`scrubber.js`、`zip.js`），不手工维护，改网页即改 App（`zipmake.js` 只给测试用，不进包）。

> 改了 `build-apk.ps1` 记得存成 **UTF-8 带 BOM**：编辑工具默认写无 BOM，PowerShell 5 会按 ANSI 读，中文注释直接把脚本解析崩。

## 验证记录

网页侧（`prototype/verify-native.js`，注入 `window.Native` 桩 + headless Edge）：

- 点「打开」→ 收到 `pickFile('pick')` ✔
- 回调 `__nativeFile(ok:true)` → 3 条消息解析出来、文件进入最近列表 ✔
- 重载页面 → 自动 `readUri('content://…', 'reopen')` ✔
- 模拟重开失败 → 回退 IDB 缓存、提示语正确、不重弹选择器 ✔
- 分片协议 3 片拼回 140.6KB 原文件 → 4000 条消息，字节一致 ✔

APK 静态检查：

- `apksigner verify`：v2 + v3 通过（minSdk 26 不需要 v1）
- `aapt2 dump badging`：`package='com.dsh.chatviewer' versionCode='5' versionName='1.1' minSdkVersion:'26' targetSdkVersion='34'`，`launchable-activity='.MainActivity'`，图标 `res/drawable/icon.png`
- `dexdump`：`MainActivity`、`Bridge.pickFile/readUri/version/caps`、`deliver/post/readAndDeliver` 全在 dex 里
- assets 八个文件与 `prototype/` 源文件的 SHA-256 逐一比对一致
- 清单里 `allowBackup=false`（`aapt2 dump xmltree` 复核）
- 1.1 的 APK：70,599 B，证书 SHA-256 `674d5cc72fdb77920dd38c1b2f0f2e3c8355180d11b9af7c10bce854480c4e76`（这个包是用外部 apksigner 签的，见[签名](#签名)）

> aapt2 会给每个条目录当前时间戳，同一份源码每次构建的 APK 哈希都不一样 —— 判断「能不能覆盖安装」看的是**证书指纹**，不是 APK 哈希。

**没有**覆盖到的：真机上的 SAF 授权弹窗、系统 WebView 版本差异、Android 14 的分区存储细节 —— 这些只能等你在手机上装一次。

## 下一步（真机反馈之后再动）

- 用 Kotlin 重写引擎，两遍流式扫描 + 分段落盘，去掉 16MB 上限。
- 首页改成「最近文件」列表页（现在是网页里的下拉面板）。
- 配方管理：导入/导出 JSON、按扩展名 + 指纹自动套用、出错时引导点选。
- 全文搜索加 FTS5 索引（现在是子串扫描）、导出图片/PDF、长按复制单条消息。
