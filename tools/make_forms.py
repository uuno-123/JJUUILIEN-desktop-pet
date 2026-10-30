# 裁切各形态 -> 背景转透明 -> 修剪 -> 保存为素材
# 注意：只从浅色背景像素开始泛洪填充，避免角色贴边时被误当成背景
from PIL import Image, ImageDraw, ImageFilter
import os

SRC = r"C:\Users\lx\.workbuddy\clipboard-images\clipboard-2026-10-29T14-47-15-076Z-bc7f2ac9.jpg"
ASSET_DIR = r"C:\Users\lx\WorkBuddy\桌宠\juju-desktop-pet\assets"
os.makedirs(ASSET_DIR, exist_ok=True)

im = Image.open(SRC).convert("RGB")

FORMS = {
    "form-stand":  (435, 495, 645, 668),
    "form-music":  (765, 655, 1000, 860),
    "form-hug":    (112, 675, 330, 865),
    "form-sing":   (440, 875, 655, 1085),
    "form-like":   (100, 1225, 340, 1400),
    "form-birth":  (430, 1295, 620, 1515),
    "form-mbti":   (755, 1205, 1000, 1385),
    "form-dark":   (828, 1620, 985, 1768),
}

MAGENTA = (255, 0, 255)

def transparentize(img, thresh, clean_top_band=None):
    w, h = img.size
    work = img.copy()
    # 只从浅色（背景）边框像素开始填充
    pts = [(x, 0) for x in range(w)] + [(x, h - 1) for x in range(w)] + \
          [(0, y) for y in range(h)] + [(w - 1, y) for y in range(h)]
    for p in pts:
        px = work.getpixel(p)
        if px != MAGENTA and sum(px) > 620:
            ImageDraw.floodfill(work, p, MAGENTA, thresh=thresh)

    alpha = Image.new("L", (w, h), 255)
    pa = alpha.load()
    pw = work.load()
    for y in range(h):
        for x in range(w):
            if pw[x, y] == MAGENTA:
                pa[x, y] = 0

    # 清理顶部残留文字：只保留浅棕色（头上的小生物），其余清透明
    if clean_top_band:
        band = clean_top_band
        for y in range(min(band, h)):
            for x in range(w):
                if pa[x, y] > 0:
                    r, g, b = pw[x, y][:3]
                    tan_like = r > 195 and g > 170 and (r - b) > 15
                    if not tan_like:
                        pa[x, y] = 0

    alpha = alpha.filter(ImageFilter.MinFilter(3))
    alpha = alpha.filter(ImageFilter.GaussianBlur(0.7))
    rgba = img.convert("RGBA")
    rgba.putalpha(alpha)
    return rgba.crop(rgba.getbbox())

for name, box in FORMS.items():
    crop = im.crop(box)
    band = 32 if name == "form-dark" else None
    out = transparentize(crop, thresh=22, clean_top_band=band)
    path = os.path.join(ASSET_DIR, name + ".png")
    out.save(path)
    print(name, out.size)
