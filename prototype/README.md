# 双模式聊天查看器 · Web 原型

把「自动识别 + 手动映射」做成可以点的东西，用来在写 Android 代码之前验证交互和配方结构。

## 打开

直接双击 `index.html`（file:// 即可，无需服务器、无需联网）。默认加载 ChatGPT 样本。
带参数：

- `index.html?mode=manual` —— 启动即进手动映射
- `index.html?blank=1` —— 空白启动，自己拖文件进去
- `index.html?sample=stdiv` / `?sample=cntags` —— 直接开一个文本样本（酒馆 div / 中文标签）

支持拖拽：把 json / jsonl / txt 拖到窗口任意位置。

## 界面三段

| 区域 | 内容 |
| --- | --- |
| 左栏 | 文件识别结果（识别类型 / 编码 / 结构 / 提示）+ 可展开的 JSON 结构树（悬停看根路径） |
| 中栏 | 自动模式：候选卡片（分数、会话路径、消息路径、几条会话几条消息）<br>手动模式：路径表单 + 每条路径的下拉候选（带样本值） |
| 右栏 | 预览气泡（我 / AI / 系统）+ 统计 + 会话切换 tab + 底部可展开配方 JSON（复制 / 下载） |

## 已实现

- **文件层**：魔数嗅探（ZIP 直接打开浏览，PNG/JPEG/PDF/GZIP/SQLite 拦下并解释，含 NUL 的按二进制处理）、UTF-8 / UTF-16 BOM / GB18030 解码回退、JSON、JSONL、聊天 txt。
- **识别层（自动）**：DFS 找「≥60% 的成员是对象，且同时有角色字段和正文字段」的集合，按 priority 表打分选字段，产出候选（会话路径 / 消息路径 / 排序方式）。ChatGPT 的 `mapping`（dict）也能识别。
- **树形还原**：有 leaf + parent 时从 current_node 回溯到根再 reverse，旁支计为「已丢弃 N 条」。
- **聊天 txt**：5 条行规则（WhatsApp iOS/Android、微信时间开头、方括号时间、`名字:`），命中最多者胜出；不匹配的行并入上一条（续行）。
- **识别层（手动）**：会话集合 / 消息集合 / 角色 / 正文 / 时间 / 消息 ID / 父节点 / 标题 / 叶子节点 / 排序，全部是相对当前节点的路径，下拉里能看到真实命中的样本值。
- **展示层**：气泡对齐、角色中文名（我 / AI / 系统）、系统消息折叠开关、时间显示；块渲染成 `<details>` 折叠盒子，徽章按类别配色，嵌套子块可再展开。
- **配方**：右侧底部实时生成 recipe JSON（detect / locate / extract / assemble / display 五段），可复制、可下载。这就是将来 Android 端要存的东西。
- **文本块化（无后缀 txt / 半 HTML 导出）**：把 `<div>`、`<details>`、`【状态】` 这类结构切成块，非对话内容收成可展开的小盒子，按原文顺序插回对话。
  - 标签栈扫描（容错未闭合 / 多余闭合 / 自闭合 / `<br>`），不依赖 DOM，同一份代码 Node 与浏览器共用。
  - 容器识别：同一 class 出现 ≥2 次、多数有子元素、平均长度合理、且语义像对话容器（`div.mes`）→ 一条消息一个容器；被容器包住的内层容器自动剔除。容器内按 `name / mes_text / time` 类名抽名字、正文、时间。
  - 块分类：双语词表把签名分到 状态栏 / 内心 / 摘要 / 系统 / OOC / 选项 / 场景 / 装饰 / 折叠块；`<details><summary>` 的 summary 文本参与分类，且不会重复成子块。
  - 行规则：`名字: 内容`、`名字 — 内容`、`[时间] 名字: 内容`，外加 `【状态】…` / `[状态]…` / `（旁白）…` 伪标签（延续到空行或下一条行规则）。
  - 手动模式：左栏列出识别到的每个块签名（×次数 + 首行样本 + 下拉类别），改类别立刻重排；`忽略不显示` 直接丢弃；块位置可选「跟随所属消息」或「独立插在对话间」。

## 压缩包直读（zip / 分片导出）

把 zip 拖进来就能直接用，不需要先解压、不需要外部库：

- **自己解析中央目录**：EOCD 反向扫描 → 中央目录项 → 本地文件头，支持 stored(0) / deflate(8)、
  ZIP64（`0x06064b50` / `0x07064b50`，大包与超 4GB 偏移）、UTF-8 flag（`0x0800`）与 GBK 文件名回退。
- **解压**：优先 `DecompressionStream('deflate-raw')`，不可用或失败时退回纯 JS inflate（约 3KB），
  老 WebView 也能开。
- **猜文件**：按名字（conversation / message / chat / history / 导出 / 记录）、内容（4KB 内开头是 `[` `{`，
  否则尝试按聊天 txt 解析 ≥2 条）、体积打分；`__MACOSX`、readme、manifest 之类减分；最多试 6 个、跳过 >48MB。
- **分片合并**：`conversations-000.json`、`-001`… 按数字序合并后再识别（ChatGPT 大导出就是这么切的）。
- **兜底 UI**：认不出来就列出包内文件（最多 200 行），带「只看像聊天的」过滤；点哪行读哪个。
  条目加密、套娃压缩包、解压失败都有各自的提示，不会静默失败。

## 全文搜索

顶栏搜索框，或 Ctrl / Cmd + F 聚焦：

- 搜所有会话的正文（多条消息拼成纯文本后匹配），命中上限 200 条，列表显示前 60 条。
- 每条命中带「会话名 · 摘录」，点一下切到那个会话、滚到那条消息、加 `mark.q-mark` 高亮并闪一下。
- Enter / ↓ 下一条、Shift+Enter / ↑ 上一条（到末尾绕回），Esc 清空；多词按 AND 处理；输入 160ms 防抖。
- 手机单列时预览在最下面，顶栏会多出「搜索」按钮（`#btnSearch`，只在 ≤760px 显示）：点了先滚到预览面板再聚焦输入框。

## 左右位置：角色和文本块都能自定义

配色跟着角色走，左右跟着设置走 —— 两者分开，所以「我」的蓝气泡也可以放在右边。

顶栏的「位置 ▾」打开一个弹层，两段：

- **角色**：我 / AI / 系统消息 / 其他人 × 左·中·右。
- **文本块**：状态栏、内心、摘要、系统块、旁白 OOC、选项、场景、折叠块、其它块 × 左·中·右；
  「其它块」是兜底项，没单独设过的类别都用它。
- 底部「恢复默认（我在左 / AI 在右）」一键还原。

两条硬要求都覆盖到了：

- **自动模式和手动模式共用同一套设置** —— 手动模式里只放一个「打开「位置」→ 改谁在左 / 谁在右」的按钮，点开还是同一个弹层，不分叉。
- **不光气泡，消息内部的小块也能左右摆**。块默认跟着所在气泡那一侧；单独给某个类别设了左右，它就在气泡里靠那一侧 —— 块容器是 flex 列，靠对齐方式（`align-self`）而不是浮动，所以窄屏也不会溢出。

选择写进配方 `display`：`{ "align": {...}, "blockAlign": { "status": "right" } }`，
同时也存 localStorage（`cv.display.v1`），关掉再开还在。Android 端直接读配方这一段，不需要另建偏好数据。

## 阅读滑轨（侧面可拖的进度条）

右侧那条竖线是**能拖的**进度条，不是装饰：手机上整页滚很长时，原生滚动条几乎看不见、也拖不稳，这条滑轨就是替代品。

- **拖动**：按住滑块上下拖（Pointer Events + `setPointerCapture`，鼠标、触摸、触控笔同一套代码）。
- **点轨道**：点哪跳哪，滑块跟着居中过去。
- **键盘**：聚焦后 ↑ / ↓ 走 40px，PageUp / PageDown 走一屏，Home / End 到头尾（`role="slider"` + `aria-valuenow`）。
- **悬停提示**：「42% · 第 17/86 条」—— 百分比 + 当前屏幕顶部是第几条消息。
- **滑块长度按比例**：`max(32px, view² / total)`，内容越长滑块越短；内容不满一屏时整条滑轨自动隐藏。

两种滚动模式自动切换，不需要配置：

| 场景 | 谁在滚 | 滑轨 |
| --- | --- | --- |
| 桌面（宽屏） | 预览面板自己滚（`#preview`） | 贴在面板内的右边缘 |
| 手机（窄屏） | 整页滚（`window`） | 变成 `position: fixed` 贴视口右侧，滚动时不跟着走 |

原生滚动条在预览面板里被隐藏（`scrollbar-width: none`），避免两条叠在一起打架。

## 最近文件：记住路径、随手切换、随便改名

顶栏左边那个「文件 N ▾」就是文件列表。点一下展开：

- **上面是最近用过的文件**，每行显示：自定义名 / 文件名、大小、上次打开时间、有没有本地缓存。
- **点行即可切换**，不用重新选文件。
- **✎ 改名**只改显示名，不动真实文件（改名不会写回磁盘，也不影响系统里的文件名）。
- **× 移除**只是从列表里删掉，磁盘上的文件当然还在。
- **下面是内置样本**，用来对比不同格式的识别效果。

记住路径的能力按运行环境降级，三档：

| 环境 | 记住什么 | 下次冷启动 |
| --- | --- | --- |
| Android 壳（APK） | SAF 的 `content://` URI（持久化读权限） | 直接读原文件 |
| Chrome / Edge | File System Access 句柄 | 请求一次权限后读原文件 |
| 其它浏览器 | 文件字节缓存（IndexedDB，≤24MB） | 用缓存打开；原文找不到了也能看 |

三档都失效时（文件被删、权限被回收），会先尝试缓存并提示「原文件读不到了，已用本地缓存打开」；缓存也没有才请你重选，不会静悄悄失败。

记住的东西分两处存：元数据（名字、时间、URI）在 localStorage，字节与句柄在 IndexedDB —— 换浏览器/清缓存只丢缓存，列表还在。

## 手机上的样子

窄屏（≤760px）自动变单列：顶栏换行、文件面板变成贴边的浮层、气泡宽度收到视口内，不会横向滚动。截图见 `shot-mobile-files.png`。

## 尚未实现（下一步）

- 点选式绑定（在左栏结构树上点节点自动填路径），现在只有下拉。
- 配方的保存 / 复用 / 分享，以及「手动配方回流自动识别」的优先级合并。
- 大文件流式（浏览器里仍是全量解析，所以别拿 300MB 的试）。
- HTML 导出解析、CSV、PDF / 图片导出；搜索没有索引（大文件慢）。
- 文本侧：真正的 HTML 解析（现在只认标签 + class 名）、`<style>/<script>` 内容剔除（已在扫描时跳过，但 `<style>` 里的 CSS 文本仍可能漏进正文，待样本验证）、块级配方的保存与跨文件复用。

## 验证

```bash
node test.js        # core.js 纯逻辑：36 条断言
node test-text.js   # textblocks.js 块解析：38 条断言
node test-zip.js    # zip.js：12 条（stored/deflate/ZIP64/GBK/加密/截断/JS inflate 兜底）

# 下面这些是端到端验证：每个脚本自带 `harness.js`，会自己拉起一台 headless Edge/Chrome、
# 开一个临时用户目录、跑完关掉。不需要事先开调试端口，也不需要手动清理进程。
node verify-ui.js      # 三栏尺寸、候选卡片、气泡数量、模式切换、无横向溢出
node verify-text.js    # 酒馆 div / 中文伪标签 / 手动改类别 / 切回 JSON 不串味，并截图
node verify-files.js   # 最近文件：切换、重载后自动回到上次
node verify-mobile.js  # 412×915：单列、无横向溢出、文件浮层贴边
node verify-align.js   # 左右位置：默认、改角色、恢复默认、手动模式、JSON 样本
node verify-scrub.js   # 滑轨：真鼠标拖动 / 点轨道 / 键盘 / 提示文案 / 手机整页滚 / 设置持久化
node verify-pops.js    # 顶栏下拉不被正文盖住（elementFromPoint 探针 + 把 header 改回 static 的反证）
node verify-native.js  # 注入 window.Native 桩，模拟 APK 里的路径：选文件 → 回调加载 /
                       # 冷启动按 URI 重开 / 重开失败回退缓存 / 分片传输
node verify-zip.js     # 压缩包：自动挑 conversations.json / 分片合并 / 认不出时列文件 / 加密条目
node verify-search.js  # 全文搜索：跨会话命中、点击跳转高亮、环绕、多词 AND、空结果、Ctrl+F、手机窄屏
```

找不到浏览器时设环境变量 `CV_BROWSER` 指向 Edge / Chrome 的可执行文件；`browser.js` 里列了
Windows 与 Linux/macOS 的常见位置。也可以 `npm run verify` 一次跑完十组。

`test.js` 覆盖：ChatGPT 树形顺序（a1,a2,a3,a5，丢弃 2 条旁支）、Claude、SillyTavern 布尔 is_user、WhatsApp 续行合并、路径引擎 5 项。
`test-text.js` 覆盖：`div.mes` 容器（只剩最外层）、名字 / 正文 / 时间抽取、`details` 归内心且 summary 不重复、`div.stat` 归状态栏、内联块 parts 顺序、中文伪标签四种类别、手动改类别（含容器内块）、关闭容器、`attach=standalone`、畸形标签容错、纯文本不崩。
`verify-ui.js` + `verify-page.js` 通过 CDP 在真实 Chromium 里跑一遍：三栏尺寸/无横向溢出、候选卡片、气泡数量、手动表单 10 个字段、样本切换后状态不残留。
`verify-text.js` 实测（1600×1000）：酒馆样本 4 条消息 3 个块（内心/状态栏×2，全部内联在气泡里）、中文样本 5 条消息 5 个块且场景块独立排最前、手动模式下把 `pseudo:*` 改成「忽略」后块从 5 变 4、切回 ChatGPT 样本状态干净、无横向溢出。

`verify-align.js` 实测（1600×1000）：酒馆样本「我」的 x 偏移 0（贴左）、AI 距右 0（贴右）；弹层里把「我」改成右、「AI」改成左后 4 条消息全部对调；点「恢复默认」回到左/右且 localStorage 同步；手动模式读到同一套设置；ChatGPT 样本同样左右交替；无横向溢出、无页面错误。
`verify-scrub.js` 实测：滑轨 `thumbH=288 / railH=374`，真鼠标拖到底 `scrollTop` 139（= 最大滚动量）、`aria-valuenow=100`、提示「100% · 第 2/4 条」；点轨道底部跳到底；键盘 End / Home 到头尾；角色「我」改右后气泡 x 775 → 1038、类名 `msg me side-right`；状态栏块改右后 `blk-wrap side-right`；独立插在对话间的块（`attach=standalone`，直接挂在 `.msgs` 下）改右后 x 从 0 变 186 / 215 / 210；刷新后设置仍在（x=1038、块 2 个靠右）；412×915 下 `rail.fixed=true`、拖动后 `window.scrollY=411`。

`verify-zip.js` 实测：`chatgpt.zip`（readme + conversations.json + 一张图）自动打开 1 会话 2 条、来源显示 `conversations.json`；`shards.zip` 把 000 / 001 两片合并成 2 会话 4 条；`media.zip`（图片 + m4a）弹出条目列表，选中 m4a 给「这是二进制文件」而不是瞎解析；`locked.zip` 的加密条目说明需要密码并留在列表态。

`verify-search.js` 实测：三个会话里搜「关东煮」得 3 条且首条属于早餐会话，点第 3 条切到夜宵、正文出现 1 个 `mark.q-mark` 与一次 `q-flash`；Enter 从末条绕回早餐；「关东煮 不错」是 1 条（AND）；无结果时提示「没有命中」并收起浮层；Ctrl+F 聚焦搜索框、Esc 清空。412×915 下 `scrollWidth=412` 无横向溢出，命中浮层 `x=23 / w=358` 在视口内。

`verify-pops.js` 实测：顶栏的「位置」「文件」弹层用 `elementFromPoint` 在内部取三点探测，桌面 1280×800 与手机 412×915 全部命中弹层自身（`bad: []`），手机端弹层 `x=10 / w=392` 不溢出；反证：把顶栏改回 `position:static`（修复前的写法）后，探测点立刻命中 `.msgs` 和 `.msg`，即正文确实会盖住下拉——说明这个测试不是空跑。

> 实现要点：顶栏原本只有 `backdrop-filter` 自成的层叠上下文，下拉又是 `position:absolute`，定位基准不确定、层级也不占优，于是被正文盖住。现在 `header{position:relative; z-index:50}` 同时解决「弹层挂哪儿」和「弹层盖谁」；手机整页滚时固定的滑轨降到 `z-index:40`，仍高于正文但不会压在弹层上；toast 抬到 80。

## 文件

- `core.js` —— JSON 侧识别与装配（无 DOM）
- `zip.js` —— ZIP 读取器（中央目录 / inflate / ZIP64 / GBK / 加密检测）
- `zipmake.js` —— 造 zip 的测试工具（stored、deflate、ZIP64、加密标记、截断），不进 APK
- `scrubber.js` —— 阅读滑轨（拖动 / 点击 / 键盘 / 两种滚动模式）
- `harness.js` —— 验证脚手架：拉起 headless 浏览器 + CDP 客户端 + 截图（`launch()`）
- `browser.js` —— 找 Edge / Chrome（`CV_BROWSER` 优先，其次各平台常见路径）
- `serve.js` —— 本地静态服务器（`npm run serve`，127.0.0.1:8765）
- `verify-pops.js` —— 顶栏下拉的层叠验证（`elementFromPoint` 探针 + 反证）
- `recents.js` —— 最近文件（localStorage 元数据 + IndexedDB 字节/句柄，三档降级）
- `textblocks.js` —— 文本 / 半 HTML 的块解析（无 DOM，UMD，Node 可直接 require）
- `app.js` —— DOM 渲染与交互
- `index.html` —— 结构与内联样式
- `samples.js` —— 由 `build-samples.js` 从 `../sniffer/fixtures` 与 `fixtures-text` 生成
- `test.js` / `test-text.js` / `test-zip.js` / `verify-ui.js` / `verify-page.js` / `verify-text.js` / `verify-align.js` / `verify-scrub.js` / `verify-pops.js` / `verify-files.js` / `verify-mobile.js` / `verify-native.js` / `verify-zip.js` / `verify-search.js` —— 验证
- `fixtures-text/` —— 文本样本（`tavern_div.txt` 酒馆 div 导出、`cn_tags_dialogue.txt` 中文伪标签）
- `shot-text-tavern.png` / `shot-text-cn.png` / `shot-text-manual.png` —— 文本模式截图
- `shot-mobile-files.png` / `shot-mobile-full.png` / `shot-native-flow.png` —— 窄屏与原生流程截图
- `shot-scrub.png` / `shot-scrub-mobile.png` —— 滑轨（桌面 / 手机）
- `shot-align-blocks.png` / `shot-align-stdiv.png` / `shot-align-swapped.png` / `shot-align-manual.png` / `shot-align-json.png` —— 左右位置截图
- `shot-zip.png` / `shot-zip-mobile.png` / `shot-search.png` / `shot-search-mobile.png` —— 压缩包与全文搜索截图
- 打包装 APK：见 `../android/README.md`