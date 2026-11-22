# Android 聊天记录导出查看器 —— 方案与市场调研

> 目标：把 ChatGPT / Claude / Gemini / DeepSeek / 微信 / QQ / WhatsApp 等导出的
> `.json / .jsonl / .txt / .zip`，在手机上直接变成可读、可搜索、可导出的对话流，
> **不要求用户懂 JSON 结构，也不依赖固定 schema**。

---

## 一、结论先说

1. **需求真实，且已被验证**：网上已有几十个 Web 版"导出查看器"，Android 也出现了
   Pine、Qlip、AI Chat Viewer & Exporter 等早期产品。
2. **没有赢家**：现有产品要么绑死单一平台（只认 ChatGPT），要么只做"格式化预览"，
   要么体积/性能撑不住真实导出（几百 MB、十几万条消息）。
3. **真正的护城河不是 UI，而是"格式自适应引擎"**：一套能对未知 JSON 做结构推断、
   失败后 30 秒人工校正、并把校正结果沉淀成可复用"配方（recipe）"的机制。
4. **移动端独有价值**：导出 zip 常常就是发到手机上的；不上传、不联网、离线可看，
   是 Web 工具给不了的。

---

## 二、市场盘点（2026-11）

### 1. 在线 Web 工具（最卷的一类，基本免费）

| 产品 | 能力 | 局限 |
|---|---|---|
| [lucentool AI Chat Export Viewer](https://lucentool.com/zh/ai-chat-export-viewer) | ChatGPT/Claude/Gemini，本地解析 | 浏览器内存，大文件崩 |
| [unzipchat](https://unzipchat.com/read-claude-export/) | Claude 专用，CSP 断网保证隐私 | 单平台 |
| [memoryplugin](https://www.memoryplugin.com/tools/ai-chat-viewer) / [modelbrain](https://modelbrain.net/chat-export-reader.html) / [1088labs](https://1088labs.com/chat-archive/) / [toololis](https://toololis.com/chat-export-viewer/) | 拖拽即看、搜索 | 同质化，均是"上传到浏览器内存" |
| [Magic Tools](https://tools.cooconsbit.com/zh/tools/chat-export-viewer) / [ponskey](https://ponskey.com/) | 中文界面 | 同上 |

### 2. 开源 / 单文件 HTML（GitHub）

- [akivacp/chatgpt-json-tree-viewer](https://github.com/akivacp/chatgpt-json-tree-viewer)：把会话画成**树**，支持 ChatGPT/Claude/DeepSeek/Grok/Mistral —— 思路值得抄。
- [osteele/claude-chat-viewer](https://github.com/osteele/claude-chat-viewer)（125★）、[Gusarovv/chatgpt-export-viewer](https://github.com/Gusarovv/chatgpt-export-viewer)（分片 `conversations-000.json` + 无扩展名 `.dat` 图片）、[beejaksharam/chatgpt-export-viewer](https://github.com/beejaksharam/chatgpt-export-viewer)、[kevin-369/chat-export-viewer](https://github.com/kevin-369/chat-export-viewer)（Google Chat Takeout）。
- 桌面端：[Stacer-Varien/Chat-Replay](https://github.com/Stacer-Varien/Chat-Replay)、[yolico-p/AI-Chat-Viewer-and-MD-Viewer](https://github.com/yolico-p/AI-Chat-Viewer-and-MD-Viewer)（中文）。

> 结论：**Web/桌面赛道已经饱和**，再做一个网页版没有意义。

### 3. Android 现有产品（重点，直接竞品）

| 产品 | 定位 | 备注 |
|---|---|---|
| **Pine: AI Chat Backup & Notes**（`com.aichatlogviewer.app`） | 导入 HTML / JSON / JSONL / 导出 ZIP，"reads JSON in almost any layout by finding the messages on its own" | **和本需求几乎一模一样**，说明方向对；但仍是 1.x、功能薄 |
| **Qlip: AI Chat Logs & Notes**（`com.orishin.qlip`） | 后台收集文本 + 导入 AI 聊天记录 | 偏"剪藏/笔记"，不是阅读器 |
| **AI Chat Viewer & Exporter**（`com.studio1live.chatgptviewer.offline`，$0.99） | 查看、搜索、导出 PDF/PPT | 付费小工具，格式覆盖窄 |
| 通用 JSON 查看器：Json Genie、JSON Pro、Giant JSON Viewer、[Json List](https://f-droid.org/packages/com.sjapps.jsonlist/) | 折叠树、大文件、语法高亮 | **不做语义化**，看 300MB 的 conversations.json 依然是天书 |
| WhatsApp 类：[Chat Viewer](https://play.google.com/store/apps/details?hl=en&id=com.cvrwc.chatviewer) | 只解析 WhatsApp 导出的 .txt | 格式写死 |
| 国内：[ChatOCR 拾语](https://github.com/CSZSmaf/ChatOCR)（截图 OCR）、[WeFlow](https://weflow.top/)、[轻虾导出助手](https://daochu.qingxia.cn/) | 微信记录导出/分析，基本是 PC 端 | 手机端仍是空白 |

### 4. 市场空缺（机会点）

- 手机上**多格式 + 离线 + 大文件**三件事同时做到的产品，目前没有。
- 中文生态（微信/QQ/豆包/DeepSeek/Kimi/通义）几乎无人覆盖。
- 没有"格式配方"生态：新格式出现时，用户能自助适配、甚至互相分享。
- 没有"归档"心智：现有产品都是一次性查看，没有库、标签、跨文件搜索、年度回顾。

---

## 三、核心思路：把"解析"变成"结构推断"

固定 schema 的解析器一定会被格式变化打死。正确做法是三层：

```
文件层(容器/编码/压缩)  →  推断层(schema inference + recipe)  →  渲染层(阅读器/搜索/导出)
        ↑ 只读字节                ↑ 输出统一 IR                ↑ 只认 IR，不认来源
```

### 3.1 文件层：先搞清楚"这是什么"

- 扩展名不可信：`.txt` 里可能是 JSON，`.json` 里可能是 JSONL，`.zip` 里套 `.zip`。
- 读前 64KB 判定：`{` 对象 / `[` 数组 / 每行独立 JSON / 纯文本聊天 / HTML。
- 编码：BOM（UTF-8/UTF-16）、GB18030（微信/QQ 老导出）、乱码兜底。
- ZIP：读中央目录 → 优先 `conversations*.json` → 支持分片合并 → 附件目录做映射。
- 加密/损坏：导出中断留下的截断 JSON 也要能读出前面 90%（流式容错，遇错跳到下一个 `}` 继续）。

### 3.2 推断层：对未知 JSON 打分

对顶层结构做"候选评分"，而不是硬匹配：

```kotlin
// 启发式：一个"消息对象"长什么样
fun messageScore(node: JsonNode): Int {
  var s = 0
  if (node.hasAny("role","sender","author","from","is_user","speaker")) s += 3
  if (node.hasAny("text","content","mes","message","parts","body"))      s += 3
  if (node.hasAny("create_time","timestamp","created_at","send_date"))  s += 1
  if (node.hasAny("parent","parent_message_uuid","parentId"))           s += 1  // 树形
  return s
}

// 一个"会话"= 消息数组的容器
fun conversationScore(node: JsonNode): Int =
  if (!node.isArray) 0 else {
    val sample = node.first()
    messageScore(sample) * 2 + (if (node.has("title") || node.has("name")) 2 else 0)
  }
```

找到会话列表后，再对**字段做类型适配**（一个字段可能是 5 种形态）：

| 语义 | 可能形态 |
|---|---|
| 正文 | `"text"` / `["a","b"]` / `{"parts":[...]}` / `{"text":"..."}` / `[{"type":"text","text":"..."}]` |
| 角色 | `"user"` / `"human"` / `{"role":"user"}` / `is_user:true` / `from:"me"` |
| 时间 | 秒 / 毫秒 / float 秒 / ISO 字符串 / 无 |

**树形结构还原（最容易翻车的地方）**

- ChatGPT：`mapping{uuid: {message, parent, children}}` + `current_node`。
  正确做法是**从 `current_node` 沿 `parent` 回溯到根，再反转**；直接遍历 mapping 会出现重复消息和已编辑的旧分支。
- Claude：`chat_messages[]` 带 `parent_message_uuid`，同样是树。
- 分支不要丢：标成"编辑版本 2/3"，点一下切换 —— 这反而是差异化功能（谁改过提示词一目了然）。

**问答对结构**（国内导出常见）：`[{q,a}]` / `[{prompt,response}]` → 展开成两条消息，
用时间 + 微秒偏移排序，不要假设"一问一答严格交替"。

**多模态与工具调用**：`content` 里 `type != "text"` 的块折叠成 chip：
`[图片] [代码执行] [联网搜索] [思维链]`，点开再看原文，避免正文被 base64 淹没。

### 3.3 配方（Recipe）机制 —— 这是产品的护城河

自动推断失败时，不要让用户去读 JSON，而是**引导式点选**：

> 顶部提示："检测到 3 个可能的对话列表，请选择" → 展示树 → 点"这是消息" → 点"这是正文" → 完成。
> 生成一条配方，下次自动命中，可导出/分享。

配方是声明式的，能覆盖 95% 的格式：

```json
{
  "name": "ChatGPT export",
  "detect": { "top": "array", "itemHas": "mapping" },
  "conversations": "$[*]",
  "title": "$.title",
  "createdAt": "$.create_time",
  "messages": "$.mapping.*",
  "role": "$.message.author.role",
  "text": "$.message.content.parts",
  "parent": "$.parent",
  "leaf": "$.current_node"
}
```

内置配方首批：ChatGPT、Claude、Gemini(Takeout MyActivity)、DeepSeek、Kimi/豆包/通义、
SillyTavern(.jsonl)、Character.AI、Chatbox/Cherry Studio/NextChat/LobeChat/Jan、
微信 txt、QQ txt、WhatsApp(iOS/Android 两种)、Telegram JSON、Discord、iMessage。

### 3.4 渲染层：只认 IR

```kotlin
data class Conversation(val id: String, val title: String, val createdAt: Long?,
                        val source: String, val model: String?, val msgCount: Int)
data class Message(val id: String, val convId: String, val role: Role,
                   val text: String, val createdAt: Long?, val parentId: String?,
                   val branch: Int, val attachments: List<Att>, val rawRef: String)
```

- 消息气泡 + 代码块（横向滚动、高亮）+ Markdown + 公式（KaTeX 预渲染成图缓存）。
- 图片/附件按导出包内文件名映射；`.dat` 用 magic bytes 识别 PNG/JPEG/WebP。
- "查看原始 JSON"按钮：定位到 `rawRef`，给开发者/较真用户兜底。

---

## 四、Android 工程方案

### 技术选型

| 层 | 选择 | 理由 |
|---|---|---|
| UI | Kotlin + Jetpack Compose (M3) | 列表复用、动效、长图导出都方便 |
| 解析 | kotlinx-serialization 流式 / Gson `JsonReader` | 逐 token，不建全量对象树 |
| 存储 | Room + SQLite FTS5 | 会话表 + 消息表 + 全文索引 |
| 分页 | Paging 3 + LazyColumn | 十万条消息不卡 |
| 文件 | SAF（`ACTION_OPEN_DOCUMENT`）+ 持久化 URI 权限 | 免存储权限、兼容 Android 11+ |
| 后台 | WorkManager（建索引） | 大文件可断点续建 |
| 导出 | Markdown / PDF(`PdfDocument`) / 长图(Bitmap 分片) | |

### 三个必须提前想清楚的坑

1. **OOM：不要把 JSON 读成对象树。**
   真实 ChatGPT 导出 `conversations.json` 常见 100–700MB。方案：
   - 第一遍：流式扫描，只记录每个会话的**字节偏移 + 长度**、标题、时间、消息数；
   - 第二遍（可选，后台）：抽正文写 FTS 索引；
   - 打开某会话：`FileChannel.position(offset)` 读那一段，解析它。
   - 索引表：`Conversation(offset, length, title, ts, count, fingerprint)`。

2. **渲染：一次只 compose 一屏。**
   单条消息可能几万字（长代码/长文），Markdown 渲染要懒加载 + 高度缓存；
   超长会话按 50 条分页。

3. **隐私就是卖点。**
   Manifest **不申请 INTERNET**（或仅在用户主动"分享配方"时用），
   应用商店描述写"文件永不离开设备"，比任何 UI 都值钱。

### MVP 里程碑（4 周可上线内测）

| 周 | 交付 |
|---|---|
| W1 | SAF 选文件 → 容器嗅探（json/jsonl/zip/编码）→ 自动识别 → 会话列表 |
| W2 | ChatGPT/Claude 树还原 + 阅读器（气泡、代码块、图片）+ 单会话搜索 |
| W3 | 全局 FTS 搜索、导出 Markdown、配方点选编辑器 |
| W4 | 大文件压测（500MB/20 万条）、深色模式、Play 上架材料 |

---

## 五、差异化与商业化

**不要做"又一个 JSON 查看器"**，做"AI 聊天记录归档 App"：

1. **格式自适应**（配方引擎 + 社区配方库）—— 别人格式一变就废，你能自愈。
2. **手机端离线**（Web 工具做不到）。
3. **中文生态**（微信/QQ/豆包/DeepSeek/Kimi）—— 海外产品不会做。
4. **归档能力**：多文件库、标签、时间线、跨库搜索、年度报告。
5. **导出**：Markdown / PDF / 长图（小红书/朋友圈分享刚需）。

变现：免费（单文件、基础格式）→ Pro 一次性买断（多库、批量合并、PDF/长图、配方云同步）
→ 可选 BYO-API-key 的"跨会话问答"。

**风险**
- Play 政策：只处理"用户主动导入的自己的导出文件"，文案避免"导出他人聊天记录"。
- 商标：应用名别用 ChatGPT/Claude，用 "Chat Archive / 聊天归档"。
- 各平台导出格式会变：靠配方机制抗。
- 国内分发：涉及"聊天记录"敏感词，审核要走软著 + 备案，渠道优先酷安/应用宝。

---

## 六、下一步

> **现状（1.1）**：网页原型与 Android 壳已经实现了 ZIP 直读（中央目录 + inflate + ZIP64 + 分片合并）
> 与跨会话全文搜索；流式扫描、FTS 索引、配方编辑器仍是计划。

1. 收集 5–10 个真实导出样本（ChatGPT / Claude / DeepSeek / 微信 / WhatsApp / SillyTavern），
   先把**纯 Kotlin 解析器 + 命令行**跑通，验证"结构推断"命中率。
2. 用 Compose 做列表 + 阅读器两个屏，跑一次 300MB 文件的真机压测。
3. 配方编辑器放第二版（先内置 8 个配方）。
