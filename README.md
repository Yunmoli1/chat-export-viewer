# 聊天导出查看器 · Chat Export Viewer

把各种聊天记录导出文件（json / jsonl / txt / 无后缀文件 / zip）读成**能滑、能搜的对话**：ChatGPT、Claude、酒馆（SillyTavern）导出的都行，手机上一键打开，离线、不联网、不上传。

很多人把对话导出成 `conversations.json` 之后就没再打开过 —— 树形的 `mapping`、几十个字段的
元数据、层层嵌套的 `parts`，用文本编辑器看是一坨噪声。这个工具把这些噪声挡在外面，
只留下「谁说了什么」，顺带把 `<div class="status">`、`【状态】` 这类夹在正文里的东西收成可展开的小块。

| 桌面 | 手机 |
| --- | --- |
| ![桌面](docs/screenshots/desktop-auto.png) | ![手机](docs/screenshots/mobile-files.png) |

## 下载安装

Android 8.0 以上，直接装：

**[下载 chat-viewer-1.1.1-debug.apk](https://github.com/Yunmoli1/chat-export-viewer/releases/latest/download/chat-viewer-1.1.1-debug.apk)**

- 版本 1.1.1，包名 `com.dsh.chatviewer`，约 69 KB。
- **清单里没有 `INTERNET` 权限** —— 装完可以在系统设置里核对：它没有联网能力。
- 也关掉了 `allowBackup`，最近文件记录不会被系统云备份带走。
- 正式包关掉了 WebView 远程调试，WebView 本身也不许读本地 `file://` / `content://`；文件只在你亲手选中之后由原生层读一次。
- 第一次安装需要允许「安装未知来源应用」。

不想装 App 也行：双击 `prototype/index.html`，浏览器里跑同一套代码（`file://` 即可，无需服务器）。

## 它能干什么

### 1. 不认识的文件名也能读

导出文件经常没有扩展名（`conversations` 就是一个 4.7 MB 的裸 json），或者明明是 json 却叫 `.dat`。
所以识别**不看文件名、不看 MIME**，只看内容：

| 层 | 做的事 |
| --- | --- |
| 字节层 | 魔数嗅探：ZIP 直接打开浏览（stored / deflate / ZIP64 / GBK 文件名）；PNG / JPEG / PDF / GZIP / SQLite 拦下并说明；含 NUL 的文件按二进制处理 |
| 编码层 | UTF-8 → UTF-16 BOM → GB18030 依次回退，中文导出不乱码 |
| 结构层 | JSON、JSONL、聊天 txt（WhatsApp / 微信 / 方括号时间 / `名字:`），按打分选最像的 |
| 语义层 | 找「≥60% 成员是对象，且同时有角色字段和正文字段」的集合，命中就是消息列表 |

### 2. ChatGPT 的树形导出能正确还原

ChatGPT 的 `mapping` 是一张有向图，不是列表 —— 直接遍历会把「编辑过的旧分支」和「重新生成的前几版」
一起打出来，看起来像重复。这里从 `current_node` 沿 `parent` 回溯到根再反转，只走当前这条线，
旁支计数后丢掉（提示「已丢弃 N 条旁支」）。Claude 的 `parent_message_uuid` 同理。

### 3. 正文里的小块收起来，不打扰阅读

酒馆（SillyTavern）导出、半 HTML 记录里常有这种结构：

```html
<div class="status">时间：22:00 | 地点：公寓</div>
<div class="thoughts">（其实他有点紧张）</div>
```

它们会被切出来、按类别（状态栏 / 内心 / 摘要 / 系统 / 旁白 / 选项 / 场景 / 折叠块）配色，
渲染成折叠块插回原来的位置，默认收起。分类是双语词表 + class 名 + 中文伪标签（`【状态】`、`（旁白）`）一起判断的。

### 4. 左右谁说话，自己摆

顶栏「位置 ▾」里可以改：我 / AI / 系统 / 其他人各自靠左、居中还是靠右；
状态栏、内心这些**块**也能单独指定左右（或跟随所在气泡）。自动模式和手动模式共用同一套设置，
重开还记得。

![位置弹层](docs/screenshots/pop-align.png)

### 5. 侧边滑轨：能拖的进度条

手机上整页滚很长时原生滚动条几乎抓不住。右侧那条竖线是真进度条：拖滑块、点轨道、键盘
↑↓ / PgUp PgDn / Home End，悬停显示「42% · 第 17/86 条」。桌面贴面板内，手机贴视口右侧。

![滑轨](docs/screenshots/scrubber.png)

### 6. 记得住上次打开的文件

顶栏「文件 N ▾」是最近文件列表：点行切换、✎ 改显示名、× 移除。记住路径的能力按环境降级 ——

| 环境 | 记住什么 | 下次冷启动 |
| --- | --- | --- |
| Android App | SAF 的 `content://` URI（持久化读权限） | 直接读原文件 |
| Chrome / Edge | File System Access 句柄 | 请求一次权限后读原文件 |
| 其它浏览器 | 文件字节缓存（IndexedDB） | 用缓存打开 |

文件被删了、权限被回收了，会先用缓存顶上并提示，不会静悄悄失败。

### 7. 压缩包直接看，不用先解压

ChatGPT 的导出常常是一个 zip，里面 `conversations.json`、附件目录、README 混在一起。
直接把 zip 拖进来（手机上直接选）就行：

- 自己读中央目录，支持 stored / deflate、ZIP64、GBK 文件名。
- 自动猜哪个文件像聊天记录：按名字（conversation / message / chat / 聊天 / 记录）、内容
  （开头是 `[` `{`）、体积打分，最多试 6 个，跳过 48MB 以上的附件。
- 分片导出（`conversations-000.json`、`-001` …）自动按序号合并。
- 单个条目解压上限 64 MB（防止压缩炸弹），解压后核对 CRC32：坏包会说明文件损坏，而不是给你一堆乱码。
- 猜不出来就把包里的文件列出来，带「只看像聊天的」过滤，点哪行读哪个；加密条目会说明需要密码。

| 桌面 | 手机 |
| --- | --- |
| ![压缩包](docs/screenshots/zip-browse.png) | ![压缩包（手机）](docs/screenshots/zip-mobile.png) |

### 8. 全文搜索

顶栏搜索框（Ctrl / Cmd + F）搜所有会话：命中列表带「会话名 · 那一条的摘录」，点一条直接跳到
对应消息并高亮闪一下；Enter / ↑ 在命中之间绕圈，Shift+Enter 反向，Esc 清空。多词是 AND。

手机上单列长页，预览在最下面，所以窄屏顶栏会多出一个「搜索」按钮：点它直接滚到预览并聚焦输入框，
不用自己一路滑下去找。

![全文搜索](docs/screenshots/search.png)

## 识别不准怎么办：手动映射

自动识别只是**猜**，猜错了就切「手动」：左栏列出识别到的每个结构签名（×次数 + 首行样本），
给它选类别（角色 / 正文 / 时间 / 状态栏 / 忽略……），中栏填会话与消息的路径，右栏实时重排。

改完的东西会生成一段声明式配方 JSON（`detect` / `locate` / `extract` / `assemble` / `display` 五段），
可以复制、下载，同一份配方可以复用到结构相同的导出文件上。

## 已知限制

- **网页版是全量解析**，大文件（>100 MB）会卡；Android 版单文件上限 16 MB。
- ZIP 只读不写：加密条目需要密码（暂不支持），套娃压缩包只提示不解开，包里 >48MB 的条目不会被自动读。
- 没有 PDF / 图片导出、CSV；全文搜索是子串扫描，没有索引。
- HTML 导出只按标签 + class 名做启发式解析，复杂模板可能分错块。
- 自签名，不是商店版本。

## 从源码构建

网页版不需要构建：直接打开 `prototype/index.html`。

APK 需要 Node 22+、JDK 11+ 和 Android SDK（`build-tools` + `platforms`）。
SDK 位置按 `ANDROID_HOME` → `ANDROID_SDK_ROOT` → 常见安装路径依次查找：

```powershell
npm run apk
```

产物在 `android/build/`，同时复制一份到 `dist/`；脚本末尾自动跑 `apksigner verify` 和
`aapt2 dump badging` 自检。

**签名**：密钥放在 `android/keystore/`（不进仓库，第一次构建自动生成 PKCS12 / RSA 2048，之后一直复用，
这样同包名覆盖安装不会被系统拒绝）。换成自己的密钥或别的 apksigner：

```powershell
$env:CV_KEYSTORE      = 'D:\keys\my-release.jks'
$env:CV_KEYSTORE_PASS = '...'
$env:CV_KEY_ALIAS     = 'myalias'
$env:CV_APKSIGNER     = 'D:\tools\apksigner\apksigner.bat'
npm run apk
```

密钥丢了，之前装过旧版本的手机就装不上新版本，记得备份。

## 许可

MIT，见 [LICENSE](LICENSE)。

这是个人小工具，按「现状」提供，不承诺兼容性也不对你的数据负责 —— 但请放心，它连网都上不了，
导入的文件只留在你自己的设备上。
