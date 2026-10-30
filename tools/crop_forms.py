# 从设定图裁出各形态的候选区域，生成对照表供检查
from PIL import Image, ImageDraw

SRC = r"C:\Users\lx\.workbuddy\clipboard-images\clipboard-2026-10-29T14-47-15-076Z-bc7f2ac9.jpg"
OUT = r"C:\Users\lx\WorkBuddy\桌宠\juju-desktop-pet\tools\contact_sheet.png"

im = Image.open(SRC)

# (标签, 实际像素坐标 x1,y1,x2,y2)
REGIONS = [
    ("1 idle-stand",   (430, 490, 650, 710)),
    ("2 headphone",    (760, 650, 1000, 860)),
    ("3 hug",          (100, 670, 330, 870)),
    ("4 sing",         (430, 870, 660, 1060)),
    ("5 like",         (80, 1180, 350, 1370)),
    ("6 birth",        (420, 1210, 650, 1460)),
    ("7 mbti",         (750, 1200, 980, 1390)),
    ("8 dark",         (770, 1510, 1020, 1720)),
]

tiles = []
for label, box in REGIONS:
    crop = im.crop(box)
    tiles.append((label, crop))

# 拼对照表：两列
cw = max(t.size[0] for _, t in tiles) + 20
ch = max(t.size[1] for _, t in tiles) + 40
cols = 2
rows = (len(tiles) + 1) // 2
sheet = Image.new("RGB", (cw * cols, ch * rows), "white")
d = ImageDraw.Draw(sheet)
for i, (label, t) in enumerate(tiles):
    x = (i % cols) * cw
    y = (i // cols) * ch
    sheet.paste(t, (x + 10, y + 30))
    d.text((x + 10, y + 8), label, fill="red")
    d.rectangle([x + 10, y + 30, x + 10 + t.size[0] - 1, y + 30 + t.size[1] - 1], outline="red")

sheet.save(OUT)
print("saved", OUT, sheet.size)
