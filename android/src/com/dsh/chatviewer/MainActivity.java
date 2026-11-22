package com.dsh.chatviewer;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.util.Log;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Locale;

/**
 * 聊天导出查看器 —— WebView 壳。
 *
 * 职责只有三件事：
 *  1. 把 prototype/ 里的静态页面塞进 assets，用 https://app.local/ 这个假的「安全来源」加载
 *     （file:// 来源在 WebView 里 IndexedDB 常被当成不透明来源，换 https + 拦截就稳了）。
 *  2. 通过 SAF（ACTION_OPEN_DOCUMENT）选文件，拿持久化读权限，把字节以 base64 交给页面。
 *  3. 记住最近用过的 URI —— 权限持久化后，下次冷启动还能直接打开。
 *
 * 刻意不申请 INTERNET 权限：页面解析全在本地。
 */
public class MainActivity extends Activity {

    private static final String TAG = "ChatViewer";
    private static final int REQ_PICK = 1001;      // Native.pickFile 走这里
    private static final int REQ_CHOOSER = 1002;   // <input type=file> 走这里
    private static final int MAX_BYTES = 16 * 1024 * 1024; // 单次读取上限；更大的导出请在桌面切分
    private static final String APP_HOST = "app.local";
    private static final String APP_ORIGIN = "https://app.local/index.html";

    private WebView web;
    private String pendingReq = "pick";
    private ValueCallback<Uri[]> chooserCb;
    private final Handler ui = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView.setWebContentsDebuggingEnabled(true);

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#14161a"));
        web.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setLoadWithOverviewMode(false);
        s.setUseWideViewPort(true);
        s.setTextZoom(100);

        // 用 https://app.local/ 这个「假的但算安全来源」的地址加载 assets：
        // file:// 来源在 WebView 里 localStorage 能用、IndexedDB 却常被当成不透明来源，
        // 换成 https 拦截后，两套存储都稳，也就不需要 setAllowFileAccessFromFileURLs 那些宽松开关。
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (u == null || !APP_HOST.equals(u.getHost())) return null;
                String path = u.getPath();
                if (path == null || path.isEmpty() || "/".equals(path)) path = "/index.html";
                String rel = path.startsWith("/") ? path.substring(1) : path;
                if (rel.contains("..")) return null;
                try {
                    InputStream in = getAssets().open(rel);
                    return new WebResourceResponse(mimeOf(rel), "utf-8", in);
                } catch (IOException e) {
                    Log.w(TAG, "asset miss: " + rel);
                    return null;
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                return u == null || !APP_HOST.equals(u.getHost());   // 页面里没有外链，真出现就拦掉
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb,
                                             FileChooserParams params) {
                chooserCb = cb;
                try {
                    startActivityForResult(buildPickIntent(), REQ_CHOOSER);
                } catch (Exception e) {
                    chooserCb = null;
                    toast("打不开文件选择器：" + e.getMessage());
                    return false;
                }
                return true;
            }
        });

        web.addJavascriptInterface(new Bridge(), "Native");
        setContentView(web);
        web.loadUrl(APP_ORIGIN);
    }

    private static String mimeOf(String rel) {
        String l = rel.toLowerCase(Locale.US);
        if (l.endsWith(".html") || l.endsWith(".htm")) return "text/html";
        if (l.endsWith(".js")) return "application/javascript";
        if (l.endsWith(".css")) return "text/css";
        if (l.endsWith(".json")) return "application/json";
        if (l.endsWith(".png")) return "image/png";
        if (l.endsWith(".svg")) return "image/svg+xml";
        return "application/octet-stream";
    }

    private Intent buildPickIntent() {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("*/*");
        // 导出文件常常没有扩展名 / 是 .dat，用 */* 让系统不要过滤掉
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        return i;
    }

    /** 页面可调用的桥。所有回调都回到 JS 的 window.__nativeFile(payload)。 */
    private class Bridge {
        @JavascriptInterface
        public void pickFile(final String reqId) {
            pendingReq = (reqId == null || reqId.isEmpty()) ? "pick" : reqId;
            ui.post(new Runnable() {
                @Override public void run() {
                    try {
                        startActivityForResult(buildPickIntent(), REQ_PICK);
                    } catch (Exception e) {
                        deliver(pendingReq, false, null, 0, null, null, "打不开文件选择器：" + e.getMessage());
                    }
                }
            });
        }

        @JavascriptInterface
        public void readUri(final String uri, final String reqId) {
            new Thread(new Runnable() {
                @Override public void run() {
                    readAndDeliver(uri, (reqId == null || reqId.isEmpty()) ? "read" : reqId);
                }
            }).start();
        }

        @JavascriptInterface
        public String version() {
            return "1.0-native";
        }

        @JavascriptInterface
        public String caps() {
            return "{\"native\":true,\"saf\":true,\"persist\":true}";
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_CHOOSER) {
            Uri[] out = null;
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                out = new Uri[]{data.getData()};
            }
            if (chooserCb != null) {
                chooserCb.onReceiveValue(out);
                chooserCb = null;
            }
            return;
        }
        if (requestCode != REQ_PICK) return;
        if (resultCode != RESULT_OK || data == null || data.getData() == null) {
            deliver(pendingReq, false, null, 0, null, null, "cancelled");
            return;
        }
        final Uri uri = data.getData();
        final String req = pendingReq;
        try {
            getContentResolver().takePersistableUriPermission(
                    uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception e) {
            Log.w(TAG, "takePersistableUriPermission failed: " + e.getMessage());
        }
        new Thread(new Runnable() {
            @Override public void run() { readAndDeliver(uri.toString(), req); }
        }).start();
    }

    private void readAndDeliver(String uriStr, String reqId) {
        InputStream in = null;
        try {
            Uri uri = Uri.parse(uriStr);
            String name = queryName(uri);
            ContentResolver cr = getContentResolver();
            in = cr.openInputStream(uri);
            if (in == null) throw new IOException("系统不提供这个文件的读取权限");
            ByteArrayOutputStream bos = new ByteArrayOutputStream(Math.max(8192, 65536));
            byte[] buf = new byte[65536];
            int n;
            long total = 0;
            while ((n = in.read(buf)) > 0) {
                total += n;
                if (total > MAX_BYTES) {
                    throw new IOException("文件超过 " + (MAX_BYTES / 1024 / 1024) + "MB，先切分或用更小的导出");
                }
                bos.write(buf, 0, n);
            }
            deliver(reqId, true, name, total, uriStr, bos.toByteArray(), null);
        } catch (SecurityException e) {
            deliver(reqId, false, null, 0, uriStr, null, "权限已失效，请重新选择文件");
        } catch (Exception e) {
            deliver(reqId, false, null, 0, uriStr, null, String.valueOf(e.getMessage()));
        } finally {
            if (in != null) try { in.close(); } catch (IOException ignored) { }
        }
    }

    private String queryName(Uri uri) {
        String name = null;
        Cursor c = null;
        try {
            c = getContentResolver().query(uri, null, null, null, null);
            if (c != null && c.moveToFirst()) {
                int idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) name = c.getString(idx);
            }
        } catch (Exception ignored) {
        } finally {
            if (c != null) c.close();
        }
        if (name == null || name.isEmpty()) {
            String last = uri.getLastPathSegment();
            name = (last == null) ? "未命名文件" : last;
        }
        return name;
    }

    /** 每个分片约 256KB 的 base64 文本：一次 evaluateJavascript 只塞这么点，低端机也不会闪崩。 */
    private static final int CHUNK = 256 * 1024;

    private void deliver(String reqId, boolean ok, String name, long size,
                         String uri, byte[] bytes, String error) {
        try {
            JSONObject head = new JSONObject();
            head.put("reqId", reqId == null ? "" : reqId);
            head.put("ok", ok);
            if (name != null) head.put("name", name);
            head.put("size", size);
            if (uri != null) head.put("uri", uri);
            if (error != null) head.put("error", error);

            final String begin = "window.__nativeBegin(" + head.toString() + ")";
            post(begin);
            if (!ok || bytes == null) return;

            String b64 = Base64.encodeToString(bytes, Base64.NO_WRAP);
            int seq = 0;
            for (int i = 0; i < b64.length(); i += CHUNK) {
                String part = b64.substring(i, Math.min(i + CHUNK, b64.length()));
                post("window.__nativeChunk(" + JSONObject.quote(reqId == null ? "" : reqId)
                        + "," + JSONObject.quote(part) + ")");
                seq++;
            }
            post("window.__nativeEnd(" + JSONObject.quote(reqId == null ? "" : reqId) + ")");
            Log.i(TAG, "delivered " + size + " B in " + seq + " chunks");
        } catch (Exception e) {
            Log.e(TAG, "deliver failed", e);
        }
    }

    private void post(String js) {
        ui.post(new Runnable() {
            @Override public void run() {
                if (web != null) web.evaluateJavascript(js, null);
            }
        });
    }

    private void toast(String msg) {
        ui.post(new Runnable() {
            @Override public void run() { Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show(); }
        });
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.removeJavascriptInterface("Native");
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
