#!/usr/bin/env python3
"""Find each group's social media links on its own website (read only).

  python3 data-review/scripts/find-socials.py live.json data-review/2026-11-social-handles.csv

live.json is the map's public data (the sheet's JSON feed, or public/data.json).
For each group: its website (or, when that is blank, the site its items link to) is fetched, then up to two more
pages on the same site (contact / about / connect), and every link to a social platform is written to the CSV.
Nothing is guessed: a row only exists when the link is on a page, and the page is named in found_on.
The script never opens the social platforms themselves, so it cannot tell whether an account is still active.
"""
import csv, json, re, sys, html
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urljoin, urlparse
import urllib.request, ssl, subprocess

UA = "Mozilla/5.0 (compatible; MACOM-data-check/1.0; +https://ma.climateorgmap.earth)"
PLATFORMS = [  # (name, host pattern, handle pattern on the path)
    ("instagram", r"(?:www\.)?instagram\.com", r"^/([A-Za-z0-9._]{2,30})/?$"),
    ("facebook", r"(?:www\.|m\.|web\.)?facebook\.com", r"^/(?:pages/[^/]+/\d+|groups/[^/?#]+|profile\.php\?id=\d+|people/[^/]+/\d+|[A-Za-z0-9.\-]{3,80})/?$"),
    ("x", r"(?:www\.|mobile\.)?(?:twitter|x)\.com", r"^/@?([A-Za-z0-9_]{2,15})/?$"),
    ("bluesky", r"bsky\.app", r"^/profile/([A-Za-z0-9.\-:]+)/?$"),
    ("linkedin", r"(?:[a-z]{2,3}\.)?linkedin\.com", r"^/(?:company|school|showcase|groups)/([^/?#]+)/?"),
    ("youtube", r"(?:www\.)?youtube\.com", r"^/(?:@[^/?#]+|channel/[^/?#]+|c/[^/?#]+|user/[^/?#]+)/?"),
    ("tiktok", r"(?:www\.)?tiktok\.com", r"^/@([A-Za-z0-9._]{2,30})/?$"),
    ("threads", r"(?:www\.)?threads\.(?:net|com)", r"^/@([A-Za-z0-9._]{2,30})/?$"),
    ("linktree", r"(?:www\.)?linktr\.ee", r"^/([A-Za-z0-9._]{2,40})/?$"),
]
# Paths that are the platform's own pages or share buttons, not an account.
NOT_ACCOUNTS = {"sharer", "sharer.php", "share", "share.php", "intent", "home", "login", "signup", "explore", "p", "reel", "reels",
                "tr", "plugins", "dialog", "hashtag", "search", "watch", "embed", "playlist", "results", "privacy", "policies",
                "help", "about", "legal", "tv", "stories", "accounts", "i", "events", "photo", "photo.php", "story.php", "l.php",
                "2008", "feed", "shareArticle", "sharing", "wix", "squarespace", "weebly", "wordpress", "godaddy", "canva"}
SITE_BUILDERS = re.compile(r"/(wix|squarespace|weebly|wordpressdotcom|wordpress|godaddy|google|nationbuilder|actionnetwork|mobilizeamerica)/?$", re.I)
SKIP_HOSTS = re.compile(r"(instagram|facebook|twitter|x|bsky|linkedin|youtube|youtu|tiktok|threads|linktr|zoom|google|eventbrite|actionnetwork|mobilize|bit|forms|docs)\.", re.I)
MORE_PAGES = re.compile(r"contact|about|connect|get-?involved|follow|social|join|who-we-are", re.I)
CTX = ssl.create_default_context()
BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"


def fetch(url):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,*/*"})
        with urllib.request.urlopen(req, timeout=25, context=CTX) as r:
            if "html" not in (r.headers.get("Content-Type") or "html"):
                return r.geturl(), ""
            return r.geturl(), r.read(3_000_000).decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001 - any failure is recorded, not hidden
        # Some sites refuse scripts outright: one more try with curl and a browser's name.
        try:
            out = subprocess.run(["curl", "-sL", "--max-time", "30", "-A", BROWSER_UA, "-w", "\n%{http_code} %{url_effective}", url],
                                 capture_output=True, timeout=40).stdout.decode("utf-8", "replace")
            body, _, tail = out.rpartition("\n")
            code, _, final = tail.partition(" ")
            if code.startswith("2") and body.strip():
                return final or url, body[:3_000_000]
            return url, f"!ERR HTTP {code or '?'} (also refused a browser-like request)"
        except Exception:  # noqa: BLE001
            return url, f"!ERR {type(e).__name__}: {str(e)[:80]}"


def social(url):
    """(platform, handle, clean url) for a link to an account, else None."""
    try:
        u = urlparse(html.unescape(url.strip()))
    except ValueError:
        return None
    host = (u.netloc or "").lower()
    for name, hostpat, pathpat in PLATFORMS:
        if not re.fullmatch(hostpat, host):
            continue
        path = u.path or "/"
        if name == "facebook" and path.rstrip("/") == "/profile.php":
            path = f"/profile.php?{u.query}"
        first = path.strip("/").split("/")[0].lstrip("@")
        if not first or first in NOT_ACCOUNTS or SITE_BUILDERS.search(path):
            return None
        if not re.search(pathpat, path):
            return None
        handle = path.strip("/")
        if name in ("instagram", "x", "tiktok", "threads", "linktree"):
            handle = handle.lstrip("@").lower()
        if name == "bluesky":
            handle = handle.split("/", 1)[1]
        clean = f"https://{host}{'/' if not path.startswith('/') else ''}{path}".rstrip("/")
        return name, handle, clean
    return None


def site_for(g):
    w = (g.get("website") or "").strip()
    if w:
        return w, "website"
    hosts = Counter()
    for kind in ("projects", "events", "actions"):
        for it in g.get(kind) or []:
            for f in ("link", "rsvp_link"):
                l = (it.get(f) or "").strip()
                h = urlparse(l).netloc.lower()
                if l.startswith("http") and h and not SKIP_HOSTS.search(h + "."):
                    hosts[f"{urlparse(l).scheme}://{h}/"] += 1
    if hosts:
        return hosts.most_common(1)[0][0], "item links"
    return "", "none"


def check(g):
    rows, site, source = [], *site_for(g)
    base = {"group_id": g["id"], "group_name": g["name"], "site_used": site, "site_source": source}
    if not site:
        return [{**base, "note": "no website and no item links: needs a web search or the point person"}]
    direct = social(site)
    if direct:  # the "website" is itself a social page
        return [{**base, "platform": direct[0], "handle": direct[1], "url": direct[2], "found_on": "website column", "note": "the group's listed website"}]
    final, text = fetch(site)
    if text.startswith("!ERR"):
        return [{**base, "note": f"could not open the site ({text[5:]})"}]
    pages, seen, found = [(final, text)], {final}, {}
    links = re.findall(r'href\s*=\s*["\']([^"\'#]+)', text, re.I)
    more = []
    for l in links:
        full = urljoin(final, html.unescape(l))
        if urlparse(full).netloc == urlparse(final).netloc and MORE_PAGES.search(urlparse(full).path) and full not in seen:
            seen.add(full); more.append(full)
    def scan(page, body):
        for l in re.findall(r'href\s*=\s*["\']([^"\']+)', body, re.I):
            s = social(urljoin(page, l))
            if s and (s[0], s[1].lower()) not in found:
                found[(s[0], s[1].lower())] = (s, page)
    scan(final, text)
    if not found:
        for m in more[:2]:
            mf, mt = fetch(m)
            if not mt.startswith("!ERR"):
                pages.append((mf, mt)); scan(mf, mt)
    u = urlparse(final)
    part_of_bigger = len(u.path.strip("/")) > 0 or re.search(r"k12|\.edu$|schools?\.|school\.org", u.netloc)
    hint = "page on a larger site (school, national group…): the accounts may be the host's, not this group's" if part_of_bigger and source == "website" else ""
    if not found:
        empty = all(len(re.sub(r"<[^>]+>", "", t)) < 400 for _, t in pages)
        return [{**base, "note": "no social links on the site" + (" (page came back nearly empty: it may load with JavaScript)" if empty else "")}]
    for (s, page) in found.values():
        rows.append({**base, "platform": s[0], "handle": s[1], "url": s[2], "found_on": page, "note": hint})
    return rows


def main():
    data = json.load(open(sys.argv[1], encoding="utf-8"))
    groups = data["organizations"] + data.get("coalitions", [])
    with ThreadPoolExecutor(8) as ex:
        results = list(ex.map(check, groups))
    shared = Counter((r.get("platform"), r.get("handle")) for rows in results for r in rows if r.get("platform"))
    for rows in results:
        for r in rows:
            if r.get("platform") and shared[(r["platform"], r["handle"])] > 1 and not r.get("note"):
                r["note"] = "same account is listed for other groups too: probably a parent or national account"
    cols = ["group_id", "group_name", "site_used", "site_source", "platform", "handle", "url", "found_on", "note"]
    with open(sys.argv[2], "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=cols); w.writeheader()
        for rows in results:
            for r in sorted(rows, key=lambda r: r.get("platform", "")):
                w.writerow({c: r.get(c, "") for c in cols})
    with_any = sum(1 for rows in results if any(r.get("platform") for r in rows))
    print(f"{len(groups)} groups and coalitions; social links found for {with_any}")
    print("by platform:", dict(Counter(r["platform"] for rows in results for r in rows if r.get("platform"))))
    print("no result:", dict(Counter(re.sub(r" \(.*", "", r["note"]) for rows in results for r in rows if not r.get("platform"))))


if __name__ == "__main__":
    main()
