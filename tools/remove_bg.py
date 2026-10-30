# 把原图的纯白背景转为透明，角色本身不做任何修改
from PIL import Image, ImageDraw, ImageFilter

SRC = r"C:\Users\lx\.workbuddy\clipboard-images\clipboard-2026-10-29T14-47-15-070Z-d598a4ec.png"
DST = r"C:\Users\lx\WorkBuddy\桌宠\juju-desktop-pet\assets\juju-idle.png"
import os
os.makedirs(os.path.dirname(DST), exist_ok=True)

img = Image.open(SRC).convert("RGB")
w, h = img.size

work = img.copy()
MAGENTA = (255, 0, 255)

# 从四条边的每个像素向内泛洪填充，把与白色相近的连通区域染成品红标记
for x in range(w):
    for y in (0, h - 1):
        if work.getpixel((x, y)) != MAGENTA:
            ImageDraw.floodfill(work, (x, y), MAGENTA, thresh=48)
for y in range(h):
    for x in (0, w - 1):
        if work.getpixel((x, y)) != MAGENTA:
            ImageDraw.floodfill(work, (x, y), MAGENTA, thresh=48)

# 生成 alpha 通道：品红区域透明
alpha = Image.new("L", (w, h), 255)
pa = alpha.load()
pw = work.load()
for y in range(h):
    for x in range(w):
        if pw[x, y] == MAGENTA:
            pa[x, y] = 0

# 轻微收缩 1px + 羽化 1px，消除白边硬边
alpha = alpha.filter(ImageFilter.MinFilter(3))
alpha = alpha.filter(ImageFilter.GaussianBlur(0.8))

rgba = img.convert("RGBA")
rgba.putalpha(alpha)

# 裁掉四周透明留白
bbox = rgba.getbbox()
rgba = rgba.crop(bbox)
rgba.save(DST)
print("saved:", DST, "size:", rgba.size)
