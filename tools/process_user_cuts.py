# 处理用户手工切分的 5 张形态图：去除浅粉背景，保留白色贴纸边
from PIL import Image, ImageDraw, ImageFilter
import os

SRC_DIR = r"C:\Users\lx\.workbuddy\clipboard-images"
ASSET_DIR = r"C:\Users\lx\WorkBuddy\桌宠\juju-desktop-pet\assets"

MAPPING = {
    "clipboard-2026-10-29T15-35-47-142Z-92fbedd6.png": "form-stand.png",
    "clipboard-2026-10-29T15-35-47-144Z-c357ebb4.png": "form-hug.png",
    "clipboard-2026-10-29T15-35-47-146Z-db5a4885.png": "form-music.png",
    "clipboard-2026-10-29T15-35-47-148Z-cf4d9327.png": "form-birth.png",
    "clipboard-2026-10-29T15-35-47-150Z-7bed8975.png": "form-mbti.png",
}

def transparentize(img):
    w, h = img.size
    work = img.convert("RGB").copy()
    MAGENTA = (255, 0, 255)

    # 第一步：低阈值泛洪，只吃掉与背景几乎一致的像素（不动白色贴纸边）
    pts = [(x, 0) for x in range(w)] + [(x, h - 1) for x in range(w)] + \
          [(0, y) for y in range(h)] + [(w - 1, y) for y in range(h)]
    for p in pts:
        if work.getpixel(p) != MAGENTA:
            ImageDraw.floodfill(work, p, MAGENTA, thresh=16)

    alpha = Image.new("L", (w, h), 255)
    pa = alpha.load()
    pw = work.load()
    for y in range(h):
        for x in range(w):
            if pw[x, y] == MAGENTA:
                pa[x, y] = 0

    # 第二步：从透明区域向外迭代扩张，清掉贴纸周围的淡阴影（半透明灰粉色）
    # 阴影特征：亮度中等偏高、低饱和；白色贴纸边 sum=765 不会命中
    changed = True
    while changed:
        changed = False
        candidates = []
        for y in range(1, h - 1):
            for x in range(1, w - 1):
                if pa[x, y] == 0:
                    continue
                # 四邻有透明
                if pa[x-1, y] == 0 or pa[x+1, y] == 0 or pa[x, y-1] == 0 or pa[x, y+1] == 0:
                    r, g, b = pw[x, y]
                    s = r + g + b
                    chroma = max(r, g, b) - min(r, g, b)
                    if 560 < s < 752 and chroma < 26:
                        candidates.append((x, y))
        if candidates:
            changed = True
            for x, y in candidates:
                pa[x, y] = 0

    # 第三步：边缘羽化
    alpha = alpha.filter(ImageFilter.GaussianBlur(0.8))

    rgba = img.convert("RGBA")
    rgba.putalpha(alpha)
    return rgba.crop(rgba.getbbox())

for src, dst in MAPPING.items():
    im = Image.open(os.path.join(SRC_DIR, src))
    out = transparentize(im)
    out.save(os.path.join(ASSET_DIR, dst))
    print(dst, out.size)
