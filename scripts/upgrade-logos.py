"""Look for sharper versions of logos that are already on the map (Nathan: logos pixelate when zoomed in).

For every group with a website, reads its own homepage (same candidates as fetch-logos.py: images marked "logo",
apple-touch / large icons, og:image), keeps the largest usable logo, and saves it to research/logos/up/<id>.png
(longest side up to 640px; SVG rendered at 640) only when it is at least 1.8x the size of the current file.
A person reviews the before/after sheet before anything is copied into public/logos/.
Usage: python3 scripts/upgrade-logos.py public/data.json public/maps/vt.json
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from importlib import import_module
fl = import_module("fetch-logos")
from PIL import Image

OUT = "research/logos/up"
os.makedirs(OUT, exist_ok=True)
report = {}
for f in sys.argv[1:]:
    d = json.load(open(f))
    for g in d["coalitions"] + d["organizations"]:
        site, cur = g.get("website"), g.get("logo")
        if not site or not cur or cur.startswith("http"):
            continue
        path = os.path.join("public", cur)
        if path.endswith(".svg") or not os.path.exists(path):
            continue
        try:
            cw, ch = Image.open(path).size
        except Exception:
            continue
        try:
            cands = fl.candidates(site)
        except Exception as e:
            report[g["id"]] = f"site error {type(e).__name__}"
            continue
        best = None
        for kind, u in cands[:8]:
            if kind == "favicon":
                continue
            try:
                r = fl.get(u)
                if r.status_code != 200:
                    continue
                im = fl.to_png(r.content, r.headers.get("content-type", ""), u)
                if not im:
                    continue
                w, h = im.size
                if kind == "og-image" and (w / max(h, 1) > 2.4 or abs(w / max(h, 1) - cw / max(ch, 1)) > 0.6):
                    continue  # og images are usually photos; only accept one shaped like the current logo
                score = max(w, h) * (1.15 if kind == "logo-img" else 1)
                if not best or score > best[0]:
                    best = (score, im, kind, u)
            except Exception:
                continue
        if best and max(best[1].size) >= 1.8 * max(cw, ch):
            im = best[1]
            im.thumbnail((640, 640))
            im.save(f"{OUT}/{g['id']}.png")
            report[g["id"]] = {"from": [cw, ch], "to": list(im.size), "kind": best[2], "url": best[3]}
            print(g["id"], cw, ch, "->", im.size, best[2], flush=True)
json.dump(report, open(f"{OUT}/report.json", "w"), indent=1)
