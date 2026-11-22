
import os, math
from PIL import Image, ImageDraw

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "res", "drawable")
os.makedirs(out, exist_ok=True)
S = 192
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# 圆角底色（深色，跟应用主题一致）
def rr(box, r, fill):
    d.rounded_rectangle(box, radius=r, fill=fill)

rr((0, 0, S - 1, S - 1), 44, (20, 22, 26, 255))
# 顶部一点渐变感：叠一层略亮的圆角矩形
rr((0, 0, S - 1, 96), 44, (32, 36, 44, 255))
d.rectangle((0, 60, S - 1, 96), fill=(32, 36, 44, 255))

# 对话气泡（左侧“我”偏亮，右侧 AI 偏蓝），两行小气泡 + 一条大气泡
ACC = (96, 165, 250, 255)     # 蓝
WARM = (250, 204, 106, 255)   # 暖黄
rr((26, 52, 116, 84), 16, WARM)          # 我的气泡（左）
rr((76, 96, 166, 128), 16, ACC)          # AI 气泡（右）
rr((26, 140, 150, 168), 14, (74, 80, 92, 255))  # 第三条（灰）

# 气泡里的小圆点（表示文字行）
for x0, y0, x1 in ((40, 64, 96), (92, 108, 148), (40, 150, 128)):
    d.rounded_rectangle((x0, y0, x1, y0 + 8), radius=4, fill=(20, 22, 26, 210))

img.save(os.path.join(out, "icon.png"))
print("icon.png", os.path.getsize(os.path.join(out, "icon.png")), "bytes", img.size)
