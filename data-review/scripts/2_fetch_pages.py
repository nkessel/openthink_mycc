"""Step 2: fetch each trial group's pages, at most 10 per group in this order (team answers, Nov 2026):
homepage, then each item's own link (and rsvp_link), then other pages linked from the homepage (one click
deep) that look like campaign / project / event / volunteer pages. Past one-off events are skipped (the map
already hides them). Items whose page doesn't fit under the cap are listed (they become "couldn't check").
/sitemap.xml is read for every site (it lists pages that load with JavaScript on Wix/Squarespace).
Usage: python3 2_fetch_pages.py [--cache-only] [group_id ...]
Output: work/pages.json (per group: pages fetched with status and kind), cache/ (raw HTML).
"""
import collections, re, sys, urllib.parse
from common import *

KEYWORDS = ["campaign", "project", "program", "working-group", "workinggroup", "team", "event", "calendar",
            "volunteer", "get-involved", "getinvolved", "take-action", "takeaction", "action", "join",
            "committee", "initiative", "our-work", "what-we-do", "priorities", "issues"]
SKIP = re.compile(r"(donate|privacy|terms|login|cart|shop|store|wp-json|feed|\.pdf$|\.jpg$|\.png$|mailto:|tel:|#)", re.I)


def site_for(g):
    if g.get("website"):
        u = g["website"]
        p = urllib.parse.urlsplit(u)
        return f"{p.scheme}://{p.netloc}/", "website column"
    hosts = collections.Counter()
    for it in g["items"]:
        for u in (it.get("link"), it.get("rsvp_link")):
            if u and not any(h in u for h in EVENT_HOSTS + SOCIAL):
                p = urllib.parse.urlsplit(u)
                hosts[f"{p.scheme}://{p.netloc}/"] += 1
    if hosts:
        return hosts.most_common(1)[0][0], "website column blank: most common item-link site"
    return "", "no website and no item links"


def links_of(url):
    s = soup(url)
    out = []
    for a in s.find_all("a", href=True):
        href = urllib.parse.urljoin(url, a["href"]).split("#")[0]
        out.append((href, re.sub(r"\s+", " ", a.get_text(" ")).strip()))
    return out


def sitemap_urls(base):
    urls, seen = [], set()
    todo = [base + "sitemap.xml"]
    while todo and len(seen) < 6:
        sm = todo.pop(0)
        if sm in seen:
            continue
        seen.add(sm)
        m = fetch(sm)
        if m["status"] != 200:
            continue
        locs = re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", raw(sm).decode("utf-8", "replace"))
        for l in locs:
            (todo if l.endswith(".xml") else urls).append(l)
    return urls


def depth(u):
    return len([x for x in urllib.parse.urlsplit(u).path.split("/") if x])


def main():
    """Page order under the cap (team answer Q2): homepage, then item links (link, then rsvp_link; past one-off
    events skipped), then other pages linked from the homepage: shallow hub pages first, then by keywords.
    At most MAX_PAGES pages per group, all counted. /sitemap.xml is read but not counted (it is not a page).
    --cache-only: use only pages already in work/cache (no new fetching); skipped candidates are listed."""
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    cache_only = "--cache-only" in sys.argv
    get = (lambda u: fetch(u) if cached(u) else None) if cache_only else fetch
    data = load_json("items.json")
    out = {}
    for g in data["groups"]:
        if args and g["id"] not in args:
            continue
        site, how = site_for(g)
        rec = {"site": site, "site_source": how, "pages": [], "sitemap": [], "social_only": False,
               "cap": MAX_PAGES, "past_events_skipped": [], "page_cap_items": [], "not_in_cache": []}
        if site and any(h in site for h in SOCIAL):
            rec["social_only"] = True
        pages = rec["pages"]
        seen = set()

        def take(u, kind, item_id=None):
            n = norm_url(u).rstrip("/")
            if n in seen:
                for p in pages:
                    if norm_url(p["url"]).rstrip("/") == n and item_id:
                        p.setdefault("item_ids", []).append(item_id)
                return True
            if len(pages) >= MAX_PAGES:
                return False
            m = get(u)
            if m is None:
                rec["not_in_cache"].append(u)
                return False
            seen.add(n)
            pages.append(m | {"kind": kind} | ({"item_ids": [item_id]} if item_id else {}))
            return True

        home_ok = False
        if site and not rec["social_only"]:
            home_ok = take(site, "homepage") and pages[0].get("status") == 200
            rec["sitemap"] = sitemap_urls(site) if not cache_only or cached(site + "sitemap.xml") else []
        for it in g["items"]:
            if past_one_off(it):
                rec["past_events_skipped"].append(it["id"])
                continue
            for f in ("link", "rsvp_link"):
                u = it.get(f)
                if u and not take(u, "item_" + f, it["id"]):
                    rec["page_cap_items"].append({"item_id": it["id"], "field": f, "url": u})
        if home_ok:
            item_urls = {norm_url(u) for it in g["items"] for u in (it.get("link"), it.get("rsvp_link")) if u}
            cands = {}
            for href, text in links_of(site):
                if host(href) != host(site) or SKIP.search(href) or norm_url(href) in item_urls or norm_url(href) == norm_url(site):
                    continue
                low = (href + " " + text).lower()
                score = sum(k in low for k in KEYWORDS)
                if score:
                    cands[norm_url(href)] = max(cands.get(norm_url(href), 0), score)
            # Small sites (Wix, Squarespace, Weebly): menus often load with JavaScript, so the homepage shows few
            # links. Their sitemap lists the same top-level pages.
            if len(cands) < MAX_PAGES and len(rec["sitemap"]) <= 40:
                for u in rec["sitemap"]:
                    if (norm_url(u) not in item_urls | {norm_url(site)} | set(cands) and not SKIP.search(u)
                            and not re.search(r"(contact|store/|photo|pictures|index\.html|20(1\d|20))", u)):
                        cands[norm_url(u)] = sum(k in u.lower() for k in KEYWORDS)
            for u in sorted(cands, key=lambda u: (depth(u), -cands[u], u)):
                if len(pages) >= MAX_PAGES:
                    break
                take(u, "discovery")
        for p in pages:
            p["text_chars"] = len(trimmed_text(p["url"])) if p.get("status") == 200 else 0
            r = raw(p["url"])[:200000].decode("utf-8", "replace").lower()
            p["builder"] = "wix" if "wix.com" in r or "_wixcss" in r else "squarespace" if "squarespace" in r else ""
        out[g["id"]] = rec
        print(f"{g['id']}: {site} ({how}) pages={len(pages)}/{MAX_PAGES} past_skipped={len(rec['past_events_skipped'])} "
              f"page_cap_items={len(rec['page_cap_items'])}" + (f" not_in_cache={len(rec['not_in_cache'])}" if cache_only else ""))
        for p in pages:
            print(f"   {p['status']} {p['kind']:16} {p['text_chars']:6} {p['builder']:11} {p['url']}" + (f" -> {p['final_url']}" if p['final_url'] != p['url'] else ""))
    save_json("pages.json", out)


if __name__ == "__main__":
    main()
