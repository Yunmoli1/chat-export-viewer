# 附录：无后缀 / 错后缀 / 纯文本 / 压缩包 的识别方案

> 现实中的导出文件：`conversations`（无后缀）、`file-abc123.dat`（其实是 PNG）、
> `聊天记录.txt`（其实是 GBK 编码的微信文本）、`export.zip`（里面套 `part-1.json`）。
> **结论：文件名只做弱提示，判定一律看字节。**

---

## 1. 嗅探流水线

```
读 8KB 头 + 末尾 64KB
   ↓
① BOM / 编码判定          （决定后面怎么解码）
   ↓
② 魔数匹配（压缩/图片/PDF/SQLite）  ← 命中即返回，最便宜
   ↓
③ 容器展开（ZIP/GZIP/RAR/7z）→ 递归回 ②
   ↓
④ 文本结构判定（JSON/JSONL/HTML/CSV/聊天TXT/纯文本）
   ↓
⑤ 语义配方匹配（ChatGPT/Claude/微信…）  ← 最贵，最后做
   ↓
⑥ 全失败 → 通用文本阅读器 + "手动指定/点选映射"
```

**原则**
- 每一步都有 confidence，取最高分；任一步 `>=0.95` 可提前退出。
- 文件名（含扩展名）权重 ≤ 0.2，只在并列时打破僵局。
- 只读头尾，不读全文件；ZIP 只读中央目录（EOCD 在末尾 64KB 内）。
- 全部检测器跑完 < 20ms，保证点开即出结果。

---

## 2. 魔数表（前 8 字节，十六进制）

| 类型 | 魔数 | 备注 |
|---|---|---|
| ZIP | `50 4B 03 04` | 也可能是 docx/xlsx/apk，需看内部条目 |
| ZIP(空) | `50 4B 05 06` | 空包 |
| GZIP | `1F 8B` | .gz / .tgz |
| BZIP2 | `42 5A 68` | |
| XZ | `FD 37 7A 58 5A 00` | |
| ZSTD | `28 B5 2F FD` | |
| RAR | `52 61 72 21 1A 07` | |
| 7z | `37 7A BC AF 27 1C` | |
| TAR | offset 257 = `75 73 74 61 72` | |
| PNG | `89 50 4E 47 0D 0A 1A 0A` | **.dat 图片大概率是这个** |
| JPEG | `FF D8 FF` | |
| GIF | `47 49 46 38` | |
| WebP | `52 49 46 46 .. .. .. .. 57 45 42 50` | RIFF....WEBP |
| BMP | `42 4D` | |
| PDF | `25 50 44 46` | `%PDF` |
| SQLite | `53 51 4C 69 74 65 20 66 6F 72 6D 61 74 20 33 00` | 微信/WhatsApp 库 |
| ELF/EXE | `7F 45 4C 46` / `4D 5A` | 直接拒绝 |
| Protobuf | 无魔数 | 只能靠"高熵 + 长度前缀"启发式 |

**JSON 检测**：跳过 BOM 与前导空白（` \t \r \n`）后首字节是 `{` 或 `[`，且前 8KB 内括号配平、无 NUL。
**HTML**：`<!DOCTYPE` / `<html` / `<div` 开头（Telegram/Discord 导出）。

---

## 3. 文本 / 二进制判定

```kotlin
fun looksLikeText(head: ByteArray): Boolean {
    if (head.contains(0x00)) return false                 // 有 NUL 基本是二进制
    val sample = head.take(minOf(head.size, 8192))
    var ctrl = 0
    for (b in sample) if (b in 0x01..0x08 || b in 0x0B..0x0C || b in 0x0E..0x1F) ctrl++
    return ctrl.toDouble() / sample.size < 0.01           // 控制字符 < 1%
}
```

---

## 4. 编码判定（中文是重灾区）

按顺序尝试，取"非法序列率 = 0"的第一个：

1. BOM：`EF BB BF`→UTF-8，`FF FE`→UTF-16LE，`FE FF`→UTF-16BE
2. UTF-8 严格校验（`CharsetDecoder` with `CodingErrorAction.REPORT`）
3. GB18030（覆盖 GBK/GB2312，微信/QQ 老导出）
4. Big5（港台）
5. UTF-16 无 BOM（偶数长度 + 大量 `00` 在奇数位）
6. 兜底：UTF-8 + `REPLACE`，UI 提供"切换编码"按钮

> 注意：**先解码再判结构**。GBK 的 JSON 里中文是合法字节，但按 UTF-8 解会乱码甚至抛异常。
> 判定只看前 8KB，够用。

---

## 5. 文本结构判定

| 特征 | 判定 | 置信度 |
|---|---|---|
| 首字符 `[`/`{`，括号配平，有 `":` | JSON | 0.95 |
| 每行独立 `{...}`，行数 ≥ 3 | JSONL/NDJSON | 0.9 |
| 首行 `<!DOCTYPE`/`<html` | HTML | 0.9 |
| 行内 `[2024/01/01, 12:00:00] 张三: ` | WhatsApp iOS | 0.95 |
| 行内 `1/1/24, 12:00 - 张三: ` | WhatsApp Android | 0.95 |
| `2024-01-01 12:00:00 张三` + 下一行正文 | 微信/QQ 导出 | 0.85 |
| Tab 分隔、列数一致 | CSV/TSV | 0.7 |
| 其余可打印文本 | 纯文本 | 0.5 |

### 聊天文本的 8 种行格式（兜底解析器）

```kotlin
val chatLinePatterns = listOf(
    // WhatsApp iOS: [2024/01/01, 12:00:00] 张三: 内容
    Regex("""^\[(\d{4}/\d{1,2}/\d{1,2}),?\s*(\d{1,2}:\d{2}(?::\d{2})?)\]\s*([^:]{1,40}):\s?(.*)$"""),
    // WhatsApp Android: 1/1/24, 12:00 - 张三: 内容
    Regex("""^(\d{1,2}/\d{1,2}/\d{2,4}),?\s*(\d{1,2}:\d{2})\s*-\s*([^:]{1,40}):\s?(.*)$"""),
    // 微信/QQ: 2024-01-01 12:00:00 张三
    Regex("""^(\d{4}[-/]\d{1,2}[-/]\d{1,2})\s+(\d{1,2}:\d{2}(?::\d{2})?)\s+([^\s:：]{1,40})(?:\(\d+\))?$"""),
    // 微信: 张三 2024-01-01 12:00:00
    Regex("""^([^\s:：]{1,40})\s+(\d{4}[-/]\d{1,2}[-/]\d{1,2})\s+(\d{1,2}:\d{2}(?::\d{2})?)$"""),
    // 通用: [时间] 昵称: 内容
    Regex("""^\[([^\]]{6,30})\]\s*([^:：]{1,40})[:：]\s?(.*)$"""),
    // 通用: 昵称: 内容（无时间）
    Regex("""^([^:：\n]{1,20})[:：]\s+(.{1,})$"""),
)
```

- **多行消息**：不匹配任何模式的行 → 追加到上一条消息正文（聊天记录里换行正文很常见）。
- **系统消息**：`张三 撤回了一条消息`、`你已添加了...` → role=system。
- **媒体占位**：`[图片]`、`[语音]`、`[视频]`、`<Media omitted>`、`image omitted` → 附件 chip。
- **没有时间的格式**：按"昵称变化"切分（连续同一昵称合并）。

> 兜底解析器命中后，**自动生成一条临时配方**存下来；同一用户的同类文件以后直接复用。

---

## 6. 压缩容器

- **ZIP**：读 EOCD → 中央目录 → 条目列表。
  - 忽略：`__MACOSX/`、`.DS_Store`、`Thumbs.db`、`desktop.ini`。
  - 分片：`conversations-000.json`、`part-1.json`、`chat_*.json` → **按名排序合并**为一个导出。
  - 嵌套：zip 里还有 zip → 递归 1 层（防 zip 炸弹：解压上限 2GB / 条目数上限 10 万）。
  - 附件：图片条目路径 → 映射表，消息里的相对路径/文件名去匹配。
- **GZIP/TAR**：单文件场景（`conversations.json.gz`）直接解到临时文件再嗅探。
- **无后缀 ZIP**：靠 `PK\x03\x04` 识别，不看名字。

---

## 7. `.dat` 与无后缀附件

ChatGPT 导出里的 `file-xxxx.dat` 常是图片，但扩展名被抹掉：

```kotlin
fun sniffAttachment(bytes: ByteArray): Attachment? = when {
    bytes.startsWith(0x89, 0x50, 0x4E, 0x47) -> Image("png")
    bytes.startsWith(0xFF, 0xD8, 0xFF)        -> Image("jpg")
    bytes.startsWith(0x52, 0x49, 0x46, 0x46)  -> Image("webp")
    bytes.startsWith(0x47, 0x49, 0x46)        -> Image("gif")
    else -> null
}
```

- 消息里是 `![image](file-abc.png)` 但包里只有 `file-abc.dat` → 按"去扩展名同名"匹配。
- 匹配不上时显示占位 `[图片: file-abc.dat]`，点击可尝试十六进制预览。

---

## 8. Android 上的 SAF 细节（最容易踩坑的地方）

1. **MIME 不可信**：无后缀文件返回 `application/octet-stream` 或 `*`；`.txt` 里是 JSON 也返回 `text/plain`。
   → 一律 `openInputStream` 读头字节自己判。
2. **文件名可能为 null**：`DocumentFile.getName()` 对某些 provider 返回 null。UI 显示 "(未命名)"，不要 NPE。
3. **随机访问不保证**：`content://` 的 fd 上 `FileChannel.position()` 多数可用但不保证。
   → 提供两种模式：
   - **原地读取**：省空间，大文件 seek 失败时退化为顺序扫描；
   - **导入副本**（推荐默认，>50MB 时提示）：`copyTo(cacheDir)` 换稳定 seek + fingerprint。
4. **目录导入**：`OpenDocumentTree` 扫整棵导出目录（zip 解压后的文件夹），一次性导入。
5. **权限持久化**：`takePersistableUriPermission`，否则重启后 URI 失效。
6. **指纹去重**：`size + mtime + SHA256(头4KB) + SHA256(尾4KB)` → 同一文件重复导入直接命中缓存索引。

---

## 9. Kotlin 骨架

```kotlin
sealed interface FileKind {
    data class Json(val encoding: Charset) : FileKind
    data class Jsonl(val encoding: Charset) : FileKind
    data class ChatText(val encoding: Charset, val pattern: Regex) : FileKind
    data class Zip(val entries: List<String>) : FileKind
    data class Image(val mime: String) : FileKind
    data class PlainText(val encoding: Charset) : FileKind
    data object Binary : FileKind
}

object Sniffer {
    fun sniff(head: ByteArray, tail: ByteArray, name: String?): FileKind {
        Zip.sniff(head)?.let { return FileKind.Zip(it) }
        Image.sniff(head)?.let { return FileKind.Image(it) }
        val text = decodeText(head) ?: return FileKind.Binary
        return when {
            Json.isBalanced(text)       -> FileKind.Json(text.charset)
            Jsonl.looksLike(text)       -> FileKind.Jsonl(text.charset)
            else -> FileKind.ChatText(text.charset, ChatText.detect(text) ?: ChatText.generic)
        }
    }
}
```

---

## 10. 测试清单（bad case 优先）

| 用例 | 期望 |
|---|---|
| `conversations`（无后缀 300MB） | 识别为 JSON，自动命中 ChatGPT 配方 |
| `file-abc.dat`（PNG） | 识别为图片，不出现在会话列表 |
| `聊天记录.txt`（GBK） | 识别为 ChatText + GB18030，正确显示中文 |
| `export.zip` 内含 `conversations-000/001.json` | 合并为 1 个导出，会话数 = 两片之和 |
| 截断的 JSON（下载中断） | 读到断点为止，提示"文件不完整，已解析 92%" |
| `chat.html`（Telegram 导出） | 走 HTML 解析器，不按纯文本处理 |
| 空文件 / 1 字节 | 不崩溃，提示无法识别 |
| 200MB 纯文本 | 不 OOM，分页阅读 |
