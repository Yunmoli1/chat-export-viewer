import java.io.*;
import java.nio.*;
import java.nio.charset.*;
import java.nio.file.*;
import java.util.*;
import java.util.regex.*;
import java.util.zip.*;

public class Sniffer {

    static final int HEAD_MAX = 8192;
    static final int TAIL_MAX = 65536;
    static final int MAX_LINES = 400;

    enum Kind {
        EMPTY, ZIP, GZIP, BZIP2, XZ, ZSTD, RAR, SEVEN_Z,
        PNG, JPEG, GIF, WEBP, BMP, PDF, SQLITE, ELF, EXE,
        JSON, JSONL, HTML, CSV, CHAT_TEXT, PLAIN_TEXT, BINARY, UNKNOWN
    }

    static final class Decoded {
        final Charset charset; final String text; final String bom;
        Decoded(Charset c, String t, String b) { charset = c; text = t; bom = b; }
    }

    static final class Msg {
        final String time, name, text; final boolean system;
        Msg(String t, String n, String x, boolean s) { time = t; name = n; text = x; system = s; }
    }

    static final class Report {
        Path path; long size;
        Kind kind = Kind.UNKNOWN;
        String encoding = "-";
        double confidence = 0;
        String format = "-";       // semantic: ChatGPT / Claude / ...
        List<String> notes = new ArrayList<>();
        List<String> samples = new ArrayList<>();
        List<String> zipEntries = new ArrayList<>();
        int convCount = -1, msgCount = -1;
    }

    // ---------- chat line patterns ----------
    static final Pattern P_WA_IOS = Pattern.compile("^\\[(\\d{4}/\\d{1,2}/\\d{1,2}),?\\s*(\\d{1,2}:\\d{2}(?::\\d{2})?)\\]\\s*([^:]{1,40}):\\s?(.*)$");
    static final Pattern P_WA_AND = Pattern.compile("^(\\d{1,2}/\\d{1,2}/\\d{2,4}),?\\s*(\\d{1,2}:\\d{2}(?::\\d{2})?)\\s*-\\s*([^:]{1,40}):\\s?(.*)$");
    static final Pattern P_WX_TIME = Pattern.compile("^(\\d{4}[-/]\\d{1,2}[-/]\\d{1,2})\\s+(\\d{1,2}:\\d{2}(?::\\d{2})?)\\s+([^\\s:：]{1,40}?)(?:\\(\\d+\\))?$");
    static final Pattern P_WX_NAME = Pattern.compile("^([^\\s:：]{1,40})\\s+(\\d{4}[-/]\\d{1,2}[-/]\\d{1,2})\\s+(\\d{1,2}:\\d{2}(?::\\d{2})?)$");
    static final Pattern P_BRACKET = Pattern.compile("^\\[([^\\]]{6,30})\\]\\s*([^:：]{1,40})[:：]\\s?(.*)$");
    static final Pattern P_COLON = Pattern.compile("^([^:：\\n]{1,20})[:：]\\s+(.+)$");

    static final Pattern[] CHAT_PATTERNS = {P_WA_IOS, P_WA_AND, P_WX_TIME, P_WX_NAME, P_BRACKET, P_COLON};
    static final String[] CHAT_NAMES = {"WhatsApp-iOS", "WhatsApp-Android", "WeChat/QQ(time-first)", "WeChat/QQ(name-first)", "bracket-time", "name-colon"};

    static final Pattern RE_SHARD = Pattern.compile("^(conversations|part|chat)[-_]?(\\d+)\\.json$", Pattern.CASE_INSENSITIVE);

    public static void main(String[] args) throws Exception {
        PrintStream out = new PrintStream(new FileOutputStream(FileDescriptor.out), true, StandardCharsets.UTF_8);
        System.setOut(out);
        System.setErr(new PrintStream(new FileOutputStream(FileDescriptor.err), true, StandardCharsets.UTF_8));

        boolean json = false;
        String outPath = null;
        List<String> paths = new ArrayList<>();
        for (int i = 0; i < args.length; i++) {
            String a = args[i];
            if (a.equals("--json")) json = true;
            else if (a.equals("--out") && i + 1 < args.length) outPath = args[++i];
            else if (a.equals("-h") || a.equals("--help")) { usage(); return; }
            else paths.add(a);
        }
        if (paths.isEmpty()) { usage(); return; }

        List<Path> files = new ArrayList<>();
        for (String p : paths) expand(Paths.get(p), files);
        if (files.isEmpty()) { System.out.println("no files"); return; }

        List<Report> reports = new ArrayList<>();
        for (Path f : files) {
            try { reports.add(analyze(f, 0)); }
            catch (Exception e) {
                Report r = new Report(); r.path = f; r.kind = Kind.UNKNOWN;
                r.notes.add("error: " + e.getClass().getSimpleName() + ": " + e.getMessage());
                reports.add(r);
            }
        }
        if (outPath != null) {
            System.setOut(new PrintStream(new FileOutputStream(outPath), true, StandardCharsets.UTF_8));
        }
        if (json) printJson(reports); else printPretty(reports);
    }

    static void usage() {
        System.out.println("""
Usage: java Sniffer.java [--json] [--out <file>] <file-or-dir> ...
Detects type/encoding/structure of chat export files without trusting names.

  --json        machine-readable JSON array
  --out <file>  write output to <file> as UTF-8 (avoids Windows shell re-encoding)
  -h, --help    show this help
        """);
    }

    static void expand(Path p, List<Path> out) throws IOException {
        if (Files.isDirectory(p)) {
            try (var s = Files.walk(p, 3)) {
                s.filter(Files::isRegularFile).sorted().forEach(out::add);
            }
        } else if (Files.isRegularFile(p)) out.add(p);
    }

    // ---------------- analysis ----------------
    static Report analyze(Path path, int depth) throws IOException {
        Report r = new Report();
        r.path = path;
        r.size = Files.size(path);
        if (r.size == 0) { r.kind = Kind.EMPTY; r.confidence = 1; return r; }
        if (r.size > 8L * 1024 * 1024 * 1024L) r.notes.add("very large (>8GB)");

        byte[] head = readRange(path, 0, HEAD_MAX);
        byte[] tail = readRange(path, Math.max(0, r.size - TAIL_MAX), TAIL_MAX);

        // 1) magic
        Kind magic = magicOf(head);
        if (magic != null) {
            r.kind = magic;
            r.confidence = 0.99;
            switch (magic) {
                case ZIP -> analyzeZip(path, r, depth);
                case GZIP -> { r.notes.add("gzip container; decompress then re-sniff"); analyzeGzip(path, r, depth); }
                case PNG, JPEG, GIF, WEBP, BMP -> r.format = "image";
                case PDF -> r.format = "pdf";
                case SQLITE -> r.format = "sqlite";
                case ELF, EXE -> r.format = "executable";
                default -> { }
            }
            return r;
        }

        // 2) text decode
        Decoded d = decode(head);
        if (d == null) {
            r.kind = Kind.BINARY;
            r.confidence = 0.9;
            r.notes.add("NUL or control bytes in head");
            return r;
        }
        r.encoding = d.charset.name() + (d.bom.isEmpty() ? "" : " (BOM)");
        String text = d.text;

        // 3) structure
        String s = text.stripLeading();
        if (s.startsWith("{") || s.startsWith("[")) {
            if (looksLikeJsonl(text)) {
                r.kind = Kind.JSONL; r.confidence = 0.92; r.format = semanticJsonl(text);
                r.notes.add("one JSON object per line");
                return r;
            }
            JsonScan js = scanJson(text);
            if (js.matchedKeys >= 2) {
                r.kind = Kind.JSON;
                boolean wholeFileInHead = r.size <= head.length;
                boolean complete = js.depth == 0;
                r.confidence = (!wholeFileInHead || complete) ? 0.97 : 0.85;
                r.format = semanticJson(text);
                if (wholeFileInHead && !complete) r.notes.add("truncated/incomplete JSON (depth=" + js.depth + ")");
                if (!wholeFileInHead) r.notes.add("head prefix only; full parse deferred to streaming parser");
                if (js.topArray) r.notes.add("top-level array, ~" + countTopLevelItems(text) + " conversations in first 8KB");
                int roles = countOccurrences(text, "\"role\"");
                if (roles > 0) r.notes.add("~" + roles + " message objects in first 8KB");
                return r;
            }
            if (looksLikeJsonl(text)) { r.kind = Kind.JSONL; r.confidence = 0.9; r.format = semanticJsonl(text); return r; }
        }
        if (text.length() > 15 && (s.startsWith("<!DOCTYPE") || s.startsWith("<html") || s.startsWith("<HTML"))) {
            r.kind = Kind.HTML; r.confidence = 0.92; r.format = "html export";
            return r;
        }

        ChatDetect cd = detectChat(text);
        if (cd != null) {
            r.kind = Kind.CHAT_TEXT;
            r.confidence = 0.6 + 0.35 * cd.ratio;
            r.format = "chat text (" + cd.patternName + ")";
            r.notes.add(String.format("%d/%d lines matched, multi-line continuation enabled", cd.hits, cd.tested));
            r.msgCount = cd.messages.size();
            for (int i = 0; i < Math.min(3, cd.messages.size()); i++) {
                Msg m = cd.messages.get(i);
                r.samples.add("[" + (m.system ? "system" : m.name) + "] " + clip(m.text, 80));
            }
            if (cd.messages.size() > 0) {
                Set<String> names = new LinkedHashSet<>();
                for (Msg m : cd.messages) if (!m.system) names.add(m.name);
                r.notes.add("participants: " + String.join(", ", names.stream().limit(5).toList()));
            }
            return r;
        }

        if (looksCsv(text)) { r.kind = Kind.CSV; r.confidence = 0.7; return r; }
        r.kind = Kind.PLAIN_TEXT; r.confidence = 0.6;
        r.notes.add("printable text, no recognizable structure");
        return r;
    }

    static String clip(String s, int n) {
        s = s.replace("\n", " ");
        return s.length() <= n ? s : s.substring(0, n) + "...";
    }

    // ---------------- magic ----------------
    static Kind magicOf(byte[] b) {
        if (b.length >= 4 && u(b[0]) == 0x50 && u(b[1]) == 0x4B
                && ((u(b[2]) == 3 && u(b[3]) == 4) || (u(b[2]) == 5 && u(b[3]) == 6) || (u(b[2]) == 7 && u(b[3]) == 8))) return Kind.ZIP;
        if (b.length >= 2 && u(b[0]) == 0x1F && u(b[1]) == 0x8B) return Kind.GZIP;
        if (b.length >= 3 && u(b[0]) == 'B' && u(b[1]) == 'Z' && u(b[2]) == 'h') return Kind.BZIP2;
        if (b.length >= 6 && u(b[0]) == 0xFD && u(b[1]) == '7' && u(b[2]) == 'z' && u(b[3]) == 'X' && u(b[4]) == 'Z' && u(b[5]) == 0x00) return Kind.XZ;
        if (b.length >= 4 && u(b[0]) == 0x28 && u(b[1]) == 0xB5 && u(b[2]) == 0x2F && u(b[3]) == 0xFD) return Kind.ZSTD;
        if (b.length >= 7 && u(b[0]) == 'R' && u(b[1]) == 'a' && u(b[2]) == 'r' && u(b[3]) == '!' && u(b[4]) == 0x1A && u(b[5]) == 0x07) return Kind.RAR;
        if (b.length >= 6 && u(b[0]) == '7' && u(b[1]) == 'z' && u(b[2]) == 0xBC && u(b[3]) == 0xAF && u(b[4]) == 0x27 && u(b[5]) == 0x1C) return Kind.SEVEN_Z;
        if (b.length >= 8 && u(b[0]) == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G') return Kind.PNG;
        if (b.length >= 3 && u(b[0]) == 0xFF && u(b[1]) == 0xD8 && u(b[2]) == 0xFF) return Kind.JPEG;
        if (b.length >= 4 && b[0] == 'G' && b[1] == 'I' && b[2] == 'F' && b[3] == '8') return Kind.GIF;
        if (b.length >= 12 && b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F' && b[8] == 'W' && b[9] == 'E' && b[10] == 'B' && b[11] == 'P') return Kind.WEBP;
        if (b.length >= 2 && b[0] == 'B' && b[1] == 'M') return Kind.BMP;
        if (b.length >= 4 && b[0] == '%' && b[1] == 'P' && b[2] == 'D' && b[3] == 'F') return Kind.PDF;
        if (b.length >= 16 && new String(b, 0, 15, StandardCharsets.ISO_8859_1).equals("SQLite format 3")) return Kind.SQLITE;
        if (b.length >= 4 && u(b[0]) == 0x7F && b[1] == 'E' && b[2] == 'L' && b[3] == 'F') return Kind.ELF;
        if (b.length >= 2 && b[0] == 'M' && b[1] == 'Z') return Kind.EXE;
        return null;
    }

    static int u(byte b) { return b & 0xFF; }

    // ---------------- decode ----------------
    static Decoded decode(byte[] b) {
        if (b.length == 0) return new Decoded(StandardCharsets.UTF_8, "", "");
        if (b.length >= 4 && u(b[0]) == 0xFF && u(b[1]) == 0xFE && b[2] == 0 && b[3] == 0)
            return new Decoded(charset("UTF-32LE"), new String(b, 4, b.length - 4, charset("UTF-32LE")), "UTF-32LE");
        if (b.length >= 4 && b[0] == 0 && b[1] == 0 && u(b[2]) == 0xFE && u(b[3]) == 0xFF)
            return new Decoded(charset("UTF-32BE"), new String(b, 4, b.length - 4, charset("UTF-32BE")), "UTF-32BE");
        if (b.length >= 3 && u(b[0]) == 0xEF && u(b[1]) == 0xBB && u(b[2]) == 0xBF)
            return new Decoded(StandardCharsets.UTF_8, new String(b, 3, b.length - 3, StandardCharsets.UTF_8), "UTF-8");
        if (b.length >= 2 && u(b[0]) == 0xFF && u(b[1]) == 0xFE)
            return new Decoded(StandardCharsets.UTF_16LE, new String(b, 2, b.length - 2, StandardCharsets.UTF_16LE), "UTF-16LE");
        if (b.length >= 2 && u(b[0]) == 0xFE && u(b[1]) == 0xFF)
            return new Decoded(StandardCharsets.UTF_16BE, new String(b, 2, b.length - 2, StandardCharsets.UTF_16BE), "UTF-16BE");

        if (hasNul(b)) {
            // possible UTF-16 without BOM
            int oddZero = 0, evenZero = 0, pairs = b.length / 2;
            for (int i = 0; i + 1 < b.length; i += 2) { if (b[i] == 0) evenZero++; if (b[i + 1] == 0) oddZero++; }
            if (pairs > 8 && oddZero > pairs * 0.3 && evenZero < pairs * 0.05) {
                Charset cs = StandardCharsets.UTF_16LE;
                return new Decoded(cs, new String(b, cs), "UTF-16LE?");
            }
            if (pairs > 8 && evenZero > pairs * 0.3 && oddZero < pairs * 0.05) {
                Charset cs = StandardCharsets.UTF_16BE;
                return new Decoded(cs, new String(b, cs), "UTF-16BE?");
            }
            return null;
        }
        if (!looksLikeText(b)) return null;
        if (strict(b, StandardCharsets.UTF_8)) return new Decoded(StandardCharsets.UTF_8, new String(b, StandardCharsets.UTF_8), "");
        Charset gb = charset("GB18030");
        if (strict(b, gb)) return new Decoded(gb, new String(b, gb), "");
        Charset big5 = charset("Big5");
        if (strict(b, big5)) return new Decoded(big5, new String(b, big5), "");
        return new Decoded(StandardCharsets.UTF_8, new String(b, StandardCharsets.UTF_8), "fallback");
    }

    static Charset charset(String n) {
        try { return Charset.forName(n); } catch (Exception e) { return StandardCharsets.UTF_8; }
    }

    static boolean hasNul(byte[] b) {
        for (byte x : b) if (x == 0) return true;
        return false;
    }

    static boolean looksLikeText(byte[] b) {
        int ctrl = 0;
        for (byte x : b) {
            int v = u(x);
            if (v < 0x20 && v != 0x09 && v != 0x0A && v != 0x0D) ctrl++;
        }
        return (double) ctrl / b.length < 0.01;
    }

    static boolean strict(byte[] b, Charset cs) {
        CharsetDecoder dec = cs.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT);
        try { dec.decode(ByteBuffer.wrap(b)); return true; }
        catch (Exception e) { return false; }
    }

    // ---------------- json ----------------
    static final class JsonScan {
        boolean balanced; boolean topArray; int depth; int matchedKeys;
    }

    static JsonScan scanJson(String t) {
        JsonScan r = new JsonScan();
        int i = 0, n = t.length();
        while (i < n && Character.isWhitespace(t.charAt(i))) i++;
        r.topArray = i < n && t.charAt(i) == '[';
        int depth = 0; boolean inStr = false, esc = false; int keys = 0;
        for (; i < n; i++) {
            char c = t.charAt(i);
            if (inStr) {
                if (esc) esc = false;
                else if (c == '\\') esc = true;
                else if (c == '"') {
                    inStr = false;
                    int j = i + 1;
                    while (j < n && Character.isWhitespace(t.charAt(j))) j++;
                    if (j < n && t.charAt(j) == ':') keys++;
                }
                continue;
            }
            if (c == '"') inStr = true;
            else if (c == '{' || c == '[') depth++;
            else if (c == '}' || c == ']') depth--;
            if (depth < 0) break;
        }
        r.depth = depth;
        r.matchedKeys = keys;
        r.balanced = depth == 0 && keys >= 2;
        return r;
    }

    static boolean looksLikeJsonl(String t) {
        String[] lines = t.split("\n");
        int ok = 0, tested = 0;
        for (String ln : lines) {
            String s = ln.strip();
            if (s.isEmpty()) continue;
            tested++;
            if (tested > 5) break;
            if (s.startsWith("{") && s.endsWith("}") && s.contains("\":")) ok++;
            else return false;
        }
        return ok >= 2;
    }

    static String semanticJson(String t) {
        String h = t.length() > 60000 ? t.substring(0, 60000) : t;
        if (h.contains("\"mapping\"") && (h.contains("\"current_node\"") || (h.contains("\"author\"") && h.contains("\"parts\""))))
            return "ChatGPT export (mapping tree)";
        if (h.contains("\"chat_messages\"") && h.contains("\"sender\"")) return "Claude export (chat_messages)";
        if (h.contains("\"is_user\"") && h.contains("\"mes\"")) return "SillyTavern / roleplay log";
        if (h.contains("\"prompt\"") && h.contains("\"response\"")) return "Q&A pairs (prompt/response)";
        if (h.contains("\"conversations\"") && h.contains("\"messages\"")) return "generic conversations[]";
        if (h.contains("\"header\"") && h.contains("\"time\"") && h.contains("\"title\"")) return "Google Takeout / MyActivity";
        if (h.contains("\"chat_messages\"")) return "chat_messages[]";
        if (h.contains("\"messages\"")) return "messages[]";
        return "generic JSON";
    }

    static String semanticJsonl(String t) {
        String first = t.strip().split("\n")[0];
        if (first.contains("\"is_user\"") && first.contains("\"mes\"")) return "SillyTavern .jsonl";
        if (first.contains("\"role\"") && (first.contains("\"content\"") || first.contains("\"text\""))) return "OpenAI-style messages .jsonl";
        return "JSONL";
    }

    static boolean looksCsv(String t) {
        String[] lines = t.split("\n");
        if (lines.length < 3) return false;
        String d = null;
        if (lines[0].contains("\t")) d = "\t";
        else if (lines[0].split(",", -1).length >= 3) d = ",";
        if (d == null) return false;
        int n = lines[0].split(d, -1).length;
        int same = 0;
        for (int i = 0; i < Math.min(5, lines.length); i++) if (lines[i].split(d, -1).length == n) same++;
        return same >= 3;
    }

    static int countTopLevelItems(String t) {
        int i = 0, n = t.length(), depth = 0, count = 0;
        boolean inStr = false, esc = false, sawToken = false;
        for (; i < n; i++) {
            char c = t.charAt(i);
            if (inStr) {
                if (esc) esc = false;
                else if (c == '\\') esc = true;
                else if (c == '"') inStr = false;
                continue;
            }
            if (c == '"') { inStr = true; if (depth == 1) sawToken = true; continue; }
            if (c == '{' || c == '[') { depth++; if (depth == 2) sawToken = true; continue; }
            if (c == '}' || c == ']') { depth--; continue; }
            if (c == ',' && depth == 1) { count++; sawToken = false; continue; }
            if (!Character.isWhitespace(c) && depth == 1) sawToken = true;
        }
        return count + (sawToken ? 1 : 0);
    }

    static int countOccurrences(String hay, String needle) {
        int c = 0, i = 0;
        while ((i = hay.indexOf(needle, i)) >= 0) { c++; i += needle.length(); }
        return c;
    }

    // ---------------- chat text ----------------
    static final class ChatDetect {
        String patternName; int hits; int tested; double ratio; List<Msg> messages = new ArrayList<>();
    }

    static ChatDetect detectChat(String text) {
        String[] rawLines = text.split("\n", -1);
        List<String> lines = new ArrayList<>();
        for (String ln : rawLines) {
            String s = ln.replace("\r", "");
            if (!s.isBlank()) lines.add(s);
            if (lines.size() >= MAX_LINES) break;
        }
        if (lines.size() < 3) return null;

        int bestIdx = -1, bestHits = 0;
        int tested = Math.min(lines.size(), 60);
        for (int p = 0; p < CHAT_PATTERNS.length; p++) {
            int hits = 0;
            for (int i = 0; i < tested; i++) if (CHAT_PATTERNS[p].matcher(lines.get(i)).matches()) hits++;
            if (hits > bestHits) { bestHits = hits; bestIdx = p; }
        }
        if (bestIdx < 0 || bestHits < 3) return null;
        double ratio = (double) bestHits / tested;
        if (bestIdx == 5 && ratio < 0.6) return null;
        if (ratio < 0.35) return null;

        ChatDetect cd = new ChatDetect();
        cd.patternName = CHAT_NAMES[bestIdx];
        cd.hits = bestHits; cd.tested = tested; cd.ratio = ratio;

        Pattern p = CHAT_PATTERNS[bestIdx];
        Msg cur = null;
        for (String ln : lines) {
            Matcher m = p.matcher(ln);
            if (m.matches()) {
                String time, name, body;
                switch (bestIdx) {
                    case 0, 1, 4 -> { time = m.group(1) + " " + m.group(2); name = m.group(3).trim(); body = m.group(4); }
                    case 2 -> { time = m.group(1) + " " + m.group(2); name = m.group(3).trim(); body = ""; }
                    case 3 -> { time = m.group(2) + " " + m.group(3); name = m.group(1).trim(); body = ""; }
                    default -> { time = ""; name = m.group(1).trim(); body = m.group(2); }
                }
                boolean sys = isSystem(name, body);
                cur = new Msg(time, name, body, sys);
                cd.messages.add(cur);
            } else if (cur != null) {
                cur = new Msg(cur.time, cur.name, (cur.text + "\n" + ln).strip(), cur.system);
                cd.messages.set(cd.messages.size() - 1, cur);
            }
        }
        return cd;
    }

    static boolean isSystem(String name, String body) {
        String n = name.toLowerCase();
        if (n.equals("系统") || n.equals("system") || n.equals("notice")) return true;
        return body.contains("撤回了一条消息") || body.contains("加入了群聊") || body.contains("changed the subject")
                || body.contains("created group") || body.contains("Messages and calls are end-to-end");
    }

    // ---------------- zip ----------------
    static void analyzeZip(Path path, Report r, int depth) {
        r.format = "zip archive";
        try (ZipFile zf = new ZipFile(path.toFile())) {
            List<String> names = new ArrayList<>();
            var en = zf.entries();
            int count = 0;
            while (en.hasMoreElements() && count++ < 5000) {
                ZipEntry e = en.nextElement();
                if (e.isDirectory()) continue;
                String n = e.getName();
                if (n.startsWith("__MACOSX/") || n.endsWith(".DS_Store") || n.endsWith("desktop.ini")) continue;
                names.add(n);
            }
            r.zipEntries = names;
            List<String> json = new ArrayList<>(), shards = new ArrayList<>(), images = new ArrayList<>();
            for (String n : names) {
                String base = n.substring(n.lastIndexOf('/') + 1);
                if (n.toLowerCase().endsWith(".json")) {
                    json.add(base);
                    if (RE_SHARD.matcher(base).matches()) shards.add(base);
                }
                if (base.toLowerCase().endsWith(".dat")) images.add(base);
            }
            r.notes.add(names.size() + " entries");
            if (!json.isEmpty()) r.notes.add("json: " + String.join(", ", json.stream().limit(6).toList()));
            if (shards.size() > 1) r.notes.add("SHARDED export: " + shards.size() + " json parts -> merge in name order");
            if (!images.isEmpty()) {
                List<String> kinds = new ArrayList<>();
                for (String img : images) {
                    kindOfZipEntry(zf, img).ifPresent(k -> kinds.add(img + " => " + k));
                }
                r.notes.add("extensionless/renamed attachments: " + kinds);
            }
            for (String n : names) {
                if (n.toLowerCase().endsWith(".zip") && depth < 1) r.notes.add("nested zip: " + n);
            }
        } catch (Exception e) {
            r.notes.add("zip read failed: " + e.getMessage());
        }
    }

    static Optional<String> kindOfZipEntry(ZipFile zf, String name) {
        try (InputStream in = zf.getInputStream(zf.getEntry(name))) {
            byte[] b = in.readNBytes(12);
            Kind k = magicOf(b);
            return k == null ? Optional.of("unknown") : Optional.of(k.name());
        } catch (Exception e) { return Optional.empty(); }
    }

    static void analyzeGzip(Path path, Report r, int depth) {
        try {
            Path tmp = Files.createTempFile("sniff-", ".bin");
            try (InputStream in = new GZIPInputStream(Files.newInputStream(path));
                 OutputStream os = Files.newOutputStream(tmp)) {
                byte[] buf = new byte[65536]; long total = 0; int k;
                while ((k = in.read(buf)) > 0 && total < 64L * 1024 * 1024) { os.write(buf, 0, k); total += k; }
            }
            Report inner = analyze(tmp, depth + 1);
            r.format = "gzip -> " + inner.kind + (inner.format.equals("-") ? "" : " (" + inner.format + ")");
            r.notes.add("inner encoding: " + inner.encoding);
            Files.deleteIfExists(tmp);
        } catch (Exception e) {
            r.notes.add("gzip read failed: " + e.getMessage());
        }
    }

    // ---------------- io ----------------
    static byte[] readRange(Path p, long off, int len) throws IOException {
        try (RandomAccessFile raf = new RandomAccessFile(p.toFile(), "r")) {
            long n = Math.min(len, raf.length() - off);
            if (n <= 0) return new byte[0];
            raf.seek(off);
            byte[] b = new byte[(int) n];
            raf.readFully(b);
            return b;
        }
    }

    // ---------------- output ----------------
    static void printPretty(List<Report> rs) {
        for (Report r : rs) {
            System.out.println("=".repeat(72));
            System.out.println("file      : " + r.path + "  (" + human(r.size) + ")");
            System.out.println("kind      : " + r.kind + "   confidence=" + String.format("%.2f", r.confidence));
            if (!r.encoding.equals("-")) System.out.println("encoding  : " + r.encoding);
            if (!r.format.equals("-")) System.out.println("format    : " + r.format);
            for (String n : r.notes) System.out.println("note      : " + n);
            for (String s : r.samples) System.out.println("sample    : " + s);
        }
        System.out.println("=".repeat(72));
        System.out.printf("%-42s %-12s %-14s %s%n", "FILE", "KIND", "ENCODING", "FORMAT");
        for (Report r : rs) {
            System.out.printf("%-42s %-12s %-14s %s%n",
                    clip(r.path.toString(), 42), r.kind, clip(r.encoding, 14), clip(r.format, 48));
        }
    }

    static void printJson(List<Report> rs) {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < rs.size(); i++) {
            Report r = rs.get(i);
            if (i > 0) sb.append(",");
            sb.append("{\"file\":").append(q(r.path.toString()))
              .append(",\"size\":").append(r.size)
              .append(",\"kind\":").append(q(r.kind.name()))
              .append(",\"encoding\":").append(q(r.encoding))
              .append(",\"confidence\":").append(String.format(Locale.ROOT, "%.2f", r.confidence))
              .append(",\"format\":").append(q(r.format))
              .append(",\"notes\":[");
            for (int j = 0; j < r.notes.size(); j++) { if (j > 0) sb.append(","); sb.append(q(r.notes.get(j))); }
            sb.append("],\"samples\":[");
            for (int j = 0; j < r.samples.size(); j++) { if (j > 0) sb.append(","); sb.append(q(r.samples.get(j))); }
            sb.append("]}");
        }
        System.out.println(sb.append("]"));
    }

    static String q(String s) {
        return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n") + "\"";
    }

    static String human(long n) {
        if (n < 1024) return n + " B";
        if (n < 1024 * 1024) return String.format("%.1f KB", n / 1024.0);
        if (n < 1024L * 1024 * 1024) return String.format("%.1f MB", n / 1048576.0);
        return String.format("%.2f GB", n / 1073741824.0);
    }
}
