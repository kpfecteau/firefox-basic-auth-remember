"""Draws the extension's icons: a brass key on a rounded steel square, the
same mark and colors as the header band in theme.css.

    python3 tools/make_icons.py      (needs Pillow: pip install pillow)

Writes extension/icons/icon-{16,32,48,96}.png (toolbar and add-on icons
referenced by manifest.json) and amo/icon-128.png (the store listing icon,
uploaded separately). Each size is drawn at 8x and scaled down so edges stay
smooth. The generated PNGs are committed; re-run this only to change the art.
"""

from pathlib import Path

from PIL import Image, ImageDraw

STEEL = (31, 43, 59, 255)  # --steel
BRASS = (201, 162, 58, 255)  # --brass
SCALE = 8
ROOT = Path(__file__).resolve().parent.parent


def draw_icon(size):
    """Returns the icon as a size x size RGBA image.

    The art is laid out on a 48-unit grid and scaled to `size`. At 16px the
    strokes are thickened so the key stays legible in the toolbar.
    """
    px = size * SCALE
    u = px / 48  # one grid unit in pixels
    img = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    d.rounded_rectangle([0, 0, px - 1, px - 1], radius=10 * u, fill=STEEL)

    stroke = (5.5 if size <= 16 else 4.5) * u
    half = stroke / 2

    # Bow: a ring centred left of middle.
    cx, cy, r = 16 * u, 24 * u, 7.5 * u
    d.ellipse([cx - r - half, cy - r - half, cx + r + half, cy + r + half], fill=BRASS)
    inner = r - half
    d.ellipse([cx - inner, cy - inner, cx + inner, cy + inner], fill=STEEL)

    def bar(x0, y0, x1, y1):
        """A stroke from (x0,y0) to (x1,y1) in grid units, with round ends."""
        a, b, c, e = x0 * u, y0 * u, x1 * u, y1 * u
        d.line([a, b, c, e], fill=BRASS, width=round(stroke))
        for x, y in ((a, b), (c, e)):
            d.ellipse([x - half, y - half, x + half, y + half], fill=BRASS)

    bar(23.5, 24, 39.5, 24)  # shaft
    bar(33.5, 24, 33.5, 31)  # bit
    bar(39.5, 24, 39.5, 29.5)  # bit

    # Box filtering: LANCZOS overshoots at the transparent edge and leaves a
    # light halo on dark toolbars.
    return img.resize((size, size), Image.Resampling.BOX)


def main():
    out = ROOT / "extension" / "icons"
    out.mkdir(parents=True, exist_ok=True)
    for size in (16, 32, 48, 96):
        draw_icon(size).save(out / f"icon-{size}.png")
    amo = ROOT / "amo"
    amo.mkdir(exist_ok=True)
    draw_icon(128).save(amo / "icon-128.png")
    print("wrote", ", ".join(f"icon-{s}.png" for s in (16, 32, 48, 96)), "and amo/icon-128.png")


if __name__ == "__main__":
    main()
