"""Find upcoming events published as schema.org Event (JSON-LD) on groups' own sites and the event pages they link to."""
import json, re, sys, html, concurrent.futures as cf
from urllib.parse import urlparse, urljoin
sys.path.insert(0, ".")
import requests
from bs4 import BeautifulSoup
from pf import allowed
BUA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
TODAY = "2026-10-13"
PLAT = re.compile(r"eventbrite\.com/e/|actionnetwork\.org/events/|lu\.ma/|meetup\.com/[^/]+/events/\d|zeffy\.com/.*(ticket|event)|givebutter\.com/|humanitix\.com/|ticketleap|brownpapertickets|tinyurl", re.I)
def get(u):
    if not allowed(u): return None
    try:
        r = requests.get(u, headers={"User-Agent": BUA}, timeout=15)
        return r if r.status_code == 200 and "html" in r.headers.get("content-type", "") else None
    except Exception: return None
def jsonld_events(soup, page):
    out = []
    for s in soup.find_all("script", type="application/ld+json"):
        try: j = json.loads(s.string or "")
        except Exception: continue
        stack = j if isinstance(j, list) else [j]
        while stack:
            x = stack.pop()
            if isinstance(x, list): stack += x; continue
            if not isinstance(x, dict): continue
            if "@graph" in x: stack += x["@graph"]
            t = x.get("@type"); t = t if isinstance(t, list) else [t]
            if any(str(tt).endswith("Event") for tt in t) and x.get("startDate"):
                loc = x.get("location") or {}
                if isinstance(loc, list): loc = loc[0] if loc else {}
                addr = loc.get("address") if isinstance(loc, dict) else None
                if isinstance(addr, dict): addr = ", ".join(v for v in [addr.get("streetAddress"), addr.get("addressLocality"), addr.get("addressRegion")] if v)
                geo = loc.get("geo") if isinstance(loc, dict) else None
                out.append({"name": html.unescape(x.get("name", "")), "start": x["startDate"], "end": x.get("endDate"),
                            "url": x.get("url") or page, "page": page, "desc": html.unescape(re.sub(r"<[^>]+>", " ", x.get("description", "") or ""))[:500],
                            "venue": loc.get("name") if isinstance(loc, dict) else str(loc), "address": addr,
                            "online": "Online" in str(x.get("eventAttendanceMode", "")) or (isinstance(loc, dict) and loc.get("@type") == "VirtualLocation"),
                            "geo": [geo.get("latitude"), geo.get("longitude")] if isinstance(geo, dict) else None,
                            "organizer": (x.get("organizer") or {}).get("name") if isinstance(x.get("organizer"), dict) else None})
    return out
def go(item):
    oid, web = item
    p = urlparse(web); root = f"{p.scheme}://{p.netloc}"
    seen, evs, links = set(), [], []
    for path in ["", "/events", "/events/", "/calendar", "/upcoming-events", "/get-involved", "/take-action", "/volunteer", "/events/list/"]:
        u = (web.rstrip("/") if not path else root + path)
        if u in seen: continue
        seen.add(u); r = get(u)
        if not r: continue
        s = BeautifulSoup(r.text, "html.parser")
        evs += jsonld_events(s, r.url)
        for a in s.find_all("a", href=True):
            h = urljoin(r.url, a["href"]).split("#")[0]
            if PLAT.search(h) or (urlparse(h).netloc == p.netloc and re.search(r"/events?/[^/?]{6,}", h) and not re.search(r"/(category|tag|list|month|day|week|page|feed)/|\?ical|ical=|outlook", h)):
                links.append(h)
    for h in list(dict.fromkeys(links))[:20]:
        if h in seen: continue
        seen.add(h); r = get(h)
        if r: evs += jsonld_events(BeautifulSoup(r.text, "html.parser"), r.url)
    keep = {}
    for e in evs:
        if e["start"][:10] >= TODAY: keep[(e["name"], e["start"][:16])] = e
    return oid, list(keep.values())
if __name__ == "__main__":
  d = json.load(open("/home/claude/openthink_mycc/research/state-pilot/or.json"))
  items = [(o["id"], o["website"]) for o in d["organizations"] + d["coalitions"] if o.get("website")]
  with cf.ThreadPoolExecutor(16) as ex: res = dict(ex.map(go, items))
  json.dump(res, open("harvest.json", "w"), indent=1, ensure_ascii=False)
  for k, v in res.items():
      if v: print(f"== {k}: {len(v)}"); [print("   ", e["start"][:16], "|", e["name"][:70], "|", (e["venue"] or "")[:25], "|", e["url"][:70]) for e in sorted(v, key=lambda e: e["start"])[:12]]
