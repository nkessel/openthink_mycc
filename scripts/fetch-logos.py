"""Find and download a logo for each group that has a website but no logo.

Usage: python3 scripts/fetch-logos.py <data.json> [<data.json> ...] [--ids id1,id2]
Writes candidates to research/logos/<id>.png (normalized to PNG, max 400px) plus research/logos/report.json.
Review the contact sheet (research/logos/sheet-*.png) before copying accepted ones into public/logos/.

Candidates, best first: an <img>/<svg> in the page whose src/alt/class/id mentions "logo"; the site's
apple-touch-icon / largest declared icon; og:image (often a photo, kept last). Only the group's own site is read.
"""
import io, json, re, sys, os
from urllib.parse import urljoin
import requests
from bs4 import BeautifulSoup
from PIL import Image

UA = {"User-Agent": "Mozilla/5.0 (map logo finder; contact via github.com/nkessel/openthink_mycc)"}
OUT = "research/logos"
os.makedirs(OUT, exist_ok=True)


def get(url, **kw):
    return requests.get(url, headers=UA, timeout=15, allow_redirects=True, **kw)


def to_png(content, ctype, url):
    """Bytes of any image → a PIL RGBA image, or None."""
    try:
        if "svg" in (ctype or "") or url.lower().split("?")[0].endswith(".svg") or content[:200].lstrip().startswith(b"<svg") or b"<svg" in content[:500]:
            import cairosvg
            content = cairosvg.svg2png(bytestring=content, output_width=400)
        im = Image.open(io.BytesIO(content))
        im.load()
        if getattr(im, "n_frames", 1) > 1:
            im.seek(0)
        return im.convert("RGBA")
    except Exception:
        return None


def candidates(site):
    r = get(site)
    soup = BeautifulSoup(r.text, "html.parser")
    base = r.url
    out = []
    for img in soup.find_all(["img"]):
        attrs = " ".join(str(img.get(a, "")) for a in ("src", "alt", "class", "id", "data-src"))
        parent = img.find_parent(["a", "div", "header"])
        pattrs = " ".join(str(parent.get(a, "")) for a in ("class", "id")) if parent else ""
        if re.search(r"logo", attrs + " " + pattrs, re.I):
            src = img.get("src") or img.get("data-src") or ""
            if src.startswith("data:") and img.get("data-src"):
                src = img.get("data-src")
            if src and not src.startswith("data:"):
                out.append(("logo-img", urljoin(base, src)))
    icons = []
    for link in soup.find_all("link"):
        rel = " ".join(link.get("rel", [])).lower()
        if "icon" in rel and link.get("href"):
            size = 0
            m = re.match(r"(\d+)x", link.get("sizes", "") or "")
            if m:
                size = int(m.group(1))
            if "apple-touch" in rel:
                size = max(size, 180)
            icons.append((size, urljoin(base, link["href"])))
    for size, u in sorted(icons, reverse=True):
        out.append((f"icon-{size}", u))
    og = soup.find("meta", property="og:image") or soup.find("meta", attrs={"name": "og:image"})
    if og and og.get("content"):
        out.append(("og-image", urljoin(base, og["content"])))
    out.append(("favicon", urljoin(base, "/favicon.ico")))
    seen, uniq = set(), []
    for k, u in out:
        if u not in seen:
            seen.add(u)
            uniq.append((k, u))
    return uniq


def main():
    files = [a for a in sys.argv[1:] if not a.startswith("--")]
    only = None
    for a in sys.argv[1:]:
        if a.startswith("--ids="):
            only = set(a[6:].split(","))
    report = {}
    for f in files:
        d = json.load(open(f))
        for g in d["coalitions"] + d["organizations"]:
            if only is not None and g["id"] not in only:
                continue
            if only is None and g.get("logo"):
                continue
            site = g.get("website")
            if not site:
                report[g["id"]] = {"status": "no website"}
                continue
            try:
                cands = candidates(site)
            except Exception as e:
                report[g["id"]] = {"status": f"site error: {type(e).__name__}"}
                continue
            chosen = None
            for kind, u in cands:
                try:
                    r = get(u)
                    if r.status_code != 200:
                        continue
                    im = to_png(r.content, r.headers.get("content-type", ""), u)
                    if not im:
                        continue
                    w, h = im.size
                    # a real logo is at least ~64px on its short side (favicons may be 32: keep as last resort)
                    if min(w, h) < 48 and kind != "favicon":
                        continue
                    if kind == "og-image" and (w / max(h, 1) > 2.4 or min(w, h) < 120):
                        continue
                    im.thumbnail((400, 400))
                    path = f"{OUT}/{g['id']}.png"
                    im.save(path)
                    chosen = {"status": "ok", "kind": kind, "url": u, "size": [w, h], "source_site": site}
                    break
                except Exception:
                    continue
            report[g["id"]] = chosen or {"status": "no usable image", "tried": len(cands)}
            print(g["id"], report[g["id"]].get("kind") or report[g["id"]]["status"], flush=True)
    old = {}
    if os.path.exists(f"{OUT}/report.json"):
        old = json.load(open(f"{OUT}/report.json"))
    old.update(report)
    json.dump(old, open(f"{OUT}/report.json", "w"), indent=1)


if __name__ == "__main__":
    main()
