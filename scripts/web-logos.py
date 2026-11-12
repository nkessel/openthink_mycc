"""Makes small WebP copies of the logos (public/logos/web/<name>.webp) and the list the site uses to pick them
(src/logos.web.json). The map shows the WebP copy when there is one and the original otherwise, so the sheet's
logo paths never change. Run again after adding logos:  python3 scripts/web-logos.py   (needs Pillow)
Oct 29: the map's 146 logos went from 3.7 MB to about 1 MB, the biggest part of the first load."""
import io, json, os
from PIL import Image

SRC, OUT = "public/logos", "public/logos/web"
MAX = 640          # px: the opened group's bubble on a sharp (2x) screen
QUALITY = 88       # WebP quality: no visible change on logos
# Nov 12: a second, tiny copy (public/logos/web/s/) for the small bubbles of the first view. The map shows it first
# and swaps in the larger copy only for bubbles that are big on screen (zoomed in, or the opened group).
SMALL_OUT, SMALL_MAX, SMALL_QUALITY = "public/logos/web/s", 64, 80
# ...and a 32px one (public/logos/web/t/) that the map paints first; the 64px copy follows when the browser is idle.
TINY_OUT, TINY_MAX = "public/logos/web/t", 32

os.makedirs(OUT, exist_ok=True)
os.makedirs(SMALL_OUT, exist_ok=True)
os.makedirs(TINY_OUT, exist_ok=True)
names, before, after = [], 0, 0
small, small_bytes = [], 0
for f in sorted(os.listdir(SRC)):
    p = os.path.join(SRC, f)
    base, ext = os.path.splitext(f)
    if not os.path.isfile(p) or ext.lower() not in (".png", ".jpg", ".jpeg", ".webp", ".gif"):
        continue
    try:
        im = Image.open(p)
        im.seek(0)
        im = im.convert("RGBA")
    except Exception:
        continue
    tiny = im.copy()
    tiny.thumbnail((SMALL_MAX, SMALL_MAX), Image.LANCZOS)
    tb = io.BytesIO()
    tiny.save(tb, "WEBP", quality=SMALL_QUALITY, method=6)
    with open(os.path.join(SMALL_OUT, base + ".webp"), "wb") as fh:
        fh.write(tb.getvalue())
    small.append(base)
    small_bytes += len(tb.getvalue())
    tiny.thumbnail((TINY_MAX, TINY_MAX), Image.LANCZOS)
    tiny.save(os.path.join(TINY_OUT, base + ".webp"), "WEBP", quality=SMALL_QUALITY, method=6)
    if max(im.size) > MAX:
        im.thumbnail((MAX, MAX), Image.LANCZOS)
    b = io.BytesIO()
    im.save(b, "WEBP", quality=QUALITY, method=6, alpha_quality=100)
    raw = os.path.getsize(p)
    if len(b.getvalue()) < raw * 0.9:  # only when it really saves something
        with open(os.path.join(OUT, base + ".webp"), "wb") as fh:
            fh.write(b.getvalue())
        names.append(f)
        before += raw
        after += len(b.getvalue())
# drop copies whose original is gone
keep = {os.path.splitext(n)[0] + ".webp" for n in names}
for f in os.listdir(OUT):
    if f.endswith(".webp") and f not in keep:
        os.remove(os.path.join(OUT, f))
for d in (SMALL_OUT, TINY_OUT):
    for f in os.listdir(d):
        if f.endswith(".webp") and os.path.splitext(f)[0] not in set(small):
            os.remove(os.path.join(d, f))
with open("src/logos.small.json", "w") as fh:
    json.dump(small, fh, indent=0)
    fh.write("\n")
with open("src/logos.web.json", "w") as fh:
    json.dump(names, fh, indent=0)
    fh.write("\n")
print(f"{len(names)} WebP logos: {before // 1024} KB -> {after // 1024} KB")
print(f"{len(small)} small logos ({SMALL_MAX}px): {small_bytes // 1024} KB")
