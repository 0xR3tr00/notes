"""
make_wordmark.py — build the Notes++ wordmark as OUTLINED SVG paths.

The wordmark is English-only by choice; Arabic body text uses a real web font
(see --sans-ar in css/style.css) rather than outlines.

Why this exists
---------------
The Thmanyah typeface is licensed for use in designs and products, but NOT for
web embedding: serving a .woff2/.otf from the site would let anyone download the
font file, which the licence forbids. Converting the lettering to vector paths
sidesteps that completely — the SVG contains geometry, not a font. No font file
is copied into this repo, and the output references no font by name.

This is a BUILD-TIME tool. Run it when the wordmark changes; commit the SVG/PNG
it produces. It needs the font installed locally:

    pip install fonttools uharfbuzz
    python tools/make_wordmark.py

Text is shaped with HarfBuzz first (essential for Arabic: letters change form and
join depending on position), then each glyph's outline is emitted as an SVG path.
"""
import os, sys

import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.misc.transform import Transform

# --- where the font lives on this machine (never copied into the repo) --------
FONT_DIR = os.path.expanduser(
    r"~\Pictures\P\text\خطوط فوتوشوب\Thmanyah-Font-Family\thmanyah typeface\thmanyahsans\otf"
)
FONT = os.path.join(FONT_DIR, "thmanyahsans-Bold.otf")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "img")

AMBER = "#F2A93B"     # the site's accent, used for the "++"
CREAM = "#F4EFE4"     # default letter colour when the SVG is used as a plain <img>
# Letters are painted with a CSS variable that falls back to the literal above.
# As an <img> the variable cannot resolve, so you get cream on dark — correct
# standalone. Inlined into a page, --logo-ink wins and the mark follows the theme.
INK = f"var(--logo-ink, {CREAM})"
SIZE = 100            # nominal type size; the SVG is vector so this is just a scale


def shape(text, font_path=FONT, size=SIZE, rtl=False):
    """Shape `text` with HarfBuzz. Returns [(glyph_name, x, y)] and the total advance."""
    blob = hb.Blob.from_file_path(font_path)
    face = hb.Face(blob)
    hbfont = hb.Font(face)
    hbfont.scale = (face.upem, face.upem)

    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    if rtl:
        buf.direction = "rtl"
        buf.script = "Arab"
    hb.shape(hbfont, buf)

    order = TTFont(font_path).getGlyphOrder()
    scale = size / face.upem
    out, x, y = [], 0.0, 0.0
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        out.append((order[info.codepoint],
                    (x + pos.x_offset) * scale,
                    (y + pos.y_offset) * scale))
        x += pos.x_advance
        y += pos.y_advance
    return out, x * scale


def paths_for(glyphs, font_path=FONT, size=SIZE):
    """Turn shaped glyphs into one SVG path string (y flipped: font is y-up, SVG y-down)."""
    tt = TTFont(font_path)
    glyphset = tt.getGlyphSet()
    upem = tt["head"].unitsPerEm
    k = size / upem
    d = []
    for name, x, y in glyphs:
        if name not in glyphset:
            continue
        pen = SVGPathPen(glyphset)
        # scale to `size`, flip vertically, then move into place
        glyphset[name].draw(TransformPen(pen, Transform(k, 0, 0, -k, x, -y)))
        seg = pen.getCommands()
        if seg:
            d.append(seg)
    return " ".join(d)


def svg(groups, width, ascent, descent, pad=8, title="Notes++"):
    """Wrap coloured path groups in an SVG document sized to the lettering."""
    h = ascent + descent + pad * 2
    w = width + pad * 2
    body = "\n  ".join(
        f'<path d="{d}" fill="{fill}"/>' for d, fill in groups if d
    )
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.1f} {h:.1f}"
     role="img" aria-label="{title}">
  <title>{title}</title>
  <!-- Lettering converted to outlines: this file contains no font data. -->
  <g transform="translate({pad:.1f}, {pad + ascent:.1f})">
  {body}
  </g>
</svg>
'''


def build_latin():
    """Notes++ — 'Notes' inherits the surrounding text colour, '++' is amber."""
    word, w1 = shape("Notes")
    plus, w2 = shape("++")
    plus = [(n, x + w1, y) for n, x, y in plus]      # place "++" after the word
    tt = TTFont(FONT)
    k = SIZE / tt["head"].unitsPerEm
    asc, desc = tt["hhea"].ascender * k, -tt["hhea"].descender * k
    return svg([(paths_for(word), INK), (paths_for(plus), AMBER)],
               w1 + w2, asc, desc, title="Notes++")


def main():
    if not os.path.exists(FONT):
        sys.exit(f"Font not found: {FONT}\nEdit FONT_DIR at the top of this script.")
    os.makedirs(OUT, exist_ok=True)
    for name, data in [("wordmark.svg", build_latin())]:
        with open(os.path.join(OUT, name), "w", encoding="utf-8") as f:
            f.write(data)
        print("wrote img/" + name, f"({len(data)} bytes)")
        # Navy-ink twin for light backgrounds. An <img> cannot inherit page
        # colour, so the stylesheet swaps between these two files by theme.
        dark_name = name.replace(".svg", "-dark.svg")
        dark = data.replace(INK, "#1D1B18")
        with open(os.path.join(OUT, dark_name), "w", encoding="utf-8") as f:
            f.write(dark)
        print("wrote img/" + dark_name)
    write_pngs()


def write_pngs(width=1200):
    """Raster copies for places that cannot use SVG (og:image, README, print).
    Rendered from the SVG paths, so still no font data involved."""
    try:
        import pymupdf
    except ImportError:
        print("skipped PNGs (pip install pymupdf)"); return
    for base in ("wordmark",):
        src = os.path.join(OUT, base + ".svg")
        for suffix, ink, bg in (("", CREAM, None), ("-dark", "#1D1B18", None)):
            svg_txt = open(src, encoding="utf-8").read().replace(INK, ink)
            doc = pymupdf.open(stream=svg_txt.encode(), filetype="svg")
            page = doc[0]
            zoom = width / page.rect.width
            pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=True)
            out = os.path.join(OUT, f"{base}{suffix}.png")
            pix.save(out)
            print(f"wrote img/{base}{suffix}.png ({pix.width}x{pix.height})")


if __name__ == "__main__":
    main()
