"""Render the plugin icon to a square PNG storefront tile.

The market only accepts GitHub-hosted raster images (png/jpg/webp) for the card
tile and draws them at ~96 px, so this reproduces icon.svg at 180 px: rounded
gradient plate, four account nodes on two rails, and the key ring in the middle.
"""
import sys
from PIL import Image, ImageDraw

OUT = sys.argv[1] if len(sys.argv) > 1 else "icon-180.png"
SIZE = int(sys.argv[2]) if len(sys.argv) > 2 else 180
S = SIZE / 64.0  # the svg viewBox is 64x64


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient(size, top, bottom):
    image = Image.new("RGB", (size, size))
    draw = ImageDraw.Draw(image)
    for y in range(size):
        t = y / max(1, size - 1)
        draw.line([(0, y), (size, y)], fill=lerp(top, bottom, t))
    return image


def scaled(points):
    return [(x * S, y * S) for x, y in points]


def main():
    top = (0x3B, 0x6D, 0xF6)
    bottom = (0x1B, 0x2F, 0x8C)

    plate = gradient(SIZE, top, bottom).convert("RGBA")
    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle([2 * S, 2 * S, 62 * S, 62 * S], radius=16 * S, fill=255)
    image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    image.paste(plate, (0, 0), mask)

    draw = ImageDraw.Draw(image)
    rail = (255, 255, 255, 107)  # 0.42 opacity
    width = max(1, round(2 * S))
    for line in (
        [(15, 44), (24, 33)],
        [(49, 44), (40, 33)],
        [(15, 20), (24, 27)],
        [(49, 20), (40, 27)],
    ):
        draw.line(scaled(line), fill=rail, width=width, joint="curve")

    node = (255, 255, 255, 230)  # 0.9 opacity
    radius = 3.2 * S
    for cx, cy in ((14, 45), (50, 45), (14, 19), (50, 19)):
        draw.ellipse([cx * S - radius, cy * S - radius, cx * S + radius, cy * S + radius], fill=node)

    key_width = max(2, round(4.4 * S))
    key = (255, 255, 255, 255)
    ring = [32 * S - 8.5 * S, 28 * S - 8.5 * S, 32 * S + 8.5 * S, 28 * S + 8.5 * S]
    draw.ellipse(ring, outline=key, width=key_width)
    draw.line(scaled([(32, 36.5), (32, 47)]), fill=key, width=key_width)
    draw.line(scaled([(32, 47), (27.5, 51.5)]), fill=key, width=key_width)
    draw.line(scaled([(37, 45.5), (32, 47)]), fill=key, width=key_width)

    image.save(OUT)
    print(f"wrote {OUT} ({image.size[0]}x{image.size[1]})")


if __name__ == "__main__":
    main()
