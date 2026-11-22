@echo off
chcp 65001 >nul
java "%~dp0Sniffer.java" %*
