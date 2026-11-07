"""Step 2: fetch each trial group's homepage, its item links (link + rsvp_link), and up to 9 more pages
linked from the homepage (one click deep) that look like campaign / project / event / volunteer pages.

Limits (from the prompt): discovery pages = homepage + at most 9 more, homepage or one click deeper only.
Item links are fetched on top of that, since every item has to be checked (see the response tab).
/sitemap.xml is read for every site (it lists pages that load with JavaScript on Wix/Squarespace).
Output: work/pages.json (per group: site used, pages fetched with status and kind), cache/ (raw HTML).
"""
import collections, re, sys, urllib.parse
from common import *

KEYWORDS = ["campaign", "project", "program", "working-group", "workinggroup", "team", "event", "calendar",
            "volunteer", "get-involved", "getinvolved", "take-action", "takeaction", "action", "join",
            "committee", "initiative", "our-work", "what-we-do", "priorities", "issues"]
SKIP = re.compile(r"(donate|privacy|terms|login|cart|shop|store|wp-json|feed|\.pdf$|\.jpg$|\.png$|mailto:|tel:|#)", re.I)
MAX_DISCOVERY = 9


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


def main():
    data = load_json("items.json")
    out = {}
    for g in data["groups"]:
        if sys.argv[1:] and g["id"] not in sys.argv[1:]:
            continue
        site, how = site_for(g)
        rec = {"site": site, "site_source": how, "pages": [], "sitemap": [], "social_only": False}
        if site and any(h in site for h in SOCIAL):
            rec["social_only"] = True
        pages = rec["pages"]
        if site and not rec["social_only"]:
            home = fetch(site)
            pages.append(home | {"kind": "homepage"})
            rec["sitemap"] = sitemap_urls(site)
            # discovery: homepage links one click deep, same site, scored by keywords
            item_urls = {norm_url(u) for it in g["items"] for u in (it.get("link"), it.get("rsvp_link")) if u}
            cands = {}
            for href, text in links_of(site) if home["status"] == 200 else []:
                if host(href) != host(site) or SKIP.search(href) or norm_url(href) in item_urls:
                    continue
                if norm_url(href) == norm_url(site):
                    continue
                low = (href + " " + text).lower()
                score = sum(k in low for k in KEYWORDS)
                if score:
                    cands[norm_url(href)] = max(cands.get(norm_url(href), 0), score)
            picked = [u for u, _ in sorted(cands.items(), key=lambda kv: (-kv[1], kv[0]))[:MAX_DISCOVERY]]
            # Small sites (Wix, Squarespace, Weebly): their menus often load with JavaScript, so the homepage
            # shows few links. Their sitemap lists the same top-level pages; fill the budget from it.
            if len(picked) < MAX_DISCOVERY and len(rec["sitemap"]) <= 40:
                extra = sorted((u for u in rec["sitemap"] if norm_url(u) not in item_urls | set(picked) | {norm_url(site)}
                                and not SKIP.search(u) and not re.search(r"(contact|store/|photo|pictures|20(1\d|20))", u)),
                               key=lambda u: (-sum(k in u.lower() for k in KEYWORDS), u))
                picked += [norm_url(u) for u in extra[:MAX_DISCOVERY - len(picked)]]
            for u in picked:
                pages.append(fetch(u) | {"kind": "discovery"})
        for it in g["items"]:
            for f in ("link", "rsvp_link"):
                u = it.get(f)
                if u and not any(p["url"] == u for p in pages):
                    pages.append(fetch(u) | {"kind": "item_" + f, "item_id": it["id"]})
                elif u:
                    for p in pages:
                        if p["url"] == u:
                            p.setdefault("item_ids", []).append(it["id"])
        for p in pages:
            p["text_chars"] = len(trimmed_text(p["url"])) if p.get("status") == 200 else 0
            r = raw(p["url"])[:200000].decode("utf-8", "replace").lower()
            p["builder"] = "wix" if "wix.com" in r or "_wixcss" in r else "squarespace" if "squarespace" in r else ""
        out[g["id"]] = rec
        n_disc = sum(p["kind"] in ("homepage", "discovery") for p in pages)
        print(f"{g['id']}: {site} ({how}) discovery={n_disc} total={len(pages)} sitemap={len(rec['sitemap'])}")
        for p in pages:
            print(f"   {p['status']} {p['kind']:16} {p['text_chars']:6} {p['builder']:11} {p['url']}" + (f" -> {p['final_url']}" if p['final_url'] != p['url'] else ""))
    save_json("pages.json", out)

if __name__ == "__main__":
    main()
