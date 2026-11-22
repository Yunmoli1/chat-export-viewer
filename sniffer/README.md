# Sniffer —— 聊天导出文件「先认结构、不认名字」探测器

单文件命令行原型，用来验证 Android 查看器项目里最脏的一层：**用户拖进来的文件到底是什么**。
它不读文件名、不看 MIME，只用字节和结构说话。

- 语言/运行环境：Java 25 单文件源码（直接 `java Sniffer.java` 跑，无需 kotlinc/gradle/maven）
- 代码：`Sniffer.java`（约 26KB，零依赖，仅 JDK 标准库）
- 夹具生成：`make_fixtures.py`（12 个常规样本）、`make_edge_fixtures.py`（7 个边界样本，含 136.5 MB 大文件）

## 为什么是 Java 而不是 Kotlin

本机没有 kotlinc / gradle，而 JDK 25 支持单文件源码直接执行。Sniffer 用到的 API
（`java.util.zip.ZipFile`、`java.nio.charset`、`RandomAccessFile`、`Pattern`）在 Android
上全部可用，逻辑可 1:1 移植为 Kotlin（见文末映射表），不是一次性的玩具代码。

## 用法

```bash
# 人读格式（默认）
java Sniffer.java fixtures

# 机器可读
java Sniffer.java --json fixtures

# Windows 上直接重定向会得到 UTF-16，用 --out 让程序自己写 UTF-8
java Sniffer.java --json --out result.json fixtures

# 递归扫描目录（深度 3），也接受单个文件或多个路径
java Sniffer.java --json --out result.json D:\downloads\export.zip D:\downloads\more
```

Windows 便捷入口：`sniff.cmd fixtures`（内部已 `chcp 65001`）。

## 判定流水线

1. **魔数优先**（头部 8192B）：ZIP/GZIP/BZIP2/XZ/ZSTD/RAR/7z/PNG/JPEG/GIF/WEBP/BMP/PDF/SQLite/ELF/EXE。
   命中即返回 —— 所以伪装成 `.json` 的 PNG、没有扩展名的 `.dat` 附件都能认出来。
2. **空文件** → `EMPTY`（0 字节，不是「损坏」）。
3. **解码**：BOM（UTF-8/16/32）→ NUL 字节检测 → 无 BOM 的 UTF-16 启发式 → 控制字符占比 <1% 判为文本
   → 严格 UTF-8 → GB18030 → Big5 → UTF-8 兜底。中文导出的 GBK 文本因此不会变成乱码。
4. **结构判定**（先后顺序很重要）：JSONL（≥2 行 `{...}` 且含 `":`）→ JSON（括号配平 + 键值统计）→
   HTML → CSV → 聊天文本（6 种行格式投票）→ 纯文本 → 二进制。
5. **JSON 语义识别**：ChatGPT `mapping`+`current_node`、Claude `chat_messages`+`sender`、
   SillyTavern `is_user`+`mes`、`prompt`+`response`、`conversations`+`messages`、Google Takeout 头。
6. **ZIP 深入**：过滤 `__MACOSX` / `.DS_Store` / `desktop.ini`；识别 `conversations-000.json` 分片并提示按名序合并；
   对无扩展名条目读 12 字节魔数；发现嵌套 zip。

### 一次只读头尾，不整文件进内存

`analyze()` 只读头部 8192B + 尾部 65536B。136.5 MB 的 JSON 也只看 8KB 就给出判定，
并明确标注「head prefix only; full parse deferred to streaming parser」，不会假装自己校验了全文。
只有当文件小到能整份装进头部缓冲区时，才会报「truncated/incomplete JSON」。

## 验证结果（19/19）

### 常规夹具 `fixtures/`

| 文件 | 判定 | 编码 | 结构 |
|---|---|---|---|
| `conversations`（无后缀） | JSON 0.97 | UTF-8 | ChatGPT export (mapping tree) |
| `conversations.json` | JSON 0.97 | UTF-8 | ChatGPT export (mapping tree) |
| `claude_conversations.json` | JSON 0.97 | UTF-8 | Claude export (chat_messages) |
| `roleplay.jsonl` | JSONL 0.92 | UTF-8 | SillyTavern .jsonl |
| `wechat_gbk.txt` | CHAT_TEXT 0.77 | **GB18030** | WeChat/QQ(time-first)，4/8 行命中，多行续写 |
| `whatsapp_chat.txt` | CHAT_TEXT 0.86 | UTF-8 | WhatsApp-iOS，3/4 行命中 |
| `export.zip` | ZIP 0.99 | – | 2 个分片 + `file-abc123.dat => PNG` |
| `truncated.json` | JSON 0.85 | UTF-8 | ChatGPT，标注 truncated (depth=5) |
| `random.bin` | BINARY 0.90 | – | NUL/控制字节 |
| `empty.txt` | EMPTY 1.00 | – | – |
| `chat.html` | HTML 0.92 | UTF-8 | html export |
| `long_note.txt` (2.9 MB) | PLAIN_TEXT 0.60 | UTF-8 | 无结构 |

### 边界夹具 `fixtures_edge/`

| 文件 | 判定 | 说明 |
|---|---|---|
| `big.json` (136.5 MB, 60 万会话) | JSON 0.97 | 仅 head prefix，不误报 truncated |
| `gbk_json.json` | JSON 0.97 / GB18030 | 先解码再判结构 |
| `chat_utf16.txt` | CHAT_TEXT 0.77 / UTF-16LE(BOM) | 3/6 行命中 |
| `image_disguised.json` | **PNG** 0.99 | 魔数优先于扩展名 |
| `bom.json` | JSON 0.97 / UTF-8(BOM) | BOM 剥离 |
| `archive.json` | **ZIP** 0.99 | 1 条目 |
| `empty.zip` | ZIP 0.99 | 0 条目（PK 05 06 也认） |

### 性能

`big.json` (136.5 MB) + 其余 6 个边界文件一起扫，总计 **644 ms**（含 JVM 启动约 0.3 s）。
纯判定耗时在几十毫秒量级 —— 因为读的只有头 8KB + 尾 64KB。

## 已知边界 / 后续要补的

- 尾部 64KB 目前只用于「文件是否以 `}` 收尾」的弱信号，还没有用于「从末尾反推最后一个完整会话」；
  真正的大文件分段扫描属于 App 层的流式解析器。
- RAR/7z 只做类型识别，不解压（Android 侧建议只支持 ZIP，其余提示用户先转存）。
- PDF/图片只识别不解析（未来用于「聊天截图 OCR 入口」）。
- CSV 判定较宽松，列名不含关键词时会给低置信度，属于预期行为。

## 移植到 Kotlin / Android 的映射

| Java 原型 | Android 实现 |
|---|---|
| `RandomAccessFile` / `Files.newInputStream` | `ContentResolver.openFileDescriptor(uri, "r")` + `FileChannel` |
| `ZipFile` | `java.util.zip.ZipFile`（对 `ParcelFileDescriptor` 需先落到 cacheDir，或用 `ZipInputStream`） |
| `new String(bytes, cs)` | 同上；GB18030 在 Android 上可用 |
| `Kind` 枚举 | `sealed interface` + `data class` |
| `Report` POJO | `data class Report(...)`，直接序列化为 IR |
| `printJson` 手写拼接 | `kotlinx.serialization` |
| `String.strip()` 等 Java 11 API | 用 `trim()` 或开启 core library desugaring |

判定逻辑（魔数表、编码启发式、聊天正则投票、JSON 语义打分）可以逐行照搬，
它们本来就不依赖 Android 专有 API —— 这也是先做 CLI 原型的意义：
**先把「认文件」这件事在桌面端跑通、用夹具钉死行为，再搬进 App。**
