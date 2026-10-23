from PIL import Image, ImageDraw
import sys

out = sys.argv[1]


def icon(size, pad_ratio, name):
    S = size * 4
    im = Image.new("RGBA", (S, S), (47, 125, 82, 255))  # leaf green
    d = ImageDraw.Draw(im)
    r = S * (0.5 - pad_ratio)
    c = S / 2
    d.ellipse([c - r, c - r, c + r, c + r], fill=(255, 251, 242, 255))  # plate
    r2 = r * 0.78
    cols = [(240, 138, 75), (246, 190, 90), (120, 190, 130), (240, 138, 75)]
    for i in range(4):  # four of five slices filled
        a0 = -90 + i * 72 + 2
        d.pieslice([c - r2, c - r2, c + r2, c + r2], a0, a0 + 68, fill=cols[i])
    im.resize((size, size), Image.LANCZOS).save(f"{out}/{name}")


icon(192, 0.08, "icon-192.png")
icon(512, 0.08, "icon-512.png")
icon(512, 0.2, "icon-maskable-512.png")
icon(180, 0.08, "apple-touch-icon.png")
