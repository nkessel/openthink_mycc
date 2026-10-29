"""Candidate projects/actions: links under 'work / programs / campaigns / get involved' pages + their meta descriptions."""
import json, re, sys, concurrent.futures as cf
from urllib.parse import urlparse, urljoin
sys.path.insert(0, ".")
import requests
from bs4 import BeautifulSoup
from pf import allowed
BUA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
KEY = re.compile(r"/(our-?work|programs?|campaigns?|projects?|initiatives?|what-?we-?do|issues|get-?involved|take-?action|volunteer|act|action|advocacy|priorities|work)(/|$)", re.I)
def get(u):
    if not allowed(u): return None
    try:
        r = requests.get(u, headers={"User-Agent": BUA}, timeout=15)
        return r if r.status_code == 200 and "html" in r.headers.get("content-type", "") else None
    except Exception: return None
def meta(s):
    m = s.find("meta", attrs={"name": "description"}) or s.find("meta", attrs={"property": "og:description"})
    return re.sub(r"\s+", " ", (m.get("content") or "")).strip()[:260] if m else ""
def go(item):
    oid, web = item
    p = urlparse(web); root = f"{p.scheme}://{p.netloc}"
    r = get(web)
    if not r: return oid, []
    s = BeautifulSoup(r.text, "html.parser")
    cands = {}
    for a in s.find_all("a", href=True):
        h = urljoin(r.url, a["href"]).split("#")[0].split("?")[0].rstrip("/")
        t = a.get_text(" ", strip=True)
        if urlparse(h).netloc != urlparse(r.url).netloc or not t or len(t) > 70: continue
        path = urlparse(h).path
        if KEY.search(path) and path.count("/") >= 1 and h.rstrip("/") != root:
            cands.setdefault(h, t)
    out = []
    for h, t in list(cands.items())[:25]:
        rr = get(h)
        if not rr: continue
        out.append({"url": h, "text": t, "meta": meta(BeautifulSoup(rr.text, "html.parser"))})
    return oid, out
if __name__ == "__main__":
    d = json.load(open("/home/claude/openthink_mycc/research/state-pilot/or.json"))
    skip = {"or_cbd","or_cfs","or_defenders","or_fww","or_oceana","or_climate_interactive","or_zfp","or_bga","or_tnc","or_hecc","or_deq","or_portland_bps","or_milwaukie","or_tigard","or_gresham","or_ashland","or_bend","or_hood_river","or_lake_oswego","or_multco_sustainability","or_central_city_concern","or_ibew48","or_oregon_aflcio","or_rncs","or_hazadapt","or_ossia"}
    items = [(o["id"], o["website"]) for o in d["organizations"] + d["coalitions"] if o.get("website") and o["id"] not in skip]
    with cf.ThreadPoolExecutor(16) as ex: res = dict(ex.map(go, items))
    json.dump(res, open("progs.json", "w"), indent=1, ensure_ascii=False)
    print(sum(1 for v in res.values() if v), "groups with candidates;", sum(len(v) for v in res.values()), "links")
