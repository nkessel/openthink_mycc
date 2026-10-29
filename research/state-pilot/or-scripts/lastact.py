"""Newest dated activity (<= today) on each group's own site: WP posts API, RSS/Atom feeds, sitemap lastmod."""
import json, re, sys, concurrent.futures as cf, datetime as dt
from email.utils import parsedate_to_datetime
from urllib.parse import urlparse
sys.path.insert(0, ".")
import requests
from pf import allowed
BUA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
TODAY = "2026-10-13"
def g(u, **kw):
    if not allowed(u): return None
    try:
        r = requests.get(u, headers={"User-Agent": BUA}, timeout=15, **kw)
        return r if r.status_code == 200 else None
    except Exception: return None
def ok(d): return d and "2025-01-01" <= d <= TODAY
def wp(root):
    r = g(root + "/wp-json/wp/v2/posts?per_page=3&_fields=date,link")
    try:
        ps = r.json() if r else []
        ds = [(p["date"][:10], p["link"]) for p in ps if ok(p["date"][:10])]
        return max(ds) if ds else None
    except Exception: return None
def feed(root):
    for path in ["/feed/", "/rss.xml", "/feed.xml", "/blog?format=rss", "/news?format=rss", "/updates?format=rss", "/atom.xml", "/index.xml"]:
        r = g(root + path)
        if not r or not re.search(r"<(rss|feed)\b", r.text[:2000]): continue
        ds = []
        for m in re.findall(r"<item>.*?</item>|<entry>.*?</entry>", r.text, re.S)[:20]:
            d = re.search(r"<pubDate>(.*?)</pubDate>|<(?:updated|published)>(.*?)</", m, re.S)
            l = re.search(r"<link>(.*?)</link>|<link[^>]*href=\"([^\"]+)\"", m, re.S)
            if not d: continue
            s = (d.group(1) or d.group(2)).strip()
            try: iso = parsedate_to_datetime(s).date().isoformat() if d.group(1) else s[:10]
            except Exception: continue
            if ok(iso): ds.append((iso, (l.group(1) or l.group(2)).strip() if l else root + path))
        if ds: return max(ds)
    return None
def sitemap(root):
    for path in ["/sitemap.xml", "/wp-sitemap.xml", "/sitemap_index.xml"]:
        r = g(root + path)
        if not r: continue
        ds = [d[:10] for d in re.findall(r"<lastmod>([^<]+)</lastmod>", r.text)]
        ds = [d for d in ds if ok(d)]
        if ds: return (max(ds), root + path)
    return None
def go(item):
    oid, web = item
    p = urlparse(web); root = f"{p.scheme}://{p.netloc}"
    for kind, fn in (("posts", wp), ("feed", feed), ("sitemap", sitemap)):
        hit = fn(root)
        if hit: return oid, {"date": hit[0], "src": hit[1], "kind": kind}
    return oid, None
d = json.load(open("/home/claude/openthink_mycc/research/state-pilot/or.json"))
items = [(o["id"], o["website"]) for o in d["organizations"] + d["coalitions"] if o.get("website") and "sierraclub.org" not in o["website"] or (o.get("website") and o["id"] in ("or_sierra_club",))]
items = [i for i in items if i[1]]
with cf.ThreadPoolExecutor(16) as ex: res = dict(ex.map(go, items))
json.dump(res, open("lastact.json", "w"), indent=1)
hit = {k: v for k, v in res.items() if v}
print(len(items), "sites;", len(hit), "dated:", {k: sum(1 for v in hit.values() if v["kind"] == k) for k in ("posts", "feed", "sitemap")})
