"""All logo-like images on each group's own site (for groups still without a logo), each saved as a candidate."""
import io, os, re, sys, json, concurrent.futures as cf
from urllib.parse import urljoin, urlparse
sys.path.insert(0, ".")
import requests
from bs4 import BeautifulSoup
from PIL import Image
from pf import allowed
from ordata import load
BUA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
OUT = "cand2"; os.makedirs(OUT, exist_ok=True)
def get(u):
    if not allowed(u): return None
    try:
        r = requests.get(u, headers={"User-Agent": BUA}, timeout=15)
        return r if r.status_code == 200 else None
    except Exception: return None
def to_img(b, u):
    try:
        if b[:300].lstrip().startswith(b"<svg") or b"<svg" in b[:500] or u.lower().split("?")[0].endswith(".svg"):
            import cairosvg; b = cairosvg.svg2png(bytestring=b, output_width=500)
        im = Image.open(io.BytesIO(b)); im.load()
        return im.convert("RGBA")
    except Exception: return None
def go(o):
    web = o["website"]; r = get(web)
    if not r: return o["id"], []
    s = BeautifulSoup(r.text, "html.parser"); base = r.url; c = []
    for img in s.find_all("img"):
        attrs = " ".join(str(img.get(a, "")) for a in ("src", "alt", "class", "id", "data-src", "srcset"))
        par = img.find_parent(["a", "header", "footer", "div"])
        pa = " ".join(str(par.get(a, "")) for a in ("class", "id", "href")) if par else ""
        if re.search(r"logo|brand|site-title|navbar|header", attrs + " " + pa, re.I):
            src = img.get("data-src") or img.get("src") or ""
            if src and not src.startswith("data:"): c.append(urljoin(base, src))
    for l in s.find_all("link"):
        if "icon" in " ".join(l.get("rel", [])).lower() and l.get("href"): c.append(urljoin(base, l["href"]))
    og = s.find("meta", property="og:image")
    if og and og.get("content"): c.append(urljoin(base, og["content"]))
    saved = []
    for k, u in enumerate(list(dict.fromkeys(c))[:10]):
        rr = get(u)
        if not rr: continue
        im = to_img(rr.content, u)
        if not im or min(im.size) < 40: continue
        im.thumbnail((500, 500)); p = f"{OUT}/{o['id']}__{k}.png"; im.save(p); saved.append({"path": p, "url": u, "size": im.size})
    return o["id"], saved
d = load()
todo = [o for o in d["organizations"] + d["coalitions"] if not o.get("logo") and o.get("website")]
with cf.ThreadPoolExecutor(12) as ex: res = dict(ex.map(go, todo))
json.dump(res, open(f"{OUT}/report.json", "w"), indent=1)
print(len(todo), "groups;", sum(1 for v in res.values() if v), "with candidates;", sum(len(v) for v in res.values()), "images")
