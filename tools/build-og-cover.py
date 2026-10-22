#!/usr/bin/env python3
"""生成社交分享图 public/assets/og-cover.png（1200x630）。

关键约束：微信/QQ 的链接卡片缩略图是**正方形**，并且按**中心**裁切。
所以所有文字与 logo 必须落在中心 630x630 的安全区内，左右两侧只放装饰；
否则分享出去只会看到被裁掉一半的文字（这正是之前的线上问题）。

    python tools/build-og-cover.py
"""
from PIL import Image, ImageDraw, ImageFont
import os

W, H = 1200, 630
# 微信缩略图是中心正方形裁切，所有内容都要落在这个范围内。
SAFE = 630
SAFE_X0 = (W - SAFE) // 2
SAFE_X1 = SAFE_X0 + SAFE
CENTER = W // 2

BG = (6, 10, 18)
GRID = (12, 20, 32)
ACCENT = (58, 212, 230)
TEXT = (232, 241, 251)
TEXT_SOFT = (143, 180, 255)
MUTED = (144, 164, 187)


def font(size, bold=False):
    candidates = [
        'C:/Windows/Fonts/msyhbd.ttc' if bold else 'C:/Windows/Fonts/msyh.ttc',
        'C:/Windows/Fonts/seguisb.ttf' if bold else 'C:/Windows/Fonts/segoeui.ttf',
        '/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc' if bold else '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
    ]
    for path in candidates:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def text_width(draw, text, f):
    box = draw.textbbox((0, 0), text, font=f)
    return box[2] - box[0]


def draw_centered(draw, y, text, f, fill):
    w = text_width(draw, text, f)
    draw.text((CENTER - w / 2, y), text, font=f, fill=fill)


img = Image.new('RGB', (W, H), BG)
d = ImageDraw.Draw(img)

# 装饰层：细网格，允许被裁掉。
for x in range(0, W, 42):
    d.line([(x, 0), (x, H)], fill=GRID, width=1)
for y in range(0, H, 42):
    d.line([(0, y), (W, y)], fill=GRID, width=1)

# 斜向霓虹带，作为背景氛围。
for i in range(24):
    shade = max(0, 40 - i)
    d.line([(0, H - 130 - i * 9), (W, 60 - i * 9)],
           fill=(8 + shade, 24 + shade, 36 + shade), width=2)

# 中心安全区边框（很淡，裁切后仍可见，作为视觉锚点）。
d.rounded_rectangle([SAFE_X0 + 18, 34, SAFE_X1 - 18, H - 34],
                    radius=26, outline=(20, 33, 48), width=2)

# A 徽标
badge = 92
badge_top = 62
d.rounded_rectangle([CENTER - badge / 2, badge_top, CENTER + badge / 2, badge_top + badge],
                    radius=22, outline=ACCENT, width=3, fill=(9, 24, 36))
d.text((CENTER - text_width(d, 'A', font(52, True)) / 2, badge_top + 14),
       'A', font=font(52, True), fill=ACCENT)

# 主标题
draw_centered(d, 184, '算法社', font(72, True), TEXT)
draw_centered(d, 288, 'Algorithm Club', font(36), TEXT_SOFT)

# 分隔线
d.line([(CENTER - 170, 356), (CENTER + 170, 356)], fill=(38, 58, 78), width=2)

# 副标题与地址（都在安全区内）
draw_centered(d, 382, '算法训练 · 可视化实验室', font(25), MUTED)
draw_centered(d, 422, 'AI 五子棋 · 社团管理', font(25), MUTED)
draw_centered(d, 492, 'skyh1aa.github.io/SIA-algorithm-club-site', font(19), ACCENT)

# 底部色条
d.rounded_rectangle([CENTER - 60, 540, CENTER + 60, 548], radius=4, fill=ACCENT)

os.makedirs('public/assets', exist_ok=True)
out = 'public/assets/og-cover.png'
img.save(out, optimize=True)
print(f'wrote {out} ({os.path.getsize(out)} bytes, {W}x{H}, safe square {SAFE_X0}..{SAFE_X1})')
