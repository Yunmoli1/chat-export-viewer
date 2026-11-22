package com.dsh.chatviewer;

/**
 * 构建期开关。
 *
 * 默认全关：发布用的 APK 不开放 WebView 远程调试，免得同一台机器上的 adb / 其他调试工具
 * 能直接看页面里的聊天内容。本地调试时用 {@code build-apk.ps1 -Debug} 构建即可打开。
 */
public final class BuildCfg {
    private BuildCfg() { }

    /** true = 允许 WebView 远程调试（只有本地调试构建才是 true）。 */
    public static final boolean DEBUG = false;
}
