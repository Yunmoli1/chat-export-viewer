# -*- coding: utf-8 -*-
import json, os, zipfile, io, time

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures_edge")
os.makedirs(BASE, exist_ok=True)

def w(name, data):
    p = os.path.join(BASE, name)
    if isinstance(data, str): data = data.encode("utf-8")
    open(p, "wb").write(data)

# GBK encoded JSON
obj = [{"title": "中文标题", "messages": [{"role": "user", "content": "你好，世界"}]}]
w("gbk_json.json", json.dumps(obj, ensure_ascii=False).encode("gbk"))

# UTF-16LE text with BOM
text = "2024-01-01 12:00:00 张三\n你好\n2024-01-01 12:00:05 李四\n在的\n2024-01-01 12:00:10 张三\n嗯\n"
w("chat_utf16.txt", "\ufeff".encode("utf-16-le") + text.encode("utf-16-le"))

# PNG disguised as .json
w("image_disguised.json", bytes.fromhex("89504E470D0A1A0A") + b"\x00" * 64)

# JSON with BOM
w("bom.json", "\ufeff".encode("utf-8") + json.dumps(obj, ensure_ascii=False).encode("utf-8"))

# empty zip
with zipfile.ZipFile(os.path.join(BASE, "empty.zip"), "w"): pass

# zip disguised as .json
with zipfile.ZipFile(os.path.join(BASE, "archive.json"), "w") as z:
    z.writestr("a.json", "[]")

# large file ~120MB (streamed)
path = os.path.join(BASE, "big.json")
t0 = time.time()
with open(path, "w", encoding="utf-8") as f:
    f.write("[")
    for i in range(600000):
        if i: f.write(",")
        f.write(json.dumps({
            "title": f"会话 {i}", "create_time": 1700000000 + i,
            "mapping": {"n1": {"message": {"author": {"role": "user"},
                        "content": {"content_type": "text", "parts": [f"问题 {i}"]}},
                        "parent": None, "children": ["n2"]}},
            "current_node": "n1"
        }, ensure_ascii=False))
    f.write("]")
print("big.json", os.path.getsize(path) // (1024*1024), "MB in", round(time.time()-t0, 1), "s")
print("edge fixtures:", sorted(os.listdir(BASE)))
